// Asks the browser to keep the app's data even when the device runs low on space, and reports the answer.
// Persistent does NOT mean safe forever: the user, a "clear browsing data", or a lost phone still erase it.

export type PersistState = "persisted" | "not-persisted" | "unsupported";

export async function persistState(): Promise<PersistState> {
  const s = globalThis.navigator?.storage;
  if (!s?.persisted) return "unsupported";
  try {
    return (await s.persisted()) ? "persisted" : "not-persisted";
  } catch {
    return "unsupported";
  }
}

/** Some browsers decide silently, some ask the user. Call after a user action. */
export async function requestPersist(): Promise<PersistState> {
  const s = globalThis.navigator?.storage;
  if (!s?.persist) return "unsupported";
  try {
    return (await s.persist()) ? "persisted" : "not-persisted";
  } catch {
    return "unsupported";
  }
}

export async function usage(): Promise<{ used: number; quota: number } | null> {
  const s = globalThis.navigator?.storage;
  if (!s?.estimate) return null;
  try {
    const e = await s.estimate();
    return { used: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}
