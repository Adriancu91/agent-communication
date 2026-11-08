// AIW-06.1: conversations exported from ChatGPT / Claude become chats of a project; the free model; dedupe.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createZip, readZip, TransferService } from "../../src/archive";
import { buildMessages, DEFAULT_ECONOMY, FREE_MODEL, findModel, priceHint, viaOf } from "../../src/chat";
import { assistantName } from "../../src/core";
import { SessionStore } from "../../src/continuity";
import { ImportError, MAX_MESSAGES, parseConversations, parseConversationsText } from "../../src/importer";
import { ProjectStore } from "../../src/projects";
import { JournaledStore } from "../../src/storage";

const node = (id: string, parent: string | null, role: string | null, parts: unknown[] | null, t: number, extra: Record<string, unknown> = {}) => ({
  id, parent, children: [],
  message: role ? { author: { role }, content: parts ? { content_type: "text", parts } : { content_type: "thoughts", thoughts: [] }, create_time: t, ...extra } : null,
});

export const CHATGPT = [
  {
    id: "c1", title: "Ofertă  DEEE\nBrăila", update_time: 1762500000,
    current_node: "m5",
    mapping: {
      root: node("root", null, null, null, 0),
      sys: node("sys", "root", "system", [""], 1),
      m1: node("m1", "sys", "user", ["Cât costă transportul?"], 1762400000),
      m2: node("m2", "m1", "assistant", [], 1762400010, { content: { content_type: "thoughts", thoughts: ["…"] } }),
      m3: node("m3", "m2", "assistant", ["Depinde de distanță."], 1762400020),
      tool: node("tool", "m3", "assistant", ["search(...)"], 1762400025, { recipient: "browser" }),
      m4: node("m4", "tool", "user", ["Și pentru 20 km?", { image: true }], 1762400030),
      m5: node("m5", "m4", "assistant", ["Aproximativ 300 lei."], 1762400040),
      // another branch (an edited question): not on the visible path
      x1: node("x1", "m3", "user", ["ramură veche"], 1762400029),
    },
  },
  { id: "c2", title: "Doar sistem", mapping: { a: node("a", null, "system", ["x"], 1) }, current_node: "a" },
];

export const CLAUDE = [
  {
    uuid: "u1", name: "Plan site", updated_at: "2026-11-01T10:00:00Z",
    chat_messages: [
      { sender: "human", text: "Fă-mi un plan.", created_at: "2026-11-01T09:00:00Z" },
      { sender: "assistant", text: "", content: [{ type: "text", text: "Pasul 1." }, { type: "tool_use" }], created_at: "2026-11-01T09:00:05Z" },
      { sender: "assistant", text: "Pasul 2.", created_at: "2026-11-01T09:00:06Z" },
    ],
  },
  { uuid: "u0", name: "Veche", updated_at: "2025-01-01T00:00:00Z", chat_messages: [{ sender: "human", text: "Salut" }] },
];

describe("reading an export", () => {
  it("ChatGPT: only the visible branch, no system / tool / hidden messages, images ignored", () => {
    const r = parseConversations(CHATGPT);
    expect(r.source).toBe("chatgpt");
    expect(r.conversations).toHaveLength(1); // "Doar sistem" has no user message
    const c = r.conversations[0];
    expect(c.title).toBe("Ofertă DEEE Brăila");
    expect(c.messages).toEqual([
      { role: "user", text: "Cât costă transportul?" },
      { role: "assistant", text: "Depinde de distanță." },
      { role: "user", text: "Și pentru 20 km?" },
      { role: "assistant", text: "Aproximativ 300 lei." },
    ]);
    expect(c.updated).toBe(new Date(1762400040 * 1000).toISOString());
  });

  it("Claude: human / assistant, text from content parts, same side joined, newest first", () => {
    const r = parseConversations(CLAUDE);
    expect(r.source).toBe("claude");
    expect(r.conversations.map((c) => c.title)).toEqual(["Plan site", "Veche"]);
    expect(r.conversations[0].messages).toEqual([
      { role: "user", text: "Fă-mi un plan." },
      { role: "assistant", text: "Pasul 1.\n\nPasul 2." },
    ]);
  });

  it("very long conversations keep the last messages; unknown files are refused clearly", () => {
    const long = [{ uuid: "L", name: "Lung", chat_messages: Array.from({ length: MAX_MESSAGES + 51 }, (_, i) => ({ sender: i % 2 ? "assistant" : "human", text: `m${i}` })) }];
    const c = parseConversations(long).conversations[0];
    expect(c.messages.length).toBeLessThanOrEqual(MAX_MESSAGES);
    expect(c.messages[0].role).toBe("user");
    expect(c.messages.at(-1)!.text).toBe(`m${MAX_MESSAGES + 50}`);
    expect(c.dropped).toBe(51);
    expect(() => parseConversationsText("nu e json")).toThrow(ImportError);
    expect(() => parseConversations([{ foo: 1 }])).toThrowError(/unknownFormat/);
    expect(() => parseConversations([])).toThrowError(/noConversations/);
    expect(() => parseConversations({ conversations: CLAUDE })).not.toThrow();
  });

  it("only conversations.json is read out of a large export archive", async () => {
    const enc = new TextEncoder();
    const zip = await createZip([
      { name: "chat.html", data: enc.encode("<html>") },
      { name: "conversations.json", data: enc.encode(JSON.stringify(CLAUDE)) },
      { name: "user.json", data: enc.encode("{}") },
    ]);
    const files = await readZip(zip, undefined, (n) => /(^|\/)conversations\.json$/.test(n));
    expect([...files.keys()]).toEqual(["conversations.json"]);
  });
});

const devs: JournaledStore[] = [];
afterEach(() => devs.splice(0).forEach((d) => d.close()));

describe("an imported conversation is a chat of the project", () => {
  it("saved closed, in order, named after its origin; it survives export / import and the journal replays", async () => {
    const base = new JournaledStore("im-" + Math.random());
    devs.push(base);
    const projects = new ProjectStore(base);
    const sessions = new SessionStore(base);
    const p = await projects.create("Firma");
    const conv = parseConversations(CHATGPT).conversations[0];
    const s = await sessions.importChat(p.id, "chatgpt", conv.title, conv.messages);
    expect(s).toMatchObject({ provider: "inapp", providerName: "import:chatgpt", task: "Ofertă DEEE Brăila", status: "closed" });
    expect(assistantName(s)).toBe("ChatGPT ⇣");
    const steps = await sessions.exchanges(s.id);
    expect(steps.map((x) => [x.kind, x.text])).toEqual([
      ["ask", "Cât costă transportul?"], ["reply", "Depinde de distanță."], ["ask", "Și pentru 20 km?"], ["reply", "Aproximativ 300 lei."],
    ]);
    // continued later in the chat with a model: a new chat that continues the imported one
    const next = await sessions.startChat(p.id, "gpt-5-nano", s.id);
    expect(next.continues).toBe(s.id);
    // nothing reaches the official memory by importing
    await expect(sessions.importChat(p.id, "claude", "x", [{ role: "assistant", text: "fără întrebare" }])).rejects.toMatchObject({ reason: "textEmpty" });

    const t = new TransferService(base, "t");
    const { bytes } = await t.exportArchive([p.id]);
    const other = new JournaledStore("im2-" + Math.random());
    devs.push(other);
    const t2 = new TransferService(other, "t");
    await t2.importArchive(await t2.preview(bytes));
    const [np] = await new ProjectStore(other).list();
    const list = await new SessionStore(other).list(np.id);
    expect(list.map((x) => x.providerName).sort()).toEqual(["gpt-5-nano", "import:chatgpt"]);
  });
});

describe("free model and repeated questions", () => {
  it("the free model is listed, reached without Puter, shown without a price", () => {
    expect(findModel(FREE_MODEL)).toMatchObject({ via: "free", tier: "free" });
    expect(viaOf(FREE_MODEL)).toBe("free");
    expect(viaOf("gpt-5-nano")).toBe("puter");
    expect(viaOf("orice-alt-model")).toBe("puter");
    expect(priceHint(FREE_MODEL)).toBe("");
  });

  it("a question asked again (after a failure / on another model) is sent once", () => {
    const m = buildMessages("SYS", [{ kind: "reply", text: "a" }, { kind: "ask", text: "q" }], "q", DEFAULT_ECONOMY, "ro");
    expect(m).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "q" }]);
  });
});
