// IndexedDB, wrapped by hand (no library): one database per app, versioned migrations, clear errors.
// Every change happens inside one transaction, so it is saved completely or not at all.

export type StorageErrorKind = "unavailable" | "quota" | "blocked" | "closed" | "conflict" | "unknown";

export class StorageError extends Error {
  constructor(public kind: StorageErrorKind, detail?: string) {
    super(`storage:${kind}${detail ? ` (${detail})` : ""}`);
    this.name = "StorageError";
  }
}

/** Turns any browser error into one of a few kinds the interface can explain. */
export function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  const name = (e as { name?: string })?.name ?? "";
  const msg = String((e as { message?: string })?.message ?? e);
  if (name === "QuotaExceededError" || /quota|space|disk/i.test(msg)) return new StorageError("quota", name || msg);
  if (name === "InvalidStateError" || name === "TransactionInactiveError") return new StorageError("closed", name);
  if (name === "SecurityError" || (name === "UnknownError" && /open/i.test(msg))) return new StorageError("unavailable", name);
  if (name === "VersionError") return new StorageError("blocked", name);
  return new StorageError("unknown", name || msg.slice(0, 120));
}

/**
 * Migrations, in order. Version N creates what version N needs; never edit an old step, add a new one.
 * Later stages (memory, conversations, files) add their stores here.
 */
export type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

export const MIGRATIONS: Migration[] = [
  // 1 — AIW-02: projects, the journal, settings
  (db) => {
    db.createObjectStore("projects", { keyPath: "id" });
    const ev = db.createObjectStore("events", { keyPath: "seq" });
    ev.createIndex("projectId", "projectId");
    db.createObjectStore("meta", { keyPath: "key" });
  },
  // 2 — AIW-03: project memory and the links between memory entries. Adds only; touches no existing data.
  (db, tx) => {
    const memory = db.createObjectStore("memory", { keyPath: "id" });
    memory.createIndex("projectId", "projectId");
    const links = db.createObjectStore("links", { keyPath: "id" });
    links.createIndex("projectId", "projectId");
    links.createIndex("from", "from");
    links.createIndex("to", "to");
    tx.objectStore("events").createIndex("entityId", "entityId");
  },
];
export const DB_VERSION = MIGRATIONS.length;

/** Stores whose records belong to one project: removed with the project on a definitive delete. */
export const PROJECT_SCOPED_STORES = ["memory", "links"] as const;

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(toStorageError(r.error));
  });
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(toStorageError(tx.error ?? new DOMException("aborted", "AbortError")));
    // A failed request aborts the whole transaction (the browser default); the abort handler reports it.
  });
}

let onClosed: (() => void) | null = null;
/** Called when another tab installs a newer version of the app's database. */
export function whenClosedByNewerVersion(cb: () => void): void {
  onClosed = cb;
}

/**
 * Opens (and if needed upgrades) the database. The upgrade runs in one transaction: if any step
 * fails, the browser keeps the previous version and its data untouched.
 */
export function openDb(name = "aiw", migrations: Migration[] = MIGRATIONS): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new StorageError("unavailable", "no IndexedDB"));
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      r = indexedDB.open(name, migrations.length);
    } catch (e) {
      reject(new StorageError("unavailable", String(e)));
      return;
    }
    r.onupgradeneeded = (ev) => {
      const tx = r.transaction!;
      try {
        for (let v = ev.oldVersion; v < migrations.length; v++) migrations[v](r.result, tx);
      } catch (e) {
        tx.abort(); // nothing of the upgrade is kept; the database stays at its previous version
        reject(new StorageError("unknown", "upgrade failed: " + String(e).slice(0, 80)));
      }
    };
    r.onblocked = () => reject(new StorageError("blocked"));
    r.onerror = () => reject(toStorageError(r.error));
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        onClosed?.();
      };
      resolve(db);
    };
  });
}

/** One writer at a time, across all open tabs (Web Locks), or inside this tab when Web Locks are missing. */
let localQueue: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks?.request) return locks.request("aiw-write", fn) as Promise<T>;
  const run = localQueue.then(fn, fn);
  localQueue = run.catch(() => undefined);
  return run;
}
