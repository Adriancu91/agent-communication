// Deep checks of an archived project (AIW-04, after the independent review):
// 1. the data of EVERY history event has the shape its type requires (not only the latest version);
// 2. replaying the history gives exactly the records in the archive (project, entries, links);
// 3. the links follow the same rules as links made in the app.
// A file that passes was produced by the app's own operations, or is indistinguishable from one.
import {
  charCount, checkDescription, checkEntry, checkName, cleanBody, cleanDescription, cleanName, cleanTitle, isCategory, isEntryId,
  isLinkType, isOfficial, REASON_MAX, SOURCE_MAX, UNSAFE_CHARS, isSessionId, isExchangeId, isProvider, namedProvider, cleanText, EXCHANGE_MAX, TASK_MAX, PROVIDER_NAME_MAX,
  type EventType, type MemoryEntry, type MemoryLink, type Project,
} from "../core";
import { ArchiveError, type ArchivedEvent, type ProjectFile } from "./archive";

const LINK_ID = /^L-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROJECT_ID = /^P-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const CONTROL = UNSAFE_CHARS;

const bad = (e: ArchivedEvent, what: string): never => {
  throw new ArchiveError("history", `event ${e.seq} ${what}`);
};
const keys = (d: Record<string, unknown>) => Object.keys(d).sort().join(",");

function needKeys(e: ArchivedEvent, d: Record<string, unknown>, k: string[]) {
  if (keys(d) !== [...k].sort().join(",")) bad(e, "fields");
}
const isStr = (v: unknown): v is string => typeof v === "string";
const validName = (v: unknown) => isStr(v) && cleanName(v) === v && !checkName(v);
const validDesc = (v: unknown) => isStr(v) && cleanDescription(v) === v && !checkDescription(v);
const validTitle = (v: unknown) => isStr(v) && cleanTitle(v) === v;
const validBody = (v: unknown) => isStr(v) && cleanBody(v) === v;

/** Events about the project itself have no entity; memory and link events always have one. */
const ENTITY: Partial<Record<EventType, "entry" | "link" | "session" | "exchange">> = {
  "session.created": "session", "session.closed": "session", "session.reopened": "session", "session.exchange": "exchange",
  "memory.created": "entry", "memory.edited": "entry", "memory.important": "entry", "memory.archived": "entry",
  "memory.restored": "entry", "memory.confirmed": "entry", "memory.rejected": "entry", "memory.status": "entry",
  "memory.purged": "entry", "link.created": "link", "link.removed": "link",
};

/** Checks the shape of one event's data, by its type. */
export function checkEventData(e: ArchivedEvent): void {
  const d = e.data as Record<string, unknown>;
  const kind = ENTITY[e.type];
  if (kind === "entry" && !isEntryId(e.entityId)) bad(e, "entity");
  if (kind === "link" && !(isStr(e.entityId) && LINK_ID.test(e.entityId))) bad(e, "entity");
  if (kind === "session" && !isSessionId(e.entityId)) bad(e, "entity");
  if (kind === "exchange" && !isExchangeId(e.entityId)) bad(e, "entity");
  if (!kind && e.type.startsWith("project.") && e.entityId !== undefined) bad(e, "entity");
  switch (e.type) {
    case "project.created":
      needKeys(e, d, ["name", "description"]);
      if (!validName(d.name) || !validDesc(d.description)) bad(e, "data");
      break;
    case "project.renamed":
      needKeys(e, d, ["name"]);
      if (!validName(d.name)) bad(e, "data");
      break;
    case "project.updated":
      needKeys(e, d, ["description"]);
      if (!validDesc(d.description)) bad(e, "data");
      break;
    case "project.pinned":
      needKeys(e, d, ["pinned"]);
      if (typeof d.pinned !== "boolean") bad(e, "data");
      break;
    case "project.trashed": case "project.restored": case "project.purged":
    case "memory.archived": case "memory.restored": case "memory.confirmed": case "memory.rejected": case "memory.purged":
    case "link.removed": case "session.closed": case "session.reopened":
      needKeys(e, d, []);
      break;
    case "session.created":
      needKeys(e, d, ["provider", "providerName", "task", "continues"]);
      if (!isProvider(d.provider) || !isStr(d.providerName) || charCount(d.providerName) > PROVIDER_NAME_MAX || CONTROL.test(d.providerName)) bad(e, "data");
      if (namedProvider(d.provider as string) !== (d.providerName !== "") || !isStr(d.task) || cleanText(d.task) !== d.task || charCount(d.task) > TASK_MAX) bad(e, "data");
      if (d.continues !== null && !isSessionId(d.continues)) bad(e, "data");
      break;
    case "session.exchange": {
      needKeys(e, d, ["session", "kind", "text", "pack", "proposals"]);
      if (!isSessionId(d.session) || !["sent", "reply", "note", "ask"].includes(d.kind as string)) bad(e, "data");
      if (!isStr(d.text) || cleanText(d.text) !== d.text || charCount(d.text) > EXCHANGE_MAX || (d.kind === "sent") !== (d.text === "")) bad(e, "data");
      if (!Array.isArray(d.proposals) || !d.proposals.every(isEntryId) || (d.kind !== "reply" && d.proposals.length > 0)) bad(e, "data");
      const pk = d.pack as Record<string, unknown> | null;
      if (d.kind === "sent" || (d.kind === "ask" && pk !== null)) {
        if (!pk || typeof pk !== "object" || keys(pk) !== "chars,refs,sha256" || !isStr(pk.sha256) || !HEX64.test(pk.sha256) || typeof pk.chars !== "number") bad(e, "data");
        const refs = pk!.refs as Record<string, unknown>;
        if (!refs || typeof refs !== "object" || Array.isArray(refs) || Object.entries(refs).some(([k, v]) => !/^[A-Z]\d{1,6}$/.test(k) || !isEntryId(v))) bad(e, "data");
      } else if (pk !== null) bad(e, "data");
      break;
    }
    case "project.imported": {
      // what an earlier import recorded; "previous" lists the imports before it
      const k = keys(d);
      if (k !== "app,archive,events,exportedAt,mode,name,sourceProject" && k !== "app,archive,events,exportedAt,mode,name,previous,sourceProject") bad(e, "fields");
      if (!["add", "copy", "replace"].includes(d.mode as string) || !validName(d.name) || !isStr(d.archive) || !HEX64.test(d.archive)) bad(e, "data");
      if (!isStr(d.exportedAt) || !ISO.test(d.exportedAt) || !isStr(d.app) || d.app.length > 60 || CONTROL.test(d.app)) bad(e, "data");
      if (!isStr(d.sourceProject) || !PROJECT_ID.test(d.sourceProject) || typeof d.events !== "number" || !Number.isInteger(d.events)) bad(e, "data");
      // earlier imports: a flat list, most recent first, at most 20, each with the same fields (no nesting)
      if (d.previous !== undefined) {
        if (!Array.isArray(d.previous) || d.previous.length === 0 || d.previous.length > 20) bad(e, "data");
        for (const r of d.previous as unknown[]) {
          if (typeof r !== "object" || r === null || Array.isArray(r)) bad(e, "data");
          const o = r as Record<string, unknown>;
          if (keys(o) !== "app,archive,events,exportedAt,mode,name,sourceProject" || !isStr(o.name) || !isStr(o.app) || !isStr(o.archive) || !isStr(o.mode) || !isStr(o.exportedAt) || !isStr(o.sourceProject) || typeof o.events !== "number") bad(e, "data");
        }
      }
      break;
    }
    case "memory.created": {
      needKeys(e, d, ["category", "title", "body", "important", "author", "source", "confirmation", "version"]);
      if (!isCategory(d.category) || !validTitle(d.title) || !validBody(d.body) || typeof d.important !== "boolean") bad(e, "data");
      if (checkEntry({ title: d.title as string, body: d.body as string, category: d.category })) bad(e, "data");
      if ((d.author !== "user" && d.author !== "ai") || d.version !== 1) bad(e, "data");
      if (d.source !== null && (!isStr(d.source) || charCount(d.source) > SOURCE_MAX || CONTROL.test(d.source))) bad(e, "data");
      if (!(d.author === "user" ? d.confirmation === "confirmed" : d.confirmation === "pending")) bad(e, "data");
      break;
    }
    case "memory.edited":
      needKeys(e, d, ["title", "body", "version"]);
      if (!validTitle(d.title) || !validBody(d.body) || checkEntry({ title: d.title as string, body: d.body as string })) bad(e, "data");
      if (typeof d.version !== "number" || !Number.isInteger(d.version) || d.version < 2) bad(e, "data");
      break;
    case "memory.important":
      needKeys(e, d, ["important"]);
      if (typeof d.important !== "boolean") bad(e, "data");
      break;
    case "memory.status":
      needKeys(e, d, ["status"]);
      if (!["active", "replaced", "resolved"].includes(d.status as string)) bad(e, "data");
      break;
    case "link.created":
      needKeys(e, d, ["from", "to", "type", "reason"]);
      if (!isEntryId(d.from) || !isEntryId(d.to) || !isLinkType(d.type) || !isStr(d.reason) || charCount(d.reason) > REASON_MAX || CONTROL.test(d.reason)) bad(e, "data");
      break;
    default:
      bad(e, "type"); // a type this version does not know in a version 1 archive
  }
}

interface FoldEntry { category: string; title: string; body: string; important: boolean; author: string; source: string | null; confirmation: string; archived: boolean; version: number }

/**
 * Replays the history and compares the result with the records. The project's state fields, every
 * entry's content and flags, and the set of links must be exactly what the history produces.
 */
export function replayProject(pf: ProjectFile): void {
  const inconsistent = (what: string): never => {
    throw new ArchiveError("inconsistent", what);
  };
  const project: { name?: string; description?: string; pinned: boolean; trashed: boolean } = { pinned: false, trashed: false };
  const entries = new Map<string, FoldEntry>();
  const purged = new Set<string>();
  const links = new Map<string, { from: string; to: string; type: string; reason: string }>();
  const removedLinks = new Set<string>();
  const sessions = new Map<string, { provider: string; providerName: string; task: string; continues: string | null; status: string }>();
  const exchanges = new Map<string, Record<string, unknown>>();
  pf.events.forEach((e, i) => {
    if (e.type === "project.imported" && i !== 0) inconsistent("import record inside the history");
    const d = e.data as Record<string, unknown>;
    const id = e.entityId!;
    const cur = entries.get(id);
    switch (e.type) {
      case "project.created": project.name = d.name as string; project.description = d.description as string; break;
      case "project.renamed": project.name = d.name as string; break;
      case "project.updated": project.description = d.description as string; break;
      case "project.pinned": project.pinned = d.pinned as boolean; break;
      case "project.trashed": project.trashed = true; break;
      case "project.restored": project.trashed = false; break;
      case "project.purged": inconsistent("purged project"); break;
      case "memory.created":
        if (entries.has(id) || purged.has(id)) inconsistent(`created twice ${id}`);
        entries.set(id, { category: d.category as string, title: d.title as string, body: d.body as string, important: d.important as boolean, author: d.author as string, source: d.source as string | null, confirmation: d.confirmation as string, archived: false, version: 1 });
        break;
      case "memory.purged":
        entries.delete(id);
        purged.add(id);
        break;
      case "memory.status":
        break; // statuses are recomputed from the links below
      case "link.created":
        if (links.has(id) || removedLinks.has(id)) inconsistent(`link created twice ${id}`);
        links.set(id, { from: d.from as string, to: d.to as string, type: d.type as string, reason: d.reason as string });
        break;
      case "link.removed":
        links.delete(id);
        removedLinks.add(id);
        break;
      case "session.created":
        if (sessions.has(id) || d.continues === id) inconsistent(`session ${id}`);
        sessions.set(id, { provider: d.provider as string, providerName: d.providerName as string, task: d.task as string, continues: d.continues as string | null, status: "open" });
        break;
      case "session.closed": case "session.reopened": {
        const x = sessions.get(id);
        if (!x) inconsistent(`event for an unknown session ${id}`);
        x!.status = e.type === "session.closed" ? "closed" : "open";
        break;
      }
      case "session.exchange":
        if (exchanges.has(id) || !sessions.has(d.session as string)) inconsistent(`exchange ${id}`);
        if (sessions.get(d.session as string)!.status === "closed") inconsistent(`exchange in a closed session ${id}`);
        exchanges.set(id, d);
        break;
      default: {
        if (!e.type.startsWith("memory.")) break;
        if (!cur) inconsistent(`event for an unknown entry ${id}`);
        const c = cur!;
        if (e.type === "memory.edited") {
          if (d.version !== c.version + 1 || c.confirmation === "rejected") inconsistent(`version order ${id}`);
          Object.assign(c, { title: d.title, body: d.body, version: d.version });
        } else if (e.type === "memory.important") c.important = d.important as boolean;
        else if (e.type === "memory.archived") c.archived = true;
        else if (e.type === "memory.restored") c.archived = false;
        else if (e.type === "memory.confirmed") {
          if (c.confirmation !== "pending") inconsistent(`confirmed twice ${id}`);
          c.confirmation = "confirmed";
        } else if (e.type === "memory.rejected") {
          if (c.confirmation !== "pending") inconsistent(`rejected twice ${id}`);
          c.confirmation = "rejected";
          c.archived = true;
        }
      }
    }
  });

  const p = pf.project;
  if (project.name === undefined) inconsistent("no project history");
  if (p.name !== project.name || p.description !== project.description || p.pinned !== project.pinned || !!p.deletedAt !== project.trashed) inconsistent("project");
  if (entries.size !== pf.memory.length) inconsistent("entries");
  for (const e of pf.memory) {
    const f = entries.get(e.id);
    if (!f) inconsistent(`entry ${e.id}`);
    for (const k of ["category", "title", "body", "important", "author", "source", "confirmation", "archived", "version"] as const) {
      if (e[k] !== f![k]) inconsistent(`${k} ${e.id}`);
    }
    if ((e.confirmation === "confirmed") !== (e.confirmedAt !== null)) inconsistent(`confirmedAt ${e.id}`);
  }
  if (links.size !== pf.links.length) inconsistent("links");
  for (const l of pf.links) {
    const f = links.get(l.id);
    if (!f || f.from !== l.from || f.to !== l.to || f.type !== l.type || f.reason !== l.reason) inconsistent(`link ${l.id}`);
  }
  checkLinkRules(pf.memory, pf.links);
  if (sessions.size !== pf.sessions.length || exchanges.size !== pf.exchanges.length) inconsistent("sessions");
  for (const x of pf.sessions) {
    const f = sessions.get(x.id);
    if (!f || f.provider !== x.provider || f.providerName !== x.providerName || f.task !== x.task || f.continues !== x.continues || f.status !== x.status) inconsistent(`session ${x.id}`);
  }
  for (const x of pf.exchanges) {
    const f = exchanges.get(x.id);
    if (!f || f.session !== x.sessionId || f.kind !== x.kind || f.text !== x.text || JSON.stringify(f.proposals) !== JSON.stringify(x.proposals)
      || JSON.stringify(f.pack) !== JSON.stringify(x.pack)) inconsistent(`exchange ${x.id}`);
  }
}

/**
 * The rules of links made in the app, applied to the final set (core/memory.ts checkLink): no
 * duplicates (related_to in either direction), category rules for replaces / resolves, no cycles of
 * derived_from or replaces, and a decision replaced by at most one official decision.
 */
export function checkLinkRules(memory: MemoryEntry[], links: MemoryLink[]): void {
  const byId = new Map(memory.map((e) => [e.id, e]));
  const seen = new Set<string>();
  for (const l of links) {
    const from = byId.get(l.from)!;
    const to = byId.get(l.to)!;
    const key = l.type === "related_to" ? [l.type, ...[l.from, l.to].sort()].join("|") : [l.type, l.from, l.to].join("|");
    if (seen.has(key)) throw new ArchiveError("inconsistent", "duplicate link");
    seen.add(key);
    if (l.type === "replaces" && (from.category !== "decision" || to.category !== "decision")) throw new ArchiveError("inconsistent", "replaces category");
    if (l.type === "resolves" && (to.category !== "issue" || from.category === "issue")) throw new ArchiveError("inconsistent", "resolves category");
  }
  for (const type of ["derived_from", "replaces"] as const) {
    const next = new Map<string, string[]>();
    for (const l of links) if (l.type === type) next.set(l.from, [...(next.get(l.from) ?? []), l.to]);
    const state = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = done
    const visit = (n: string): void => {
      if (state.get(n) === 2) return;
      if (state.get(n) === 1) throw new ArchiveError("inconsistent", `${type} cycle`);
      state.set(n, 1);
      for (const m of next.get(n) ?? []) visit(m);
      state.set(n, 2);
    };
    for (const n of next.keys()) visit(n);
  }
  const replacedBy = new Map<string, number>();
  for (const l of links) {
    if (l.type !== "replaces" || !isOfficial(byId.get(l.from)!)) continue;
    replacedBy.set(l.to, (replacedBy.get(l.to) ?? 0) + 1);
    if (replacedBy.get(l.to)! > 1) throw new ArchiveError("inconsistent", "replaced twice");
  }
}

/** Project fields not covered by the history: dates, name history. */
export function checkProjectExtras(p: Project): void {
  for (const h of p.nameHistory) if (!validName(h.name)) throw new ArchiveError("invalidRecord", "nameHistory");
}
