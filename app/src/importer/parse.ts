// AIW-06.1: reading the conversations a user exported from their own AI account.
// - ChatGPT: Settings → Data controls → Export data → a .zip by e-mail, with conversations.json
//   (a list of { title, create_time, mapping: { id: { message, parent, children } }, current_node }).
// - Claude: Settings → Privacy → Export data → a .zip by e-mail, with conversations.json
//   (a list of { uuid, name, created_at, chat_messages: [{ sender, text | content[], created_at }] }).
// Pure: the bytes come from the user's own file; nothing is fetched. Unknown shapes are refused, odd items skipped.
import { cleanText, EXCHANGE_MAX } from "../core";

export type ImportSource = "chatgpt" | "claude";

export interface ImportedMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ImportedConversation {
  source: ImportSource;
  /** the id in the export (to recognise a conversation imported before) */
  id: string;
  title: string;
  /** ISO date of the conversation's last message, or null */
  updated: string | null;
  messages: ImportedMessage[];
  /** messages left out because the conversation is very long */
  dropped: number;
}

export const MAX_MESSAGES = 400;
export const TITLE_MAX = 200;

export class ImportError extends Error {
  constructor(public problem: "notJson" | "unknownFormat" | "empty" | "tooLarge" | "noConversations" | "zip", detail = "") {
    super(`import:${problem}${detail ? ` (${detail})` : ""}`);
    this.name = "ImportError";
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === "string" ? x : "");

function iso(x: unknown): string | null {
  if (typeof x === "number" && Number.isFinite(x) && x > 0) {
    const d = new Date(x < 1e11 ? x * 1000 : x); // seconds (ChatGPT) or milliseconds
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof x === "string") {
    const t = Date.parse(x);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

function text(raw: string): string {
  const t = cleanText(raw);
  return [...t].length > EXCHANGE_MAX ? [...t].slice(0, EXCHANGE_MAX - 12).join("") + "\n[…scurtat]" : t;
}

/** Joins consecutive messages of the same side; keeps the last MAX_MESSAGES. */
function finish(source: ImportSource, id: string, title: string, updated: string | null, list: ImportedMessage[]): ImportedConversation | null {
  const out: ImportedMessage[] = [];
  for (const m of list) {
    if (!m.text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.text = text(last.text + "\n\n" + m.text);
    else out.push({ ...m });
  }
  if (!out.some((m) => m.role === "user")) return null;
  const dropped = Math.max(0, out.length - MAX_MESSAGES);
  let kept = out.slice(dropped);
  if (kept[0]?.role === "assistant") kept = kept.slice(1); // a chat starts with the user's question
  const name = cleanText(title).replace(/\s+/g, " ").trim();
  return { source, id, title: [...(name || "—")].slice(0, TITLE_MAX).join(""), updated, messages: kept, dropped };
}

function chatgptConversation(c: Record<string, unknown>, i: number): ImportedConversation | null {
  const mapping = c.mapping;
  if (!isObj(mapping)) return null;
  // the visible branch: from the current node up to the root, then reversed
  let node = str(c.current_node);
  if (!node || !isObj(mapping[node])) {
    // no current node: the latest message in the mapping
    let best = "";
    let bestT = -1;
    for (const [k, v] of Object.entries(mapping)) {
      const t = isObj(v) && isObj(v.message) ? Number(v.message.create_time) || 0 : 0;
      if (t > bestT) (best = k), (bestT = t);
    }
    node = best;
  }
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  while (node && isObj(mapping[node]) && !seen.has(node) && seen.size < 20000) {
    seen.add(node);
    const n = mapping[node] as Record<string, unknown>;
    if (isObj(n.message)) chain.push(n.message);
    node = str(n.parent);
  }
  chain.reverse();
  const list: ImportedMessage[] = [];
  let last: string | null = null;
  for (const m of chain) {
    const role = isObj(m.author) ? str(m.author.role) : "";
    if (role !== "user" && role !== "assistant") continue; // system / tool messages are not the conversation
    if (isObj(m.metadata) && m.metadata.is_visually_hidden_from_conversation) continue;
    if (role === "assistant" && m.recipient !== undefined && m.recipient !== "all") continue; // tool calls
    const content = isObj(m.content) ? m.content : {};
    const type = str(content.content_type);
    let t = "";
    if (type === "text" || type === "multimodal_text" || type === "") {
      t = Array.isArray(content.parts) ? content.parts.filter((x): x is string => typeof x === "string").join("\n") : "";
    } else if (type === "code") t = "```\n" + str(content.text) + "\n```";
    else continue; // thoughts, images, browsing results…
    list.push({ role, text: text(t) });
    last = iso(m.create_time) ?? last;
  }
  return finish("chatgpt", str(c.id) || str(c.conversation_id) || `chatgpt-${i}`, str(c.title), last ?? iso(c.update_time), list);
}

function claudeConversation(c: Record<string, unknown>, i: number): ImportedConversation | null {
  if (!Array.isArray(c.chat_messages)) return null;
  const list: ImportedMessage[] = [];
  let last: string | null = null;
  for (const m of c.chat_messages) {
    if (!isObj(m)) continue;
    const sender = str(m.sender);
    const role = sender === "human" ? "user" : sender === "assistant" ? "assistant" : null;
    if (!role) continue;
    let t = str(m.text);
    if (!t && Array.isArray(m.content)) {
      t = m.content.filter((x): x is Record<string, unknown> => isObj(x) && x.type === "text").map((x) => str(x.text)).join("\n");
    }
    list.push({ role, text: text(t) });
    last = iso(m.created_at) ?? last;
  }
  return finish("claude", str(c.uuid) || `claude-${i}`, str(c.name), last ?? iso(c.updated_at), list);
}

/** Reads a conversations.json (already parsed). Newest first. */
export function parseConversations(data: unknown): { source: ImportSource; conversations: ImportedConversation[] } {
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.conversations) ? data.conversations : null;
  if (!list) throw new ImportError("unknownFormat");
  if (list.length === 0) throw new ImportError("noConversations");
  const first = list.find(isObj);
  if (!first) throw new ImportError("unknownFormat");
  const source: ImportSource | null = "mapping" in first ? "chatgpt" : "chat_messages" in first ? "claude" : null;
  if (!source) throw new ImportError("unknownFormat");
  const conversations: ImportedConversation[] = [];
  list.forEach((c, i) => {
    if (!isObj(c)) return;
    const conv = source === "chatgpt" ? chatgptConversation(c, i) : claudeConversation(c, i);
    if (conv) conversations.push(conv);
  });
  if (conversations.length === 0) throw new ImportError("noConversations");
  conversations.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
  return { source, conversations };
}

/** Parses the text of a conversations.json. */
export function parseConversationsText(json: string): ReturnType<typeof parseConversations> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ImportError("notJson");
  }
  return parseConversations(data);
}
