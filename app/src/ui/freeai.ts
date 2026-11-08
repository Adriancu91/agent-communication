// AIW-06.1: the free mode of the chat — no account, no key, no cost.
// Pollinations (https://pollinations.ai) offers an anonymous public text service (OpenAI-style, CORS open),
// with an open model (GPT-OSS 20B) and a fair-use rate limit. The app uses it as it is offered: one request
// at a time, no retries in a loop, no way around its limits. Only https://text.pollinations.ai is allowed
// (Content-Security-Policy in index.html). The messages (and the project memory, in the form chosen under
// Saving) go to Pollinations when the user picks the free model or it takes over when Puter credit ends.
import type { WireMessage } from "../chat";
import { PuterError, type ChatResult } from "./puter";

export const FREE_URL = "https://text.pollinations.ai/openai";
const FREE_MODEL_ID = "openai-fast"; // the anonymous tier's model (GPT-OSS 20B)

/** One call, streamed (Server-Sent Events): `onText` receives the answer so far. */
export async function chatFree(messages: WireMessage[], onText: (soFar: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  let res: Response;
  try {
    res = await fetch(FREE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: FREE_MODEL_ID, messages, stream: true, private: true }),
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (e) {
    if (signal?.aborted) throw new PuterError("aborted");
    throw new PuterError("network", String(e).slice(0, 80));
  }
  if (res.status === 429) throw new PuterError("busy", "free");
  if (res.status === 402) throw new PuterError("freeLimit", "free");
  if (!res.ok || !res.body) throw new PuterError(res.status >= 500 ? "network" : "unknown", `free ${res.status}`);

  let text = "";
  let cut = false;
  let usage: ChatResult["usage"] = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j: { choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }; error?: unknown };
        try {
          j = JSON.parse(data);
        } catch {
          continue; // a broken line is skipped, the rest of the answer still counts
        }
        if (j.error) throw new PuterError("unknown", "free error");
        const c = j.choices?.[0];
        // only the answer: the model's "reasoning" stream is not shown or saved
        if (c && typeof c.delta?.content === "string" && c.delta.content) {
          text += c.delta.content;
          onText(text);
        }
        if (c?.finish_reason === "length") cut = true;
        if (j.usage && typeof j.usage.prompt_tokens === "number" && typeof j.usage.completion_tokens === "number") {
          usage = { input: j.usage.prompt_tokens, output: j.usage.completion_tokens };
        }
      }
    }
  } catch (e) {
    if (signal?.aborted) throw new PuterError("aborted");
    if (e instanceof PuterError) throw e;
    throw new PuterError("network", "free stream");
  }
  if (!text.trim()) throw new PuterError("empty");
  return { text, cut, usage };
}
