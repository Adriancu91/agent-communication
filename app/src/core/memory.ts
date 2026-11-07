// Project memory: the entry, the link between entries, and their rules. Pure functions, no storage.
import { charCount, searchKey } from "./project";

/** The seven approved categories, in the order the interface shows them. */
export const CATEGORIES = ["goal", "instruction", "decision", "fact", "context", "issue", "step"] as const;
export type Category = (typeof CATEGORIES)[number];

/** The four approved relationship types. */
export const LINK_TYPES = ["derived_from", "replaces", "resolves", "related_to"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export type EntryStatus = "active" | "replaced" | "resolved";
export type Author = "user" | "ai";
export type Confirmation = "confirmed" | "pending" | "rejected";

export const TITLE_MAX = 120;
export const BODY_MAX = 20_000;
export const SOURCE_MAX = 200;
export const REASON_MAX = 500;

export interface MemoryEntry {
  id: string; // "M-<uuid>"
  projectId: string;
  category: Category;
  title: string;
  body: string; // plain text with line breaks
  important: boolean;
  /** replaced = a newer decision replaces it; resolved = an entry resolves this problem. Derived from links. */
  status: EntryStatus;
  /** Archived entries leave the normal view; restoring brings them back unchanged. */
  archived: boolean;
  author: Author; // who introduced it: the user, or an AI proposal
  source: string | null; // where it came from, only when supplied (never invented)
  confirmation: Confirmation; // AI proposals stay "pending" until the user confirms them
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number; // current content version; older versions live in the journal
  v: 1;
}

export interface MemoryLink {
  id: string; // "L-<uuid>"
  projectId: string;
  from: string; // e.g. the NEW decision …
  to: string; // … replaces the OLD decision
  type: LinkType;
  reason: string; // optional explanation (required by the interface when replacing a decision)
  createdAt: string;
  v: 1;
}

/** One version of an entry's content, read back from the journal. */
export interface EntryVersion {
  version: number;
  title: string;
  body: string;
  ts: string;
  seq: number;
  current: boolean;
}

export type EntryField = "title" | "body" | "category" | "source" | "reason";
export type EntryProblem = "empty" | "tooLong" | "invalidChars" | "invalid";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;
const ID = /^[ML]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newEntryId(): string {
  return "M-" + crypto.randomUUID();
}
export function newLinkId(): string {
  return "L-" + crypto.randomUUID();
}
export function isEntryId(s: unknown): s is string {
  return typeof s === "string" && ID.test(s) && s.startsWith("M-");
}

export function isCategory(c: unknown): c is Category {
  return typeof c === "string" && (CATEGORIES as readonly string[]).includes(c);
}
export function isLinkType(t: unknown): t is LinkType {
  return typeof t === "string" && (LINK_TYPES as readonly string[]).includes(t);
}

export function cleanTitle(raw: string): string {
  return String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}
export function cleanBody(raw: string): string {
  return String(raw ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

/** First problem found in a new or edited entry, or null. */
export function checkEntry(e: { title: string; body: string; category?: unknown; source?: string | null }): { field: EntryField; problem: EntryProblem } | null {
  if (e.category !== undefined && !isCategory(e.category)) return { field: "category", problem: "invalid" };
  if (!e.title) return { field: "title", problem: "empty" };
  if (charCount(e.title) > TITLE_MAX) return { field: "title", problem: "tooLong" };
  if (CONTROL.test(e.title) || e.title.includes("\n")) return { field: "title", problem: "invalidChars" };
  if (charCount(e.body) > BODY_MAX) return { field: "body", problem: "tooLong" };
  if (CONTROL.test(e.body)) return { field: "body", problem: "invalidChars" };
  if (e.source != null && (charCount(e.source) > SOURCE_MAX || CONTROL.test(e.source))) return { field: "source", problem: "invalid" };
  return null;
}

/** Official memory = confirmed by the user and not archived. Only this goes into an AI context. */
export function isOfficial(e: MemoryEntry): boolean {
  return e.confirmation === "confirmed" && !e.archived;
}

/**
 * The status an entry must have, given the links pointing to it. Only links coming from OFFICIAL
 * entries count: if the decision that replaced this one is archived, this one is current again.
 * `official(id)` says whether the source entry is official (confirmed, not archived).
 */
export function statusFromLinks(entryId: string, links: MemoryLink[], official: (id: string) => boolean = () => true): EntryStatus {
  if (links.some((l) => l.to === entryId && l.type === "replaces" && official(l.from))) return "replaced";
  if (links.some((l) => l.to === entryId && l.type === "resolves" && official(l.from))) return "resolved";
  return "active";
}

export type LinkProblem = "self" | "missing" | "crossProject" | "notAllowed" | "duplicate" | "wrongCategory"
  | "alreadyReplaced" | "cycle" | "invalidType";

/**
 * Checks a new link `from —type→ to`. Rules: same project, no self-links, both entries official,
 * no duplicates (related_to counts both directions), category rules for replaces/resolves,
 * no cycles for derived_from and replaces (a chain that comes back to itself has no clear meaning).
 */
export function checkLink(from: MemoryEntry | undefined, to: MemoryEntry | undefined, type: unknown, links: MemoryLink[]): LinkProblem | null {
  if (!isLinkType(type)) return "invalidType";
  if (!from || !to) return "missing";
  if (from.id === to.id) return "self";
  if (from.projectId !== to.projectId) return "crossProject";
  if (!isOfficial(from) || !isOfficial(to)) return "notAllowed";
  const dup = links.some((l) => l.type === type && ((l.from === from.id && l.to === to.id) || (type === "related_to" && l.from === to.id && l.to === from.id)));
  if (dup) return "duplicate";
  if (type === "replaces") {
    if (from.category !== "decision" || to.category !== "decision") return "wrongCategory";
    if (to.status === "replaced" || from.status === "replaced") return "alreadyReplaced";
  }
  if (type === "resolves" && (to.category !== "issue" || from.category === "issue")) return "wrongCategory";
  if ((type === "derived_from" || type === "replaces") && reaches(to.id, from.id, type, links)) return "cycle";
  return null;
}

/** True if `start` reaches `target` by following links of `type` (from → to). */
function reaches(start: string, target: string, type: LinkType, links: MemoryLink[]): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const l of links) if (l.type === type && l.from === cur) stack.push(l.to);
  }
  return false;
}

export interface SearchOptions {
  /** Also look in earlier versions of the entries (opt-in). */
  history?: boolean;
  /** Search the archive instead of the active memory (the archive view). */
  archived?: boolean;
}

export interface SearchHit {
  entry: MemoryEntry;
  /** Set when the match is only in an earlier version. */
  version?: number;
}

/**
 * Searches ONE project's memory: title and text, without diacritics or case.
 * By default only official, non-archived entries; earlier versions only when asked.
 * Pending AI proposals never appear in search results (they have their own list).
 */
export function searchMemory(projectId: string, entries: MemoryEntry[], query: string, opts: SearchOptions = {},
  versions: Map<string, EntryVersion[]> = new Map()): SearchHit[] {
  const q = searchKey(query.trim());
  const pool = entries.filter((e) => e.projectId === projectId && e.confirmation === "confirmed" && e.archived === !!opts.archived);
  if (!q) return pool.map((entry) => ({ entry }));
  const hit = (title: string, body: string) => searchKey(title).includes(q) || searchKey(body).includes(q);
  const out: SearchHit[] = [];
  for (const entry of pool) {
    if (hit(entry.title, entry.body)) out.push({ entry });
    else if (opts.history) {
      const old = (versions.get(entry.id) ?? []).filter((v) => !v.current && hit(v.title, v.body));
      if (old.length) out.push({ entry, version: old[old.length - 1].version });
    }
  }
  return out;
}

/** Display order inside a category: important first, then most recently changed, then id (stable). */
export function sortEntries(list: MemoryEntry[]): MemoryEntry[] {
  return [...list].sort((a, b) => Number(b.important) - Number(a.important) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
