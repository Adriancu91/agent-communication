// AIW-05.1: handing text to an AI app and getting the reply back with as few taps as possible,
// without any API, key or server, on any plan:
//  - out: the system share sheet on phones (ChatGPT / Claude / Gemini apps accept shared text),
//         copy + open the AI site in a new tab on computers;
//  - back: Android can share the AI reply straight into the installed app (Web Share Target,
//          manifest "share_target"); everywhere, one tap reads the clipboard after "Copy" in the AI app.
// The AI's own app or site is used normally by the person; nothing reads it automatically.

/** The reply waiting to be added to a session (passed between screens, never stored). */
let pending: { sessionId: string | null; text: string } | null = null;

export function setPendingReply(sessionId: string | null, text: string) {
  pending = { sessionId, text };
}

/** Takes the waiting reply for this session (or one not tied to a session yet). */
export function takePendingReply(sessionId: string): string | null {
  if (!pending || (pending.sessionId && pending.sessionId !== sessionId)) return null;
  const t = pending.text;
  pending = null;
  return t;
}

/** Text shared into the app (Android share sheet), kept until the person chooses a session. */
const SHARED_KEY = "aiw.shared";

export const SHARE_PARAMS = { title: "aiw_title", text: "aiw_text", url: "aiw_url" } as const;

/**
 * At start-up: if the app was opened by the share sheet, keep the shared text and remove it from the
 * address at once (so it is not left in the browser history), then show the "received" screen.
 */
export function captureSharedText(loc: Location = location, hist: History = history, store: Storage | null = safeSession()): boolean {
  const q = new URLSearchParams(loc.search);
  const parts = [q.get(SHARE_PARAMS.title), q.get(SHARE_PARAMS.text), q.get(SHARE_PARAMS.url)].filter((x): x is string => !!x && !!x.trim());
  if (!q.has(SHARE_PARAMS.text) && !q.has(SHARE_PARAMS.title) && !q.has(SHARE_PARAMS.url)) return false;
  const text = sharedText(parts);
  try {
    store?.setItem(SHARED_KEY, text);
  } catch {
    /* storage refused: the text is kept in memory only */
  }
  pending = { sessionId: null, text };
  hist.replaceState(null, "", loc.pathname + "#/primire");
  return true;
}

/** The shared pieces as one text: some apps send the reply as "title" + "text", or put a link apart. */
export function sharedText(parts: string[]): string {
  const list = parts.map((x) => x.trim()).filter(Boolean);
  // a piece already contained in another one (a title repeated in the text) is dropped
  const kept = list.filter((p, i) => !list.some((q, j) => j !== i && q.includes(p) && (q.length > p.length || j < i)));
  return kept.join("\n\n");
}

export function readSharedText(): string | null {
  if (pending && !pending.sessionId) return pending.text;
  try {
    return safeSession()?.getItem(SHARED_KEY) ?? null;
  } catch {
    return null;
  }
}

export function clearSharedText() {
  if (pending && !pending.sessionId) pending = null;
  try {
    safeSession()?.removeItem(SHARED_KEY);
  } catch {
    /* nothing to clear */
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** One tap: the text in the clipboard (the AI reply after "Copy"), or null if the browser refuses. */
export async function readClipboard(): Promise<string | null> {
  try {
    const t = await navigator.clipboard.readText();
    return t && t.trim() ? t : null;
  } catch {
    return null;
  }
}

/** Phones and tablets: the system share sheet can hand text to the AI apps. */
export function canShareText(): boolean {
  try {
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    return coarse && typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ text: "x" }));
  } catch {
    return false;
  }
}
