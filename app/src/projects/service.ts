// Project operations. Every change: one journal event + the new project state, in one transaction.
import {
  checkDescription, checkName, cleanDescription, cleanName, newProjectId, verifyChain,
  type ChainReport, type EventType, type FieldError, type JournalEvent, type Project,
} from "../core";
import { deleteAll, eraseEventData, JournaledStore, PROJECT_SCOPED_STORES, req, StorageError } from "../storage";

export class ValidationError extends Error {
  constructor(public field: "name" | "description", public reason: FieldError) {
    super(`${field}:${reason}`);
    this.name = "ValidationError";
  }
}

/** Project operations, written through the shared journal (storage/journaled.ts). */
export class ProjectStore {
  readonly base: JournaledStore;

  /** Pass the app's shared JournaledStore, or a database name (tests) to get a private one. */
  constructor(base: JournaledStore | string = "aiw", now?: () => Date) {
    this.base = typeof base === "string" ? new JournaledStore(base, now) : base;
  }

  /** Called after any change, here or in another tab. */
  subscribe(l: () => void): () => void {
    return this.base.subscribe(l);
  }

  async list(): Promise<Project[]> {
    return this.base.read(["projects"], (tx) => req(tx.objectStore("projects").getAll() as IDBRequest<Project[]>));
  }

  async get(id: string): Promise<Project | undefined> {
    return this.base.read(["projects"], (tx) => req(tx.objectStore("projects").get(id) as IDBRequest<Project | undefined>));
  }

  async journal(): Promise<JournalEvent[]> {
    return this.base.journal();
  }

  async verify(): Promise<ChainReport> {
    return verifyChain(await this.base.journal());
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
   * Definitive delete, only from the trash. Removes the project, its memory and links, and erases
   * their names and texts from the journal (the fingerprints stay, so the chain is still verifiable).
   */
  async purge(id: string): Promise<void> {
    await this.change(id, "project.purged", {}, (cur) => {
      if (!cur.deletedAt) throw new StorageError("conflict", "not in trash");
      return null;
    });
  }

  /** One project change = one journal event + the new project state, in one transaction. */
  private async change(id: string, type: EventType, data: Record<string, unknown>,
    next: (cur: Project, ts: string) => Project | null): Promise<Project | null> {
    return this.base.write(["projects", ...PROJECT_SCOPED_STORES], async (tx, ts) => {
      const cur = await req(tx.objectStore("projects").get(id) as IDBRequest<Project | undefined>);
      let updated: Project | null;
      if (type === "project.created") {
        if (cur) throw new StorageError("conflict", "id exists");
        updated = next(undefined as never, ts);
      } else {
        if (!cur) throw new StorageError("conflict", "missing project");
        updated = next(cur, ts);
        if (updated === cur) return { events: [], result: cur }; // nothing to save
      }
      return {
        events: [{ type, projectId: id, data }],
        result: updated,
        apply: async (w) => {
          if (updated) {
            w.objectStore("projects").put(updated);
            return;
          }
          w.objectStore("projects").delete(id);
          for (const store of PROJECT_SCOPED_STORES) await deleteAll(w, store, "projectId", id);
          await eraseEventData(w, "projectId", id);
        },
      };
    });
  }

  close() {
    this.base.close();
  }
}
