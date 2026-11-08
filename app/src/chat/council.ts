// AIW-07: the council of models — the same question to 2–3 models at once; a judge model then compares
// their answers (agreement, differences, conclusion). Pure: the calls themselves are made by the chat screen.
import type { PackLang } from "../continuity";
import { findModel, isModelId } from "./models";
import type { ChatMessage } from "./economy";

/** The "model" name of a council chat (sessions keep one model name each). */
export const COUNCIL = "council";
export const COUNCIL_MIN = 2;
export const COUNCIL_MAX = 3;

export interface Council {
  members: string[];
  judge: string;
}
export const DEFAULT_COUNCIL: Council = { members: ["gemini-2.5-flash-lite", "gpt-5-nano", "claude-haiku-5-5"], judge: "gemini-2.5-flash-lite" };

export function cleanCouncil(raw: unknown): Council {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const members = Array.isArray(r.members) ? [...new Set(r.members.filter(isModelId))].slice(0, COUNCIL_MAX) : [];
  const judge = isModelId(r.judge) ? r.judge : members[0];
  return members.length >= COUNCIL_MIN && judge ? { members, judge } : DEFAULT_COUNCIL;
}

const T = {
  ro: {
    member: "Ești unul dintre mai multe modele care răspund la aceeași întrebare. Răspunde direct, cu ce știi sigur; spune clar unde nu ești sigur. Nu adăuga bloc de propuneri.",
    judge: "Mai jos sunt răspunsurile a {n} modele la aceeași întrebare. Compară-le: în ce sunt de acord, unde diferă și, dacă se poate spune, care are dreptate și de ce. Apoi dă concluzia ta, scurt. Nu repeta răspunsurile.",
    question: "Întrebarea",
    answers: "Răspunsurile",
    conclusion: "Concluzia",
    failed: "nu a răspuns",
  },
  en: {
    member: "You are one of several models answering the same question. Answer directly with what you know for sure; say clearly where you are not sure. Do not add a proposals block.",
    judge: "Below are the answers of {n} models to the same question. Compare them: where they agree, where they differ and, if it can be told, which is right and why. Then give your conclusion, briefly. Do not repeat the answers.",
    question: "The question",
    answers: "The answers",
    conclusion: "Conclusion",
    failed: "did not answer",
  },
};

export const nameOf = (id: string): string => findModel(id)?.name ?? id;

/** Members get the same messages, with one line added to the system message. */
export function memberMessages(messages: ChatMessage[], lang: PackLang): ChatMessage[] {
  return messages.map((m, i) => (i === 0 && m.role === "system" ? { ...m, content: m.content + "\n" + T[lang].member + "\n" } : m));
}

export interface MemberAnswer {
  model: string;
  text: string | null;
}

/** The judge sees the system message (memory, proposals instructions) and one user message with everything. */
export function judgeMessages(system: string, question: string, answers: MemberAnswer[], lang: PackLang): ChatMessage[] {
  const t = T[lang];
  const ok = answers.filter((a) => a.text);
  const body = ok.map((a) => `### ${nameOf(a.model)}\n${a.text!.trim()}`).join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `${t.judge.replace("{n}", String(ok.length))}\n\n## ${t.question}\n${question}\n\n## ${t.answers}\n${body}` },
  ];
}

/** The saved answer: each member's answer, then the judge's conclusion (which may carry the proposals block). */
export function councilText(answers: MemberAnswer[], judge: { model: string; text: string } | null, lang: PackLang): string {
  const t = T[lang];
  const parts = answers.map((a) => `### ${nameOf(a.model)}\n${a.text ? a.text.trim() : `_(${t.failed})_`}`);
  if (judge) parts.push(`### ${t.conclusion} · ${nameOf(judge.model)}\n${judge.text.trim()}`);
  return parts.join("\n\n");
}
