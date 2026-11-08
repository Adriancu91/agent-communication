// AIW-06: what the in-app chat sends (system prompt, compact table, history window, options), templates,
// chats saved in the project (ask / reply), the archive (version 3) and older archives.
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATEGORIES, type Exchange, type MemoryEntry } from "../../src/core";
import { parseArchive, readZip, TransferService, MANIFEST_NAME, EXPORT_VERSION } from "../../src/archive";
import {
  buildMessages, callOptions, cell, cleanEconomy, cleanMyPrompts, DEFAULT_ECONOMY, estimateCost, isModelId, MODELS, PRESETS, presetOf,
  priceHint, systemPrompt, tokensForChars, builtInPrompts, type Economy,
} from "../../src/chat";
import { parseReply, SessionStore } from "../../src/continuity";
import { MemoryStore } from "../../src/memory";
import { ProjectStore } from "../../src/projects";
import { JournaledStore } from "../../src/storage";

if (typeof globalThis.localStorage === "undefined") {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

let clock = 0;
const tick = () => new Date((clock += 1000));
interface Dev { base: JournaledStore; projects: ProjectStore; memory: MemoryStore; sessions: SessionStore; transfer: TransferService }
const devs: Dev[] = [];
function dev(): Dev {
  const base = new JournaledStore("ch-" + Math.random(), tick);
  const d = { base, projects: new ProjectStore(base), memory: new MemoryStore(base), sessions: new SessionStore(base), transfer: new TransferService(base, "t") };
  devs.push(d);
  return d;
}
beforeEach(() => {
  clock = Date.parse("2026-11-08T10:00:00Z");
  localStorage.clear();
});
afterEach(() => devs.splice(0).forEach((d) => d.base.close()));

const date = (iso: string) => iso.slice(0, 10);
const SHA = "b".repeat(64);

async function project(d: Dev) {
  const p = await d.projects.create("Oferta Brăila", "Ofertă DEEE, client din Brăila");
  const e: Record<string, MemoryEntry> = {};
  for (const c of CATEGORIES) e[c] = await d.memory.create(p.id, { category: c, title: `${c} oficial`, body: `Detalii ${c}, cu virgulă, "ghilimele" și\nun rând nou`, important: c === "decision" });
  const pending = await d.memory.propose(p.id, { category: "fact", title: "Propunere neconfirmată", source: "ChatGPT" });
  return { p, e, pending };
}

async function sys(d: Dev, projectId: string, economy: Partial<Economy> = {}) {
  const [pr, entries, links] = await Promise.all([d.projects.get(projectId), d.memory.list(projectId), d.memory.links(projectId)]);
  return { s: systemPrompt(pr!, entries, links, { lang: "ro", economy: { ...DEFAULT_ECONOMY, ...economy }, assistant: "Gemini", maxChars: 24000, date: "8 nov. 2026", formatDate: date }), entries };
}

describe("what the chat sends", () => {
  it("compact: one table, fields named once, every official item with its reference; never a pending proposal", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const { s } = await sys(d, p.id);
    expect(s.text).toContain("memorie[7]{ref,tip,titlu,text,imp}:");
    expect(s.text).toContain("D1,decizie,decision oficial,");
    expect(s.text).toContain('"Detalii decision, cu virgulă, \\"ghilimele\\" și\\nun rând nou",1');
    expect(s.text).not.toContain("Propunere neconfirmată");
    expect(s.refs.D1).toBe(e.decision.id);
    expect(s.included).toBe(7);
    expect(s.text).toContain("```aiw-propuneri");
    expect(s.text).toContain("Răspunde concis");
  });

  it("compact is much smaller than the full package for the same memory", async () => {
    const d = dev();
    const { p } = await project(d);
    const full = (await sys(d, p.id, { context: "full" })).s;
    const compact = (await sys(d, p.id, { context: "compact" })).s;
    expect(full.text).toContain("# Pachet de continuitate");
    expect(Object.keys(compact.refs).sort()).toEqual(Object.keys(full.refs).sort()); // same items, same references
    expect(compact.text.length).toBeLessThan(full.text.length * 0.7);
  });

  it("important only / none / no proposals / telegraphic", async () => {
    const d = dev();
    const { p } = await project(d);
    const imp = (await sys(d, p.id, { context: "important" })).s;
    expect(imp.included).toBe(1);
    expect(imp.text).toContain("memorie[1]");
    expect(imp.text).toContain("Sunt incluse doar informațiile marcate importante");
    const none = (await sys(d, p.id, { context: "none", proposals: false, answer: "telegraphic" })).s;
    expect(none.included).toBe(0);
    expect(none.refs).toEqual({});
    expect(none.text).not.toContain("memorie[");
    expect(none.text).not.toContain("aiw-propuneri");
    expect(none.text).toContain("telegrafice");
  });

  it("the model's proposals are read back through the compact references", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const { s, entries } = await sys(d, p.id);
    const reply = 'Ok.\n\n```aiw-propuneri\n[{"tip":"decizie","titlu":"Preț nou","inlocuieste":"D1","motiv":"piața"},{"tip":"informatie","titlu":"Rezolvat","rezolva":"P1"}]\n```';
    const r = parseReply(reply, s.refs, entries);
    expect(r.proposals.map((x) => [x.replaces, x.resolves])).toEqual([[e.decision.id, null], [null, e.issue.id]]);
  });

  it("table cells: bare when safe, quoted and escaped otherwise", () => {
    expect(cell("simplu")).toBe("simplu");
    expect(cell("a,b")).toBe('"a,b"');
    expect(cell(' spațiu')).toBe('" spațiu"');
    expect(cell("12.5")).toBe('"12.5"'); // would read as a number
    expect(cell('x"y\\z\nw')).toBe('"x\\"y\\\\z\\nw"');
    expect(cell("")).toBe("");
  });

  it("history window: only the last N messages, never starting with an answer; replies without their proposals block", () => {
    const x = (kind: Exchange["kind"], text: string) => ({ kind, text });
    const earlier = [x("ask", "q1"), x("reply", "a1"), x("note", "n"), x("ask", "q2"), x("reply", "a2\n\n```aiw-propuneri\n[]\n```")];
    const m = buildMessages("SYS", earlier, "q3", { ...DEFAULT_ECONOMY, history: 2 }, "ro");
    expect(m.map((y) => y.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(m[1].content).toBe("q2");
    expect(m[2].content).toContain("a2");
    expect(m[2].content).not.toContain("```aiw-propuneri");
    const odd = buildMessages("SYS", earlier, "q3", { ...DEFAULT_ECONOMY, history: 3 }, "ro");
    expect(odd[1].role).toBe("user"); // "a1" would start the window: dropped
    expect(buildMessages("SYS", earlier, "q3", { ...DEFAULT_ECONOMY, history: 0 }, "ro")).toHaveLength(2);
  });

  it("a question whose answer failed is joined with the next one (alternating turns)", () => {
    const m = buildMessages("SYS", [{ kind: "ask", text: "q1" }], "q2", DEFAULT_ECONOMY, "ro");
    expect(m).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "q1\n\nq2" }]);
  });

  it("call options: length cap, low reasoning effort on reasoning models", () => {
    expect(callOptions("gemini-2.5-flash-lite", PRESETS.balanced, false)).toEqual({ model: "gemini-2.5-flash-lite", max_tokens: 1200 });
    expect(callOptions("gpt-5-nano", PRESETS.max, true)).toEqual({ model: "gpt-5-nano", max_tokens: 1200, reasoning_effort: "low", verbosity: "low" });
    expect(callOptions("gpt-5.4", PRESETS.quality, true)).toEqual({ model: "gpt-5.4", reasoning_effort: "low" });
  });

  it("settings read back field by field; presets recognised", () => {
    expect(cleanEconomy(null)).toEqual(DEFAULT_ECONOMY);
    expect(cleanEconomy({ context: "full", answer: "x", history: 3, maxOutput: 600, proposals: false })).toEqual({ ...DEFAULT_ECONOMY, context: "full", maxOutput: 600, proposals: false });
    expect(presetOf(PRESETS.max)).toBe("max");
    expect(presetOf({ ...PRESETS.max, history: 16 })).toBeNull();
  });

  it("models, prices and estimates", () => {
    expect(MODELS.every((m) => isModelId(m.id))).toBe(true);
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
    expect(priceHint("gpt-5-nano")).toBe("$");
    expect(priceHint("gpt-5.4")).toBe("$$$");
    expect(priceHint("necunoscut")).toBe("");
    expect(isModelId("openrouter:anthropic/claude-sonnet-5.5")).toBe(true);
    expect(isModelId("rău model")).toBe(false);
    expect(isModelId("<script>")).toBe(false);
    expect(estimateCost("gpt-5-nano", 1_000_000, 0)).toBeCloseTo(0.05);
    expect(tokensForChars(37)).toBe(10);
  });
});

describe("templates", () => {
  it("ready-made in both languages, same ids", () => {
    expect(builtInPrompts("ro").map((p) => p.id)).toEqual(builtInPrompts("en").map((p) => p.id));
  });
  it("my own: invalid items dropped, limits enforced", () => {
    const ok = { id: "U-1731050000000", label: "Ofertă", text: "Rezumă oferta." };
    expect(cleanMyPrompts([ok, ok, { id: "x", label: "a", text: "b" }, { id: "U-2", label: "", text: "b" }, { id: "U-3", label: "a".repeat(31), text: "b" }, "s"])).toEqual([ok]);
    expect(cleanMyPrompts("nu")).toEqual([]);
    expect(cleanMyPrompts(Array.from({ length: 40 }, (_, i) => ({ id: `U-${i}`, label: "a", text: "b" })))).toHaveLength(30);
  });
});

describe("chats saved in the project", () => {
  it("startChat + ask + applyReply: in order, with the context fingerprint; the reply's proposals reviewed as usual", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const s = await d.sessions.startChat(p.id, "gemini-2.5-flash-lite");
    expect(s).toMatchObject({ provider: "inapp", providerName: "gemini-2.5-flash-lite", task: "", status: "open" });
    const ask = await d.sessions.ask(s.id, "Unde suntem?", { sha256: SHA, chars: 900, refs: { D1: e.decision.id } });
    await d.sessions.applyReply(s.id, "Suntem bine.", []);
    const steps = await d.sessions.exchanges(s.id);
    expect(steps.map((x) => x.kind)).toEqual(["ask", "reply"]);
    expect(steps[0]).toMatchObject({ id: ask.id, text: "Unde suntem?", pack: { sha256: SHA, chars: 900 } });
    // chat questions are not "saved replies" for outside packages
    expect((await d.sessions.savedReplies(p.id, 10)).map((x) => x.exchange.kind)).toEqual(["reply"]);
    // a package step does not belong in a chat; a chat message does not belong in an outside session
    await expect(d.sessions.recordSent(s.id, { sha256: SHA, chars: 1, refs: {} })).rejects.toMatchObject({ reason: "invalid" });
    const outside = await d.sessions.start(p.id, { provider: "claude" }, { sha256: SHA, chars: 1, refs: {} });
    await expect(d.sessions.ask(outside.id, "x", null)).rejects.toMatchObject({ reason: "invalid" });
    await expect(d.sessions.start(p.id, { provider: "inapp", providerName: "x" }, { sha256: SHA, chars: 1, refs: {} })).rejects.toMatchObject({ reason: "invalid" });
  });

  it("another model continues the same project's chat; bad model names and empty questions are refused", async () => {
    const d = dev();
    const { p } = await project(d);
    const a = await d.sessions.startChat(p.id, "gpt-5-nano");
    const b = await d.sessions.startChat(p.id, "claude-haiku-5-5", a.id);
    expect(b.continues).toBe(a.id);
    await expect(d.sessions.startChat(p.id, "")).rejects.toMatchObject({ reason: "providerName" });
    await expect(d.sessions.startChat(p.id, "x".repeat(41))).rejects.toMatchObject({ reason: "providerName" });
    await expect(d.sessions.ask(a.id, "   ", null)).rejects.toMatchObject({ reason: "textEmpty" });
    const other = await d.projects.create("Alt proiect");
    await expect(d.sessions.startChat(other.id, "gpt-5-nano", a.id)).rejects.toMatchObject({ reason: "missing" });
  });

  it("export (version 3) and import keep the chats; the journal replays", async () => {
    const a = dev();
    const { p, e } = await project(a);
    const s = await a.sessions.startChat(p.id, "gemini-2.5-flash-lite");
    await a.sessions.ask(s.id, "Ce urmează?", { sha256: SHA, chars: 10, refs: { D1: e.decision.id } });
    await a.sessions.applyReply(s.id, "Pasul X.\n\n```aiw-propuneri\n[{\"tip\":\"pas\",\"titlu\":\"Pasul X\"}]\n```", [
      { category: "step", title: "Pasul X", body: "", important: false, replaces: null, resolves: null, reason: "", verdict: "accept" },
    ]);
    await a.sessions.ask(s.id, "Și apoi?", null);
    const { bytes } = await a.transfer.exportArchive([p.id]);
    const files = await readZip(bytes);
    expect(JSON.parse(new TextDecoder().decode(files.get(MANIFEST_NAME)!)).version).toBe(3);
    expect(EXPORT_VERSION).toBe(3);

    const b = dev();
    await b.transfer.importArchive(await b.transfer.preview(bytes));
    const [np] = await b.projects.list();
    const [ns] = await b.sessions.list(np.id);
    expect(ns).toMatchObject({ provider: "inapp", providerName: "gemini-2.5-flash-lite" });
    const steps = await b.sessions.exchanges(ns.id);
    expect(steps.map((x) => x.kind)).toEqual(["ask", "reply", "ask"]);
    expect(steps[2].pack).toBeNull();
    expect((await b.memory.list(np.id)).some((x) => x.title === "Pasul X" && x.confirmation === "confirmed")).toBe(true);
  });

  it("an archive of version 2 may not contain chats (they did not exist then)", async () => {
    const a = dev();
    const { p } = await project(a);
    const s = await a.sessions.startChat(p.id, "gpt-5-nano");
    await a.sessions.ask(s.id, "Salut", null);
    const { bytes } = await a.transfer.exportArchive([p.id]);
    const files = await readZip(bytes);
    // rewrite as version 2 (manifest + project file, fingerprints recomputed)
    const names = [...files.keys()].filter((n) => n.endsWith(".json") && n !== MANIFEST_NAME);
    const manifest = JSON.parse(new TextDecoder().decode(files.get(MANIFEST_NAME)!));
    const out: { name: string; data: Uint8Array }[] = [];
    for (const n of names) {
      const pf = JSON.parse(new TextDecoder().decode(files.get(n)!));
      pf.version = 2;
      const data = new TextEncoder().encode(JSON.stringify(pf));
      manifest.projects.find((x: { file: string }) => x.file === n).sha256 = createHash("sha256").update(data).digest("hex");
      out.push({ name: n, data });
    }
    manifest.version = 2;
    const v2 = new Map(files);
    v2.set(MANIFEST_NAME, new TextEncoder().encode(JSON.stringify(manifest)));
    for (const f of out) v2.set(f.name, f.data);
    await expect(parseArchive(v2)).rejects.toMatchObject({ problem: "structure", detail: "chat in an older format" });
    // the same files declared as version 3 are accepted
    manifest.version = 3;
    for (const f of out) {
      const pf = JSON.parse(new TextDecoder().decode(f.data));
      pf.version = 3;
      const data = new TextEncoder().encode(JSON.stringify(pf));
      manifest.projects.find((x: { file: string }) => x.file === f.name).sha256 = createHash("sha256").update(data).digest("hex");
      v2.set(f.name, data);
    }
    v2.set(MANIFEST_NAME, new TextEncoder().encode(JSON.stringify(manifest)));
    await expect(parseArchive(v2)).resolves.toBeTruthy();

  });
});

describe("the shipped Puter.js", () => {
  it("is the unchanged file of @heyputer/puter.js 2.6.5 (fingerprint), with its license notices", () => {
    const root = resolve(__dirname, "../..");
    const js = readFileSync(resolve(root, "vendor/puter/puter.js"));
    expect(createHash("sha256").update(js).digest("hex")).toBe("0e5665b9fd76839e14a56a65dd10c78f43a8d556f51b48a66f67781419d04c2d");
    const lic = readFileSync(resolve(root, "vendor/puter/LICENSES.txt"), "utf8");
    expect(lic).toContain("Apache License");
    expect(lic).toContain("socket.io-client");
    expect(readFileSync(resolve(root, "vite.config.ts"), "utf8")).toContain("0e5665b9fd76839e14a56a65dd10c78f43a8d556f51b48a66f67781419d04c2d");
  });
});
