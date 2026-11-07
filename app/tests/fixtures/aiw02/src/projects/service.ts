// Project operations. Every change: one journal event + the new project state, in one transaction.
import {
  checkDescription, checkName, cleanDescription, cleanName, makeEvent, newProjectId, verifyChain,
  type ChainReport, type EventType, type FieldError, type JournalEvent, type Project,
} from "../core";
import { done, exclusive, openDb, req, StorageError, toStorageError } from "../storage";

export class ValidationError extends Error {
  constructor(public field: "name" | "description", public reason: FieldError) {
    super(`${field}:${reason}`);
    this.name = "ValidationError";
  }
}

type Listener = () => void;

export class ProjectStore {
  private db: Promise<IDBDatabase> | null = null;
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;

  constructor(private dbName = "aiw", private now: () => Date = () => new Date()) {
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`${dbName}-changes`);
      this.channel.onmessage = () => this.emit(); // another tab changed something
    }
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= openDb(this.dbName).catch((e) => {
      this.db = null; // try again next time
      throw e;
    });
    return this.db;
  }

  /** Called after any change, here or in another tab. */
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  async list(): Promise<Project[]> {
    const db = await this.open();
    try {
      return await req(db.transaction("projects").objectStore("projects").getAll() as IDBRequest<Project[]>);
    } catch (e) {
      throw toStorageError(e);
    }
  }

  async get(id: string): Promise<Project | undefined> {
    const db = await this.open();
    return req(db.transaction("projects").objectStore("projects").get(id) as IDBRequest<Project | undefined>);
  }

  async journal(): Promise<JournalEvent[]> {
    const db = await this.open();
    return req(db.transaction("events").objectStore("events").getAll() as IDBRequest<JournalEvent[]>);
  }

  async verify(): Promise<ChainReport> {
    return verifyChain(await this.journal());
  }

  async create(name: string, description = ""): Promise<Project> {
    const n = cleanName(name);
    const d = cleanDescription(description);
    const en = checkName(n);
    if (en) throw new ValidationError("name", en);
    const ed = checkDescription(d);
    if (ed) throw new ValidationError("description", ed);
    const id = newProjectId();
    return (await this.change(id, "project.created", { name: n, description: d }, (_cur, ts) => ({
      id, name: n, description: d, createdAt: ts, updatedAt: ts, pinned: false, deletedAt: null, nameHistory: [], v: 1,
    })))!;
  }

  /** Renames and keeps the old name in the history. Same name: nothing changes. */
  async rename(id: string, name: string): Promise<Project> {
    const n = cleanName(name);
    const err = checkName(n);
    if (err) throw new ValidationError("name", err);
    return (await this.change(id, "project.renamed", { name: n }, (cur, ts) => {
      if (cur.name === n) return cur;
      return { ...cur, name: n, updatedAt: ts, nameHistory: [...cur.nameHistory, { name: cur.name, until: ts }] };
    }))!;
  }

  async setDescription(id: string, description: string): Promise<Project> {
    const d = cleanDescription(description);
    const err = checkDescription(d);
    if (err) throw new ValidationError("description", err);
    return (await this.change(id, "project.updated", { description: d }, (cur, ts) =>
      cur.description === d ? cur : { ...cur, description: d, updatedAt: ts }))!;
  }

  /** Pinning does not count as a content change: the "recent" order is not affected. */
  async setPinned(id: string, pinned: boolean): Promise<Project> {
    return (await this.change(id, "project.pinned", { pinned }, (cur) => (cur.pinned === pinned ? cur : { ...cur, pinned })))!;
  }

  async trash(id: string): Promise<Project> {
    return (await this.change(id, "project.trashed", {}, (cur, ts) => (cur.deletedAt ? cur : { ...cur, deletedAt: ts })))!;
  }

  async restore(id: string): Promise<Project> {
    return (await this.change(id, "project.restored", {}, (cur) => (cur.deletedAt ? { ...cur, deletedAt: null } : cur)))!;
  }

  /**
   * Definitive delete, only from the trash. Removes the project and erases its names and texts from
   * the journal (the fingerprints stay, so the chain is still verifiable).
   */
  async purge(id: string): Promise<void> {
    await this.change(id, "project.purged", {}, (cur) => {
      if (!cur.deletedAt) throw new StorageError("conflict", "not in trash");
      return null;
    });
  }

  /**
   * The single write path. Reads the last event and the current project, prepares the new event
   * (fingerprints are computed outside the transaction), then writes everything in one transaction
   * after checking that nothing changed meanwhile.
   */
  private async change(id: string, type: EventType, data: Record<string, unknown>,
    next: (cur: Project, ts: string) => Project | null): Promise<Project | null> {
    const db = await this.open();
    const result = await exclusive(async () => {
      try {
        const r = db.transaction(["projects", "events"]);
        const [tail, cur] = await Promise.all([
          req(r.objectStore("events").openCursor(null, "prev")).then((c) => (c ? (c.value as JournalEvent) : null)),
          req(r.objectStore("projects").get(id) as IDBRequest<Project | undefined>),
        ]);
        const ts = this.now().toISOString();
        let updated: Project | null;
        if (type === "project.created") {
          if (cur) throw new StorageError("conflict", "id exists");
          updated = next(undefined as never, ts);
        } else {
          if (!cur) throw new StorageError("conflict", "missing project");
          updated = next(cur, ts);
          if (updated === cur) return cur; // nothing to save
        }
        const ev = await makeEvent(tail, ts, type, id, data);

        const w = db.transaction(["projects", "events"], "readwrite");
        const finished = done(w);
        finished.catch(() => undefined); // reported below; avoids an unhandled rejection after abort
        try {
          const projects = w.objectStore("projects");
          const events = w.objectStore("events");
          const now = await req(events.openCursor(null, "prev"));
          if ((now ? (now.value as JournalEvent).seq : 0) !== (tail?.seq ?? 0)) {
            w.abort();
            throw new StorageError("conflict", "journal moved");
          }
          if (updated) projects.put(updated);
          else {
            projects.delete(id);
            // erase the content of this project's past events (names, descriptions)
            const cursor = events.index("projectId").openCursor(IDBKeyRange.only(id));
            await new Promise<void>((resolve, reject) => {
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
          events.add(ev);
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
        return updated;
      } catch (e) {
        throw toStorageError(e);
      }
    });
    this.emit();
    this.channel?.postMessage("changed");
    return result;
  }

  close() {
    this.channel?.close();
    void this.db?.then((d) => d.close());
  }
}
