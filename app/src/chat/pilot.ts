// AIW-08: the automatic pilot ("Auto" in the model list). The free model (GPT-OSS 20B, no account) does
// part of the user's work, so the paid model is used only where it is worth it:
//  1. dispatcher — clear cases are decided here, on the device (pictures, files, code, long questions);
//     a short plain question goes first to the free model, which either answers it or hands it on
//     with a tag ([[MEDIU]] / [[GREU]] / [[COD]]) to the right Puter model — one call, not two;
//  2. summary — when a chat outgrows the history window, the free model keeps a short summary of the
//     older part, sent instead of nothing (so the paid model knows the story for a few dozen tokens);
//  3. document reader — a long attached document is read by the free model, and only what matters for
//     the question goes to the paid one.
// The anonymous free service allows about one request every few seconds: the helpers (2, 3) run only
// when a request slot is free, and every helper that fails or is late is simply skipped — the chat
// then works exactly as without the pilot. Pure: no network here (the calls are made by the screen).
import type { PackLang } from "../continuity";
import type { ChatMessage, Economy } from "./economy";

/** The "model" of a pilot chat (a session keeps one model name). */
export const AUTO = "auto";

export type Level = "simple" | "medium" | "hard" | "code";
/** The levels that go on to a Puter model ("simple" is answered by the free model itself). */
export type PaidLevel = Exclude<Level, "simple">;

/** Which Puter model answers each level. The pilot never picks the most expensive ($$$) models by itself. */
export const ROUTE: Record<PaidLevel, string> = {
  medium: "gemini-2.5-flash-lite",
  hard: "gemini-3.5-flash",
  code: "gemini-3.5-flash",
};

/** Room left for the answer: code needs long answers (a "no limit" choice stays no limit). */
export function pilotEconomy(level: Level, eco: Economy): Economy {
  return level === "code" ? { ...eco, maxOutput: eco.maxOutput === 0 ? 0 : Math.max(eco.maxOutput, 2500), answer: "normal" } : eco;
}

const CODE = /(```|<\/?[a-z]+[ >]|\b(cod(ul)?|code|html|css|javascript|typescript|python|sql|script|funcți[ae]|function|bug|compil|regex|api|json|aplicați[ae]|app|program(ul)?|algoritm)\b|⌘)/i;
const FILES = /\n\n(Fișier atașat|Attached file|\[poză atașată|\[attached photo|\[Fișier atașat|\[Attached file)/;

export interface Decision {
  /** the level, when the device can tell; null = ask the free model (it answers or hands on) */
  level: PaidLevel | null;
  why: "pictures" | "files" | "code" | "long" | "ask";
}

/** What the device can decide on its own, instantly, without sending anything anywhere. */
export function decideLocally(question: string, pictures: number): Decision {
  const typed = question.split(FILES)[0];
  if (pictures > 0) return { level: typed.length > 400 ? "hard" : "medium", why: "pictures" };
  if (FILES.test(question)) return { level: typed.length > 400 ? "hard" : "medium", why: "files" };
  if (CODE.test(typed)) return { level: "code", why: "code" };
  if (typed.length > 600) return { level: "hard", why: "long" };
  return { level: null, why: "ask" };
}

const TAG = /\[\[\s*(MEDIU|MEDIUM|GREU|HARD|COD|CODE)\s*\]\]/i;
const levelOf = (w: string): PaidLevel => (/^(GREU|HARD)$/i.test(w) ? "hard" : /^(COD|CODE)$/i.test(w) ? "code" : "medium");
/**
 * While the free model writes: did it hand the question on (to which level)? "pending" = too early to tell.
 * Markdown around the tag (**, `, >) is ignored.
 */
export function readTag(soFar: string): PaidLevel | null | "pending" {
  const s = soFar.replace(/^[\s*_`>~]+/, "");
  if (!s) return "pending";
  if (!s.startsWith("[")) return soFar.trim().length < 12 ? "pending" : null; // "OK. [[MEDIU]]" is caught at the end
  const m = new RegExp("^" + TAG.source, "i").exec(s);
  if (m) return levelOf(m[1]);
  return s.length < 14 ? "pending" : null; // a "[" that is not a tag: an ordinary answer
}

/** When the free model has finished: a short text holding a tag anywhere is a hand-on, not an answer. */
export function finalTag(text: string): PaidLevel | null {
  const m = TAG.exec(text);
  return m && text.replace(TAG, "").replace(/[\s*_`>~.:!,-]/g, "").length < 30 ? levelOf(m[1]) : null;
}

const T = {
  ro: {
    dispatch:
      "\nREGULĂ DE PILOT: răspunzi DOAR dacă cererea e simplă: salut, mulțumire, o reformulare, o traducere scurtă, o întrebare scurtă de cultură generală. " +
      "Pentru orice altceva — decizii sau date ale proiectului, calcule, analize, sfaturi importante, planuri, texte lungi, cod — scrie DOAR eticheta, fără alt text: " +
      "[[MEDIU]] (o întrebare obișnuită), [[GREU]] (analiză, raționament, plan, ceva important) sau [[COD]] (cod, aplicații, programare). Dacă nu ești sigur, scrie [[MEDIU]].\n",
    summarize:
      "Rezumă discuția de mai jos pentru un alt asistent care o continuă. Maximum 120 de cuvinte, în română. Păstrează exact cifrele, numele, datele, deciziile și ce a rămas deschis. Fără introducere.",
    previous: "Rezumatul de până acum",
    newer: "Mesajele care urmează",
    user: "Utilizator",
    ai: "Asistent",
    summaryLabel: "Rezumatul discuției mai vechi (făcut automat)",
    extract:
      "Din documentele de mai jos, copiază doar pasajele de care e nevoie pentru întrebare, cuvânt cu cuvânt (cifre, nume, date, clauze exact cum sunt). " +
      "Fără comentarii și fără răspuns la întrebare. Dacă totul e important, scrie TOT. Întrebarea:",
    extracted: "Fragmente alese automat din fișierele atașate (pentru întrebarea de mai sus)",
  },
  en: {
    dispatch:
      "\nPILOT RULE: answer ONLY if the request is simple: a greeting, a thank-you, a rewording, a short translation, a short general-knowledge question. " +
      "For anything else — the project's decisions or data, calculations, analyses, important advice, plans, long texts, code — write ONLY the tag, nothing else: " +
      "[[MEDIUM]] (an ordinary question), [[HARD]] (analysis, reasoning, a plan, something important) or [[CODE]] (code, apps, programming). If unsure, write [[MEDIUM]].\n",
    summarize:
      "Summarize the conversation below for another assistant who continues it. At most 120 words, in English. Keep numbers, names, dates, decisions and open points exactly. No introduction.",
    previous: "Summary so far",
    newer: "The messages that follow",
    user: "User",
    ai: "Assistant",
    summaryLabel: "Summary of the earlier conversation (made automatically)",
    extract:
      "From the documents below, copy only the passages needed for the question, word for word (numbers, names, dates, clauses exactly as written). " +
      "No comments and no answer to the question. If everything matters, write ALL. The question:",
    extracted: "Passages picked automatically from the attached files (for the question above)",
  },
};

/** The free model's first try: the usual messages, with the dispatch rule added to the system message. */
export function dispatchMessages(messages: ChatMessage[], lang: PackLang): ChatMessage[] {
  return messages.map((m, i) => (i === 0 && m.role === "system" ? { ...m, content: m.content + T[lang].dispatch } : m));
}

// ---------- summary of the older part of a chat ----------

type Turn = { kind: string; text: string };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** The questions and answers that do not travel any more (before the history window). */
export function olderTurns(earlier: Turn[], history: number): Turn[] {
  const talk = earlier.filter((x) => x.kind === "ask" || x.kind === "reply");
  if (history <= 0) return [];
  let start = Math.max(0, talk.length - history);
  while (start < talk.length && talk[start].kind === "reply") start++; // the same rule as buildMessages
  return talk.slice(0, start);
}

export interface Summary {
  /** how many of the older turns it covers */
  n: number;
  text: string;
}

/** A new summary is worth asking for when at least this many older turns are not covered yet. */
export const SUMMARY_STEP = 4;
export const needsSummary = (older: number, s: Summary | null): boolean => older - (s?.n ?? 0) >= (s ? SUMMARY_STEP : 2);

export function summaryMessages(older: Turn[], previous: Summary | null, lang: PackLang): ChatMessage[] {
  const t = T[lang];
  const fresh = older.slice(previous?.n ?? 0);
  let body = fresh.map((x) => `${x.kind === "ask" ? t.user : t.ai}: ${clip(x.text.replace(/```[\s\S]*?```/g, "[…]").trim(), 1500)}`).join("\n\n");
  body = clip(body, 12000);
  const content = previous ? `${t.previous}:\n${previous.text}\n\n${t.newer}:\n${body}` : body;
  return [{ role: "system", content: t.summarize }, { role: "user", content }];
}

/** The summary rides in the system message, after the memory (the window itself is unchanged). */
export function withSummary(system: string, s: Summary | null, lang: PackLang): string {
  return s && s.text.trim() ? `${system}\n\n## ${T[lang].summaryLabel}\n${clip(s.text.trim(), 1500)}\n` : system;
}

// ---------- the document reader ----------

/** Documents shorter than this go as they are (reading them would not save much). */
export const READ_FROM = 6000;
const BLOCK = /\n\n(?:Fișier atașat|Attached file): [^\n]+\n```\n([\s\S]*?)\n```(?=\n\n|$)/g;

/** The files' text inside a saved question; worth reading when it is long. */
export function documentsOf(question: string): { typed: string; docs: string; chars: number } {
  const blocks = [...question.matchAll(BLOCK)];
  const chars = blocks.reduce((n, m) => n + m[1].length, 0);
  const first = blocks.length ? question.indexOf(blocks[0][0]) : -1;
  return { typed: first >= 0 ? question.slice(0, first) : question, docs: blocks.map((m) => m[0].trim()).join("\n\n"), chars };
}

export function extractMessages(question: string, lang: PackLang): ChatMessage[] | null {
  const d = documentsOf(question);
  if (d.chars < READ_FROM) return null;
  return [{ role: "system", content: `${T[lang].extract} ${clip(d.typed.trim() || "—", 2000)}` }, { role: "user", content: clip(d.docs, 60000) }];
}

/**
 * The question as the paid model gets it: the read files replaced by the passages the free model picked.
 * Everything else (photo notes, a file that was cut and has no closing fence) stays as it was.
 */
export function withExtract(question: string, extract: string, lang: PackLang): string {
  const d = documentsOf(question);
  const all = /^\s*(TOT|ALL)\s*$/i.test(extract);
  if (all || extract.trim().length < 40 || extract.length >= d.chars) return question; // nothing saved: send the files as they are
  const names = [...question.matchAll(/\n\n(?:Fișier atașat|Attached file): ([^\n]+)\n```/g)].map((m) => m[1]).join(", ");
  const rest = question.replace(BLOCK, "").trimEnd();
  return `${rest}\n\n${T[lang].extracted} — ${names}:\n\`\`\`\n${extract.replace(/```/g, "ʼʼʼ").trim()}\n\`\`\``;
}

/** Turns of the anonymous service: helpers wait this long after the last free request (any free request). */
export const FREE_GAP_MS = 15000;
