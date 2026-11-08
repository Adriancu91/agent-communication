// AIW-06: the models offered in the in-app chat (through Puter, paid from the user's own Puter account).
// A short, curated list (Puter lists ~1000); any other model can still be typed by its exact Puter name.
// Prices: what Puter listed on 2026-11-08, in US cents per million tokens (input / output). They only
// sort the list and give the "$ / $$ / $$$" hint; the real charge is Puter's.

export type Tier = "free" | "economic" | "balanced" | "strong";
/** how the model is reached: through the user's Puter account, or the free public service (no account) */
export type Via = "puter" | "free";

export interface ChatModel {
  id: string;
  name: string;
  maker: string;
  tier: Tier;
  /** cents per million tokens, as listed by Puter */
  cost: { input: number; output: number };
  /** reasoning model: it accepts reasoning_effort / verbosity, and thinking counts as output */
  reasoning: boolean;
  via: Via;
  /** it can look at pictures (photos, scanned pages) */
  vision: boolean;
}

export const MODELS: ChatModel[] = [
  // AIW-06.1: free, no account, no key — Pollinations' public anonymous service (open model GPT-OSS 20B).
  // Slower and with a fair-use rate limit; used when Puter credit runs out, or when the user prefers it.
  { id: "free:gpt-oss-20b", name: "GPT-OSS 20B", maker: "Pollinations", tier: "free", cost: { input: 0, output: 0 }, reasoning: false, via: "free", vision: false },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", maker: "Google", tier: "economic", cost: { input: 10, output: 40 }, reasoning: false, via: "puter", vision: true },
  { id: "gpt-5-nano", name: "GPT-5 nano", maker: "OpenAI", tier: "economic", cost: { input: 5, output: 40 }, reasoning: true, via: "puter", vision: true },
  { id: "mistral-small-2603", name: "Mistral Small", maker: "Mistral", tier: "economic", cost: { input: 15, output: 60 }, reasoning: false, via: "puter", vision: true },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", maker: "Anthropic", tier: "economic", cost: { input: 10, output: 50 }, reasoning: false, via: "puter", vision: true },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", maker: "DeepSeek", tier: "economic", cost: { input: 30, output: 120 }, reasoning: false, via: "puter", vision: false },
  { id: "gpt-5.4-mini", name: "GPT-5.4 mini", maker: "OpenAI", tier: "balanced", cost: { input: 75, output: 450 }, reasoning: true, via: "puter", vision: true },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", maker: "Google", tier: "balanced", cost: { input: 75, output: 375 }, reasoning: false, via: "puter", vision: true },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", maker: "Anthropic", tier: "strong", cost: { input: 200, output: 1000 }, reasoning: false, via: "puter", vision: true },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", maker: "Google", tier: "strong", cost: { input: 125, output: 1000 }, reasoning: false, via: "puter", vision: true },
  { id: "gpt-5.4", name: "GPT-5.4", maker: "OpenAI", tier: "strong", cost: { input: 250, output: 1500 }, reasoning: true, via: "puter", vision: true },
];

export const DEFAULT_MODEL = "gemini-2.5-flash-lite";
export const FREE_MODEL = "free:gpt-oss-20b";
/** typed model names go through Puter; only the listed free model goes to the free service */
export const viaOf = (id: string): Via => findModel(id)?.via ?? "puter";
/** listed models say; a model typed by name is assumed to see pictures (Puter refuses otherwise) */
export const seesImages = (id: string): boolean => findModel(id)?.vision ?? true;

/** A model name the user typed: Puter's own ids (letters, digits, . _ - : / ~), at most 40 characters. */
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/~-]{0,39}$/;
export const isModelId = (s: unknown): s is string => typeof s === "string" && MODEL_ID.test(s);

export const findModel = (id: string): ChatModel | undefined => MODELS.find((m) => m.id === id);

/** "$" cheap … "$$$" expensive, from the output price (what usually dominates a chat). Unknown model: "". */
export function priceHint(id: string): string {
  const m = findModel(id);
  if (!m) return "";
  if (m.via === "free") return "";
  return m.cost.output <= 150 ? "$" : m.cost.output <= 500 ? "$$" : "$$$";
}

/** Estimated cost in US dollars of one call (unknown model: null). */
export function estimateCost(id: string, inputTokens: number, outputTokens: number): number | null {
  const m = findModel(id);
  if (!m) return null;
  return (inputTokens * m.cost.input + outputTokens * m.cost.output) / 1e6 / 100;
}
