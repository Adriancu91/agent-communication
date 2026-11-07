// Project memory operations. Every change goes through the shared journal (storage/journaled.ts):
// journal event(s) + new records in ONE transaction. Content versions live in the journal.
import {
  checkEntry, checkLink, isOfficial, cleanBody, cleanTitle, isCategory, isEntryId, isLinkType, newEntryId, newLinkId, REASON_MAX,
  statusFromLinks, charCount, currentEvents, stripUnsafe,
  type Category, type EntryVersion, type JournalEvent, type LinkProblem, type LinkType, type MemoryEntry,
  type MemoryLink, type Project,
} from "../core";
import { checkJournal, eraseEventData, JournaledStore, req, StorageError, type Checkpoint, type IntegrityReport, type PendingEvent } from "../storage";

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

const STORES = ["projects", "memory", "links", "events"];

const getEntry = (tx: IDBTransaction, id: string) => req(tx.objectStore("memory").get(id) as IDBRequest<MemoryEntry | undefined>);
const projectLinks = (tx: IDBTransaction, projectId: string) =>
  req(tx.objectStore("links").index("projectId").getAll(IDBKeyRange.only(projectId)) as IDBRequest<MemoryLink[]>);
const getProject = (tx: IDBTransaction, id: string) => req(tx.objectStore("projects").get(id) as IDBRequest<Project | undefined>);

const projectEntries = (tx: IDBTransaction, projectId: string) =>
  req(tx.objectStore("memory").index("projectId").getAll(IDBKeyRange.only(projectId)) as IDBRequest<MemoryEntry[]>);

/** Memory of a project in the trash (or deleted) can be read but not changed. */
async function assertWritable(tx: IDBTransaction, projectId: string) {
  const project = await getProject(tx, projectId);
  if (!project || project.deletedAt) throw new StorageError("conflict", "project unavailable");
}

/**
 * After `changed` entries change state (archived, confirmed…), the entries they replace or resolve may
 * change status. Returns the entries whose status must be updated, with their new status.
 */
function statusUpdates(links: MemoryLink[], all: MemoryEntry[], changed: MemoryEntry[], ts: string): MemoryEntry[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  for (const c of changed) byId.set(c.id, c);
  const official = (id: string) => { const e = byId.get(id); return !!e && isOfficial(e); };
  const targets = new Set(links.filter((l) => changed.some((c) => c.id === l.from) && (l.type === "replaces" || l.type === "resolves")).map((l) => l.to));
  const out: MemoryEntry[] = [];
  for (const id of targets) {
    const t = byId.get(id);
    if (!t) continue;
    const status = statusFromLinks(id, links, official);
    if (status !== t.status) out.push({ ...t, status, updatedAt: ts });
  }
  return out;
}

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
    return currentEvents(all, projectId).filter((e) => e.type.startsWith("memory.") || e.type.startsWith("link.")).sort((a, b) => a.seq - b.seq);
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
    }), (e, links, all) => {
      // a decision is replaced only once: restoring a replacement whose target was replaced again meanwhile is refused
      const byId = new Map(all.map((x) => [x.id, x]));
      for (const l of links.filter((x) => x.from === e.id && x.type === "replaces")) {
        const other = links.some((x) => x.to === l.to && x.type === "replaces" && x.from !== e.id && !!byId.get(x.from) && isOfficial(byId.get(x.from)!));
        if (other) throw new LinkError("alreadyReplaced");
      }
    });
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
    { next: MemoryEntry; event: Omit<PendingEvent, "projectId" | "entityId">; keepDate?: boolean } | null,
    precheck?: (e: MemoryEntry, links: MemoryLink[], all: MemoryEntry[]) => void): Promise<MemoryEntry> {
    if (!isEntryId(id)) throw new StorageError("conflict", "bad id");
    return this.base.write(STORES, async (tx, ts) => {
      const cur = await getEntry(tx, id);
      if (!cur) throw new StorageError("conflict", "missing entry");
      await assertWritable(tx, cur.projectId);
      const c = change(cur, ts);
      if (!c) return { events: [], result: cur };
      const next = c.keepDate ? c.next : { ...c.next, updatedAt: ts };
      // archiving / restoring / confirming an entry can change the status of what it replaces or resolves
      const [links, all] = await Promise.all([projectLinks(tx, cur.projectId), projectEntries(tx, cur.projectId)]);
      precheck?.(next, links, all);
      const cascade = statusUpdates(links, all, [next], ts);
      return {
        result: next,
        events: [
          { ...c.event, projectId: cur.projectId, entityId: id },
          ...cascade.map((t) => ({ type: "memory.status" as const, projectId: cur.projectId, entityId: t.id, data: { status: t.status } })),
        ],
        apply: (w) => {
          w.objectStore("memory").put(next);
          for (const t of cascade) w.objectStore("memory").put(t);
        },
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
      await assertWritable(tx, cur.projectId);
      const [links, all] = await Promise.all([projectLinks(tx, cur.projectId), projectEntries(tx, cur.projectId)]);
      const allById = new Map(all.map((e) => [e.id, e]));
      const officialSrc = (x: string) => x !== id && !!allById.get(x) && isOfficial(allById.get(x)!);
      const touching = links.filter((l) => l.from === id || l.to === id);
      const projectEvents = await req(tx.objectStore("events").index("projectId").getAll(IDBKeyRange.only(cur.projectId)) as IDBRequest<JournalEvent[]>);
      const pastLinkIds = new Set([
        ...touching.map((l) => l.id),
        ...projectEvents
          .filter((ev) => ev.type === "link.created" && ev.entityId && ev.data && ((ev.data as { from?: string }).from === id || (ev.data as { to?: string }).to === id))
          .map((ev) => ev.entityId!),
      ]);
      const remaining = links.filter((l) => l.from !== id && l.to !== id);
      const others = [...new Set(touching.map((l) => (l.from === id ? l.to : l.from)))];
      const otherEntries = (await Promise.all(others.map((o) => getEntry(tx, o)))).filter(Boolean) as MemoryEntry[];
      const statusChanges = otherEntries
        .map((o) => ({ o, status: statusFromLinks(o.id, remaining, officialSrc) }))
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
          for (const l of touching) w.objectStore("links").delete(l.id);
          // erase the texts of every link that EVER touched this entry, including links removed earlier
          // (link reasons may talk about the deleted entry)
          for (const linkId of pastLinkIds) await eraseEventData(w, "entityId", linkId);
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
    const r = stripUnsafe(cleanBody(reason));
    if (charCount(r) > REASON_MAX) throw new MemoryValidationError("reason", "tooLong");
    return this.base.write(STORES, async (tx, ts) => {
      const [from, to] = await Promise.all([isEntryId(fromId) ? getEntry(tx, fromId) : undefined, isEntryId(toId) ? getEntry(tx, toId) : undefined]);
      const [links, entries] = from ? await Promise.all([projectLinks(tx, from.projectId), projectEntries(tx, from.projectId)]) : [[], []];
      const problem = checkLink(from, to, type, links);
      if (problem) throw new LinkError(problem);
      await assertWritable(tx, from!.projectId);
      return this.planLink(from!, to!, type, r, ts, links, entries);
    });
  }

  private planLink(from: MemoryEntry, to: MemoryEntry, type: LinkType, reason: string, ts: string, links: MemoryLink[],
    entries: MemoryEntry[], extra: PendingEvent[] = [], extraApply?: (w: IDBTransaction) => void) {
    const link: MemoryLink = { id: newLinkId(), projectId: from.projectId, from: from.id, to: to.id, type, reason, createdAt: ts, v: 1 };
    // only links from OFFICIAL entries count (the new link's source is official: checkLink requires it)
    const byId = new Map(entries.map((e) => [e.id, e]));
    byId.set(from.id, from);
    const status = statusFromLinks(to.id, [...links, link], (x) => !!byId.get(x) && isOfficial(byId.get(x)!));
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
      await assertWritable(tx, link.projectId);
      const [allLinks, all] = await Promise.all([projectLinks(tx, link.projectId), projectEntries(tx, link.projectId)]);
      const links = allLinks.filter((l) => l.id !== linkId);
      const byId = new Map(all.map((e) => [e.id, e]));
      const to = byId.get(link.to);
      const status = to ? statusFromLinks(to.id, links, (x) => !!byId.get(x) && isOfficial(byId.get(x)!)) : null;
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
    const r = stripUnsafe(cleanBody(reason));
    if (!r) throw new MemoryValidationError("reason", "empty");
    if (charCount(r) > REASON_MAX) throw new MemoryValidationError("reason", "tooLong");
    return this.base.write(STORES, async (tx, ts) => {
      const old = isEntryId(oldId) ? await getEntry(tx, oldId) : undefined;
      if (!old) throw new LinkError("missing");
      await assertWritable(tx, old.projectId);
      const [links, entries] = await Promise.all([projectLinks(tx, old.projectId), projectEntries(tx, old.projectId)]);
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
      const plan = this.planLink(entry, old, "replaces", r, ts, links, entries, [created], (w) => void w.objectStore("memory").add(entry));
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
    const r = stripUnsafe(cleanBody(reason));
    return this.base.write(STORES, async (tx, ts) => {
      const issue = isEntryId(issueId) ? await getEntry(tx, issueId) : undefined;
      if (!issue) throw new LinkError("missing");
      await assertWritable(tx, issue.projectId);
      const [links, entries] = await Promise.all([projectLinks(tx, issue.projectId), projectEntries(tx, issue.projectId)]);
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
      return this.planLink(entry, issue, "resolves", r, ts, links, entries, [created], (w) => void w.objectStore("memory").add(entry));
    });
  }

  // ---------- integrity ----------

  /**
   * The journal check (chain + checkpoint) plus a consistency check of ONE project's memory, all on
   * ONE snapshot (a single read transaction), with the checkpoint read before it:
   * every entry's current text must equal its latest version in the journal and that version must not
   * be erased; every link must have both ends; every status must match the links.
   */
  async verify(projectId: string): Promise<IntegrityReport & { inconsistencies: string[] }> {
    const cp: Checkpoint | null = this.base.checkpoint();
    const { events, entries, links, project } = await this.base.read(["events", "memory", "links", "projects"], async (tx) => {
      const [events, entries, links, project] = await Promise.all([
        req(tx.objectStore("events").getAll() as IDBRequest<JournalEvent[]>),
        projectEntries(tx, projectId), projectLinks(tx, projectId), getProject(tx, projectId),
      ]);
      return { events, entries, links, project };
    });
    const report = await checkJournal(events, cp);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const official = (id: string) => !!byId.get(id) && isOfficial(byId.get(id)!);
    const problems: string[] = [];
    const contentEvents = new Map<string, JournalEvent[]>();
    const own = currentEvents(events, projectId); // a project replaced by an import: only its current history
    for (const ev of own) {
      if (!ev.entityId) continue;
      if (ev.type === "memory.created" || ev.type === "memory.edited") contentEvents.set(ev.entityId, [...(contentEvents.get(ev.entityId) ?? []), ev]);
    }
    for (const e of entries) {
      const evs = contentEvents.get(e.id) ?? [];
      if (evs.some((ev) => ev.data === null)) { problems.push(`erased:${e.id}`); continue; } // content hidden while the entry still exists
      const last = evs.at(-1)?.data as { title: string; body: string; version: number } | undefined;
      if (!last || last.version !== e.version || last.title !== e.title || last.body !== e.body) problems.push(`content:${e.id}`);
      if (e.status !== statusFromLinks(e.id, links, official)) problems.push(`status:${e.id}`);
    }
    if (project && own.some((ev) => !ev.entityId && ev.data === null)) problems.push(`erased:${projectId}`);
    for (const l of links) if (!byId.has(l.from) || !byId.has(l.to)) problems.push(`link:${l.id}`);
    return { ...report, ok: report.ok && problems.length === 0, inconsistencies: problems };
  }
}
