// AIW-07: files attached to a chat message (photos, PDF, text, .docx). Pure: the reading itself (canvas,
// pdf.js) happens in ui/files.ts; here are the limits, what is written into the message, and the images part.
import { cleanText, EXCHANGE_MAX } from "../core";
import { escapeFences, type PackLang } from "../continuity";
import type { ChatMessage } from "./economy";

export type AttachmentKind = "image" | "pdf" | "text" | "docx";

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  /** text read from the file (PDF, text, .docx), already cleaned and capped */
  text: string;
  /** images to show the model (a photo, or the pages of a scanned PDF), as JPEG data URLs */
  images: string[];
  /** PDF pages */
  pages: number;
  /** the text was cut at the limit */
  cut: boolean;
}

export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGES = 4;
/** text of one file that goes into the message */
export const MAX_FILE_TEXT = 40000;
/** all the text of one message (question + files) stays under the saved-step limit */
export const MAX_MESSAGE_TEXT = EXCHANGE_MAX - 2000;
/** a picture costs roughly this many tokens to a model (a rough, middle value, only for the estimate) */
export const IMAGE_TOKENS = 1100;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;

const T = {
  ro: { file: "Fișier atașat", pages: "pagini", cut: "textul a fost scurtat", image: "poză atașată", scanned: "pagini scanate trimise ca imagini" },
  en: { file: "Attached file", pages: "pages", cut: "the text was shortened", image: "attached photo", scanned: "scanned pages sent as images" },
};

export function capText(raw: string, max = MAX_FILE_TEXT): { text: string; cut: boolean } {
  const t = cleanText(raw);
  const chars = [...t];
  return chars.length > max ? { text: chars.slice(0, max).join("") + "…", cut: true } : { text: t, cut: false };
}

/** What a file adds to the text of the message (and to the saved question). Photos are only named. */
export function attachmentNote(a: Attachment, lang: PackLang): string {
  const t = T[lang];
  if (a.kind === "image") return `[${t.image}: ${a.name}]`;
  const info = [a.pages ? `${a.pages} ${t.pages}` : "", a.cut ? t.cut : "", a.images.length ? `${a.images.length} ${t.scanned}` : ""].filter(Boolean).join(", ");
  const head = `${t.file}: ${a.name}${info ? ` (${info})` : ""}`;
  return a.text ? `${head}\n\`\`\`\n${escapeFences(a.text)}\n\`\`\`` : `[${head}]`;
}

/** The question with its files, as saved and sent: question first, then each file. */
export function messageWithFiles(question: string, files: Attachment[], lang: PackLang): string {
  const parts = [question.trim(), ...files.map((a) => attachmentNote(a, lang))].filter(Boolean);
  const all = parts.join("\n\n");
  const chars = [...all];
  return chars.length > MAX_MESSAGE_TEXT ? chars.slice(0, MAX_MESSAGE_TEXT).join("") + "…" : all;
}

export const imagesOf = (files: Attachment[]): string[] => files.flatMap((a) => a.images).slice(0, MAX_IMAGES);

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface WireMessage {
  role: ChatMessage["role"];
  content: string | ContentPart[];
}

/** The last (user) message carries the images, OpenAI-style: text part + one image part per picture. */
export function withImages(messages: ChatMessage[], images: string[]): WireMessage[] {
  if (!images.length) return messages;
  const out: WireMessage[] = messages.slice(0, -1);
  const last = messages[messages.length - 1];
  out.push({ role: last.role, content: [{ type: "text", text: last.content }, ...images.map((url): ContentPart => ({ type: "image_url", image_url: { url } }))] });
  return out;
}
