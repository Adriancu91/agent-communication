// AIW-05: continuity package, reading AI replies back, sessions, accept / reject, archive v2, compatibility.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATEGORIES, type MemoryEntry } from "../../src/core";
import { archiveFiles, parseArchive, readZip, TransferService, MANIFEST_NAME } from "../../src/archive";
import { buildPack, parseReply, SessionStore, type ReviewedProposal } from "../../src/continuity";
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
  const base = new JournaledStore("c-" + Math.random(), tick);
  const d = { base, projects: new ProjectStore(base), memory: new MemoryStore(base), sessions: new SessionStore(base), transfer: new TransferService(base, "t") };
  devs.push(d);
  return d;
}
beforeEach(() => {
  clock = Date.parse("2026-11-07T10:00:00Z");
  localStorage.clear();
});
afterEach(() => devs.splice(0).forEach((d) => d.base.close()));

const SHA = "a".repeat(64);
const date = (iso: string) => iso.slice(0, 10);

/** "Oferta Brăila": one official entry of every type, an open problem, a decision, a pending and a rejected proposal, an archived entry. */
async function project(d: Dev) {
  const p = await d.projects.create("Oferta Brăila", "Ofertă DEEE pentru Brăila");
  const e: Record<string, MemoryEntry> = {};
  for (const c of CATEGORIES) e[c] = await d.memory.create(p.id, { category: c, title: `${c} oficial`, body: `Detalii ${c}`, important: c === "decision" });
  const pending = await d.memory.propose(p.id, { category: "fact", title: "Propunere neconfirmată", source: "ChatGPT" });
  const rejected = await d.memory.propose(p.id, { category: "step", title: "Propunere respinsă" });
  await d.memory.reject(rejected.id);
  const archived = await d.memory.create(p.id, { category: "context", title: "Context arhivat" });
  await d.memory.archive(archived.id);
  return { p, e, pending, rejected, archived };
}

async function packFor(d: Dev, projectId: string, opts: Partial<Parameters<typeof buildPack>[3]> = {}) {
  const [pr, entries, links] = await Promise.all([d.projects.get(projectId), d.memory.list(projectId), d.memory.links(projectId)]);
  return buildPack(pr!, entries, links, { lang: "ro", assistant: "Claude", task: "", history: [], maxChars: 24000, date: "7 nov. 2026", formatDate: date, ...opts });
}

describe("continuity package", () => {
  it("contains the official memory of every type, with short references, the task and the proposals format", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const pack = await packFor(d, p.id, { task: "Pregătește oferta finală." });
    for (const c of CATEGORIES) expect(pack.text).toContain(`${c} oficial`);
    expect(pack.text).toContain("# Pachet de continuitate: Oferta Brăila");
    expect(pack.text).toContain("Ofertă DEEE pentru Brăila");
    expect(pack.text).toContain("## Sarcina pentru această sesiune\nPregătește oferta finală.");
    expect(pack.text).toContain("```aiw-propuneri");
    expect(pack.refs.D1).toBe(e.decision.id);
    expect(pack.refs.P1).toBe(e.issue.id);
    expect(pack.text).toContain("- [D1] ★ decision oficial (important)");
    // the same input gives the same text
    expect((await packFor(d, p.id, { task: "Pregătește oferta finală." })).text).toBe(pack.text);
    // English
    expect((await packFor(d, p.id, { lang: "en" })).text).toContain("```aiw-proposals");
  });

  it("never contains unconfirmed, rejected or archived entries, nor closed items unless asked", async () => {
    const d = dev();
    const { p, e } = await project(d);
    await d.memory.resolveIssue(e.issue.id, { entryId: e.fact.id }, "rezolvat");
    const pack = await packFor(d, p.id);
    expect(pack.text).not.toContain("Propunere neconfirmată");
    expect(pack.text).not.toContain("Propunere respinsă");
    expect(pack.text).not.toContain("Context arhivat");
    expect(pack.text).not.toContain("issue oficial"); // resolved: not an open problem any more
    expect(pack.omitted.map((o) => o.reason).sort()).toEqual(["archived", "closed", "notConfirmed", "notConfirmed"]);
    expect((await packFor(d, p.id, { includeClosed: true })).text).toContain("issue oficial (rezolvată)");
  });

  it("respects the size limit: saved replies go first, then the least important memory", async () => {
    const d = dev();
    const p = await d.projects.create("Mare");
    for (let i = 0; i < 60; i++) await d.memory.create(p.id, { category: CATEGORIES[i % 7], title: `Informația ${i}`, body: "x".repeat(400), important: i < 3 });
    const s = await d.sessions.start(p.id, { provider: "chatgpt" }, { sha256: SHA, chars: 1, refs: {} });
    await d.sessions.applyReply(s.id, "Răspuns lung " + "y".repeat(3000), []);
    const history = await d.sessions.savedReplies(p.id, 3);
    for (const max of [8000, 24000]) {
      const pack = await packFor(d, p.id, { maxChars: max, history });
      expect(pack.text.length).toBeLessThanOrEqual(max);
      expect(pack.stats.chars).toBe(pack.text.length);
      if (max === 8000) {
        expect(pack.historyOmitted).toBe(1); // the saved reply was dropped before memory
        expect(pack.omitted.some((o) => o.reason === "sizeLimit")).toBe(true);
        for (const i of [0, 1, 2]) expect(pack.text).toContain(`Informația ${i}`); // important entries kept longest
      }
    }
    const big = await packFor(d, p.id, { maxChars: 96000, history });
    expect(big.historyIncluded).toBe(1);
    expect(big.text).toContain("Răspuns de la ChatGPT");
  });
});

describe("reading an AI reply", () => {
  const refs = (e: Record<string, MemoryEntry>) => ({ D1: e.decision.id, P1: e.issue.id, F1: e.fact.id });

  it("reads the proposals block (Romanian or English keys, lenient JSON) and resolves the references", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const reply = `Am analizat oferta.

\`\`\`aiw-propuneri
[
  {"tip": "decizie", "titlu": "Preț 4,5 lei/kg", "text": "Cuprul a crescut", "inlocuieste": "D1", "motiv": "piață"},
  {"type": "step", "title": "Trimite oferta luni"},
  {"tip": "informație", "titlu": "Clientul are certificat", "rezolva": "P1"},
  {"tip": "pas", "titlu": "step oficial"},
  {"tip": "necunoscut", "titlu": "ignorat"},
]
\`\`\``;
    const r = parseReply(reply, refs(e), await d.memory.list(p.id));
    expect(r.found).toBe("block");
    expect(r.proposals.map((x) => [x.category, x.title, x.match])).toEqual([
      ["decision", "Preț 4,5 lei/kg", "new"], ["step", "Trimite oferta luni", "new"], ["fact", "Clientul are certificat", "new"], ["step", "step oficial", "duplicate"],
    ]);
    expect(r.proposals[0]).toMatchObject({ replaces: e.decision.id, reason: "piață", body: "Cuprul a crescut" });
    // a replacement that resembles the decision it replaces is expected, not flagged as "similar"
    const same = parseReply('```aiw-propuneri\n[{"tip":"decizie","titlu":"decision oficial nou","inlocuieste":"D1"}]\n```', refs(e), await d.memory.list(p.id));
    expect(same.proposals[0]).toMatchObject({ match: "new", replaces: e.decision.id });
    const without = parseReply('```aiw-propuneri\n[{"tip":"decizie","titlu":"decision oficial nou"}]\n```', refs(e), await d.memory.list(p.id));
    expect(without.proposals[0]).toMatchObject({ match: "similar", similarTo: e.decision.id });
    expect(r.proposals[2].resolves).toBe(e.issue.id);
    expect(r.proposals[3].similarTo).toBe(e.step.id);
  });

  it("falls back to sections the AI wrote on its own; flags unknown references and invalid relations", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const reply = `Iată rezumatul.

**Decizii:**
- Livrăm cu camionul propriu
- Preț fix pentru 3 luni

## Next steps
1. Sună clientul
2. [ ] Pregătește contractul

Alte gânduri:
- nu e o propunere`;
    const r = parseReply(reply, refs(e), await d.memory.list(p.id));
    expect(r.found).toBe("sections");
    expect(r.proposals.map((x) => [x.category, x.title])).toEqual([
      ["decision", "Livrăm cu camionul propriu"], ["decision", "Preț fix pentru 3 luni"], ["step", "Sună clientul"], ["step", "Pregătește contractul"],
    ]);
    const bad = parseReply('```aiw-proposals\n[{"type":"fact","title":"X","replaces":"D1"},{"type":"decision","title":"Y","replaces":"D9"}]\n```', refs(e), await d.memory.list(p.id));
    expect(bad.proposals[0].notes).toContain("replacesNotDecision");
    expect(bad.proposals[1].notes).toContain("unknownRef");
    const broken = parseReply("```aiw-propuneri\n[{nu e json\n```\n**Pași următori:**\n- Pas din text", {}, []);
    expect(broken.blockInvalid).toBe(true);
    expect(broken.proposals.map((x) => x.title)).toEqual(["Pas din text"]);
    expect(parseReply("Doar text, fără propuneri.", {}, []).found).toBe("none");
  });

  it("cuts titles that are too long into title + text, and finds similar entries", async () => {
    const d = dev();
    const { p } = await project(d);
    const long = "Aceasta este o propoziție foarte lungă despre ofertă. " + "cuvânt ".repeat(40);
    const r = parseReply(`**Informații:**\n- ${long}\n- decision oficial nouă`, {}, await d.memory.list(p.id));
    expect([...r.proposals[0].title].length).toBeLessThanOrEqual(120);
    expect(r.proposals[0].notes).toContain("titleCut");
    expect(r.proposals[0].body).toContain("cuvânt");
  });
});

describe("sessions: accept, reject, later; the official memory changes only on acceptance", () => {
  it("applies the user's decisions in one transaction, with relations, provenance and history", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const s = await d.sessions.start(p.id, { provider: "chatgpt", task: "Revizuiește oferta" }, { sha256: SHA, chars: 100, refs: { D1: e.decision.id } });
    const items: ReviewedProposal[] = [
      { category: "decision", title: "Preț nou", body: "", important: true, replaces: e.decision.id, resolves: null, reason: "piață", verdict: "accept" },
      { category: "fact", title: "Certificat primit", body: "", important: false, replaces: null, resolves: e.issue.id, reason: "", verdict: "accept" },
      { category: "step", title: "Pas respins", body: "", important: false, replaces: null, resolves: null, reason: "", verdict: "reject" },
      { category: "goal", title: "De decis mai târziu", body: "", important: false, replaces: null, resolves: null, reason: "", verdict: "later" },
      { category: "context", title: "Textul meu", body: "corectat", important: false, original: { title: "Textul AI", body: "greșit" }, replaces: null, resolves: null, reason: "", verdict: "accept" },
    ];
    const { exchange, entries } = await d.sessions.applyReply(s.id, "Răspunsul complet al AI-ului", items);
    expect(exchange.proposals).toEqual(entries.map((x) => x.id));
    const by = (t: string) => entries.find((x) => x.title === t)!;
    expect(by("Preț nou")).toMatchObject({ confirmation: "confirmed", author: "ai", source: "ChatGPT · 2026-11-07" });
    expect(by("Pas respins")).toMatchObject({ confirmation: "rejected", archived: true });
    expect(by("De decis mai târziu")).toMatchObject({ confirmation: "pending", archived: false });
    expect(await d.memory.get(e.decision.id)).toMatchObject({ status: "replaced" });
    expect(await d.memory.get(e.issue.id)).toMatchObject({ status: "resolved" });
    expect((await d.memory.history(by("Textul meu").id)).map((v) => [v.version, v.title])).toEqual([[1, "Textul AI"], [2, "Textul meu"]]);
    // only accepted ones are in the next package
    const pack = await packFor(d, p.id);
    expect(pack.text).toContain("Preț nou");
    expect(pack.text).not.toContain("Pas respins");
    expect(pack.text).not.toContain("De decis mai târziu");
    expect(pack.text).toContain("propusă de AI (ChatGPT · 2026-11-07), confirmată de utilizator");
    // everything is consistent and in the history
    expect((await d.memory.verify(p.id)).ok).toBe(true);
    const journal = await d.base.journal();
    expect(journal.filter((x) => x.type === "memory.rejected").length).toBe(2); // the earlier one + this one
    expect((await d.sessions.exchanges(s.id)).map((x) => x.kind)).toEqual(["sent", "reply"]);
  });

  it("refuses an impossible set of decisions and writes nothing", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const s = await d.sessions.start(p.id, { provider: "claude" }, { sha256: SHA, chars: 1, refs: {} });
    const before = await d.base.journal();
    const twice: ReviewedProposal[] = [1, 2].map((n) => ({ category: "decision", title: `Înlocuire ${n}`, body: "", important: false, replaces: e.decision.id, resolves: null, reason: "", verdict: "accept" }));
    await expect(d.sessions.applyReply(s.id, "răspuns", twice)).rejects.toMatchObject({ reason: "invalid" });
    expect(await d.base.journal()).toEqual(before);
    await expect(d.sessions.applyReply(s.id, "", [])).rejects.toMatchObject({ reason: "textEmpty" });
    await d.sessions.close(s.id);
    await expect(d.sessions.applyReply(s.id, "după închidere", [])).rejects.toMatchObject({ reason: "closed" });
  });

  it("moves the work from ChatGPT to Claude: the second package carries the accepted result and the saved reply", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const first = await d.sessions.start(p.id, { provider: "chatgpt", task: "Calculează prețul" }, { sha256: SHA, chars: 1, refs: { D1: e.decision.id } });
    const reply = '```aiw-propuneri\n[{"tip":"decizie","titlu":"Preț 4,5 lei/kg","inlocuieste":"D1","motiv":"piață"},{"tip":"pas","titlu":"Pas inutil"}]\n```';
    const parsed = parseReply(reply, { D1: e.decision.id }, await d.memory.list(p.id));
    await d.sessions.applyReply(first.id, reply, parsed.proposals.map((x) => ({ ...x, verdict: x.title === "Pas inutil" ? "reject" : "accept" })));
    await d.sessions.close(first.id);

    const history = await d.sessions.savedReplies(p.id, 1);
    const pack = await packFor(d, p.id, { assistant: "Claude", task: "Scrie oferta", history });
    expect(pack.text).toContain("Pregătit de AI Workspace pe 7 nov. 2026 pentru Claude.");
    expect(pack.text).toContain("Preț 4,5 lei/kg");
    expect(pack.text).not.toContain("decision oficial"); // replaced → not in the current context
    expect(pack.text).not.toContain("- [S2] Pas inutil");
    expect(pack.text).toContain("### Răspuns de la ChatGPT");
    const second = await d.sessions.start(p.id, { provider: "claude", task: "Scrie oferta", continues: first.id }, { sha256: SHA, chars: pack.text.length, refs: pack.refs });
    expect(second.continues).toBe(first.id);
    expect((await d.sessions.list(p.id)).map((x) => x.provider)).toEqual(["claude", "chatgpt"]);
    expect((await d.memory.verify(p.id)).ok).toBe(true);
  });

  it("checks the session inputs", async () => {
    const d = dev();
    const { p } = await project(d);
    await expect(d.sessions.start(p.id, { provider: "other" }, { sha256: SHA, chars: 1, refs: {} })).rejects.toMatchObject({ reason: "providerName" });
    const s = await d.sessions.start(p.id, { provider: "other", providerName: "Mistral" }, { sha256: SHA, chars: 1, refs: {} });
    expect(s.providerName).toBe("Mistral");
    await expect(d.sessions.start(p.id, { provider: "claude", task: "x".repeat(5000) }, { sha256: SHA, chars: 1, refs: {} })).rejects.toMatchObject({ reason: "taskLong" });
    await d.projects.trash(p.id);
    await expect(d.sessions.addNote(s.id, "notă")).rejects.toMatchObject({ reason: "project" });
  });
});

describe("archive version 2 and compatibility", () => {
  async function withSessions(d: Dev) {
    const r = await project(d);
    const s1 = await d.sessions.start(r.p.id, { provider: "chatgpt", task: "T1" }, { sha256: SHA, chars: 10, refs: { D1: r.e.decision.id } });
    await d.sessions.applyReply(s1.id, "răspuns 1", [
      { category: "decision", title: "Nouă", body: "", important: false, replaces: r.e.decision.id, resolves: null, reason: "m", verdict: "accept" },
      { category: "step", title: "Respinsă", body: "", important: false, replaces: null, resolves: null, reason: "", verdict: "reject" },
    ]);
    await d.sessions.addNote(s1.id, "notă");
    await d.sessions.close(s1.id);
    await d.sessions.start(r.p.id, { provider: "other", providerName: "Mistral", continues: s1.id }, { sha256: SHA, chars: 10, refs: { D1: r.e.decision.id } });
    return r;
  }
  const snap = async (d: Dev, id: string) => {
    const sessions = await d.sessions.list(id);
    return { sessions, steps: await Promise.all(sessions.map((s) => d.sessions.exchanges(s.id))), memory: (await d.memory.list(id)).length };
  };

  it("exports and imports projects with their sessions (add and copy), consistently", async () => {
    const a = dev();
    const { p } = await withSessions(a);
    const { bytes } = await a.transfer.exportArchive([p.id]);
    const b = dev();
    const pv = await b.transfer.preview(bytes);
    expect(pv.projects[0].counts).toMatchObject({ sessions: 2, replies: 1 });
    await b.transfer.importArchive(pv);
    expect(await snap(b, p.id)).toEqual(await snap(a, p.id));
    expect((await b.memory.verify(p.id)).ok).toBe(true);
    // a copy remaps sessions, steps, proposals and references
    const res = await b.transfer.importArchive(await b.transfer.preview(bytes), { [p.id]: "copy" });
    const copyId = res.imported[0].id;
    const cs = await b.sessions.list(copyId);
    expect(cs).toHaveLength(2);
    const copyEntries = new Set((await b.memory.list(copyId)).map((x) => x.id));
    const steps = (await Promise.all(cs.map((s) => b.sessions.exchanges(s.id)))).flat();
    for (const x of steps) {
      for (const pid of x.proposals) expect(copyEntries.has(pid)).toBe(true);
      for (const v of Object.values(x.pack?.refs ?? {})) expect(copyEntries.has(v)).toBe(true);
    }
    expect(cs.find((s) => s.continues)!.continues).toBe(cs.find((s) => !s.continues)!.id);
    // and the copy exports again
    const c = dev();
    await c.transfer.importArchive(await c.transfer.preview((await b.transfer.exportArchive([copyId])).bytes));
    expect((await c.memory.verify(copyId)).ok).toBe(true);
  });

  it("still reads version 1 archives (AIW-04) and refuses sessions that do not match their history", async () => {
    const a = dev();
    const { p } = await project(a);
    const map = await readZip((await a.transfer.exportArchive([p.id])).bytes);
    const file = `projects/${p.id}.json`;
    const pf = JSON.parse(new TextDecoder().decode(map.get(file)!));
    // a version 1 file, as AIW-04 wrote it: no sessions
    const v1 = { format: "aiw-project", version: 1, project: pf.project, memory: pf.memory, links: pf.links, events: pf.events };
    const v1bytes = new TextEncoder().encode(JSON.stringify(v1));
    const manifest = JSON.parse(new TextDecoder().decode(map.get(MANIFEST_NAME)!));
    manifest.version = 1;
    manifest.projects[0].sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", v1bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const parsed = await parseArchive(new Map([[MANIFEST_NAME, new TextEncoder().encode(JSON.stringify(manifest))], [file, v1bytes]]));
    expect(parsed.projects[0]).toMatchObject({ version: 1, sessions: [], exchanges: [] });

    const d = dev();
    const r = await withSessions(d);
    const m2 = await readZip((await d.transfer.exportArchive([r.p.id])).bytes);
    const f2 = JSON.parse(new TextDecoder().decode(m2.get(`projects/${r.p.id}.json`)!));
    f2.sessions[0].task = "schimbat fără istoric";
    const rebuilt = new Map((await archiveFiles([f2], { app: "x", exportedAt: "2026-11-07T10:00:00.000Z", scope: "project", sourceJournal: { ok: true, events: 1 } })).map((f) => [f.name, f.data]));
    await expect(parseArchive(rebuilt)).rejects.toMatchObject({ problem: "inconsistent" });
  });

  it("a definitive project delete also removes its sessions and erases their texts", async () => {
    const d = dev();
    const { p } = await withSessions(d);
    await d.projects.trash(p.id);
    await d.projects.purge(p.id);
    expect(await d.sessions.list(p.id)).toEqual([]);
    const left = (await d.base.journal()).filter((x) => x.projectId === p.id && x.type.startsWith("session.") && x.data !== null);
    expect(left).toEqual([]);
    expect((await d.base.verify()).ok).toBe(true);
  });
});

describe("review 2 findings (AIW-05)", () => {
  const SEAL = { app: "x", exportedAt: "2026-11-07T10:00:00.000Z", scope: "project" as const, sourceJournal: { ok: true, events: 1 } };

  it("invisible control / direction characters from an AI reply never make an export unreadable", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const s = await d.sessions.start(p.id, { provider: "claude" }, { sha256: SHA, chars: 1, refs: { D1: e.decision.id } });
    const reply = '```aiw-propuneri\n[{"tip":"decizie","titlu":"Preț‮ nou\u0007","text":"te⁦xt","inlocuieste":"D1","motiv":"pe\u0007ste ‮citit"}]\n```\nrăspuns\u0007';
    const parsed = parseReply(reply, { D1: e.decision.id }, await d.memory.list(p.id));
    expect(parsed.proposals[0]).toMatchObject({ title: "Preț nou", body: "text", reason: "peste citit" });
    await d.sessions.applyReply(s.id, reply, parsed.proposals.map((x) => ({ ...x, verdict: "accept" as const })));
    // a reason typed by hand with such characters (AIW-03 link) is cleaned too
    await d.memory.link(e.goal.id, e.fact.id, "related_to", "manual\u0007‮");
    const b = dev();
    await b.transfer.importArchive(await b.transfer.preview((await d.transfer.exportArchive([p.id])).bytes));
    expect((await b.memory.verify(p.id)).ok).toBe(true);
    const x = (await b.sessions.exchanges(s.id)).find((z) => z.kind === "reply")!;
    expect(x.text).not.toMatch(/[\u0007‮]/);
    // a name typed for "other" with such characters is refused, with a clear reason
    await expect(d.sessions.start(p.id, { provider: "other", providerName: "Mis‮tral" }, { sha256: SHA, chars: 1, refs: {} })).rejects.toMatchObject({ reason: "chars" });
  });

  it("saved replies enter the package without their proposals block (rejected or pending items stay out)", async () => {
    const d = dev();
    const { p } = await project(d);
    const s = await d.sessions.start(p.id, { provider: "chatgpt" }, { sha256: SHA, chars: 1, refs: {} });
    const reply = 'Analiza mea.\n\n```aiw-propuneri\n[{"tip":"pas","titlu":"SECRET RESPINS"},{"tip":"pas","titlu":"SECRET AMANAT"}]\n```\nFinal.';
    const parsed = parseReply(reply, {}, await d.memory.list(p.id));
    await d.sessions.applyReply(s.id, reply, parsed.proposals.map((x, i) => ({ ...x, verdict: i === 0 ? "reject" as const : "later" as const })));
    const pack = await packFor(d, p.id, { history: await d.sessions.savedReplies(p.id, 3) });
    expect(pack.text).toContain("Analiza mea.");
    expect(pack.text).toContain("Final.");
    expect(pack.text).not.toContain("SECRET RESPINS");
    expect(pack.text).not.toContain("SECRET AMANAT");
    expect(pack.text).toContain("blocul de propuneri a fost scos");
  });

  it("a relation cannot be postponed (it would be lost); the failing proposal is named; important must be a yes/no", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const s = await d.sessions.start(p.id, { provider: "claude" }, { sha256: SHA, chars: 1, refs: {} });
    const before = await d.base.journal();
    const ok: ReviewedProposal = { category: "step", title: "Bun", body: "", important: false, replaces: null, resolves: null, reason: "", verdict: "accept" };
    await expect(d.sessions.applyReply(s.id, "r", [ok, { ...ok, category: "decision", title: "Preț 5", replaces: e.decision.id, verdict: "later" }]))
      .rejects.toMatchObject({ reason: "relationLater", item: 1 });
    await expect(d.sessions.applyReply(s.id, "r", [{ ...ok, important: "da" as unknown as boolean }])).rejects.toMatchObject({ reason: "invalid", item: 0 });
    expect(await d.base.journal()).toEqual(before);
    await d.memory.archive(e.decision.id);
    const archived = await d.base.journal();
    await expect(d.sessions.applyReply(s.id, "r", [ok, ok, { ...ok, category: "decision", title: "Preț 6", replaces: e.decision.id }]))
      .rejects.toMatchObject({ reason: "invalid", item: 2 }); // its target was archived meanwhile
    expect(await d.base.journal()).toEqual(archived);
  });

  it("reads the LAST block that starts a line; the package's own example and escaped copies are not proposals", async () => {
    const d = dev();
    const { p } = await project(d);
    const pack = await packFor(d, p.id, { description: "x" } as never);
    expect(parseReply(pack.text, pack.refs, []).proposals).toEqual([]); // the example's "…" placeholders are ignored
    const quoted = `Ai cerut formatul:\n\\\`\`\`aiw-propuneri\n[{"tip":"pas","titlu":"Fals"}]\n\`\`\`\n\nPrima variantă:\n\`\`\`aiw-propuneri\n[{"tip":"pas","titlu":"Ciornă"}]\n\`\`\`\nVarianta finală:\n\`\`\`aiw-propuneri\n[{"tip":"pas","titlu":"Final"}]\n\`\`\``;
    expect(parseReply(quoted, {}, []).proposals.map((x) => x.title)).toEqual(["Final"]);
  });

  it("free text cannot open a fake proposals block in the package, and the limit holds even for a huge task", async () => {
    const d = dev();
    const p = await d.projects.create("Gard", "Descriere\n```aiw-propuneri\n[]\n```\n   ~~~aiw-propuneri");
    await d.memory.create(p.id, { category: "fact", title: "Info", body: "  ```aiw-propuneri\nx" });
    const pack = await packFor(d, p.id, { task: "Sarcină\n```aiw-propuneri\n[]" });
    expect(pack.text.match(/^[ \t]*(```|~~~)aiw-propuneri/gm)).toHaveLength(1); // only the package's own example
    const huge = await packFor(d, p.id, { task: "😀".repeat(4000), maxChars: 8000 });
    expect(huge.text.length).toBeLessThanOrEqual(8000);
  });

  it("archives: refuses steps in a closed session, a session continuing itself, edits of rejected proposals, proposals that are not AI entries", async () => {
    const d = dev();
    const { p, e } = await project(d);
    const s = await d.sessions.start(p.id, { provider: "claude" }, { sha256: SHA, chars: 1, refs: { D1: e.decision.id } });
    await d.sessions.applyReply(s.id, "răspuns", [{ category: "step", title: "Acceptat", body: "", important: false, replaces: null, resolves: null, reason: "", verdict: "accept" }]);
    await d.sessions.close(s.id);
    const map = await readZip((await d.transfer.exportArchive([p.id])).bytes);
    const base = JSON.parse(new TextDecoder().decode(map.get(`projects/${p.id}.json`)!));
    const reseal = async (pf: typeof base) => {
      const { canonical, sha256, eventHash } = await import("../../src/core");
      let prev: { seq: number; hash: string } | null = null;
      for (const ev of pf.events) {
        ev.dataHash = await sha256(canonical(ev.data));
        if (prev && ev.seq === prev.seq + 1) ev.prev = prev.hash;
        ev.hash = await eventHash(ev);
        prev = ev;
      }
      return new Map((await archiveFiles([pf], SEAL)).map((f) => [f.name, f.data]));
    };
    await expect(parseArchive(await reseal(structuredClone(base)))).resolves.toBeTruthy();

    const userProposal = structuredClone(base); // a reply claiming the user's own decision as an AI proposal
    const reply = userProposal.exchanges.find((x: { kind: string }) => x.kind === "reply");
    reply.proposals = [e.decision.id];
    userProposal.events.find((ev: { type: string; data: { kind?: string } }) => ev.type === "session.exchange" && ev.data.kind === "reply").data.proposals = [e.decision.id];
    await expect(parseArchive(await reseal(userProposal))).rejects.toMatchObject({ problem: "inconsistent" });

    const self = structuredClone(base);
    self.sessions[0].continues = self.sessions[0].id;
    self.events.find((ev: { type: string }) => ev.type === "session.created").data.continues = self.sessions[0].id;
    await expect(parseArchive(await reseal(self))).rejects.toBeTruthy();

    const late = structuredClone(base); // move the "closed" event before the reply
    const iClose = late.events.findIndex((ev: { type: string }) => ev.type === "session.closed");
    const iReply = late.events.findIndex((ev: { type: string; data: { kind?: string } }) => ev.type === "session.exchange" && ev.data.kind === "reply");
    const [closeEv] = late.events.splice(iClose, 1);
    late.events.splice(iReply, 0, closeEv);
    late.events.forEach((ev: { seq: number }, i: number) => (ev.seq = i + 1));
    await expect(parseArchive(await reseal(late))).rejects.toMatchObject({ problem: "inconsistent" });
  });
});
