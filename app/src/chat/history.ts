// AIW-09: the conversation list as people expect it — a title from the first question, search, and an
// export of a conversation as text (markdown) to keep or share. Pure; the data model is unchanged.
import type { Exchange, Session } from "../core";
import type { PackLang } from "../continuity";
import { describeImage } from "./images";

export const TITLE_MAX = 60;

/** The first line of a question, without the attached files' part, cut to a title's length. */
export function titleFrom(question: string): string {
  const typed = question.split(/\n\n(?=Fișier atașat: |Attached file: |\[poză atașată: |\[attached photo: |\[Fișier atașat: |\[Attached file: )/)[0];
  const line = typed.replace(/^\/(imagine|img|image|poză|poza|desen)(?=[:\s]|$)[:\s]*/i, "").split("\n").find((l) => l.trim()) ?? "";
  const clean = line.replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

/** A chat's title: what the user named it (imports), else its first question, else nothing. */
export function chatTitle(s: Pick<Session, "task">, firstQuestion: string | undefined): string {
  return s.task.trim() ? titleFrom(s.task) : firstQuestion ? titleFrom(firstQuestion) : "";
}

/** The chats whose title or questions contain every word typed (letters compared without diacritics). */
export function searchChats<T extends { id: string }>(chats: T[], query: string, textOf: (c: T) => string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return chats;
  return chats.filter((c) => {
    const hay = fold(textOf(c));
    return words.every((w) => hay.includes(w));
  });
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The proposals block is not part of the text people read. */
const stripBlock = (text: string) => text.replace(/^[ \t]*(```|~~~)[ \t]*(aiw-propuneri|aiw-proposals)[ \t]*\n[\s\S]*?(^[ \t]*\1[ \t]*$|(?![\s\S]))/gim, "").trim();

/**
 * A conversation as markdown: a heading, then each question and answer with who said it. Pictures are
 * written as their description and address. Used for the export file and for sharing.
 */
export function conversationMarkdown(input: { title: string; project: string; assistant: string; steps: Exchange[]; lang: PackLang; date: (iso: string) => string }): string {
  const t = input.lang === "ro" ? { you: "Tu", ai: input.assistant || "AI", project: "Proiect", exported: "Exportat din AI Workspace" } : { you: "You", ai: input.assistant || "AI", project: "Project", exported: "Exported from AI Workspace" };
  const lines: string[] = [`# ${input.title || (input.lang === "ro" ? "Conversație" : "Conversation")}`, "", `${t.project}: ${input.project}`, ""];
  for (const x of input.steps) {
    if (x.kind !== "ask" && x.kind !== "reply" && x.kind !== "note") continue;
    const who = x.kind === "ask" ? t.you : x.kind === "reply" ? t.ai : "✎";
    const body = x.kind === "reply" ? describeImage(x.text, input.lang) ?? stripBlock(x.text) : x.text;
    lines.push(`**${who}** · ${input.date(x.createdAt)}`, "", body.trim(), "");
  }
  lines.push("---", `${t.exported} · ${new Date().toISOString().slice(0, 10)}`);
  return lines.join("\n") + "\n";
}

/** A safe file name for the export, from the title. */
export function exportFileName(title: string): string {
  const base = title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40).replace(/-+$/, "");
  return (base || "conversatie") + ".md";
}
