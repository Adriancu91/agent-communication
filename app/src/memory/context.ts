// Prepares a project's memory for a future AI hand-over (AIW-05). Pure and deterministic:
// same input + same options = the same output, byte for byte. It never changes the memory;
// the complete memory always stays the reference. No network, no AI here.
import { canonical, isOfficial, type Category, type LinkType, type MemoryEntry, type MemoryLink, type Project } from "../core";

/** The order of the sections in the context (what an AI should read first). */
export const CONTEXT_ORDER: Category[] = ["instruction", "goal", "context", "decision", "fact", "issue", "step"];

export interface ContextOptions {
  /** Size limit in characters of the serialized result (default 24 000). */
  maxChars?: number;
  /** Also include resolved problems / done steps and replaced decisions (default: no). */
  includeClosed?: boolean;
}

export interface ContextItem {
  id: string;
  title: string;
  body: string;
  important: boolean;
  status: MemoryEntry["status"];
  author: MemoryEntry["author"];
  source: string | null;
  links: { type: LinkType; direction: "out" | "in"; id: string; title: string }[];
}

export interface Omission {
  id: string;
  category: Category;
  title: string;
  reason: "sizeLimit" | "closed" | "archived" | "notConfirmed";
}

export interface PreparedContext {
  format: "aiw-context";
  version: 1;
  project: { id: string; name: string; description: string };
  sections: { category: Category; items: ContextItem[] }[];
  omitted: Omission[];
  stats: { included: number; omitted: number; chars: number; maxChars: number };
}

export const DEFAULT_MAX_CHARS = 24_000;

function byPriority(a: MemoryEntry, b: MemoryEntry): number {
  // important first, then the most recently changed, then the id (so ties are always ordered the same way)
  return Number(b.important) - Number(a.important) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}

/**
 * Rules (documented in docs/AIW-03.md):
 * 1. Only official memory: confirmed by the user and not archived. Pending AI proposals, rejected
 *    proposals and archived entries are excluded (and listed as omitted with their reason).
 * 2. Resolved problems, done steps and replaced decisions are excluded unless includeClosed.
 * 3. Sections in CONTEXT_ORDER; inside a section: important first, then most recent, then id.
 * 4. Size limit (measured on the project + sections, see contextSize): entries are dropped one at a time, the least important first — non-important before
 *    important, sections from the end of CONTEXT_ORDER backwards, and inside a section from the
 *    bottom of its order — until the result fits. Every dropped entry is listed in `omitted`.
 *    Instructions are dropped last of all.
 * 5. Only entries of this project are read, whatever the input contains.
 */
export function buildContext(project: Project, entries: MemoryEntry[], links: MemoryLink[], opts: ContextOptions = {}): PreparedContext {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const own = entries.filter((e) => e.projectId === project.id);
  const ownIds = new Set(own.map((e) => e.id));
  const byId = new Map(own.map((e) => [e.id, e]));
  const omitted: Omission[] = [];
  const candidates: MemoryEntry[] = [];
  for (const e of [...own].sort((a, b) => a.id.localeCompare(b.id))) {
    if (e.archived) omitted.push({ id: e.id, category: e.category, title: e.title, reason: e.confirmation === "confirmed" ? "archived" : "notConfirmed" });
    else if (!isOfficial(e)) omitted.push({ id: e.id, category: e.category, title: e.title, reason: "notConfirmed" });
    else if (e.status !== "active" && !opts.includeClosed) omitted.push({ id: e.id, category: e.category, title: e.title, reason: "closed" });
    else candidates.push(e);
  }
  const ownLinks = links.filter((l) => l.projectId === project.id && ownIds.has(l.from) && ownIds.has(l.to));

  const item = (e: MemoryEntry, included: Set<string>): ContextItem => ({
    id: e.id, title: e.title, body: e.body, important: e.important, status: e.status, author: e.author, source: e.source,
    links: ownLinks
      .filter((l) => (l.from === e.id && included.has(l.to)) || (l.to === e.id && included.has(l.from)))
      .map((l) => {
        const out = l.from === e.id;
        const other = byId.get(out ? l.to : l.from)!;
        return { type: l.type, direction: out ? ("out" as const) : ("in" as const), id: other.id, title: other.title };
      })
      .sort((a, b) => a.type.localeCompare(b.type) || a.direction.localeCompare(b.direction) || a.id.localeCompare(b.id)),
  });

  const ordered = CONTEXT_ORDER.flatMap((c) => candidates.filter((e) => e.category === c).sort(byPriority));
  // drop order: non-important before important; sections from the end; inside a section from the bottom
  const rank = (e: MemoryEntry) => (e.important ? 1 : 0) * 100 + (e.category === "instruction" ? 50 : 0) + CONTEXT_ORDER.indexOf(e.category) * -1;
  const dropOrder = [...ordered].reverse().sort((a, b) => rank(a) - rank(b));

  const included = new Set(ordered.map((e) => e.id));
  const assemble = (): PreparedContext => {
    const sections = CONTEXT_ORDER
      .map((category) => ({ category, items: ordered.filter((e) => e.category === category && included.has(e.id)).map((e) => item(e, included)) }))
      .filter((s) => s.items.length > 0);
    const n = sections.reduce((s, x) => s + x.items.length, 0);
    const result: PreparedContext = {
      format: "aiw-context", version: 1,
      project: { id: project.id, name: project.name, description: project.description },
      sections,
      omitted: [...omitted],
      stats: { included: n, omitted: omitted.length, chars: 0, maxChars },
    };
    result.stats.chars = contextSize(result);
    return result;
  };

  let result = assemble();
  for (const e of dropOrder) {
    if (result.stats.chars <= maxChars) break;
    included.delete(e.id);
    omitted.push({ id: e.id, category: e.category, title: e.title, reason: "sizeLimit" });
    result = assemble();
  }
  return result;
}

/** Stable serialization of the whole result (sorted keys), used by the determinism tests. */
export function serializeContext(c: PreparedContext): string {
  return canonical(c);
}

/**
 * The size that counts for the limit: what an AI would receive (the project and the sections).
 * The omission report is for the user and is not counted (it grows as entries are dropped).
 */
export function contextSize(c: Pick<PreparedContext, "project" | "sections">): number {
  return canonical({ project: c.project, sections: c.sections }).length;
}
