// AIW-09: pictures made from a description, free, without an account (the public Pollinations image
// service; one picture every 45 seconds per connection on its anonymous tier). Pure: the screen makes
// the request; what is saved in the chat is ordinary markdown, `![description](address)`, so a picture
// travels in archives like any other answer and is shown again from the device's cache (ui/media.ts).
import type { PackLang } from "../continuity";

export const IMAGE_HOST = "https://image.pollinations.ai";
/** The anonymous tier's rule, as the service states it (its 402 answer says exactly how long to wait). */
export const IMAGE_GAP_S = 45;
export const IMAGE_PROMPT_MAX = 1000;
/** Fits a phone screen and the free tier; the service returns JPEG. */
export const IMAGE_SIZE = 1024;

/** The command a user may type to be explicit: "/imagine o pisică pe lună". */
const COMMAND = /^\/(imagine|img|image|poză|poza|desen)(?=[:\s]|$)[:\s]*/i;
// A request that starts with a making verb and names a picture within its first words. Conservative on
// purpose: "arată-mi o imagine" or "ce e în poză" are not requests to make one.
const VERB = "(fă|fa|fă-mi|fa-mi|generează|genereaza|generează-mi|genereaza-mi|creează|creeaza|creează-mi|creeaza-mi|desenează|deseneaza|desenează-mi|deseneaza-mi|pictează|picteaza|make|generate|create|draw|paint|render|design)";
const NOUN = "(imagine|imaginea|poză|poza|pozã|desen|desenul|ilustrație|ilustratie|ilustrația|ilustratia|tablou|logo|logo-ul|pictură|pictura|afiș|afis|poster|wallpaper|avatar|icon|iconiță|iconita|picture|image|photo|drawing|illustration|painting|artwork|sketch|banner)";
// (no \b after a word ending in a diacritic: it is not a "word character" for the regex engine)
const END = "(?=[\\s.,!?:;)]|$)";
// "o imagine de ansamblu" (an overview), "an image caption", "a logo concept in words": questions, not pictures
const NOT_PICTURE = "(?!\\s+(?:de\\s+ansamblu|caption|text|descri|concept|în\\s+cuvinte|in\\s+words|idea|idei|ideas|de\\s+profil\\s+mai|mai\\s+bun|mai\\s+clar|more|better))";
const INTENT = new RegExp(`^${VERB}(?=\\s)(?:\\s+\\S+){0,3}?\\s+(?:(?:o|un|a|an|the|me|mi|îmi|imi)\\s+)?${NOUN}${END}${NOT_PICTURE}`, "i");

/** The description to draw when the message asks for a picture; null for anything else. */
export function imageRequest(text: string): string | null {
  const t = text.trim();
  if (!t || /\n\n(?:Fișier atașat|Attached file|\[poză atașată|\[attached photo)/.test(t)) return null; // files: a question about them
  const cmd = COMMAND.exec(t);
  if (cmd) {
    const rest = t.slice(cmd[0].length).trim();
    return rest ? rest.slice(0, IMAGE_PROMPT_MAX) : null;
  }
  if (t.length > IMAGE_PROMPT_MAX || t.split("\n").length > 6) return null;
  return INTENT.test(t) ? t : null;
}

/** A seed makes the same description give the same picture again (the service caches it by address). */
export function imageSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** The address of a picture: the description in the path, the options in the query. */
export function imageUrl(prompt: string, seed: number, size = IMAGE_SIZE): string {
  // encodeURIComponent leaves ' ( ) ! * as they are; here everything outside letters, digits and -_.~ is encoded
  const p = encodeURIComponent(prompt.trim().slice(0, IMAGE_PROMPT_MAX)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  // safe: the service's filter for unsuitable content; nofeed: not shown in the service's public feed
  return `${IMAGE_HOST}/prompt/${p}?width=${size}&height=${size}&seed=${Math.floor(seed)}&model=sana&safe=true&nofeed=true`;
}

/**
 * Is this exactly an address made by imageUrl (and nothing else)? Checked before anything is shown or
 * fetched as a picture: the host, the path, and only the options above, with the safety filter on.
 */
export function isImageUrl(url: string): boolean {
  if (typeof url !== "string" || url.length > 3000 || /[\s<>"'\\]/.test(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin !== IMAGE_HOST || u.hash || u.username || u.password) return false;
  if (!/^\/prompt\/[^/]+$/.test(u.pathname) || /%2F|\.\./i.test(u.pathname)) return false;
  const q = u.searchParams;
  const keys = [...q.keys()].sort().join(",");
  if (keys !== "height,model,nofeed,safe,seed,width") return false;
  const size = (k: string) => /^\d{2,4}$/.test(q.get(k) ?? "") && Number(q.get(k)) <= 2048;
  return size("width") && size("height") && /^\d{1,12}$/.test(q.get("seed") ?? "") && q.get("model") === "sana" && q.get("safe") === "true" && q.get("nofeed") === "true";
}

/** What the chat saves as the answer: markdown with the description as the alt text. */
export function imageReply(prompt: string, url: string): string {
  const alt = prompt.replace(/[\[\]\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  return `![${alt}](${url})`;
}

/** The picture in a saved answer, when the answer is one (made here); null otherwise. */
export function imageOfReply(text: string): { alt: string; url: string } | null {
  const m = /^!\[([^\]\n]*)\]\((\S+)\)\s*$/.exec(text.trim());
  return m && isImageUrl(m[2]) ? { alt: m[1], url: m[2] } : null;
}

export type ImageProblem = "limit" | "busy" | "network" | "unsafe" | "unknown";

export class ImageError extends Error {
  constructor(public problem: ImageProblem, /** seconds to wait before trying again (limit) */ public wait = 0) {
    super(`image:${problem}`);
    this.name = "ImageError";
  }
}

/** Reads the service's refusal: 402 = the free limit (with how long to wait), 429 = busy, others = unknown. */
export function imageProblem(status: number, body: string, retryAfter: string | null): ImageError {
  const header = Number(retryAfter);
  let wait = Number.isFinite(header) && header > 0 ? Math.ceil(header) : 0;
  if (!wait) {
    const m = /retry after (\d+)\s*s/i.exec(body);
    if (m) wait = Number(m[1]);
  }
  if (status === 402 || /FREE_LIMIT|free limit/i.test(body)) return new ImageError("limit", wait || IMAGE_GAP_S);
  if (status === 429 || status === 503) return new ImageError("busy", wait);
  if (status === 400 && /safe|nsfw|content/i.test(body)) return new ImageError("unsafe");
  return new ImageError("unknown");
}

/** The alt text of a saved picture, for the history and the export. */
export function describeImage(text: string, lang: PackLang): string | null {
  const img = imageOfReply(text);
  return img ? (lang === "ro" ? "🎨 Imagine: " : "🎨 Picture: ") + img.alt : null;
}
