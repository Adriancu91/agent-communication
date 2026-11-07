// The single write path shared by every module (projects, memory, …), extracted from AIW-02.
// One change = one or more journal events + the new records, written in ONE transaction:
// saved completely or not at all. One writer at a time across tabs; other tabs are told to reload.
import { GENESIS, makeEvent, verifyChain, type ChainReport, type EventType, type JournalEvent } from "../core";
import { done, exclusive, openDb, req, StorageError, toStorageError, type Migration } from "./db";

export interface PendingEvent {
  type: EventType;
  projectId: string;
  entityId?: string;
  data: Record<string, unknown>;
  /** The event's own date, when it is not "now" (imported history keeps its original dates). */
  ts?: string;
}

export interface WritePlan<T> {
  /** Events to append, in order. No events = nothing to save (the result is returned as is). */
  events: PendingEvent[];
  /** Writes the new records. Runs inside the write transaction: use only IndexedDB requests here. */
  apply?: (tx: IDBTransaction) => Promise<void> | void;
  result: T;
}

/**
 * A checkpoint is the last {seq, hash} this device saw, kept OUTSIDE the database (localStorage).
 * It lets the integrity check notice a database that lost its most recent events or was rolled back.
 */
export interface Checkpoint {
  seq: number;
  hash: string;
}

export interface IntegrityReport extends ChainReport {
  /**
   * ok       — the chain matches the checkpoint kept outside the database;
   * missing  — no checkpoint on this device (e.g. site data partly cleared): only a PARTIAL check is possible;
   * behind   — the database has fewer events than this device last saw (latest events removed / rolled back);
   * mismatch — the checkpoint does not match the history.
   */
  checkpoint: "ok" | "missing" | "behind" | "mismatch";
}

/** Compares a journal snapshot with a checkpoint read BEFORE the snapshot (it only moves forward). */
export async function checkJournal(events: JournalEvent[], cp: Checkpoint | null): Promise<IntegrityReport> {
  const chain = await verifyChain(events);
  let checkpoint: IntegrityReport["checkpoint"];
  if (!cp) checkpoint = events.length === 0 ? "ok" : "missing";
  else if (cp.seq === 0) checkpoint = "ok";
  else if (!events[cp.seq - 1]) checkpoint = "behind";
  else checkpoint = events[cp.seq - 1].hash === cp.hash ? "ok" : "mismatch";
  return { ...chain, ok: chain.ok && (checkpoint === "ok" || checkpoint === "missing"), checkpoint };
}

type Listener = () => void;

export class JournaledStore {
  private db: Promise<IDBDatabase> | null = null;
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;

  constructor(
    readonly dbName = "aiw",
    private now: () => Date = () => new Date(),
    private migrations?: Migration[],
  ) {
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`${dbName}-changes`);
      this.channel.onmessage = () => this.emit(); // another tab changed something
    }
  }

  open(): Promise<IDBDatabase> {
    this.db ??= openDb(this.dbName, this.migrations).catch((e) => {
      this.db = null; // try again next time
      throw e;
    });
    return this.db;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** A read-only transaction over the given stores. */
  async read<T>(stores: string[], fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    try {
      return await fn(db.transaction(stores));
    } catch (e) {
      throw asStorageError(e);
    }
  }

  async journal(): Promise<JournalEvent[]> {
    return this.read(["events"], (tx) => req(tx.objectStore("events").getAll() as IDBRequest<JournalEvent[]>));
  }

  /**
   * The single write path.
   * 1. `prepare` reads the current state (IndexedDB requests only) and says what to write.
   * 2. Fingerprints are computed outside any transaction (the browser would close it meanwhile).
   * 3. One read-write transaction checks that the journal did not move, writes, appends the events;
   *    any error aborts everything.
   */
  async write<T>(stores: string[], prepare: (tx: IDBTransaction, ts: string) => Promise<WritePlan<T>>): Promise<T> {
    const db = await this.open();
    const all = [...new Set([...stores, "events"])];
    let wrote = false;
    const result = await exclusive(async () => {
      try {
        const r = db.transaction(all);
        const tailP = req(r.objectStore("events").openCursor(null, "prev")).then((c) => (c ? (c.value as JournalEvent) : null));
        const ts = this.now().toISOString();
        const [tail, plan] = await Promise.all([tailP, prepare(r, ts)]);
        if (plan.events.length === 0) return plan.result;

        const events: JournalEvent[] = [];
        let prev: { seq: number; hash: string } | null = tail;
        for (const p of plan.events) {
          const e = await makeEvent(prev, p.ts ?? ts, p.type, p.projectId, p.data, p.entityId);
          events.push(e);
          prev = e;
        }

        const w = db.transaction(all, "readwrite");
        const finished = done(w);
        finished.catch(() => undefined); // reported below; avoids an unhandled rejection after abort
        try {
          const now = await req(w.objectStore("events").openCursor(null, "prev"));
          if ((now ? (now.value as JournalEvent).seq : 0) !== (tail?.seq ?? 0)) throw new StorageError("conflict", "journal moved");
          await plan.apply?.(w);
          for (const e of events) w.objectStore("events").add(e);
        } catch (e) {
          // A failure after some writes were queued must cancel the whole transaction,
          // otherwise the browser would commit the part that succeeded.
          try {
            w.abort();
          } catch {
            /* already finished */
          }
          throw e;
        }
        await finished;
        wrote = true;
        this.saveCheckpoint(events[events.length - 1]);
        return plan.result;
      } catch (e) {
        throw asStorageError(e);
      }
    });
    if (wrote) {
      this.emit();
      this.channel?.postMessage("changed");
    }
    return result;
  }

  // ---------- integrity ----------

  private checkpointKey() {
    return `aiw.checkpoint:${this.dbName}`;
  }

  checkpoint(): Checkpoint | null {
    try {
      const raw = globalThis.localStorage?.getItem(this.checkpointKey());
      return raw ? (JSON.parse(raw) as Checkpoint) : null;
    } catch {
      return null;
    }
  }

  private saveCheckpoint(e: JournalEvent) {
    try {
      const cur = this.checkpoint();
      if (!cur || e.seq >= cur.seq) globalThis.localStorage?.setItem(this.checkpointKey(), JSON.stringify({ seq: e.seq, hash: e.hash }));
    } catch {
      /* no localStorage: the check reports "missing" */
    }
  }

  /**
   * Verifies the chain and compares it with the checkpoint kept outside the database.
   * The checkpoint is read first: a write that lands meanwhile can only make the journal longer
   * than the checkpoint, never shorter, so it cannot cause a false alarm.
   * Detects edited, removed or reordered events, and a journal that lost its latest events.
   * It cannot detect someone who rewrites the whole database AND the checkpoint consistently.
   */
  async verify(): Promise<IntegrityReport> {
    const cp = this.checkpoint();
    return checkJournal(await this.journal(), cp);
  }

  close() {
    this.channel?.close();
    void this.db?.then((d) => d.close());
  }
}

export { GENESIS };

/**
 * Browser errors become StorageErrors; the app's own errors (validation, link rules) pass through
 * unchanged, so the interface can show the exact reason.
 */
function asStorageError(e: unknown): unknown {
  if (e instanceof StorageError) return e;
  if (typeof DOMException !== "undefined" && e instanceof DOMException) return toStorageError(e);
  if (e instanceof Error && e.constructor !== Error && e.name !== "TypeError" && e.name !== "Error") return e; // our own error classes
  return toStorageError(e);
}

/** Clears the content (names, texts) of past events found through an index, keeping their fingerprints. */
export function eraseEventData(tx: IDBTransaction, index: "projectId" | "entityId", key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursor = tx.objectStore("events").index(index).openCursor(IDBKeyRange.only(key));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve();
      const e = c.value as JournalEvent;
      if (e.data !== null) c.update({ ...e, data: null });
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

/** Deletes every record found through an index (for example all memory entries of a project). */
export function deleteAll(tx: IDBTransaction, store: string, index: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursor = tx.objectStore(store).index(index).openCursor(IDBKeyRange.only(key));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve();
      c.delete();
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}
