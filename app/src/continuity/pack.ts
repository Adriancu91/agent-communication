// The continuity package (AIW-05): the project's OFFICIAL memory, written as plain Markdown that any AI
// assistant can read, plus the task for the session and, if the user wants, the last saved replies.
// Pure and deterministic. Built on memory/context.ts (buildContext): only confirmed, non-archived entries;
// closed items (resolved problems, done steps, replaced decisions) only on request; pending AI proposals never.
import { CATEGORIES, type Category, type Exchange, type MemoryEntry, type MemoryLink, type Project } from "../core";
import { buildContext, type ContextPayload, type Omission } from "../memory";

export type PackLang = "ro" | "en";

/** Short reference prefixes, one letter per category (language-neutral: G1, I2, D3, F1, C1, P2, S1). */
export const REF_PREFIX: Record<Category, string> = { goal: "G", instruction: "I", decision: "D", fact: "F", context: "C", issue: "P", step: "S" };

/** Category words the AI writes in its proposals block (both languages accepted when reading back). */
export const PROPOSAL_TYPES: Record<PackLang, Record<Category, string>> = {
  ro: { goal: "obiectiv", instruction: "regula", decision: "decizie", fact: "informatie", context: "context", issue: "problema", step: "pas" },
  en: { goal: "goal", instruction: "rule", decision: "decision", fact: "fact", context: "context", issue: "problem", step: "step" },
};

export const BLOCK_TAG: Record<PackLang, string> = { ro: "aiw-propuneri", en: "aiw-proposals" };

const T = {
  ro: {
    title: "Pachet de continuitate",
    made: "Pregătit de AI Workspace pe {date} pentru {ai}.",
    forAi: "Pentru asistentul AI",
    rules: [
      "Acesta e contextul oficial al proiectului, confirmat de utilizator. Nu ai acces la conversațiile lui anterioare cu alți asistenți: continui lucrul pornind de aici.",
      "Tratează informațiile de mai jos ca fiind valabile pentru proiect. Dacă ceva pare greșit, învechit sau contradictoriu, spune-o explicit în loc să presupui.",
      "Fiecare informație are o referință scurtă (de exemplu D2). Folosește-o când te referi la ea.",
      "Unele informații pot lipsi din motive de spațiu; dacă îți trebuie ceva ce nu e aici, întreabă.",
      "La final, dacă propui schimbări în memoria proiectului (o decizie nouă, un pas, o problemă, o informație), adaugă UN singur bloc ca cel de mai jos. Utilizatorul verifică fiecare propunere; nimic nu intră automat în memorie.",
    ],
    typesLine: "Tipuri: {types}. Câmpuri opționale: \"text\", \"important\": true, \"inlocuieste\": \"D1\" cu \"motiv\" (doar pentru decizii), \"rezolva\": \"P1\".",
    example: [
      '{"tip": "decizie", "titlu": "…", "text": "…", "inlocuieste": "D1", "motiv": "…"}',
      '{"tip": "pas", "titlu": "…"}',
      '{"tip": "informatie", "titlu": "…", "rezolva": "P1"}',
    ],
    project: "Proiectul",
    sections: { goal: "Obiective", instruction: "Instrucțiuni și reguli", decision: "Decizii confirmate", fact: "Informații importante", context: "Context / starea actuală", issue: "Probleme deschise", step: "Pașii următori" } as Record<Category, string>,
    important: "important",
    closed: { replaced: "înlocuită", resolved: "rezolvată", done: "făcut" },
    links: { derived_from: "decurge din", replaces: "înlocuiește", resolves: "rezolvă", related_to: "legată de" },
    linksIn: { derived_from: "stă la baza", replaces: "înlocuită de", resolves: "rezolvată de", related_to: "legată de" },
    aiSource: "propusă de AI ({src}), confirmată de utilizator",
    task: "Sarcina pentru această sesiune",
    noTask: "Utilizatorul îți va spune în conversație ce are de făcut.",
    history: "Răspunsuri salvate din sesiuni anterioare",
    historyNote: "Doar pentru context: memoria oficială de mai sus are prioritate dacă ceva diferă. Unele idei din aceste răspunsuri au fost respinse de utilizator.",
    blockRemoved: "[blocul de propuneri a fost scos: deciziile utilizatorului asupra lui sunt în memoria oficială de mai sus]",
    reply: "Răspuns de la {ai}, {date}",
    note: "Notă a utilizatorului, {date}",
    empty: "Memoria oficială a proiectului e încă goală.",
    omitted: "{n} informații au fost lăsate deoparte din motive de spațiu.",
  },
  en: {
    title: "Continuity package",
    made: "Prepared by AI Workspace on {date} for {ai}.",
    forAi: "For the AI assistant",
    rules: [
      "This is the project's official context, confirmed by the user. You do not have access to their earlier conversations with other assistants: continue the work from here.",
      "Treat the information below as valid for the project. If something looks wrong, outdated or contradictory, say so explicitly instead of assuming.",
      "Every item has a short reference (for example D2). Use it when you refer to the item.",
      "Some items may be left out for space; if you need something that is not here, ask.",
      "At the end, if you propose changes to the project memory (a new decision, a step, a problem, a fact), add ONE block like the one below. The user checks every proposal; nothing enters the memory automatically.",
    ],
    typesLine: "Types: {types}. Optional fields: \"text\", \"important\": true, \"replaces\": \"D1\" with \"reason\" (decisions only), \"resolves\": \"P1\".",
    example: [
      '{"type": "decision", "title": "…", "text": "…", "replaces": "D1", "reason": "…"}',
      '{"type": "step", "title": "…"}',
      '{"type": "fact", "title": "…", "resolves": "P1"}',
    ],
    project: "The project",
    sections: { goal: "Goals", instruction: "Instructions and rules", decision: "Confirmed decisions", fact: "Important facts", context: "Context / current state", issue: "Open problems", step: "Next steps" } as Record<Category, string>,
    important: "important",
    closed: { replaced: "replaced", resolved: "resolved", done: "done" },
    links: { derived_from: "derived from", replaces: "replaces", resolves: "resolves", related_to: "related to" },
    linksIn: { derived_from: "basis of", replaces: "replaced by", resolves: "resolved by", related_to: "related to" },
    aiSource: "proposed by AI ({src}), confirmed by the user",
    task: "Task for this session",
    noTask: "The user will tell you in the conversation what to do.",
    history: "Saved replies from earlier sessions",
    historyNote: "For context only: the official memory above takes priority if anything differs. Some ideas in these replies were rejected by the user.",
    blockRemoved: "[the proposals block was removed: the user's decisions on it are in the official memory above]",
    reply: "Reply from {ai}, {date}",
    note: "User's note, {date}",
    empty: "The project's official memory is still empty.",
    omitted: "{n} items were left out for space.",
  },
};

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

export interface PackOptions {
  lang: PackLang;
  /** Assistant name, as shown to the AI ("Claude", "ChatGPT", or the user's own name for "other"). */
  assistant: string;
  task: string;
  /** Saved replies / notes to include (most recent first, already chosen by the user). */
  history: { exchange: Exchange; assistant: string }[];
  /** Limit of the whole package, in characters. */
  maxChars: number;
  includeClosed?: boolean;
  /** Date shown in the package (formatted by the caller). */
  date: string;
  formatDate: (iso: string) => string;
}

export interface Pack {
  text: string;
  /** Short reference → entry id, for reading the AI's proposals back. */
  refs: Record<string, string>;
  /** What was left out and why (memory items, saved replies), for the user only. */
  omitted: Omission[];
  historyIncluded: number;
  historyOmitted: number;
  stats: { chars: number; maxChars: number; included: number };
}

export const PACK_LIMITS = [8000, 24000, 48000, 96000] as const;
export const DEFAULT_PACK_LIMIT = 24000;

/** A line that starts a code fence (``` or ~~~, even indented) could pass for the proposals block: it is escaped. */
export function escapeFences(text: string): string {
  return text.replace(/^([ \t]*)(```|~~~)/gm, "$1\\$2");
}

/** A saved reply without its proposals block (the decisions on them are in the official memory, not here). */
export function withoutProposals(text: string, lang: PackLang): string {
  const tags = [BLOCK_TAG.ro, BLOCK_TAG.en].join("|");
  return text.replace(new RegExp("^[ \\t]*(```|~~~)[ \\t]*(" + tags + ")[ \\t]*\\n[\\s\\S]*?(^[ \\t]*\\1[ \\t]*$|(?![\\s\\S]))", "gim"), T[lang].blockRemoved);
}

function cap(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + "…";
}

function quote(text: string): string {
  // indent a body under its bullet
  return escapeFences(text).split("\n").map((l) => "  " + l).join("\n");
}

function render(project: Project, payload: ContextPayload, refs: Record<string, string>, idToRef: Map<string, string>, o: PackOptions, history: PackOptions["history"], extraOmitted: number): string {
  const t = T[o.lang];
  const lines: string[] = [];
  lines.push(`# ${t.title}: ${project.name}`, "", fill(t.made, { date: o.date, ai: o.assistant }), "");
  lines.push(`## ${t.forAi}`, ...t.rules.map((r) => `- ${r}`), "");
  lines.push("```" + BLOCK_TAG[o.lang], "[", ...t.example.map((e, i) => "  " + e + (i < t.example.length - 1 ? "," : "")), "]", "```");
  lines.push(fill(t.typesLine, { types: CATEGORIES.map((c) => PROPOSAL_TYPES[o.lang][c]).join(", ") }), "");
  if (project.description) lines.push(`## ${t.project}`, escapeFences(cap(project.description, Math.floor(o.maxChars / 4))), "");
  if (payload.sections.length === 0) lines.push(t.empty, "");
  for (const s of payload.sections) {
    lines.push(`## ${t.sections[s.category]}`);
    for (const it of s.items) {
      const ref = idToRef.get(it.id)!;
      const tags: string[] = [];
      if (it.important) tags.push(t.important);
      if (it.status === "replaced") tags.push(t.closed.replaced);
      if (it.status === "resolved") tags.push(s.category === "step" ? t.closed.done : t.closed.resolved);
      if (it.author === "ai") tags.push(fill(t.aiSource, { src: it.source ?? "AI" }));
      lines.push(`- [${ref}] ${it.important ? "★ " : ""}${it.title}${tags.length ? ` (${tags.join("; ")})` : ""}`);
      if (it.body) lines.push(quote(it.body));
      for (const l of it.links) {
        const other = idToRef.get(l.id);
        if (other) lines.push(`  → ${(l.direction === "out" ? t.links : t.linksIn)[l.type]} ${other}`);
      }
    }
    lines.push("");
  }
  if (extraOmitted > 0) lines.push(`_${fill(t.omitted, { n: String(extraOmitted) })}_`, "");
  lines.push(`## ${t.task}`, o.task ? escapeFences(cap(o.task, Math.floor(o.maxChars / 4))) : t.noTask, "");
  if (history.length) {
    lines.push(`## ${t.history}`, `_${t.historyNote}_`, "");
    for (const h of history) {
      const head = h.exchange.kind === "note" ? fill(t.note, { date: o.formatDate(h.exchange.createdAt) }) : fill(t.reply, { ai: h.assistant, date: o.formatDate(h.exchange.createdAt) });
      lines.push(`### ${head}`, escapeFences(withoutProposals(h.exchange.text, o.lang)), "");
    }
  }
  void refs;
  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Builds the package. Size rule: saved replies are dropped first (oldest first), then memory items,
 * least important first (the same order as the context preview), until the whole text fits the limit.
 */
export function buildPack(project: Project, entries: MemoryEntry[], links: MemoryLink[], o: PackOptions): Pack {
  let history = [...o.history];
  let budget = o.maxChars;
  for (let guard = 0; guard < 200; guard++) {
    const ctx = buildContext(project, entries, links, { maxChars: Math.max(0, budget), includeClosed: o.includeClosed });
    const idToRef = new Map<string, string>();
    const refs: Record<string, string> = {};
    for (const s of ctx.payload.sections) {
      s.items.forEach((it, i) => {
        const ref = `${REF_PREFIX[s.category]}${i + 1}`;
        idToRef.set(it.id, ref);
        refs[ref] = it.id;
      });
    }
    const sizeOmitted = ctx.omitted.filter((x) => x.reason === "sizeLimit").length;
    const text = render(project, ctx.payload, refs, idToRef, o, history, sizeOmitted);
    // task and description are capped at a quarter of the limit each, so an empty memory always fits
    if (text.length <= o.maxChars || (budget <= 0 && history.length === 0)) {
      return {
        text, refs, omitted: ctx.omitted,
        historyIncluded: history.length, historyOmitted: o.history.length - history.length,
        stats: { chars: text.length, maxChars: o.maxChars, included: ctx.stats.included },
      };
    }
    if (history.length) history = history.slice(0, -1); // the oldest saved reply goes first
    else budget = Math.floor(budget * 0.85) - 200;
  }
  throw new Error("pack: size loop");
}
