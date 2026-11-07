// AIW-03: project memory — data, migration, isolation, versions, provenance, relationships, integrity, search, context.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATEGORIES, searchMemory, type MemoryEntry } from "../../src/core";
import { buildContext, LinkError, MemoryStore, MemoryValidationError, serializeContext } from "../../src/memory";
import { ProjectStore } from "../../src/projects";
import { JournaledStore, MIGRATIONS, openDb, req } from "../../src/storage";
import { ProjectStore as Aiw02ProjectStore } from "../fixtures/aiw02/src/projects";

let base: JournaledStore;
let projects: ProjectStore;
let memory: MemoryStore;
let clock = 0;
let dbName = "";
const tick = () => new Date((clock += 1000));

beforeEach(() => {
  clock = Date.parse("2026-11-07T10:00:00Z");
  dbName = "mem-" + Math.random();
  localStorage.clear();
  base = new JournaledStore(dbName, tick);
  projects = new ProjectStore(base);
  memory = new MemoryStore(base);
});
afterEach(() => base.close());

/** Raw access to the database, to simulate tampering or inspect records. */
async function raw<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await openDb(dbName);
  try {
    const tx = db.transaction(stores, mode);
    const out = await fn(tx);
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
    return out;
  } finally {
    db.close();
  }
}

// localStorage is used for the checkpoint; provide a minimal one in Node.
if (typeof globalThis.localStorage === "undefined") {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

describe("data and migration", () => {
  it("a fresh database has the memory schema and verifies", async () => {
    const db = await openDb(dbName);
    // AIW-05 added "sessions" and "exchanges" (migration 3); the AIW-03 stores are unchanged
    expect([...db.objectStoreNames].sort()).toEqual(["events", "exchanges", "links", "memory", "meta", "projects", "sessions"]);
    expect(db.version).toBe(MIGRATIONS.length);
    expect([...db.transaction("events").objectStore("events").indexNames].sort()).toEqual(["entityId", "projectId"]);
    db.close();
    expect((await base.verify()).ok).toBe(true);
  });

  it("an AIW-02 database (created by the real AIW-02 code) migrates without losing anything", async () => {
    const old = new Aiw02ProjectStore(dbName, tick);
    const a = await old.create("Ofertă Brăila", "lot DEEE");
    await old.rename(a.id, "Ofertă Brăila v2");
    await old.setPinned(a.id, true);
    const b = await old.create("Șantier Iași 🏗️");
    await old.trash(b.id);
    const c = await old.create("De șters");
    await old.trash(c.id);
    await old.purge(c.id);
    const beforeProjects = await old.list();
    const beforeEvents = await old.journal();
    old.close();

    const after = new ProjectStore(new JournaledStore(dbName, tick));
    const db = await openDb(dbName);
    expect(db.version).toBe(MIGRATIONS.length); // AIW-03: 2; AIW-05: 3 (the AIW-02 database goes through every step)
    db.close();
    expect(await after.list()).toEqual(beforeProjects); // names, descriptions, pins, dates, trash, name history
    expect(await after.journal()).toEqual(beforeEvents);
    expect(await after.verify()).toMatchObject({ ok: true, events: beforeEvents.length, erased: 2 }); // created + trashed of the purged project
    const m = new MemoryStore(after.base);
    const e = await m.create(a.id, { category: "goal", title: "Primul obiectiv după migrare" });
    expect((await m.list(a.id)).map((x) => x.id)).toEqual([e.id]);
    expect((await after.base.verify()).ok).toBe(true);
    after.close();
  });

  it("a failed migration leaves the database at its old version with all data", async () => {
    const old = new Aiw02ProjectStore(dbName, tick);
    await old.create("Rămâne intact");
    old.close();
    const broken = [...MIGRATIONS.slice(0, 1), () => { throw new Error("simulated failure"); }];
    await expect(openDb(dbName, broken)).rejects.toMatchObject({ kind: "unknown" });
    const v1 = await openDb(dbName, MIGRATIONS.slice(0, 1));
    expect(v1.version).toBe(1);
    expect([...v1.objectStoreNames]).not.toContain("memory");
    const list = await req(v1.transaction("projects").objectStore("projects").getAll());
    expect(list.map((p: { name: string }) => p.name)).toEqual(["Rămâne intact"]);
    v1.close();
    const p = new ProjectStore(new JournaledStore(dbName, tick)); // the real migration then succeeds
    expect((await p.list()).map((x) => x.name)).toEqual(["Rămâne intact"]);
    p.close();
  });

  it("a write that fails half-way leaves no partial entry or version", async () => {
    const p = await projects.create("P");
    const e = await memory.create(p.id, { category: "fact", title: "Original" });
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
      if (this.name === "events") throw new DOMException("full", "QuotaExceededError");
      return add.apply(this, args);
    };
    try {
      await expect(memory.create(p.id, { category: "fact", title: "Nou" })).rejects.toMatchObject({ kind: "quota" });
      await expect(memory.edit(e.id, { title: "Schimbat", body: "" })).rejects.toMatchObject({ kind: "quota" });
    } finally {
      IDBObjectStore.prototype.add = add;
    }
    const list = await memory.list(p.id);
    expect(list.map((x) => [x.title, x.version])).toEqual([["Original", 1]]);
    expect((await memory.history(e.id)).length).toBe(1);
    expect((await memory.verify(p.id)).ok).toBe(true);
  });

  it("two tabs writing at the same time cannot corrupt the journal", async () => {
    const p = await projects.create("P");
    const tab2 = new JournaledStore(dbName, tick);
    const m2 = new MemoryStore(tab2);
    const writes = Array.from({ length: 15 }, (_, i) => (i % 2 ? memory : m2).create(p.id, { category: "fact", title: `F${i}` }));
    const results = await Promise.allSettled(writes);
    // a write may be refused with a clear "conflict" (and be retried by the user); none may half-succeed
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ kind: "conflict" });
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect((await memory.list(p.id)).length).toBe(ok);
    expect(await memory.verify(p.id)).toMatchObject({ ok: true, inconsistencies: [] });
    tab2.close();
  });
});

describe("project isolation", () => {
  it("entries, search, links and context never cross projects", async () => {
    const a = await projects.create("A");
    const b = await projects.create("B");
    const ea = await memory.create(a.id, { category: "fact", title: "Secretul lui A" });
    const eb = await memory.create(b.id, { category: "fact", title: "Secretul lui B" });
    expect((await memory.list(a.id)).map((e) => e.id)).toEqual([ea.id]);
    const all = [...(await memory.list(a.id)), ...(await memory.list(b.id))];
    expect(searchMemory(a.id, all, "secretul").map((h) => h.entry.id)).toEqual([ea.id]);
    await expect(memory.link(ea.id, eb.id, "related_to")).rejects.toMatchObject({ reason: "crossProject" });
    const ctx = buildContext(a, all, []);
    expect(JSON.stringify(ctx)).not.toContain("Secretul lui B");
  });

  it("no memory can be added to a project in the trash or a missing project", async () => {
    const a = await projects.create("A");
    await projects.trash(a.id);
    await expect(memory.create(a.id, { category: "goal", title: "x" })).rejects.toMatchObject({ kind: "conflict" });
    await expect(memory.create("P-nope", { category: "goal", title: "x" })).rejects.toMatchObject({ kind: "conflict" });
  });

  it("deleting a project permanently removes its memory, links and their texts from the journal", async () => {
    const a = await projects.create("A");
    const keep = await projects.create("B");
    const g = await memory.create(a.id, { category: "goal", title: "Obiectiv secret", body: "text privat" });
    const d = await memory.create(a.id, { category: "decision", title: "Decizie" });
    await memory.link(d.id, g.id, "derived_from", "motiv privat");
    const k = await memory.create(keep.id, { category: "fact", title: "Rămâne" });
    await projects.trash(a.id);
    await projects.purge(a.id);
    expect(await memory.list(a.id)).toEqual([]);
    expect(await memory.links(a.id)).toEqual([]);
    expect(JSON.stringify(await base.journal())).not.toMatch(/secret|privat|Decizie/);
    expect((await memory.list(keep.id)).map((e) => e.id)).toEqual([k.id]);
    expect(await memory.verify(keep.id)).toMatchObject({ ok: true });
  });
});

describe("entries and versions", () => {
  it("creates an entry in each of the seven categories, user-authored and confirmed", async () => {
    const p = await projects.create("P");
    for (const c of CATEGORIES) await memory.create(p.id, { category: c, title: `Titlu ${c}`, body: "rând 1\nrând 2" });
    const list = await memory.list(p.id);
    expect(list.map((e) => e.category).sort()).toEqual([...CATEGORIES].sort());
    for (const e of list) expect(e).toMatchObject({ author: "user", confirmation: "confirmed", source: null, status: "active", archived: false, version: 1 });
    expect(list[0].body).toBe("rând 1\nrând 2");
  });

  it("rejects invalid input", async () => {
    const p = await projects.create("P");
    await expect(memory.create(p.id, { category: "nope" as never, title: "x" })).rejects.toBeInstanceOf(MemoryValidationError);
    await expect(memory.create(p.id, { category: "fact", title: "  " })).rejects.toMatchObject({ field: "title", reason: "empty" });
    await expect(memory.create(p.id, { category: "fact", title: "x".repeat(121) })).rejects.toMatchObject({ reason: "tooLong" });
    await expect(memory.create(p.id, { category: "fact", title: "x", body: "y".repeat(20_001) })).rejects.toMatchObject({ field: "body" });
    await expect(memory.archive("not-an-id")).rejects.toMatchObject({ kind: "conflict" });
    expect(await memory.list(p.id)).toEqual([]);
  });

  it("editing appends a version and keeps the old one; same text changes nothing", async () => {
    const p = await projects.create("P");
    const e = await memory.create(p.id, { category: "instruction", title: "Regula 1", body: "Scrie în română." });
    await memory.edit(e.id, { title: "Regula 1", body: "Scrie în română, simplu." });
    const now = await memory.edit(e.id, { title: "Regula 1 (actualizată)", body: "Scrie în română, simplu." });
    expect(now.version).toBe(3);
    const h = await memory.history(e.id);
    expect(h.map((v) => [v.version, v.body, v.current])).toEqual([
      [1, "Scrie în română.", false], [2, "Scrie în română, simplu.", false], [3, "Scrie în română, simplu.", true],
    ]);
    await memory.edit(e.id, { title: "Regula 1 (actualizată)", body: "Scrie în română, simplu." });
    expect((await memory.history(e.id)).length).toBe(3);
  });

  it("importance persists; archive and restore; cancelled actions change nothing", async () => {
    const p = await projects.create("P");
    const e = await memory.create(p.id, { category: "fact", title: "F" });
    await memory.setImportant(e.id, true);
    const fresh = new MemoryStore(new JournaledStore(dbName, tick));
    expect((await fresh.get(e.id))!.important).toBe(true);
    await memory.archive(e.id);
    expect(searchMemory(p.id, await memory.list(p.id), "").length).toBe(0);
    expect(searchMemory(p.id, await memory.list(p.id), "", { archived: true }).length).toBe(1);
    const r = await memory.restore(e.id);
    expect(r).toMatchObject({ archived: false, important: true, status: "active" });
    const before = await base.journal();
    await memory.setImportant(e.id, true); // nothing to change
    expect((await base.journal()).length).toBe(before.length);
    fresh.base.close();
  });

  it("permanent delete only from the archive; removes links, restores statuses, erases texts", async () => {
    const p = await projects.create("P");
    const old = await memory.create(p.id, { category: "decision", title: "Decizia veche" });
    const { entry: neu } = await memory.replaceDecision(old.id, { title: "Decizia nouă cu text privat" }, "motiv privat");
    await expect(memory.purge(neu.id)).rejects.toMatchObject({ kind: "conflict" });
    expect((await memory.get(old.id))!.status).toBe("replaced");
    await memory.archive(neu.id);
    await memory.purge(neu.id);
    expect(await memory.get(neu.id)).toBeUndefined();
    expect(await memory.links(p.id)).toEqual([]);
    expect((await memory.get(old.id))!.status).toBe("active"); // nothing points to a missing entry
    expect(JSON.stringify(await base.journal())).not.toMatch(/text privat|motiv privat/);
    expect(await memory.verify(p.id)).toMatchObject({ ok: true, inconsistencies: [] });
  });
});

describe("provenance and AI proposals", () => {
  it("a proposal stays pending, outside official memory, search and context, until confirmed", async () => {
    const p = await projects.create("P");
    const prop = await memory.propose(p.id, { category: "fact", title: "Propunere AI", source: "conversația din 7 nov. (ChatGPT)" });
    expect(prop).toMatchObject({ author: "ai", confirmation: "pending", confirmedAt: null, source: "conversația din 7 nov. (ChatGPT)" });
    const list = await memory.list(p.id);
    expect(searchMemory(p.id, list, "propunere")).toEqual([]);
    expect(buildContext(p, list, []).payload.sections).toEqual([]);
    expect(buildContext(p, list, []).omitted).toEqual([expect.objectContaining({ id: prop.id, reason: "notConfirmed" })]);
    const user = await memory.create(p.id, { category: "fact", title: "F" });
    await expect(memory.link(prop.id, user.id, "related_to")).rejects.toMatchObject({ reason: "notAllowed" });
    const ok = await memory.confirm(prop.id);
    expect(ok.confirmation).toBe("confirmed");
    expect(ok.confirmedAt).not.toBeNull();
    expect(ok.author).toBe("ai"); // provenance is kept after confirmation
    expect(buildContext(p, await memory.list(p.id), []).payload.sections[0].items[0]).toMatchObject({ id: prop.id, author: "ai" });
  });

  it("a rejected proposal is never promoted silently and cannot be restored to memory", async () => {
    const p = await projects.create("P");
    const prop = await memory.propose(p.id, { category: "goal", title: "Respins" });
    const r = await memory.reject(prop.id);
    expect(r).toMatchObject({ confirmation: "rejected", archived: true });
    await expect(memory.confirm(prop.id)).rejects.toMatchObject({ kind: "conflict" });
    expect((await memory.restore(prop.id)).archived).toBe(true);
    expect(buildContext(p, await memory.list(p.id), []).payload.sections).toEqual([]);
    await memory.purge(prop.id); // can be deleted from the archive
    expect(await memory.list(p.id)).toEqual([]);
  });

  it("a user entry has no invented source; timestamps persist", async () => {
    const p = await projects.create("P");
    const e = await memory.create(p.id, { category: "fact", title: "F" });
    const again = await new MemoryStore(new JournaledStore(dbName, tick)).get(e.id);
    expect(again).toMatchObject({ source: null, createdAt: e.createdAt, updatedAt: e.updatedAt, confirmedAt: e.createdAt });
  });
});

describe("relationships", () => {
  async function setup() {
    const p = await projects.create("P");
    const mk = (category: MemoryEntry["category"], title: string) => memory.create(p.id, { category, title });
    return { p, goal: await mk("goal", "Obiectiv"), d1: await mk("decision", "D1"), d2: await mk("decision", "D2"), issue: await mk("issue", "Problemă"), step: await mk("step", "Pas"), fact: await mk("fact", "Fapt") };
  }

  it("all four types work and are validated", async () => {
    const s = await setup();
    await memory.link(s.d1.id, s.goal.id, "derived_from");
    await memory.link(s.fact.id, s.goal.id, "related_to");
    await memory.link(s.step.id, s.issue.id, "resolves");
    await memory.link(s.d2.id, s.d1.id, "replaces", "D1 era prea scumpă");
    expect((await memory.links(s.p.id)).map((l) => l.type).sort()).toEqual(["derived_from", "related_to", "replaces", "resolves"]);
    expect((await memory.get(s.issue.id))!.status).toBe("resolved");
    expect((await memory.get(s.d1.id))!.status).toBe("replaced");
  });

  it("rejects self, duplicate (both directions for related_to), missing, wrong category and cycles", async () => {
    const s = await setup();
    await expect(memory.link(s.fact.id, s.fact.id, "related_to")).rejects.toMatchObject({ reason: "self" });
    await memory.link(s.fact.id, s.goal.id, "related_to");
    await expect(memory.link(s.fact.id, s.goal.id, "related_to")).rejects.toMatchObject({ reason: "duplicate" });
    await expect(memory.link(s.goal.id, s.fact.id, "related_to")).rejects.toMatchObject({ reason: "duplicate" });
    await expect(memory.link(s.fact.id, "M-00000000-0000-4000-8000-000000000000", "related_to")).rejects.toMatchObject({ reason: "missing" });
    await expect(memory.link(s.fact.id, s.goal.id, "nope" as never)).rejects.toBeInstanceOf(LinkError);
    await expect(memory.link(s.fact.id, s.goal.id, "replaces")).rejects.toMatchObject({ reason: "wrongCategory" });
    await expect(memory.link(s.step.id, s.goal.id, "resolves")).rejects.toMatchObject({ reason: "wrongCategory" });
    await memory.link(s.d1.id, s.goal.id, "derived_from");
    await memory.link(s.goal.id, s.fact.id, "derived_from");
    await expect(memory.link(s.fact.id, s.d1.id, "derived_from")).rejects.toMatchObject({ reason: "cycle" });
    await memory.archive(s.step.id);
    await expect(memory.link(s.step.id, s.issue.id, "resolves")).rejects.toMatchObject({ reason: "notAllowed" });
  });

  it("replacing a decision keeps the old decision, its text, versions and the reason", async () => {
    const s = await setup();
    await memory.edit(s.d1.id, { title: "D1", body: "detalii v2" });
    const { entry, link } = await memory.replaceDecision(s.d1.id, { title: "D3 nouă", body: "de ce" }, "costă mai puțin");
    const old = (await memory.get(s.d1.id))!;
    expect(old).toMatchObject({ status: "replaced", body: "detalii v2", archived: false });
    expect((await memory.history(s.d1.id)).length).toBe(2);
    expect(link).toMatchObject({ from: entry.id, to: s.d1.id, type: "replaces", reason: "costă mai puțin" });
    await expect(memory.replaceDecision(s.d1.id, { title: "încă una" }, "x")).rejects.toMatchObject({ reason: "alreadyReplaced" });
    await expect(memory.replaceDecision(s.d2.id, { title: "fără motiv" }, "  ")).rejects.toMatchObject({ field: "reason" });
    await memory.unlink(link.id); // undoing the replacement restores the old decision as active
    expect((await memory.get(s.d1.id))!.status).toBe("active");
  });

  it("resolving a problem keeps the problem and shows what resolved it (existing or new entry)", async () => {
    const s = await setup();
    const l1 = await memory.resolveIssue(s.issue.id, { entryId: s.step.id });
    expect((await memory.get(s.issue.id))!).toMatchObject({ status: "resolved", title: "Problemă", archived: false });
    expect(l1.from).toBe(s.step.id);
    const issue2 = await memory.create(s.p.id, { category: "issue", title: "Problemă 2" });
    const l2 = await memory.resolveIssue(issue2.id, { category: "decision", title: "Decizia care rezolvă" }, "explicație");
    const resolver = (await memory.get(l2.from))!;
    expect(resolver).toMatchObject({ category: "decision", title: "Decizia care rezolvă", author: "user" });
    expect((await memory.get(issue2.id))!.status).toBe("resolved");
    await expect(memory.resolveIssue(issue2.id, { category: "issue", title: "nu" })).rejects.toMatchObject({ reason: "wrongCategory" });
  });
});

describe("integrity (tamper detection)", () => {
  async function filled() {
    const p = await projects.create("P");
    const e = await memory.create(p.id, { category: "fact", title: "Original", body: "v1" });
    await memory.edit(e.id, { title: "Original", body: "v2" });
    await memory.edit(e.id, { title: "Original", body: "v3" });
    return { p, e };
  }

  it("legitimate edits append valid versions", async () => {
    const { p } = await filled();
    expect(await memory.verify(p.id)).toMatchObject({ ok: true, checkpoint: "ok", inconsistencies: [] });
  });

  it("an altered historical version is detected", async () => {
    const { p } = await filled();
    await raw(["events"], "readwrite", async (tx) => {
      const all = await req(tx.objectStore("events").getAll());
      const v2 = all.find((x: { data: { body?: string } | null }) => x.data?.body === "v2");
      tx.objectStore("events").put({ ...v2, data: { ...v2.data, body: "falsificat" } });
    });
    const r = await memory.verify(p.id);
    expect(r.ok).toBe(false);
    expect(r.problem).toBe("contentModified");
  });

  it("a removed historical record is detected (gap in the chain)", async () => {
    const { p } = await filled();
    await raw(["events"], "readwrite", (tx) => tx.objectStore("events").delete(3));
    const r = await memory.verify(p.id);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ problem: "gap", at: 3 });
  });

  it("removing the most recent records is detected by the checkpoint kept outside the database", async () => {
    const { p } = await filled();
    const n = (await base.journal()).length;
    await raw(["events"], "readwrite", (tx) => tx.objectStore("events").delete(n));
    const r = await memory.verify(p.id);
    expect(r.checkpoint).toBe("behind");
    expect(r.ok).toBe(false);
  });

  it("reordered records are detected", async () => {
    const { p } = await filled();
    await raw(["events"], "readwrite", async (tx) => {
      const s = tx.objectStore("events");
      const [a, b] = [await req(s.get(2)), await req(s.get(3))];
      s.put({ ...b, seq: 2 });
      s.put({ ...a, seq: 3 });
    });
    expect((await memory.verify(p.id)).ok).toBe(false);
  });

  it("an entry changed directly in the database (not through the app) is detected", async () => {
    const { p, e } = await filled();
    await raw(["memory"], "readwrite", async (tx) => {
      const cur = await req(tx.objectStore("memory").get(e.id));
      tx.objectStore("memory").put({ ...cur, body: "schimbat pe ascuns" });
    });
    const r = await memory.verify(p.id);
    expect(r.ok).toBe(false);
    expect(r.inconsistencies).toEqual([`content:${e.id}`]);
  });

  it("limitation (documented): rewriting the whole history AND the checkpoint consistently is not detectable", async () => {
    const { p } = await filled();
    localStorage.clear(); // without a checkpoint, a consistently truncated journal still verifies
    const n = (await base.journal()).length;
    await raw(["events", "memory"], "readwrite", (tx) => { tx.objectStore("events").delete(n); });
    const r = await base.verify();
    expect(r.checkpoint).toBe("missing");
    expect(r.ok).toBe(true); // the chain alone cannot see a cut at the end — hence the checkpoint, and the honest wording in the UI
    void p;
  });
});

describe("search", () => {
  it("title and text, without diacritics; history only when asked; archived and pending excluded", async () => {
    const p = await projects.create("P");
    const e = await memory.create(p.id, { category: "fact", title: "Prețul cuprului", body: "Furnizor din Brăila" });
    await memory.edit(e.id, { title: "Prețul cuprului", body: "Furnizor din Iași" });
    const arch = await memory.create(p.id, { category: "fact", title: "Brăila arhivată" });
    await memory.archive(arch.id);
    await memory.propose(p.id, { category: "fact", title: "Brăila propusă" });
    const list = await memory.list(p.id);
    const versions = await memory.versions(p.id);
    expect(searchMemory(p.id, list, "PRETUL").map((h) => h.entry.id)).toEqual([e.id]);
    expect(searchMemory(p.id, list, "iasi").map((h) => h.entry.id)).toEqual([e.id]);
    expect(searchMemory(p.id, list, "braila", {}, versions)).toEqual([]);
    expect(searchMemory(p.id, list, "braila", { history: true }, versions)).toEqual([{ entry: expect.objectContaining({ id: e.id }), version: 1 }]);
    expect(searchMemory(p.id, list, "braila", { archived: true }).map((h) => h.entry.id)).toEqual([arch.id]);
  });
});

describe("context preparation (for AIW-05)", () => {
  async function sample() {
    const p = await projects.create("Proiect", "descriere");
    const add = (category: MemoryEntry["category"], title: string, important = false, body = "") => memory.create(p.id, { category, title, important, body });
    const step = await add("step", "Pasul următor");
    const g = await add("goal", "Obiectiv principal", true);
    const instr = await add("instruction", "Răspunde în română");
    const d = await add("decision", "Folosim ZIP");
    await memory.link(d.id, g.id, "derived_from");
    const issue = await add("issue", "Problemă rezolvată");
    await memory.resolveIssue(issue.id, { entryId: step.id });
    const f1 = await add("fact", "Fapt mic");
    const f2 = await add("fact", "Fapt important", true);
    const arch = await add("context", "Context vechi");
    await memory.archive(arch.id);
    return { p, step, g, instr, d, issue, f1, f2, arch };
  }

  it("deterministic order, important first, closed/archived/pending excluded with reasons, provenance and links kept", async () => {
    const s = await sample();
    await memory.propose(s.p.id, { category: "goal", title: "Propunere" });
    const entries = await memory.list(s.p.id);
    const links = await memory.links(s.p.id);
    const c = buildContext(s.p, entries, links);
    expect(c.payload.sections.map((x) => x.category)).toEqual(["instruction", "goal", "decision", "fact", "step"]);
    expect(c.payload.sections.find((x) => x.category === "fact")!.items.map((i) => i.title)).toEqual(["Fapt important", "Fapt mic"]);
    expect(c.payload.sections.find((x) => x.category === "decision")!.items[0].links).toEqual([{ type: "derived_from", direction: "out", id: s.g.id, title: "Obiectiv principal" }]);
    expect(c.payload.sections.flatMap((x) => x.items).every((i) => i.author === "user" && i.id.startsWith("M-"))).toBe(true);
    expect(c.omitted.map((o) => [o.title, o.reason]).sort()).toEqual([["Context vechi", "archived"], ["Problemă rezolvată", "closed"], ["Propunere", "notConfirmed"]]);
    // same input, any order → byte-for-byte the same result
    const again = buildContext(s.p, [...entries].reverse(), [...links].reverse());
    expect(serializeContext(again)).toBe(serializeContext(c));
    expect(JSON.stringify(again)).toBe(JSON.stringify(c));
  });

  it("the size limit drops the least important entries first and reports them; instructions last", async () => {
    const s = await sample();
    const entries = await memory.list(s.p.id);
    const full = buildContext(s.p, entries, await memory.links(s.p.id));
    const small = buildContext(s.p, entries, await memory.links(s.p.id), { maxChars: full.stats.chars - 1 });
    const dropped = small.omitted.filter((o) => o.reason === "sizeLimit");
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped[0].title).toBe("Pasul următor"); // non-important, last section first
    expect(small.stats.chars).toBeLessThanOrEqual(full.stats.chars - 1);
    const tiny = buildContext(s.p, entries, await memory.links(s.p.id), { maxChars: 10 });
    const order = tiny.omitted.filter((o) => o.reason === "sizeLimit").map((o) => o.title);
    expect(order.indexOf("Răspunde în română")).toBeGreaterThan(order.indexOf("Fapt mic"));
    expect(order.at(-1)).toBe("Obiectiv principal"); // important entries go last of all
  });

  it("never changes the memory", async () => {
    const s = await sample();
    const before = JSON.stringify([await memory.list(s.p.id), await memory.links(s.p.id), await base.journal()]);
    buildContext(s.p, await memory.list(s.p.id), await memory.links(s.p.id), { maxChars: 50 });
    expect(JSON.stringify([await memory.list(s.p.id), await memory.links(s.p.id), await base.journal()])).toBe(before);
  });
});

describe("review findings (independent review, 7 Nov 2026)", () => {
  it("an integrity check during a write in another tab gives no false alarm", async () => {
    const p = await projects.create("P");
    await memory.create(p.id, { category: "fact", title: "F" });
    const tab2 = new MemoryStore(new JournaledStore(dbName, tick));
    const [r] = await Promise.all([memory.verify(p.id), tab2.create(p.id, { category: "fact", title: "în paralel" })]);
    expect(r).toMatchObject({ ok: true });
    expect(await memory.verify(p.id)).toMatchObject({ ok: true, checkpoint: "ok" });
    tab2.base.close();
  });

  it("a failed request inside a write aborts everything (nothing half-saved, no orphan event)", async () => {
    const p = await projects.create("P");
    const e = await memory.create(p.id, { category: "fact", title: "F" });
    const before = (await base.journal()).length;
    await expect(base.write(["memory"], async () => ({
      result: null,
      events: [{ type: "memory.edited", projectId: p.id, entityId: e.id, data: { title: "x", body: "", version: 2 } }],
      apply: (w) => void w.objectStore("memory").add({ ...e }), // same key: the request fails
    }))).rejects.toBeTruthy();
    expect((await base.journal()).length).toBe(before);
    expect(await memory.verify(p.id)).toMatchObject({ ok: true });
  });

  it("archiving the decision that replaced another makes the old one current again; restoring reverses it", async () => {
    const p = await projects.create("P");
    const a = await memory.create(p.id, { category: "decision", title: "A" });
    const { entry: b } = await memory.replaceDecision(a.id, { title: "B" }, "motiv");
    expect((await memory.get(a.id))!.status).toBe("replaced");
    await memory.archive(b.id);
    expect((await memory.get(a.id))!.status).toBe("active");
    expect(buildContext(p, await memory.list(p.id), await memory.links(p.id)).payload.sections[0].items.map((i) => i.title)).toEqual(["A"]);
    await memory.restore(b.id);
    expect((await memory.get(a.id))!.status).toBe("replaced");
    expect(await memory.verify(p.id)).toMatchObject({ ok: true, inconsistencies: [] });
  });

  it("the payload that may be sent never contains pending, rejected or archived titles", async () => {
    const p = await projects.create("P");
    await memory.create(p.id, { category: "fact", title: "Oficial" });
    await memory.propose(p.id, { category: "fact", title: "TITLU PROPUNERE" });
    const arch = await memory.create(p.id, { category: "fact", title: "TITLU ARHIVAT" });
    await memory.archive(arch.id);
    const c = buildContext(p, await memory.list(p.id), []);
    expect(serializeContext(c)).toContain("Oficial");
    expect(serializeContext(c)).not.toMatch(/TITLU PROPUNERE|TITLU ARHIVAT/);
    expect(c.omitted.map((o) => o.title).sort()).toEqual(["TITLU ARHIVAT", "TITLU PROPUNERE"]); // only in the user's report
  });

  it("missing checkpoint = partial check (not a clean bill of health); hidden old content is reported", async () => {
    const p = await projects.create("P");
    const e = await memory.create(p.id, { category: "fact", title: "F", body: "v1" });
    await memory.edit(e.id, { title: "F", body: "v2" });
    localStorage.clear();
    expect(await memory.verify(p.id)).toMatchObject({ checkpoint: "missing" });
    await raw(["events"], "readwrite", async (tx) => {
      const all = await req(tx.objectStore("events").getAll());
      const v1 = all.find((x: { data: { body?: string } | null }) => x.data?.body === "v1");
      tx.objectStore("events").put({ ...v1, data: null }); // an old version silently "erased"
    });
    const r = await memory.verify(p.id);
    expect(r.ok).toBe(false);
    expect(r.inconsistencies).toEqual([`erased:${e.id}`]);
  });

  it("the memory of a project in the trash can be read but not changed", async () => {
    const p = await projects.create("P");
    const a = await memory.create(p.id, { category: "fact", title: "A" });
    const b = await memory.create(p.id, { category: "goal", title: "B" });
    await projects.trash(p.id);
    await expect(memory.edit(a.id, { title: "x", body: "" })).rejects.toMatchObject({ kind: "conflict" });
    await expect(memory.link(a.id, b.id, "related_to")).rejects.toMatchObject({ kind: "conflict" });
    await expect(memory.archive(a.id)).rejects.toMatchObject({ kind: "conflict" });
    expect((await memory.list(p.id)).length).toBe(2);
    await projects.restore(p.id);
    expect((await memory.edit(a.id, { title: "x", body: "" })).title).toBe("x");
  });
});

describe("second review findings (7 Nov 2026)", () => {
  it("a new ordinary link never brings back a status coming from an archived entry", async () => {
    const p = await projects.create("P");
    const x = await memory.create(p.id, { category: "issue", title: "X" });
    const f = await memory.create(p.id, { category: "fact", title: "F" });
    const g = await memory.create(p.id, { category: "goal", title: "G" });
    await memory.link(f.id, x.id, "resolves");
    await memory.archive(f.id);
    expect((await memory.get(x.id))!.status).toBe("active");
    await memory.link(g.id, x.id, "related_to");
    expect((await memory.get(x.id))!.status).toBe("active");
    const a = await memory.create(p.id, { category: "decision", title: "A" });
    const { entry: b } = await memory.replaceDecision(a.id, { title: "B" }, "motiv");
    await memory.archive(b.id);
    const c = await memory.create(p.id, { category: "decision", title: "C" });
    await memory.link(c.id, a.id, "derived_from");
    expect((await memory.get(a.id))!.status).toBe("active");
    expect(await memory.verify(p.id)).toMatchObject({ ok: true, inconsistencies: [] });
  });

  it("permanent delete also erases texts of links removed earlier", async () => {
    const p = await projects.create("P");
    const a = await memory.create(p.id, { category: "fact", title: "A" });
    const b = await memory.create(p.id, { category: "fact", title: "B" });
    const l = await memory.link(a.id, b.id, "related_to", "SECRET despre B");
    await memory.unlink(l.id);
    await memory.archive(b.id);
    await memory.purge(b.id);
    expect(JSON.stringify(await base.journal())).not.toContain("SECRET despre B");
    expect(await memory.verify(p.id)).toMatchObject({ ok: true });
  });

  it("a decision is replaced only once: restoring an earlier replacement is refused", async () => {
    const p = await projects.create("P");
    const b = await memory.create(p.id, { category: "decision", title: "B" });
    const { entry: a } = await memory.replaceDecision(b.id, { title: "A" }, "1");
    await memory.archive(a.id);
    await memory.replaceDecision(b.id, { title: "C" }, "2");
    await expect(memory.restore(a.id)).rejects.toMatchObject({ reason: "alreadyReplaced" });
    expect((await memory.get(a.id))!.archived).toBe(true);
    expect(await memory.verify(p.id)).toMatchObject({ ok: true, inconsistencies: [] });
  });
});
