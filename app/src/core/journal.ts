// The journal: every change is an event linked to the previous one by a SHA-256 fingerprint
// (same idea as logs/events.jsonl in the back-office). The content of an event is fingerprinted
// separately, so it can be erased (definitive delete) without breaking the chain.

export type EventType = "project.created" | "project.renamed" | "project.updated" | "project.pinned"
  | "project.trashed" | "project.restored" | "project.purged"
  // AIW-03: memory entries and the links between them
  | "memory.created" | "memory.edited" | "memory.important" | "memory.archived" | "memory.restored"
  | "memory.confirmed" | "memory.rejected" | "memory.status" | "memory.purged"
  | "link.created" | "link.removed"
  // AIW-04: a project arrived from an export archive; the events after it are its imported history
  | "project.imported";

export const EVENT_TYPES: readonly EventType[] = ["project.created", "project.renamed", "project.updated", "project.pinned",
  "project.trashed", "project.restored", "project.purged", "memory.created", "memory.edited", "memory.important",
  "memory.archived", "memory.restored", "memory.confirmed", "memory.rejected", "memory.status", "memory.purged",
  "link.created", "link.removed", "project.imported"];

export interface JournalEvent {
  seq: number;
  ts: string;
  type: EventType;
  projectId: string;
  /** The memory entry or link the event is about (AIW-03). Absent on AIW-02 project events. */
  entityId?: string;
  dataHash: string;
  data: Record<string, unknown> | null; // null after a definitive delete
  prev: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);

/** Stable JSON: keys sorted, so the same content always gives the same fingerprint. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The fingerprinted header. `entityId` is included only when present, so AIW-02 events keep their fingerprint. */
function header(e: Pick<JournalEvent, "seq" | "ts" | "type" | "projectId" | "entityId" | "dataHash" | "prev">) {
  const h: Record<string, unknown> = { seq: e.seq, ts: e.ts, type: e.type, projectId: e.projectId, dataHash: e.dataHash, prev: e.prev };
  if (e.entityId !== undefined) h.entityId = e.entityId;
  return canonical(h);
}

/** The fingerprint an event must have, given its header fields (used to check imported history). */
export function eventHash(e: Pick<JournalEvent, "seq" | "ts" | "type" | "projectId" | "entityId" | "dataHash" | "prev">): Promise<string> {
  return sha256(header(e));
}

/**
 * The events that describe a project as it is now: those from its latest import on (AIW-04).
 * When a project is replaced by an imported copy, its older events stay in the journal (nothing is
 * deleted and the chain stays verifiable) but no longer describe the current project.
 */
export function currentEvents<E extends Pick<JournalEvent, "seq" | "type" | "projectId">>(events: E[], projectId: string): E[] {
  const own = events.filter((e) => e.projectId === projectId);
  let from = 0;
  for (const e of own) if (e.type === "project.imported" && e.seq > from) from = e.seq;
  return own.filter((e) => e.seq >= from);
}

export async function makeEvent(prev: { seq: number; hash: string } | null, ts: string, type: EventType,
  projectId: string, data: Record<string, unknown>, entityId?: string): Promise<JournalEvent> {
  const seq = (prev?.seq ?? 0) + 1;
  const prevHash = prev?.hash ?? GENESIS;
  const dataHash = await sha256(canonical(data));
  const base = { seq, ts, type, projectId, dataHash, prev: prevHash, ...(entityId !== undefined ? { entityId } : {}) };
  const hash = await sha256(header(base));
  return { ...base, data, hash };
}

export type ChainProblem = "gap" | "brokenLink" | "eventModified" | "contentModified";

export interface ChainReport {
  ok: boolean;
  events: number;
  erased: number;
  /** What is wrong, as a code the interface translates, and at which event. */
  problem?: ChainProblem;
  at?: number;
}

/** Checks the whole chain. Erased content is allowed; any other change is reported. */
export async function verifyChain(events: JournalEvent[]): Promise<ChainReport> {
  let prev = GENESIS;
  let erased = 0;
  for (const [i, e] of events.entries()) {
    if (e.seq !== i + 1) return { ok: false, events: events.length, erased, problem: "gap", at: i + 1 };
    if (e.prev !== prev) return { ok: false, events: events.length, erased, problem: "brokenLink", at: e.seq };
    const h = await sha256(header(e));
    if (h !== e.hash) return { ok: false, events: events.length, erased, problem: "eventModified", at: e.seq };
    if (e.data === null) erased++;
    else if ((await sha256(canonical(e.data))) !== e.dataHash) {
      return { ok: false, events: events.length, erased, problem: "contentModified", at: e.seq };
    }
    prev = e.hash;
  }
  return { ok: true, events: events.length, erased };
}
