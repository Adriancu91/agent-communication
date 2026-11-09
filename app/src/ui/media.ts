// AIW-09: the pictures made in the chat, kept on this device in their own small database ("aiw-media"),
// apart from the journaled app data. A picture is saved in the chat as its address (markdown); the bytes
// live here, so showing it again never asks the free service again (its anonymous tier allows one picture
// every 45 seconds). A picture whose bytes are not here (another device, after an archive import, or
// evicted) is shown as a placeholder the person can tap to load — never fetched on its own.
import { useEffect, useState } from "preact/hooks";

const DB = "aiw-media";
const STORE = "images";
/** Enough for a long history on a phone (a picture is ~100–200 KB); the oldest pictures go first. */
export const MEDIA_MAX_ITEMS = 200;

/** The bytes are kept as a buffer (not a Blob): WebKit's IndexedDB does not keep every Blob it is given. */
interface Row { url: string; data: ArrayBuffer; type: string; at: number }

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let opening: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no IndexedDB"));
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "url" }).createIndex("at", "at");
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("blocked"));
  }).catch((e) => { opening = null; throw e; });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await open();
  const tx = db.transaction(STORE, mode);
  const result = await fn(tx.objectStore(STORE));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("aborted"));
  });
  return result;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const mediaCache = {
  async get(url: string): Promise<Blob | null> {
    try {
      const row = await run("readonly", (s) => wrap(s.get(url) as IDBRequest<Row | undefined>));
      return row ? new Blob([row.data], { type: row.type || "image/jpeg" }) : null;
    } catch {
      return null;
    }
  },
  /** Keeps a picture; when the cache is full, the oldest pictures make room (keys only: no bytes are read). */
  async put(url: string, blob: Blob): Promise<void> {
    try {
      const data = await blob.arrayBuffer();
      await run("readwrite", async (s) => {
        s.put({ url, data, type: blob.type, at: Date.now() } satisfies Row);
        let extra = (await wrap(s.count())) - MEDIA_MAX_ITEMS;
        if (extra <= 0) return;
        await new Promise<void>((resolve, reject) => {
          const c = s.index("at").openKeyCursor();
          c.onsuccess = () => {
            const cur = c.result;
            if (!cur || extra <= 0) return resolve();
            if (cur.primaryKey !== url) {
              s.delete(cur.primaryKey);
              extra--;
            }
            cur.continue();
          };
          c.onerror = () => reject(c.error);
        });
      });
      notify();
    } catch {
      /* the picture is still shown from its address, on request */
    }
  },
  /** How many pictures are kept — without creating the database when there has never been one. */
  async count(): Promise<number> {
    try {
      if (!opening && typeof indexedDB.databases === "function" && !(await indexedDB.databases()).some((d) => d.name === DB)) return 0;
      return await run("readonly", (s) => wrap(s.count()));
    } catch {
      return 0;
    }
  },
  async clear(): Promise<void> {
    try {
      await run("readwrite", (s) => void s.clear());
      notify();
    } catch {
      /* nothing to clear */
    }
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

export type MediaState = { status: "loading" } | { status: "cached"; src: string; blob: Blob } | { status: "missing" };

/** A picture's bytes from the cache, as an object address (revoked when the component goes); "missing" if not here. */
export function useMedia(url: string): MediaState {
  const [state, setState] = useState<MediaState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    let object: string | null = null;
    const load = () => {
      void mediaCache.get(url).then((blob) => {
        if (!live) return;
        if (object) URL.revokeObjectURL(object);
        object = null;
        if (blob) {
          object = URL.createObjectURL(blob);
          setState({ status: "cached", src: object, blob });
        } else setState({ status: "missing" });
      });
    };
    load();
    const off = mediaCache.subscribe(load);
    return () => {
      live = false;
      off();
      if (object) URL.revokeObjectURL(object);
    };
  }, [url]);
  return state;
}

/** How many pictures the cache holds (Settings → Storage). */
export function useMediaCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => void mediaCache.count().then(setN);
    load();
    return mediaCache.subscribe(load);
  }, []);
  return n;
}
