// AIW-06: the link to Puter (https://puter.com), used only by the in-app chat.
// Puter.js (Apache-2.0) is shipped with the app (vendor/puter.js, same origin) and loaded only when the
// chat is opened. The user signs in to their own Puter account in Puter's window; the app never sees a
// password or a key. Each message is paid from that account (Puter gives new accounts some free credit).
// Only https://api.puter.com is allowed to be contacted (Content-Security-Policy in index.html).
import type { ChatMessage } from "../chat";

interface PuterUsageDetails { inputTokens: number; outputTokens: number }
interface PuterChunk { type: string; text?: string; usage?: Record<string, number>; usageDetails?: PuterUsageDetails; error?: unknown }
interface PuterResponse { message?: { content?: unknown }; finish_reason?: string; stopReason?: string; usage?: Record<string, number>; usageDetails?: PuterUsageDetails }
interface PuterGlobal {
  quiet?: boolean;
  auth: {
    isSignedIn(): boolean;
    signIn(): Promise<unknown>;
    signOut(): void;
    getUser(): Promise<{ username?: string }>;
    getMonthlyUsage?(): Promise<{ allowanceInfo?: { remaining?: number; monthUsageAllowance?: number; unit?: string } }>;
  };
  ai: { chat(messages: ChatMessage[], options: Record<string, unknown>): Promise<PuterResponse | AsyncIterable<PuterChunk>> };
}

declare global {
  interface Window { puter?: PuterGlobal }
}

export const PUTER_SCRIPT = "./vendor/puter.js";

let loading: Promise<PuterGlobal> | null = null;

/** Loads Puter.js once (only when the chat needs it). */
export function loadPuter(): Promise<PuterGlobal> {
  if (window.puter) return Promise.resolve(window.puter);
  if (loading) return loading;
  loading = new Promise<PuterGlobal>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PUTER_SCRIPT;
    s.async = true;
    s.dataset.puter = "";
    s.onload = () => {
      if (window.puter) {
        window.puter.quiet = true;
        resolve(window.puter);
      } else {
        loading = null; // the next attempt loads it again
        s.remove();
        reject(new PuterError("load"));
      }
    };
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new PuterError("load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export type PuterProblem = "load" | "signin" | "popup" | "cancelled" | "account" | "funds" | "busy" | "network" | "model" | "aborted" | "empty" | "unknown";

export class PuterError extends Error {
  constructor(public problem: PuterProblem, detail = "") {
    super(`puter:${problem}${detail ? ` (${detail})` : ""}`);
    this.name = "PuterError";
  }
}

/** Puter's errors come in several shapes (objects, strings, Error): this reads what kind it is. */
export function classify(e: unknown): PuterError {
  if (e instanceof PuterError) return e;
  if (e instanceof DOMException && e.name === "AbortError") return new PuterError("aborted");
  const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
  const inner = (o.error && typeof o.error === "object" ? o.error : {}) as Record<string, unknown>;
  // Puter rejects in several shapes: { error: "popup_blocked", msg }, { error: { message, code } }, Error, string
  const text = [o.error, o.msg, o.message, o.code, inner.message, inner.code, typeof e === "string" ? e : ""].filter((x) => typeof x === "string").join(" ").toLowerCase();
  const status = Number(o.status ?? inner.status);
  const d = text.slice(0, 120);
  if (/popup_blocked|popup.*block/.test(text)) return new PuterError("popup", d);
  if (/auth_window_closed|window.*closed|cancel/.test(text)) return new PuterError("cancelled", d);
  if (/subscription_required|email_must_be_confirmed|confirm.*email|account.*(suspend|disabled)/.test(text)) return new PuterError("account", d);
  if (status === 429 || /rate.?limit|too many requests/.test(text)) return new PuterError("busy", d);
  if (status === 401 || /unauthori[sz]ed|sign.?in|not.*logged|auth/.test(text)) return new PuterError("signin", d);
  if (status === 402 || /insufficient|funds|usage.?limit|credit|quota|limit.*reached/.test(text)) return new PuterError("funds", d);
  if (/model.*(not|unknown|unavailable|invalid|found)|no such model/.test(text)) return new PuterError("model", d);
  if (e instanceof TypeError || /network|fetch|failed to|offline|timeout/.test(text)) return new PuterError("network", text.slice(0, 120));
  return new PuterError("unknown", text.slice(0, 120));
}

export function isSignedIn(): boolean {
  try {
    return !!window.puter?.auth.isSignedIn();
  } catch {
    return false;
  }
}

/** Opens Puter's sign-in window. Must be called from a click (otherwise the browser blocks the window). */
export async function signIn(): Promise<boolean> {
  const p = await loadPuter();
  try {
    // the user's own account (no temporary guest account created on their behalf)
    await p.auth.signIn();
  } catch (e) {
    throw classify(e);
  }
  return p.auth.isSignedIn();
}

export async function signOut(): Promise<void> {
  const p = await loadPuter();
  p.auth.signOut();
}

export async function userName(): Promise<string | null> {
  try {
    const u = await (await loadPuter()).auth.getUser();
    return typeof u?.username === "string" ? u.username : null;
  } catch {
    return null;
  }
}

/** What is left of the account's monthly allowance: "credits" or US dollars, when Puter says. */
export async function remainingCredit(): Promise<{ value: number; unit: "credits" | "usd" } | null> {
  try {
    const p = await loadPuter();
    const info = (await p.auth.getMonthlyUsage?.())?.allowanceInfo;
    if (!info || typeof info.remaining !== "number" || !Number.isFinite(info.remaining)) return null;
    // raw amounts are in microcents (1 USD = 100 000 000)
    return info.unit === "credits" ? { value: info.remaining, unit: "credits" } : { value: info.remaining / 1e8, unit: "usd" };
  } catch {
    return null;
  }
}

export interface ChatResult {
  text: string;
  /** the answer stopped at the length limit */
  cut: boolean;
  usage: { input: number; output: number } | null;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join("");
  return "";
}

const usageOf = (u: PuterUsageDetails | undefined) =>
  u && typeof u.inputTokens === "number" && typeof u.outputTokens === "number" ? { input: u.inputTokens, output: u.outputTokens } : null;

/**
 * One call to the model, streamed: `onText` receives the answer so far as it arrives.
 * Stopping (signal) keeps nothing: the partial answer is not saved.
 */
export async function chat(messages: ChatMessage[], options: Record<string, unknown>, onText: (soFar: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  const p = await loadPuter();
  if (!p.auth.isSignedIn()) throw new PuterError("signin");
  let text = "";
  let cut = false;
  let usage: ChatResult["usage"] = null;
  try {
    // stopping must work even while waiting for the first word
    const stopped = new Promise<never>((_, reject) => {
      if (signal?.aborted) reject(new PuterError("aborted"));
      signal?.addEventListener("abort", () => reject(new PuterError("aborted")), { once: true });
    });
    stopped.catch(() => undefined);
    const res = await Promise.race([p.ai.chat(messages, { ...options, stream: true, normalize: true, signal }), stopped]);
    if (res && typeof (res as AsyncIterable<PuterChunk>)[Symbol.asyncIterator] === "function") {
      for await (const c of res as AsyncIterable<PuterChunk>) {
        if (signal?.aborted) throw new PuterError("aborted");
        if (c.type === "text" && typeof c.text === "string") {
          text += c.text;
          onText(text);
        } else if (c.type === "error") throw classify(c.error ?? c);
        else if (c.type === "usage") usage = usageOf(c.usageDetails) ?? usage;
        else if ((c.type === "finish" || c.type === "stop") && /length|max_tokens/.test(String((c as unknown as Record<string, unknown>).reason ?? ""))) cut = true;
      }
    } else {
      const r = res as PuterResponse;
      text = textOf(r?.message?.content);
      cut = /length|max_tokens/.test(String(r?.finish_reason ?? r?.stopReason ?? ""));
      usage = usageOf(r?.usageDetails);
      onText(text);
    }
  } catch (e) {
    if (signal?.aborted) throw new PuterError("aborted");
    throw classify(e);
  }
  if (!text.trim()) throw new PuterError("empty");
  return { text, cut, usage };
}
