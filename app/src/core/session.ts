// AI work sessions (AIW-05): a session = one project worked on with one AI assistant, outside the app.
// The app never talks to the AI: it prepares the context, the user carries it over, and brings the
// reply back. Pure types and rules, no storage.
import { charCount, stripUnsafe, UNSAFE_CHARS } from "./project";

/**
 * Assistants the user can choose. `url` only opens the provider's own site in a new tab, where the user
 * is signed in directly with the provider; nothing is sent from this app (no API, no key, no prefilled text).
 */
export const PROVIDERS = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "claude", name: "Claude", url: "https://claude.ai/new" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app" },
  { id: "other", name: "", url: "" },
  // AIW-06: the chat inside the app (through Puter, signed in by the user). providerName = the model's name.
  { id: "inapp", name: "", url: "" },
] as const;
export type ProviderId = (typeof PROVIDERS)[number]["id"];

export const isProvider = (p: unknown): p is ProviderId => typeof p === "string" && PROVIDERS.some((x) => x.id === p);
export const providerUrl = (p: ProviderId): string => PROVIDERS.find((x) => x.id === p)!.url;

export const TASK_MAX = 4000;
export const PROVIDER_NAME_MAX = 40;
/** A pasted AI reply or a note. Long, but bounded (a phone must stay responsive). */
export const EXCHANGE_MAX = 100_000;

export interface Session {
  id: string; // "S-<uuid>"
  projectId: string;
  provider: ProviderId;
  /** The assistant's name when provider = "other" (e.g. "Mistral"); "" otherwise. */
  providerName: string;
  /** What the user asked the AI to do in this session (part of the package). */
  task: string;
  status: "open" | "closed";
  /** The session this one continues (moving the same work to another assistant), or null. */
  continues: string | null;
  createdAt: string;
  updatedAt: string;
  v: 1;
}

export type ExchangeKind = "sent" | "reply" | "note" | "ask";

/** AIW-06.1: a conversation imported from the user's own account is a chat whose "model" names its origin. */
export const IMPORTED: Record<string, string> = { "import:chatgpt": "ChatGPT ⇣", "import:claude": "Claude ⇣" };

/** Providers whose name is given by the user / the app (the assistant for "other", the model for "inapp"). */
export const namedProvider = (p: string): boolean => p === "other" || p === "inapp";

/**
 * One step of a session, saved in order.
 * sent  — a continuity package was copied / downloaded for the AI (its fingerprint, size and the
 *         short references it used; the text itself can be rebuilt and is not stored twice)
 * reply — the AI's answer, pasted by the user
 * note  — the user's own note about the session
 * ask   — AIW-06, in-app chat: the user's message; `pack` = the project context sent with it (or null)
 */
export interface Exchange {
  id: string; // "X-<uuid>"
  sessionId: string;
  projectId: string;
  kind: ExchangeKind;
  text: string; // reply / note text; "" for "sent"
  /** For "sent": fingerprint of the package text, its size, and short reference → entry id (e.g. D1 → M-…). */
  pack: { sha256: string; chars: number; refs: Record<string, string> } | null;
  /** For "reply": the memory entries created from it as proposals (accepted, rejected or still pending). */
  proposals: string[];
  createdAt: string;
  v: 1;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SESSION_ID = new RegExp(`^S-${UUID}$`);
const EXCHANGE_ID = new RegExp(`^X-${UUID}$`);
export const isSessionId = (s: unknown): s is string => typeof s === "string" && SESSION_ID.test(s);
export const isExchangeId = (s: unknown): s is string => typeof s === "string" && EXCHANGE_ID.test(s);
export const newSessionId = () => "S-" + crypto.randomUUID();
export const newExchangeId = () => "X-" + crypto.randomUUID();

const CONTROL = UNSAFE_CHARS;

/** Pasted text: invisible control / direction characters are removed (they would make an export unreadable). */
export function cleanText(raw: string): string {
  return stripUnsafe(String(raw ?? "")).normalize("NFC").replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

export type SessionProblem = "providerName" | "taskLong" | "textEmpty" | "textLong" | "chars";

export function checkSessionInput(s: { provider: ProviderId; providerName: string; task: string }): SessionProblem | null {
  if (namedProvider(s.provider) && (!s.providerName || charCount(s.providerName) > PROVIDER_NAME_MAX)) return "providerName";
  if (!namedProvider(s.provider) && s.providerName) return "providerName";
  if (CONTROL.test(s.providerName) || s.providerName.includes("\n") || CONTROL.test(s.task)) return "chars";
  if (charCount(s.task) > TASK_MAX) return "taskLong";
  return null;
}

export function checkExchangeText(text: string): SessionProblem | null {
  if (!text) return "textEmpty";
  if (charCount(text) > EXCHANGE_MAX) return "textLong";
  if (CONTROL.test(text)) return "chars";
  return null;
}

/** How a session is called in lists: the provider's name, or the name the user gave for "other". */
export function assistantName(s: Pick<Session, "provider" | "providerName">): string {
  if (s.provider === "inapp" && Object.hasOwn(IMPORTED, s.providerName)) return IMPORTED[s.providerName];
  return namedProvider(s.provider) ? s.providerName : PROVIDERS.find((p) => p.id === s.provider)!.name;
}
