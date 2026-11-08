// AIW-06: what the in-app chat sends to the model, and the settings that make it cheaper.
// Pure and deterministic (no network, no storage). Written from scratch for this app; the ideas are public:
//  - compact context: the memory as one table with a header naming the fields once, instead of
//    Markdown with repeated labels (the idea of the TOON format, implemented here independently);
//  - answer style: asking for short or telegraphic answers (the idea behind "caveman"-style prompts);
//  - history window: only the last few messages travel with each question;
//  - only important memory, a cap on the answer length, low reasoning effort on reasoning models.
// Every call to the model is stateless: what is in the messages below is everything the model sees.
import { CATEGORIES, type Category, type Exchange, type MemoryEntry, type MemoryLink, type Project } from "../core";
import { buildContext } from "../memory";
import { BLOCK_TAG, buildPack, escapeFences, PROPOSAL_TYPES, REF_PREFIX, withoutProposals, type PackLang } from "../continuity";

export type ContextMode = "full" | "compact" | "important" | "none";
export type AnswerStyle = "normal" | "short" | "telegraphic";

export interface Economy {
  context: ContextMode;
  answer: AnswerStyle;
  /** how many earlier messages (questions and answers) travel with a new question */
  history: number;
  /** cap on the answer length, in tokens; 0 = the model's own limit */
  maxOutput: number;
  /** ask the model for memory proposals (the instructions cost a few hundred tokens per call).
   *  The full package always carries them: with context "full" this is effectively on. */
  proposals: boolean;
}

export const HISTORY_CHOICES = [0, 2, 4, 8, 16] as const;
export const OUTPUT_CHOICES = [0, 600, 1200, 2500] as const;

export type PresetId = "max" | "balanced" | "quality";
export const PRESETS: Record<PresetId, Economy> = {
  max: { context: "important", answer: "telegraphic", history: 2, maxOutput: 600, proposals: true },
  balanced: { context: "compact", answer: "short", history: 4, maxOutput: 1200, proposals: true },
  quality: { context: "full", answer: "normal", history: 8, maxOutput: 0, proposals: true },
};
export const DEFAULT_ECONOMY: Economy = PRESETS.balanced;

export function presetOf(e: Economy): PresetId | null {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const p = PRESETS[id];
    if (p.context === e.context && p.answer === e.answer && p.history === e.history && p.maxOutput === e.maxOutput && p.proposals === e.proposals) return id;
  }
  return null;
}

/** Settings read back from storage: anything unknown falls back to the default, field by field. */
export function cleanEconomy(raw: unknown): Economy {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_ECONOMY;
  return {
    context: (["full", "compact", "important", "none"] as const).includes(r.context as ContextMode) ? (r.context as ContextMode) : d.context,
    answer: (["normal", "short", "telegraphic"] as const).includes(r.answer as AnswerStyle) ? (r.answer as AnswerStyle) : d.answer,
    history: (HISTORY_CHOICES as readonly number[]).includes(r.history as number) ? (r.history as number) : d.history,
    maxOutput: (OUTPUT_CHOICES as readonly number[]).includes(r.maxOutput as number) ? (r.maxOutput as number) : d.maxOutput,
    proposals: typeof r.proposals === "boolean" ? r.proposals : d.proposals,
  };
}

/**
 * Rough token count. Models count differently; for European languages ~3.5–4 characters per token is
 * a fair middle. Shown to the user only as "≈", never used to bill anything.
 */
export function estimateTokens(text: string): number {
  return tokensForChars(text.length);
}
export const tokensForChars = (chars: number): number => (chars > 0 ? Math.ceil(chars / 3.7) : 0);

// ---------- the compact table ----------

/** One value of the table: bare when safe, otherwise in double quotes with \" \\ \n escaped. */
export function cell(value: string): string {
  if (value === "") return "";
  if (/^[^,"\\\n\r\t]+$/.test(value) && value.trim() === value && !/^[-\d.]+$/.test(value)) return value;
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n").replace(/\t/g, " ") + '"';
}

const cut = (s: string, max: number) => (s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…");

const T = {
  ro: {
    role: "Ești asistentul pentru proiectul „{name}”.",
    lang: "Răspunde în limba în care ți se scrie.",
    memory: "Memoria oficială a proiectului (confirmată de utilizator) e tabelul de mai jos: un rând = o informație; ref = referința ei scurtă; imp = 1 pentru important. Dacă ceva pare greșit sau învechit, spune-o.",
    noMemory: "Memoria oficială a proiectului e încă goală.",
    importantOnly: "Sunt incluse doar informațiile marcate importante; dacă îți trebuie altceva, întreabă.",
    omitted: "{n} informații au fost lăsate deoparte din motive de spațiu.",
    noContext: "Utilizatorul nu a trimis memoria proiectului cu această întrebare.",
    proposals: "Dacă propui schimbări în memorie (decizie, pas, problemă, informație…), adaugă la final UN singur bloc ```{tag} cu o listă JSON de obiecte {\"tip\",\"titlu\"} și opțional \"text\", \"important\": true, \"inlocuieste\": \"D1\" + \"motiv\" (doar decizii), \"rezolva\": \"P1\". Tipuri: {types}. Utilizatorul confirmă fiecare propunere; fără blocul acesta nu se schimbă nimic.",
    styles: {
      normal: "",
      short: "Răspunde concis: fără introducere, fără repetarea întrebării, fără încheieri de politețe. Liste scurte doar când ajută.",
      telegraphic: "Mod ultra-scurt: propoziții telegrafice, fără cuvinte de umplutură sau formule de politețe, doar esențialul. Păstrează exact numele, cifrele, termenii tehnici și codul.",
    } as Record<AnswerStyle, string>,
    fields: { ref: "ref", type: "tip", title: "titlu", text: "text", imp: "imp" },
    project: "proiect", description: "descriere", table: "memorie",
  },
  en: {
    role: "You are the assistant for the project \"{name}\".",
    lang: "Reply in the language the user writes in.",
    memory: "The project's official memory (confirmed by the user) is the table below: one row = one item; ref = its short reference; imp = 1 for important. If something looks wrong or outdated, say so.",
    noMemory: "The project's official memory is still empty.",
    importantOnly: "Only the items marked important are included; ask if you need anything else.",
    omitted: "{n} items were left out for space.",
    noContext: "The user did not send the project memory with this question.",
    proposals: "If you propose changes to the memory (decision, step, problem, fact…), add at the end ONE ```{tag} block with a JSON list of objects {\"type\",\"title\"} and optionally \"text\", \"important\": true, \"replaces\": \"D1\" + \"reason\" (decisions only), \"resolves\": \"P1\". Types: {types}. The user confirms every proposal; without this block nothing changes.",
    styles: {
      normal: "",
      short: "Be concise: no introduction, do not restate the question, no closing pleasantries. Short lists only when they help.",
      telegraphic: "Ultra-short mode: telegraphic sentences, no filler words or pleasantries, essentials only. Keep names, numbers, technical terms and code exactly.",
    } as Record<AnswerStyle, string>,
    fields: { ref: "ref", type: "type", title: "title", text: "text", imp: "imp" },
    project: "project", description: "description", table: "memory",
  },
};
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

export interface SystemPrompt {
  text: string;
  /** short reference → memory entry id (to read the model's proposals back) */
  refs: Record<string, string>;
  /** memory items included */
  included: number;
}

export interface SystemOptions {
  lang: PackLang;
  economy: Economy;
  /** the model's display name (the "full" context names the assistant) */
  assistant: string;
  /** limit for the full / compact context, in characters */
  maxChars: number;
  date: string;
  formatDate: (iso: string) => string;
}

/**
 * The system message: who the model is, the project memory in the chosen form, the answer style and,
 * if wanted, how to write memory proposals. Only OFFICIAL memory is ever included (buildContext rules).
 */
export function systemPrompt(project: Project, entries: MemoryEntry[], links: MemoryLink[], o: SystemOptions): SystemPrompt {
  const t = T[o.lang];
  const e = o.economy;
  const parts: string[] = [];
  let refs: Record<string, string> = {};
  let included = 0;

  if (e.context === "full") {
    // the same package as for an outside assistant (it carries its own proposal instructions)
    const pack = buildPack(project, entries, links, { lang: o.lang, assistant: o.assistant, task: "", history: [], maxChars: o.maxChars, date: o.date, formatDate: o.formatDate });
    refs = pack.refs;
    included = pack.stats.included;
    parts.push(t.lang, pack.text.trim());
  } else {
    parts.push(fill(t.role, { name: project.name }), t.lang);
    if (e.context === "none") parts.push(t.noContext);
    else {
      const source = e.context === "important" ? entries.filter((x) => x.important) : entries;
      const ctx = buildContext(project, source, links, { maxChars: o.maxChars });
      const rows: string[] = [];
      for (const s of ctx.payload.sections) {
        s.items.forEach((it, i) => {
          const ref = `${REF_PREFIX[s.category]}${i + 1}`;
          refs[ref] = it.id;
          rows.push("  " + [ref, PROPOSAL_TYPES[o.lang][s.category], cell(escapeFences(it.title)), cell(escapeFences(cut(it.body, 400))), it.important ? "1" : ""].join(","));
        });
      }
      included = rows.length;
      if (project.description) parts.push(`${t.project}: ${cell(project.name)}\n${t.description}: ${cell(escapeFences(cut(project.description, 600)))}`);
      if (rows.length === 0) parts.push(t.noMemory);
      else {
        const f = t.fields;
        parts.push(t.memory, `${t.table}[${rows.length}]{${[f.ref, f.type, f.title, f.text, f.imp].join(",")}}:\n${rows.join("\n")}`);
      }
      if (e.context === "important") parts.push(t.importantOnly);
      const dropped = ctx.omitted.filter((x) => x.reason === "sizeLimit").length;
      if (dropped) parts.push(fill(t.omitted, { n: String(dropped) }));
    }
    if (e.proposals) parts.push(fill(t.proposals, { tag: BLOCK_TAG[o.lang], types: CATEGORIES.map((c: Category) => PROPOSAL_TYPES[o.lang][c]).join(", ") }));
  }
  if (t.styles[e.answer]) parts.push(t.styles[e.answer]);
  return { text: parts.join("\n\n") + "\n", refs, included };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * The messages of one call: the system prompt, the last `economy.history` messages of the conversation
 * (answers without their proposals block: the user's decisions on them are in the memory), the question.
 */
export function buildMessages(system: string, earlier: Pick<Exchange, "kind" | "text">[], question: string, economy: Economy, lang: PackLang): ChatMessage[] {
  const talk = earlier.filter((x) => x.kind === "ask" || x.kind === "reply");
  const window = economy.history > 0 ? talk.slice(-economy.history) : [];
  // the window never starts with an answer whose question was left out
  while (window.length && window[0].kind === "reply") window.shift();
  const out: ChatMessage[] = [{ role: "system", content: system }];
  const push = (m: ChatMessage) => {
    // two messages of the same side in a row (a question whose answer failed) are joined: some models
    // accept only alternating turns
    const last = out[out.length - 1];
    if (last.role === m.role && m.role !== "system") {
      // the same question asked again (after a failure, or on another model) is sent once
      if (last.content !== m.content && !last.content.endsWith("\n\n" + m.content)) last.content += "\n\n" + m.content;
    }
    else out.push(m);
  };
  for (const x of window) push(x.kind === "ask" ? { role: "user", content: x.text } : { role: "assistant", content: withoutProposals(x.text, lang) });
  push({ role: "user", content: question });
  return out;
}

/** Characters of a list of messages (for the estimate shown before sending). */
export const messagesChars = (m: ChatMessage[]): number => m.reduce((n, x) => n + x.content.length, 0);

/** Options passed to the model for these settings. Reasoning models think less when economy matters. */
export function callOptions(model: string, economy: Economy, reasoning: boolean): Record<string, unknown> {
  const o: Record<string, unknown> = { model };
  if (economy.maxOutput > 0) o.max_tokens = reasoning ? economy.maxOutput * 2 : economy.maxOutput; // thinking counts as output
  if (reasoning) {
    o.reasoning_effort = "low"; // "minimal" is refused by some newer models
    if (economy.answer !== "normal") o.verbosity = "low";
  }
  return o;
}
