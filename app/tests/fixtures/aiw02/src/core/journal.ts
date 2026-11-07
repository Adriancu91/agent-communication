// The journal: every change is an event linked to the previous one by a SHA-256 fingerprint
// (same idea as logs/events.jsonl in the back-office). The content of an event is fingerprinted
// separately, so it can be erased (definitive delete) without breaking the chain.

export type EventType = "project.created" | "project.renamed" | "project.updated" | "project.pinned"
  | "project.trashed" | "project.restored" | "project.purged";

export interface JournalEvent {
  seq: number;
  ts: string;
  type: EventType;
  projectId: string;
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

export async function makeEvent(prev: { seq: number; hash: string } | null, ts: string, type: EventType,
  projectId: string, data: Record<string, unknown>): Promise<JournalEvent> {
  const seq = (prev?.seq ?? 0) + 1;
  const prevHash = prev?.hash ?? GENESIS;
  const dataHash = await sha256(canonical(data));
  const hash = await sha256(canonical({ seq, ts, type, projectId, dataHash, prev: prevHash }));
  return { seq, ts, type, projectId, dataHash, data, prev: prevHash, hash };
}

export interface ChainReport {
  ok: boolean;
  events: number;
  erased: number;
  problem?: string;
}

/** Checks the whole chain. Erased content is allowed; any other change is reported. */
export async function verifyChain(events: JournalEvent[]): Promise<ChainReport> {
  let prev = GENESIS;
  let erased = 0;
  for (const [i, e] of events.entries()) {
    if (e.seq !== i + 1) return { ok: false, events: events.length, erased, problem: `lipsește evenimentul ${i + 1}` };
    if (e.prev !== prev) return { ok: false, events: events.length, erased, problem: `legătura ruptă la ${e.seq}` };
    const h = await sha256(canonical({ seq: e.seq, ts: e.ts, type: e.type, projectId: e.projectId, dataHash: e.dataHash, prev: e.prev }));
    if (h !== e.hash) return { ok: false, events: events.length, erased, problem: `evenimentul ${e.seq} a fost modificat` };
    if (e.data === null) erased++;
    else if ((await sha256(canonical(e.data))) !== e.dataHash) {
      return { ok: false, events: events.length, erased, problem: `conținutul evenimentului ${e.seq} a fost modificat` };
    }
    prev = e.hash;
  }
  return { ok: true, events: events.length, erased };
}
