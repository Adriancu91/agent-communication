// Reading an AI reply back (AIW-05): finds the proposals in it and compares them with the project's memory.
// Pure functions. Nothing here writes anything: the user reviews every proposal first.
//
// 1. Preferred: the fenced block the package asks for (```aiw-propuneri / ```aiw-proposals, JSON).
// 2. Otherwise: sections the AI wrote on its own ("Decizii:", "## Next steps", …) and their bullet points.
// 3. Every proposal is compared with the memory: already there (same category + same title), similar
//    (most words of the title in common), or new; references (D1, P2) are resolved to the real entries.
import {
  CATEGORIES, charCount, cleanBody, cleanTitle, searchKey, TITLE_MAX, BODY_MAX, REASON_MAX,
  type Category, type MemoryEntry,
} from "../core";
import { BLOCK_TAG, PROPOSAL_TYPES } from "./pack";

export type MatchKind = "new" | "duplicate" | "similar";

export interface ProposalDraft {
  /** Stable key inside one review. */
  key: string;
  category: Category;
  title: string;
  body: string;
  important: boolean;
  /** Entry this decision replaces (resolved from a reference such as D1), with the AI's reason. */
  replaces: string | null;
  /** Problem this entry resolves (from a reference such as P1). */
  resolves: string | null;
  reason: string;
  origin: "block" | "sections";
  match: MatchKind;
  /** The existing entry it duplicates or resembles. */
  similarTo: string | null;
  /** What could not be used as given, for the user (e.g. an unknown reference). */
  notes: ("unknownRef" | "replacesNotDecision" | "resolvesNotIssue" | "titleCut" | "duplicateInReply")[];
}

export interface ParsedReply {
  found: "block" | "sections" | "none";
  /** The block was there but was not valid JSON (the sections were tried instead). */
  blockInvalid: boolean;
  proposals: ProposalDraft[];
}

const MAX_PROPOSALS = 100;

/** Every category word, both languages, without diacritics, singular and plural / usual synonyms. */
const SYNONYMS: Record<Category, string[]> = {
  goal: ["obiectiv", "obiective", "scop", "scopuri", "goal", "goals", "objective", "objectives"],
  instruction: ["regula", "reguli", "instructiune", "instructiuni", "instructiuni si reguli", "rule", "rules", "instruction", "instructions", "constraints", "constrangeri"],
  decision: ["decizie", "decizii", "decizii confirmate", "decizii noi", "decision", "decisions", "new decisions"],
  fact: ["informatie", "informatii", "informatii importante", "fapt", "fapte", "fact", "facts", "key facts", "important facts", "findings", "constatari"],
  context: ["context", "stare", "starea actuala", "context / starea actuala", "current state", "status", "situatie", "situatia actuala"],
  issue: ["problema", "probleme", "probleme deschise", "risc", "riscuri", "intrebari deschise", "issue", "issues", "problem", "problems", "open problems", "open questions", "risks"],
  step: ["pas", "pasi", "pasii urmatori", "urmatorii pasi", "pasi urmatori", "step", "steps", "next steps", "next step", "todo", "to do", "de facut", "actiuni", "action items", "actions"],
};

const norm = (s: string) => searchKey(s).replace(/[^\p{L}\p{N}\s/]/gu, " ").replace(/\s+/g, " ").trim();

export function categoryOf(word: unknown): Category | null {
  if (typeof word !== "string") return null;
  const w = norm(word);
  if ((CATEGORIES as readonly string[]).includes(w)) return w as Category;
  for (const c of CATEGORIES) {
    if (PROPOSAL_TYPES.ro[c] === w || PROPOSAL_TYPES.en[c] === w || SYNONYMS[c].includes(w)) return c;
  }
  return null;
}

/** A title must fit the memory rules: one line, at most TITLE_MAX characters. Longer text moves to the body. */
function splitTitle(raw: string, body: string): { title: string; body: string; cut: boolean } {
  const one = cleanTitle(raw.split("\n")[0]);
  const rest = raw.includes("\n") ? raw.slice(raw.indexOf("\n") + 1) : "";
  if (charCount(one) <= TITLE_MAX) return { title: one, body: cleanBody([rest, body].filter(Boolean).join("\n")), cut: false };
  const chars = [...one];
  let cutAt = TITLE_MAX - 1;
  const sentence = one.search(/[.!?;:](\s|$)/);
  if (sentence > 10 && sentence < TITLE_MAX - 1) cutAt = sentence + 1;
  const title = cleanTitle(chars.slice(0, cutAt).join("")) + (cutAt === TITLE_MAX - 1 ? "…" : "");
  return { title, body: cleanBody([one, rest, body].filter(Boolean).join("\n")), cut: true };
}

/** JSON as AI assistants often write it: tolerates trailing commas and typographic quotes. */
function lenientJson(src: string): unknown {
  try {
    return JSON.parse(src);
  } catch {
    const fixed = src.replace(/[“”„]/g, '"').replace(/,\s*([\]}])/g, "$1");
    return JSON.parse(fixed);
  }
}

const field = (o: Record<string, unknown>, ...names: string[]): unknown => {
  for (const n of names) if (o[n] !== undefined) return o[n];
  return undefined;
};

const BLOCK_RE = new RegExp("```\\s*(" + [BLOCK_TAG.ro, BLOCK_TAG.en].join("|") + ")\\s*\\n([\\s\\S]*?)```", "i");

interface Raw { category: Category; title: string; body: string; important: boolean; replacesRef: string | null; resolvesRef: string | null; reason: string; origin: "block" | "sections" }

function fromBlock(text: string): { raws: Raw[] | null; invalid: boolean } {
  const m = BLOCK_RE.exec(text);
  if (!m) return { raws: null, invalid: false };
  let data: unknown;
  try {
    data = lenientJson(m[2].trim());
  } catch {
    return { raws: null, invalid: true };
  }
  const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { proposals?: unknown }).proposals) ? (data as { proposals: unknown[] }).proposals : null;
  if (!list) return { raws: null, invalid: true };
  const raws: Raw[] = [];
  for (const item of list.slice(0, MAX_PROPOSALS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const category = categoryOf(field(o, "tip", "type", "categorie", "category"));
    const title = field(o, "titlu", "title");
    if (!category || typeof title !== "string" || !title.trim()) continue;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    raws.push({
      category, title, body: str(field(o, "text", "body", "detalii", "details")), important: field(o, "important") === true,
      replacesRef: str(field(o, "inlocuieste", "înlocuiește", "replaces")).trim() || null,
      resolvesRef: str(field(o, "rezolva", "rezolvă", "resolves")).trim() || null,
      reason: str(field(o, "motiv", "reason")), origin: "block",
    });
  }
  return { raws, invalid: false };
}

/** Headings ("## Decizii", "**Next steps:**", "Probleme deschise:") followed by bullet points. */
function fromSections(text: string): Raw[] {
  const raws: Raw[] = [];
  let current: Category | null = null;
  let inCode = false;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !trimmed) continue;
    const bullet = /^(?:[-*•–]|\d{1,3}[.)])\s+(.+)$/.exec(trimmed);
    if (bullet && !/^\*\*.*\*\*:?$/.test(trimmed)) {
      const t = bullet[1].replace(/^\[[ xX]\]\s*/, "").replace(/\*\*|__/g, "").trim();
      if (current && t) raws.push({ category: current, title: t, body: "", important: false, replacesRef: null, resolvesRef: null, reason: "", origin: "sections" });
      if (raws.length >= MAX_PROPOSALS) break;
      continue;
    }
    // a heading: "# …", a line in bold, or a short line ending with ":" — it starts a new section
    // (a category we know, or an unrelated one, which stops collecting)
    const isHeading = trimmed.startsWith("#") || /^(\*\*|__).+(\*\*|__):?$/.test(trimmed) || (trimmed.endsWith(":") && trimmed.length <= 60);
    if (isHeading) current = categoryOf(trimmed.replace(/^#+/, "").replace(/\*\*|__/g, "").replace(/:$/, "").trim());
  }
  return raws;
}

function words(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((w) => w.length > 2));
}
function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}

/**
 * Reads the reply. `refs` maps the short references of the package that was sent (D1 → entry id);
 * `entries` is the project's memory now (to compare with).
 */
export function parseReply(text: string, refs: Record<string, string>, entries: MemoryEntry[]): ParsedReply {
  const { raws: blockRaws, invalid } = fromBlock(text);
  const raws = blockRaws ?? fromSections(text);
  const found: ParsedReply["found"] = blockRaws ? "block" : raws.length ? "sections" : "none";
  const byId = new Map(entries.map((e) => [e.id, e]));
  const resolveRef = (r: string | null) => {
    if (!r) return { id: null, unknown: false };
    const key = r.replace(/[\s[\]]/g, "").toUpperCase();
    const id = refs[key];
    return id && byId.has(id) ? { id, unknown: false } : { id: null, unknown: true };
  };
  // compare with everything the user has not rejected (official, pending, archived)
  const pool = entries.filter((e) => e.confirmation !== "rejected");
  const seen = new Set<string>();
  const proposals: ProposalDraft[] = raws.map((r, i) => {
    const notes: ProposalDraft["notes"] = [];
    const st = splitTitle(r.title, r.body);
    if (st.cut) notes.push("titleCut");
    const body = [...st.body].slice(0, BODY_MAX).join("");
    const rep = resolveRef(r.replacesRef);
    const res = resolveRef(r.resolvesRef);
    if (rep.unknown || res.unknown) notes.push("unknownRef");
    let replaces = rep.id;
    let resolves = res.id;
    if (replaces && (r.category !== "decision" || byId.get(replaces)!.category !== "decision")) {
      notes.push("replacesNotDecision");
      replaces = null;
    }
    if (resolves && (r.category === "issue" || byId.get(resolves)!.category !== "issue")) {
      notes.push("resolvesNotIssue");
      resolves = null;
    }
    const k = `${r.category}|${norm(st.title)}`;
    if (seen.has(k)) notes.push("duplicateInReply");
    seen.add(k);
    let match: MatchKind = "new";
    let similarTo: string | null = null;
    const same = pool.find((e) => e.category === r.category && norm(e.title) === norm(st.title));
    if (same) {
      match = "duplicate";
      similarTo = same.id;
    } else {
      let best = 0;
      for (const e of pool) {
        if (e.category !== r.category) continue;
        const s = similarity(e.title, st.title);
        if (s > best) {
          best = s;
          similarTo = e.id;
        }
      }
      if (best >= 0.6) match = "similar";
      else similarTo = null;
    }
    return {
      key: `p${i}`, category: r.category, title: st.title, body, important: r.important,
      replaces, resolves, reason: [...cleanBody(r.reason)].slice(0, REASON_MAX).join(""), origin: r.origin, match, similarTo, notes,
    };
  });
  return { found, blockInvalid: invalid, proposals };
}
