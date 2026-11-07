// The app's single project store and the hooks the screens use.
import { useEffect, useState } from "preact/hooks";
import type { EntryVersion, MemoryEntry, MemoryLink, Project } from "../core";
import { LinkError, MemoryStore, MemoryValidationError } from "../memory";
import { SessionError, SessionStore } from "../continuity";
import { ProjectStore, ValidationError } from "../projects";
import { JournaledStore, persistState, requestPersist, StorageError, usage, whenClosedByNewerVersion, type PersistState } from "../storage";
import type { Key } from "./i18n";

/** One database connection and one journal for the whole app; projects and memory share it. */
export const base = new JournaledStore();
export const store = new ProjectStore(base);
export const memoryStore = new MemoryStore(base);
export const sessionStore = new SessionStore(base);

export interface MemoryState {
  entries: MemoryEntry[];
  links: MemoryLink[];
  versions: Map<string, EntryVersion[]>;
  loading: boolean;
  error: StorageError | null;
}

/** One project's memory, reloaded after any change (here or in another tab). */
export function useMemory(projectId: string | null): MemoryState {
  const [state, setState] = useState<MemoryState>({ entries: [], links: [], versions: new Map(), loading: true, error: null });
  useEffect(() => {
    if (!projectId) {
      setState({ entries: [], links: [], versions: new Map(), loading: false, error: null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const load = () =>
      Promise.all([memoryStore.list(projectId), memoryStore.links(projectId), memoryStore.versions(projectId)]).then(
        ([entries, links, versions]) => alive && setState({ entries, links, versions, loading: false, error: null }),
        (e) => alive && setState((s) => ({ ...s, loading: false, error: e instanceof StorageError ? e : new StorageError("unknown") })),
      );
    load();
    const off = memoryStore.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, [projectId]);
  return state;
}

const LAST = "aiw.lastProject";
export function rememberProject(id: string): void {
  try {
    localStorage.setItem(LAST, id);
  } catch {
    /* not fatal */
  }
}
export function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

export interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: StorageError | null;
}

export function useProjects(): ProjectsState {
  const [state, setState] = useState<ProjectsState>({ projects: [], loading: true, error: null });
  useEffect(() => {
    let alive = true;
    const load = () =>
      store.list().then(
        (projects) => alive && setState({ projects, loading: false, error: null }),
        (e) => alive && setState((s) => ({ ...s, loading: false, error: e instanceof StorageError ? e : new StorageError("unknown") })),
      );
    load();
    const off = store.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

let closedByNewer = false;
const closedListeners = new Set<() => void>();
whenClosedByNewerVersion(() => {
  closedByNewer = true;
  closedListeners.forEach((l) => l());
});
export function useClosedByNewerVersion(): boolean {
  const [v, set] = useState(closedByNewer);
  useEffect(() => {
    const l = () => set(true);
    closedListeners.add(l);
    return () => void closedListeners.delete(l);
  }, []);
  return v;
}

/** The text key that explains an error to the user. */
export function errorKey(e: unknown): Key {
  if (e instanceof LinkError) return `le_${e.reason}` as Key;
  if (e instanceof SessionError) return `se_${e.reason}` as Key;
  if (e instanceof MemoryValidationError) {
    if (e.field === "title") return e.reason === "empty" ? "errTitleEmpty" : e.reason === "tooLong" ? "errTitleLong" : "errChars";
    if (e.field === "body") return e.reason === "tooLong" ? "errBodyLong" : "errChars";
    if (e.field === "reason") return e.reason === "empty" ? "errReasonEmpty" : "errReasonLong";
    return "errEntryInvalid";
  }
  if (e instanceof ValidationError) {
    if (e.reason === "empty") return "errEmpty";
    if (e.reason === "tooLong") return e.field === "name" ? "errNameLong" : "errDescLong";
    return "errChars";
  }
  const kind = e instanceof StorageError ? e.kind : "unknown";
  return ({ quota: "errQuota", unavailable: "errUnavailable", blocked: "errBlocked", closed: "errClosed", conflict: "errConflict", unknown: "errUnknown" } as const)[kind];
}

// Persistent storage: asked once, after the first project is created (a user action).
const ASKED = "aiw.persistAsked";
export async function askPersistOnce(): Promise<void> {
  try {
    if (localStorage.getItem(ASKED)) return;
    localStorage.setItem(ASKED, "1");
  } catch {
    /* not fatal */
  }
  await requestPersist();
}

export interface StorageInfo {
  persist: PersistState | null;
  used: number | null;
}
export function useStorageInfo(): [StorageInfo, () => Promise<void>] {
  const [info, setInfo] = useState<StorageInfo>({ persist: null, used: null });
  const refresh = async () => setInfo({ persist: await persistState(), used: (await usage())?.used ?? null });
  useEffect(() => {
    void refresh();
  }, []);
  const ask = async () => {
    await requestPersist();
    await refresh();
  };
  return [info, ask];
}

/** iPhone / iPad (including iPadOS, which reports itself as a Mac with touch). */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
