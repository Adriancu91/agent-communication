// Project memory operations. Every change goes through the shared journal (storage/journaled.ts):
// journal event(s) + new records in ONE transaction. Content versions live in the journal.
import {
  checkEntry, checkLink, cleanBody, cleanTitle, isCategory, isEntryId, isLinkType, newEntryId, newLinkId, REASON_MAX,
  statusFromLinks, charCount,
  type Category, type EntryVersion, type JournalEvent, type LinkProblem, type LinkType, type MemoryEntry,
  type MemoryLink, type Project,
} from "../core";
import { eraseEventData, JournaledStore, req, StorageError, type IntegrityReport, type PendingEvent } from "../storage";

export class MemoryValidationError extends Error {
  constructor(public field: string, public reason: string) {
    super(`memory:${field}:${reason}`);
    this.name = "MemoryValidationError";
  }
}
export class LinkError extends Error {
  constructor(public reason: LinkProblem) {
    super(`link:${reason}`);
    this.name = "LinkError";
  }
}

export interface NewEntry {
  category: Category;
  title: string;
  body?: string;
  important?: boolean;
}

const STORES = ["projects", "memory", "links"];

const getEntry = (tx: IDBTransaction, id: string) => req(tx.objectStore("memory").get(id) as IDBRequest<MemoryEntry | undefined>);
const projectLinks = (tx: IDBTransaction, projectId: string) =>
  req(tx.objectStore("links").index("projectId").getAll(IDBKeyRange.only(projectId)) as IDBRequest<MemoryLink[]>);
const getProject = (tx: IDBTransaction, id: string) => req(tx.objectStore("projects").get(id) as IDBRequest<Project | undefined>);

function validate(e: { title: string; body: string; category?: unknown; source?: string | null }) {
  const p = checkEntry(e);
  if (p) throw new MemoryValidationError(p.field, p.problem);
}

export class MemoryStore {
  constructor(readonly base: JournaledStore) {}

  subscribe(l: () => void): () => void {
    return this.base.subscribe(l);
  }

  // ---------- reading ----------

  /** Every entry of ONE project (all states; the screens filter). */
  async list(projectId: string): Promise<MemoryEntry[]> {
    return this.base.read(["memory"], (tx) =>
      req(tx.objectStore("memory").index("projectId").getAll(IDBKeyRange.only(projectId)) as IDBRequest<MemoryEntry[]>));
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    return this.base.read(["memory"], (tx) => getEntry(tx, id));
  }

  async links(projectId: string): Promise<MemoryLink[]> {
    return this.base.read(["links"], (tx) => projectLinks(tx, projectId));
  }

  /** The project's memory and link events, oldest first (the organised history). */
  async timeline(projectId: string): Promise<JournalEvent[]> {
    const all = await this.base.read(["events"], (tx) =>
      req(tx.objectStore("events").index("projectId").getAll(IDBKeyRange.only(projectId)) as IDBRequest<JournalEvent[]>));
    return all.filter((e) => e.type.startsWith("memory.") || e.type.startsWith("link.")).sort((a, b) => a.seq - b.seq);
  }

  /** All content versions of every entry of a project, read from the journal (oldest first). */
  async versions(projectId: string): Promise<Map<string, EntryVersion[]>> {
    const [events, entries] = await Promise.all([this.timeline(projectId), this.list(projectId)]);
    const current = new Map(entries.map((e) => [e.id, e.version]));
    const out = new Map<string, EntryVersion[]>();
    for (const e of events) {
      if ((e.type !== "memory.created" && e.type !== "memory.edited") || !e.entityId || !e.data) continue;
      const d = e.data as { title: string; body: string; version: number };
      const list = out.get(e.entityId) ?? [];
      list.push({ version: d.version, title: d.title, body: d.body, ts: e.ts, seq: e.seq, current: current.get(e.entityId) === d.version });
      out.set(e.entityId, list);
    }
    return out;
  }

  async history(entryId: string): Promise<EntryVersion[]> {
    const entry = await this.get(entryId);
    if (!entry) return [];
    return (await this.versions(entry.projectId)).get(entryId) ?? [];
  }

  // ---------- writing ----------

  /** A user-written entry: official as soon as it is saved. */
  async create(projectId: string, input: NewEntry): Promise<MemoryEntry> {
    return this.add(projectId, input, "user", null);
  }

  /**
   * An AI proposal (used from AIW-05 on): stays "pending", outside official memory and outside any
   * AI context, until the user confirms it. `source` is stored only when supplied.
   */
  async propose(projectId: string, input: NewEntry & { source?: string }): Promise<MemoryEntry> {
    return this.add(projectId, input, "ai", input.source ? cleanTitle(input.source) : null);
  }

  private async add(projectId: string, input: NewEntry, author: "user" | "ai", source: string | null): Promise<MemoryEntry> {
    const title = cleanTitle(input.title);
    const body = cleanBody(input.body ?? "");
    validate({ title, body, category: input.category, source });
    return this.base.write(STORES, async (tx, ts) => {
      const project = await getProject(tx, projectId);
      if (!project || project.deletedAt) throw new StorageError("conflict", "project unavailable");
      const entry: MemoryEntry = {
        id: newEntryId(), projectId, category: input.category, title, body, important: !!input.important,
        status: "active", archived: false, author, source,
        confirmation: author === "user" ? "confirmed" : "pending", confirmedAt: author === "user" ? ts : null,
        createdAt: ts, updatedAt: ts, version: 1, v: 1,
      };
      return {
        result: entry,
        events: [{ type: "memory.created", projectId, entityId: entry.id, data: {
          category: entry.category, title, body, important: entry.important, author, source, confirmation: entry.confirmation, version: 1,
        } }],
        apply: (w) => void w.objectStore("memory").add(entry),
      };
    });
  }

  /** Editing appends a new version; the previous one stays in the journal and in the history view. */
  async edit(id: string, change: { title: string; body: string }): Promise<MemoryEntry> {
    const title = cleanTitle(change.title);
    const body = cleanBody(change.body);
    validate({ title, body });
    return this.update(id, (e) => (e.title === title && e.body === body ? null : {
      next: { ...e, title, body, version: e.version + 1 },
      event: { type: "memory.edited", data: { title, body, version: e.version + 1 } },
    }));
  }

  async setImportant(id: string, important: boolean): Promise<MemoryEntry> {
    return this.update(id, (e) => (e.important === important ? null : {
      next: { ...e, important }, event: { type: "memory.important", data: { important } }, keepDate: true,
    }));
  }

  async archive(id: string): Promise<MemoryEntry> {
    return this.update(id, (e) => (e.archived ? null : { next: { ...e, archived: true }, event: { type: "memory.archived", data: {} } }));
  }

  async restore(id: string): Promise<MemoryEntry> {
    return this.update(id, (e) => (!e.archived || e.confirmation === "rejected" ? null : {
      next: { ...e, archived: false }, event: { type: "memory.restored", data: {} },
    }));
  }

  /** Makes a pending AI proposal official. Records when it was confirmed. */
  async confirm(id: string): Promise<MemoryEntry> {
    return this.update(id, (e, ts) => {
      if (e.confirmation !== "pending") throw new StorageError("conflict", "not pending");
      return { next: { ...e, confirmation: "confirmed", confirmedAt: ts }, event: { type: "memory.confirmed", data: {} } };
    });
  }

  /** Rejects a pending proposal: it never becomes official; it moves to the archive, where it can be deleted. */
  async reject(id: string): Promise<MemoryEntry> {
    return this.update(id, (e) => {
      if (e.confirmation !== "pending") throw new StorageError("conflict", "not pending");
      return { next: { ...e, confirmation: "rejected", archived: true }, event: { type: "memory.rejected", data: {} } };
    });
  }

  private async update(id: string, change: (e: MemoryEntry, ts: string) =>
    { next: MemoryEntry; event: Omit<PendingEvent, "projectId" | "entityId">; keepDate?: boolean } | null): Promise<MemoryEntry> {
    if (!isEntryId(id)) throw new StorageError("conflict", "bad id");
    return this.base.write(STORES, async (tx, ts) => {
      const cur = await getEntry(tx, id);
      if (!cur) throw new StorageError("conflict", "missing entry");
      const c = change(cur, ts);
      if (!c) return { events: [], result: cur };
      const next = c.keepDate ? c.next : { ...c.next, updatedAt: ts };
      return {
        result: next,
        events: [{ ...c.event, projectId: cur.projectId, entityId: id }],
        apply: (w) => void w.objectStore("memory").put(next),
      };
    });
  }

  /**
   * Definitive delete: only for archived entries (two steps, like the project trash). Removes the
   * entry and every link touching it, recomputes the status of the entries at the other end
   * (a decision whose replacement is deleted becomes active again), and erases the entry's texts
   * from the journal. Nothing is left pointing to a missing entry.
   */
  async purge(id: string): Promise<void> {
    if (!isEntryId(id)) throw new StorageError("conflict", "bad id");
    await this.base.write(STORES, async (tx) => {
      const cur = await getEntry(tx, id);
      if (!cur) throw new StorageError("conflict", "missing entry");
      if (!cur.archived) throw new StorageError("conflict", "not archived");
      const links = await projectLinks(tx, cur.projectId);
      const touching = links.filter((l) => l.from === id || l.to === id);
      const remaining = links.filter((l) => l.from !== id && l.to !== id);
      const others = [...new Set(touching.map((l) => (l.from === id ? l.to : l.from)))];
      const otherEntries = (await Promise.all(others.map((o) => getEntry(tx, o)))).filter(Boolean) as MemoryEntry[];
      const statusChanges = otherEntries
        .map((o) => ({ o, status: statusFromLinks(o.id, remaining) }))
        .filter(({ o, status }) => o.status !== status);
      const events: PendingEvent[] = [
        ...touching.map((l) => ({ type: "link.removed" as const, projectId: cur.projectId, entityId: l.id, data: {} })),
        ...statusChanges.map(({ o, status }) => ({ type: "memory.status" as const, projectId: cur.projectId, entityId: o.id, data: { status } })),
        { type: "memory.purged", projectId: cur.projectId, entityId: id, data: {} },
      ];
      return {
        result: undefined,
        events,
        apply: async (w) => {
          w.objectStore("memory").delete(id);
          for (const l of touching) {
            w.objectStore("links").delete(l.id);
            await eraseEventData(w, "entityId", l.id); // link reasons may contain the deleted text
          }
          for (const { o, status } of statusChanges) w.objectStore("memory").put({ ...o, status });
          await eraseEventData(w, "entityId", id);
        },
      };
    });
  }

  // ---------- relationships ----------

  /** Links two official entries of the same project (see core/memory.ts checkLink for the rules). */
  async link(fromId: string, toId: string, type: LinkType, reason = ""): Promise<MemoryLink> {
    if (!isLinkType(type)) throw new LinkError("invalidType");
    const r = cleanBody(reason);
    if (charCount(r) > REASON_MAX) throw new MemoryValidationError("reason", "tooLong");
    return this.base.write(STORES, async (tx, ts) => {
      const [from, to] = await Promise.all([isEntryId(fromId) ? getEntry(tx, fromId) : undefined, isEntryId(toId) ? getEntry(tx, toId) : undefined]);
      const links = from ? await projectLinks(tx, from.projectId) : [];
      const problem = checkLink(from, to, type, links);
      if (problem) throw new LinkError(problem);
      return this.planLink(from!, to!, type, r, ts, links);
    });
  }

  private planLink(from: MemoryEntry, to: MemoryEntry, type: LinkType, reason: string, ts: string, links: MemoryLink[], extra: PendingEvent[] = [], extraApply?: (w: IDBTransaction) => void) {
    const link: MemoryLink = { id: newLinkId(), projectId: from.projectId, from: from.id, to: to.id, type, reason, createdAt: ts, v: 1 };
    const status = statusFromLinks(to.id, [...links, link]);
    const target = status !== to.status ? { ...to, status, updatedAt: ts } : null;
    return {
      result: link,
      events: [
        ...extra,
        { type: "link.created" as const, projectId: from.projectId, entityId: link.id, data: { from: from.id, to: to.id, type, reason } },
        ...(target ? [{ type: "memory.status" as const, projectId: from.projectId, entityId: to.id, data: { status } }] : []),
      ],
      apply: (w: IDBTransaction) => {
        extraApply?.(w);
        w.objectStore("links").add(link);
        if (target) w.objectStore("memory").put(target);
      },
    };
  }

  /** Removes a link; the entry at its end gets its status back if nothing else replaces/resolves it. */
  async unlink(linkId: string): Promise<void> {
    await this.base.write(STORES, async (tx, ts) => {
      const link = await req(tx.objectStore("links").get(linkId) as IDBRequest<MemoryLink | undefined>);
      if (!link) throw new LinkError("missing");
      const links = (await projectLinks(tx, link.projectId)).filter((l) => l.id !== linkId);
      const to = await getEntry(tx, link.to);
      const status = to ? statusFromLinks(to.id, links) : null;
      const target = to && status !== to.status ? { ...to, status: status!, updatedAt: ts } : null;
      return {
        result: undefined,
        events: [
          { type: "link.removed", projectId: link.projectId, entityId: linkId, data: {} },
          ...(target ? [{ type: "memory.status" as const, projectId: link.projectId, entityId: target.id, data: { status: target.status } }] : []),
        ],
        apply: (w) => {
          w.objectStore("links").delete(linkId);
          if (target) w.objectStore("memory").put(target);
        },
      };
    });
  }

  /**
   * Replaces a decision with a NEW one (explicit, confirmed by the user in the interface):
   * creates the new decision, links it ("replaces"), marks the old one replaced. The old decision,
   * its text, its versions and the reason stay available. All in one transaction.
   */
  async replaceDecision(oldId: string, input: { title: string; body?: string; important?: boolean }, reason: string): Promise<{ entry: MemoryEntry; link: MemoryLink }> {
    const title = cleanTitle(input.title);
    const body = cleanBody(input.body ?? "");
    validate({ title, body });
    const r = cleanBody(reason);
    if (!r) throw new MemoryValidationError("reason", "empty");
    if (charCount(r) > REASON_MAX) throw new MemoryValidationError("reason", "tooLong");
    return this.base.write(STORES, async (tx, ts) => {
      const old = isEntryId(oldId) ? await getEntry(tx, oldId) : undefined;
      if (!old) throw new LinkError("missing");
      const links = await projectLinks(tx, old.projectId);
      const entry: MemoryEntry = {
        id: newEntryId(), projectId: old.projectId, category: "decision", title, body, important: !!input.important,
        status: "active", archived: false, author: "user", source: null, confirmation: "confirmed", confirmedAt: ts,
        createdAt: ts, updatedAt: ts, version: 1, v: 1,
      };
      const problem = checkLink(entry, old, "replaces", links);
      if (problem) throw new LinkError(problem);
      const created: PendingEvent = { type: "memory.created", projectId: old.projectId, entityId: entry.id, data: {
        category: "decision", title, body, important: entry.important, author: "user", source: null, confirmation: "confirmed", version: 1,
      } };
      const plan = this.planLink(entry, old, "replaces", r, ts, links, [created], (w) => void w.objectStore("memory").add(entry));
      return { ...plan, result: { entry, link: plan.result } };
    });
  }

  /**
   * Resolves an open problem with an existing entry or a new one. The problem is kept (marked resolved)
   * and shows which entry resolved it.
   */
  async resolveIssue(issueId: string, by: { entryId: string } | { category: Category; title: string; body?: string }, reason = ""): Promise<MemoryLink> {
    if ("entryId" in by) return this.link(by.entryId, issueId, "resolves", reason);
    const title = cleanTitle(by.title);
    const body = cleanBody(by.body ?? "");
    validate({ title, body, category: by.category });
    if (!isCategory(by.category) || by.category === "issue") throw new LinkError("wrongCategory");
    const r = cleanBody(reason);
    return this.base.write(STORES, async (tx, ts) => {
      const issue = isEntryId(issueId) ? await getEntry(tx, issueId) : undefined;
      if (!issue) throw new LinkError("missing");
      const links = await projectLinks(tx, issue.projectId);
      const entry: MemoryEntry = {
        id: newEntryId(), projectId: issue.projectId, category: by.category, title, body, important: false,
        status: "active", archived: false, author: "user", source: null, confirmation: "confirmed", confirmedAt: ts,
        createdAt: ts, updatedAt: ts, version: 1, v: 1,
      };
      const problem = checkLink(entry, issue, "resolves", links);
      if (problem) throw new LinkError(problem);
      const created: PendingEvent = { type: "memory.created", projectId: issue.projectId, entityId: entry.id, data: {
        category: by.category, title, body, important: false, author: "user", source: null, confirmation: "confirmed", version: 1,
      } };
      return this.planLink(entry, issue, "resolves", r, ts, links, [created], (w) => void w.objectStore("memory").add(entry));
    });
  }

  // ---------- integrity ----------

  /**
   * The journal check (chain + checkpoint) plus a consistency check of ONE project's memory:
   * every entry's current text must equal its latest version in the journal, every link must have
   * both ends, and every status must match the links.
   */
  async verify(projectId: string): Promise<IntegrityReport & { inconsistencies: string[] }> {
    const [report, entries, links, versions] = await Promise.all([this.base.verify(), this.list(projectId), this.links(projectId), this.versions(projectId)]);
    const ids = new Set(entries.map((e) => e.id));
    const problems: string[] = [];
    for (const e of entries) {
      const last = (versions.get(e.id) ?? []).at(-1);
      if (!last || last.version !== e.version || last.title !== e.title || last.body !== e.body) problems.push(`content:${e.id}`);
      if (e.status !== statusFromLinks(e.id, links)) problems.push(`status:${e.id}`);
    }
    for (const l of links) if (!ids.has(l.from) || !ids.has(l.to)) problems.push(`link:${l.id}`);
    return { ...report, ok: report.ok && problems.length === 0, inconsistencies: problems };
  }
}


