// AIW-04: export / import — ZIP safety, archive validation, round trip, duplicates, atomicity, compatibility.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATEGORIES, canonical, eventHash, newLinkId, sha256, type MemoryEntry } from "../../src/core";
import {
  ArchiveError, archiveFiles, crc32, createZip, EXPORT_VERSION, ImportError, MANIFEST_NAME, parseArchive, readZip,
  TransferService, ZipError, type ProjectFile,
} from "../../src/archive";
import { buildContext, MemoryStore } from "../../src/memory";
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

interface Device { base: JournaledStore; projects: ProjectStore; memory: MemoryStore; transfer: TransferService }
let clock = 0;
const tick = () => new Date((clock += 1000));
const devices: Device[] = [];
function device(): Device {
  const base = new JournaledStore("dev-" + Math.random(), tick);
  const d = { base, projects: new ProjectStore(base), memory: new MemoryStore(base), transfer: new TransferService(base, "test") };
  devices.push(d);
  return d;
}
beforeEach(() => {
  clock = Date.parse("2026-11-07T10:00:00Z");
  localStorage.clear();
});
afterEach(() => devices.splice(0).forEach((d) => d.base.close()));

/** A project using every feature: the 7 categories, versions, links of every type, a pending, a rejected and an archived entry. */
async function rich(d: Device, name = "Oferta Brăila") {
  const p = await d.projects.create(name, "Ofertă pentru clientul din Brăila");
  const e: Record<string, MemoryEntry> = {};
  for (const c of CATEGORIES) e[c] = await d.memory.create(p.id, { category: c, title: `${c} — titlu`, body: `Text ${c}\nrândul doi`, important: c === "goal" });
  await d.memory.edit(e.fact.id, { title: "fact — titlu v2", body: "Text nou" });
  await d.memory.edit(e.fact.id, { title: "fact — titlu v3", body: "Text și mai nou" });
  const { entry: newDecision } = await d.memory.replaceDecision(e.decision.id, { title: "Decizie nouă" }, "Clientul a cerut altceva");
  await d.memory.resolveIssue(e.issue.id, { entryId: e.step.id }, "Rezolvat de pas");
  await d.memory.link(e.fact.id, e.context.id, "derived_from");
  await d.memory.link(e.goal.id, e.instruction.id, "related_to", "legătură");
  const pending = await d.memory.propose(p.id, { category: "fact", title: "Propunere AI", source: "ChatGPT" });
  const rejected = await d.memory.propose(p.id, { category: "step", title: "Propunere respinsă" });
  await d.memory.reject(rejected.id);
  const archived = await d.memory.create(p.id, { category: "context", title: "Context vechi" });
  await d.memory.archive(archived.id);
  return { p, e, newDecision, pending, rejected, archived };
}

async function snapshot(d: Device, projectId: string) {
  const [project, entries, links, versions] = await Promise.all([
    d.projects.get(projectId), d.memory.list(projectId), d.memory.links(projectId), d.memory.versions(projectId),
  ]);
  const sort = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => x.id.localeCompare(y.id));
  const v = [...versions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, list]) => [id, list.map((x) => [x.version, x.title, x.body, x.ts, x.current])]);
  return { project, entries: sort(entries), links: sort(links), versions: v };
}

async function zipOf(files: Map<string, Uint8Array>) {
  return createZip([...files].map(([name, data]) => ({ name, data })));
}

describe("zip", () => {
  it("round trip, stored and compressed, with CRC", async () => {
    const big = new TextEncoder().encode("aaaa ".repeat(10_000));
    const zip = await createZip([{ name: "a.json", data: new TextEncoder().encode("{}") }, { name: "dir/b.txt", data: big }]);
    expect(zip.length).toBeLessThan(big.length); // compressed
    const files = await readZip(zip);
    expect([...files.keys()]).toEqual(["a.json", "dir/b.txt"]);
    expect(files.get("dir/b.txt")).toEqual(big);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("refuses unsafe names, damaged data, bombs and non-zip files", async () => {
    await expect(createZip([{ name: "../x", data: new Uint8Array(1) }])).rejects.toThrow(ZipError);
    await expect(readZip(new TextEncoder().encode("not a zip file at all, really not"))).rejects.toMatchObject({ problem: "notZip" });
    const zip = await createZip([{ name: "a.txt", data: new TextEncoder().encode("hello world, stored") }]);
    // flip one data byte → CRC error
    const bad = zip.slice();
    bad[30 + 5 + 2] ^= 0xff;
    await expect(readZip(bad)).rejects.toMatchObject({ problem: "crc" });
    // cut the end → truncated
    await expect(readZip(zip.slice(0, zip.length - 10))).rejects.toMatchObject({ problem: "truncated" });
    // a name with ".." written by hand in a valid-looking zip
    const evil = zip.slice();
    const at = evil.length - 22 - (46 + 5) + 46; // the name inside the central directory entry
    evil.set(new TextEncoder().encode("../ab"), at);
    await expect(readZip(evil)).rejects.toMatchObject({ problem: "badName" });
    // a "bomb": a compressed file that inflates far beyond its declared size
    const huge = new TextEncoder().encode("0".repeat(2_000_000));
    const bomb = await createZip([{ name: "b.txt", data: huge }]);
    const v = new DataView(bomb.buffer);
    const cd = v.getUint32(bomb.length - 22 + 16, true);
    v.setUint32(cd + 24, 100, true); // declared size: 100 bytes
    await expect(readZip(bomb)).rejects.toMatchObject({ problem: "sizeMismatch" });
    // limits
    await expect(readZip(await createZip([{ name: "a", data: new Uint8Array(10) }, { name: "b", data: new Uint8Array(10) }]), { maxFiles: 1, maxFileBytes: 100, maxTotalBytes: 100 }))
      .rejects.toMatchObject({ problem: "tooManyFiles" });
    await expect(readZip(await createZip([{ name: "a", data: new Uint8Array(200) }]), { maxFiles: 5, maxFileBytes: 100, maxTotalBytes: 1000 }))
      .rejects.toMatchObject({ problem: "tooLarge" });
  });
});

describe("export → import on a clean device", () => {
  it("moves a project with all 7 memory types, versions, links and proposals without losing anything", async () => {
    const a = device();
    const { p } = await rich(a);
    const before = await snapshot(a, p.id);
    expect(new Set(before.entries.map((e) => e.category))).toEqual(new Set(CATEGORIES));

    const { bytes, fileName, count } = await a.transfer.exportArchive([p.id]);
    expect(count).toBe(1);
    expect(fileName).toMatch(/^ai-workspace-oferta-braila-\d{4}-\d{2}-\d{2}\.zip$/);

    const b = device();
    const preview = await b.transfer.preview(bytes);
    expect(preview.projects).toHaveLength(1);
    expect(preview.projects[0]).toMatchObject({ match: "new", choices: ["add", "skip"], counts: { entries: before.entries.length, links: before.links.length, pending: 1, versions: 2 } });
    const res = await b.transfer.importArchive(preview);
    expect(res.imported).toEqual([{ id: p.id, name: p.name, mode: "add" }]);

    const after = await snapshot(b, p.id);
    expect(after).toEqual(before); // records, links, every version with its original date
    const report = await b.memory.verify(p.id);
    expect(report.ok).toBe(true);
    expect(report.inconsistencies).toEqual([]);
    expect((await b.base.verify()).ok).toBe(true); // the destination's own chain stays valid

    // the context for an AI is identical and never contains the pending / rejected / archived entries
    const ctx = (d: Device) => Promise.all([d.projects.get(p.id), d.memory.list(p.id), d.memory.links(p.id)]).then(([pr, en, li]) => buildContext(pr!, en, li));
    const [ca, cb] = await Promise.all([ctx(a), ctx(b)]);
    expect(canonical(cb.payload)).toBe(canonical(ca.payload));
    const titles = JSON.stringify(cb.payload);
    expect(titles).not.toContain("Propunere AI");
    expect(titles).not.toContain("Propunere respinsă");
    expect(titles).not.toContain("Context vechi");

    // the imported project keeps working normally
    const e = after.entries.find((x) => x.category === "goal")!;
    await b.memory.edit(e.id, { title: "Obiectiv nou", body: "" });
    expect((await b.memory.history(e.id)).map((v) => v.version)).toEqual([1, 2]);
    expect((await b.memory.verify(p.id)).ok).toBe(true);
  });

  it("exports all projects (trash included) and moves them back and forth between two devices", async () => {
    const a = device();
    const one = await rich(a, "Unu");
    const two = await a.projects.create("Doi");
    await a.projects.trash(two.id);
    const all = await a.transfer.exportArchive("all");
    expect(all.count).toBe(2);
    expect(all.fileName).toMatch(/^ai-workspace-toate-/);
    const b = device();
    await b.transfer.importArchive(await b.transfer.preview(all.bytes));
    expect((await b.projects.get(two.id))?.deletedAt).toBeTruthy(); // still in the trash
    // change it on B, bring it back to A (replace)
    await b.memory.create(one.p.id, { category: "step", title: "Pas făcut pe PC" });
    const back = await b.transfer.exportArchive([one.p.id]);
    const pv = await a.transfer.preview(back.bytes);
    expect(pv.projects[0]).toMatchObject({ match: "sameId", choices: ["skip", "replace", "copy"] });
    await a.transfer.importArchive(pv, { [one.p.id]: "replace" });
    expect((await a.memory.list(one.p.id)).some((e) => e.title === "Pas făcut pe PC")).toBe(true);
    expect(await snapshot(a, one.p.id)).toEqual(await snapshot(b, one.p.id));
    expect((await a.memory.verify(one.p.id)).ok).toBe(true);
    expect((await a.base.verify()).ok).toBe(true);
    // the replaced copy's history is still in A's journal (nothing deleted), but no longer shown
    const journal = await a.base.journal();
    expect(journal.filter((e) => e.projectId === one.p.id && e.type === "project.created")).toHaveLength(2);
    // one import record on A (its own, the latest), which keeps B's earlier record inside it
    const markers = journal.filter((e) => e.type === "project.imported");
    expect(markers.map((e) => (e.data as { mode: string }).mode)).toEqual(["replace"]);
    expect((markers[0].data as { previous?: { mode: string } }).previous?.mode).toBe("add");
    expect((await a.memory.timeline(one.p.id)).length).toBeGreaterThan(0); // history shown after the replace
    // the same archive again: identical → default "skip"
    const again = await a.transfer.preview(back.bytes);
    expect(again.projects[0]).toMatchObject({ match: "same", choices: ["skip", "copy"] });
    expect(await a.transfer.importArchive(again)).toEqual({ imported: [], skipped: 1 });
  });

  it("imports as a separate copy with new ids, a free name and its links and history intact", async () => {
    const a = device();
    const { p } = await rich(a);
    const { bytes } = await a.transfer.exportArchive([p.id]);
    const res = await a.transfer.importArchive(await a.transfer.preview(bytes), { [p.id]: "copy" });
    const copy = res.imported[0];
    expect(copy.mode).toBe("copy");
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe("Oferta Brăila (2)");
    const [orig, dup] = await Promise.all([snapshot(a, p.id), snapshot(a, copy.id)]);
    expect(dup.entries.length).toBe(orig.entries.length);
    expect(dup.links.length).toBe(orig.links.length);
    const dupIds = new Set(dup.entries.map((e) => e.id));
    for (const l of dup.links) expect(dupIds.has(l.from) && dupIds.has(l.to)).toBe(true);
    expect(dup.entries.some((e) => orig.entries.some((o) => o.id === e.id))).toBe(false);
    const norm = (s: typeof orig) => s.versions.map(([, v]) => JSON.stringify(v)).sort();
    expect(norm(dup)).toEqual(norm(orig)); // every version of every entry, with its original date
    expect(dup.project?.nameHistory.at(-1)?.name).toBe("Oferta Brăila");
    expect((await a.memory.verify(copy.id)).ok).toBe(true);
    expect((await a.memory.verify(p.id)).ok).toBe(true);
    // a third import gets the next free name
    const res3 = await a.transfer.importArchive(await a.transfer.preview(bytes), { [p.id]: "copy" });
    expect(res3.imported[0].name).toBe("Oferta Brăila (3)");
  });

  it("detects a different project with the same name", async () => {
    const a = device();
    const { p } = await rich(a, "Nume comun");
    const b = device();
    await b.projects.create("Nume comun");
    const pv = await b.transfer.preview((await a.transfer.exportArchive([p.id])).bytes);
    expect(pv.projects[0]).toMatchObject({ match: "sameName", choices: ["copy", "skip"] });
    const res = await b.transfer.importArchive(pv);
    expect(res.imported[0].name).toBe("Nume comun (2)");
  });

  it("keeps projects created by the earlier versions (no memory) importable", async () => {
    const a = device();
    const p = await a.projects.create("Doar proiect");
    await a.projects.rename(p.id, "Proiect redenumit");
    await a.projects.setPinned(p.id, true);
    const b = device();
    await b.transfer.importArchive(await b.transfer.preview((await a.transfer.exportArchive([p.id])).bytes));
    expect(await b.projects.get(p.id)).toEqual(await a.projects.get(p.id));
  });
});

describe("damaged or hostile archives", () => {
  async function files(): Promise<{ map: Map<string, Uint8Array>; pf: ProjectFile; name: string }> {
    const a = device();
    const { p } = await rich(a);
    const map = await readZip((await a.transfer.exportArchive([p.id])).bytes);
    const name = `projects/${p.id}.json`;
    return { map, pf: JSON.parse(new TextDecoder().decode(map.get(name)!)), name };
  }
  const reencode = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

  it("refuses a changed file (fingerprint)", async () => {
    const { map, pf, name } = await files();
    pf.memory[0].title = "schimbat";
    map.set(name, reencode(pf));
    await expect(parseArchive(map)).rejects.toMatchObject({ problem: "fingerprint" });
  });

  it("refuses consistent-looking edits: changed history, memory not matching its history, broken links", async () => {
    // rebuild the archive with correct file fingerprints, so only the deeper checks can catch the change
    const rebuild = async (pf: ProjectFile) => new Map((await archiveFiles([pf], { app: "x", exportedAt: "2026-11-07T10:00:00.000Z", scope: "project", sourceJournal: { ok: true, events: 1 } })).map((f) => [f.name, f.data]));
    const { pf } = await files();

    const h = structuredClone(pf);
    (h.events.find((e) => e.type === "memory.edited")!.data as { title: string }).title = "istorie falsă";
    await expect(parseArchive(await rebuild(h))).rejects.toMatchObject({ problem: "history" });

    const m = structuredClone(pf);
    m.memory.find((e) => e.category === "fact" && e.version === 3)!.body = "alt text";
    await expect(parseArchive(await rebuild(m))).rejects.toMatchObject({ problem: "inconsistent" });

    const l = structuredClone(pf);
    l.links[0].to = "M-00000000-0000-4000-8000-000000000000";
    await expect(parseArchive(await rebuild(l))).rejects.toMatchObject({ problem: "invalidRecord" });

    const s = structuredClone(pf);
    s.memory.find((e) => e.status === "replaced")!.status = "active";
    await expect(parseArchive(await rebuild(s))).rejects.toMatchObject({ problem: "inconsistent" });

    const x = structuredClone(pf) as unknown as { project: Record<string, unknown> };
    x.project.script = "<script>alert(1)</script>";
    await expect(parseArchive(await rebuild(x as unknown as ProjectFile))).rejects.toMatchObject({ problem: "invalidRecord" });
  });

  it("refuses unknown files, newer formats and archives that are not ours", async () => {
    const { map } = await files();
    const extra = new Map(map);
    extra.set("run.js", new TextEncoder().encode("alert(1)"));
    await expect(parseArchive(extra)).rejects.toMatchObject({ problem: "structure" });

    const newer = new Map(map);
    const m = JSON.parse(new TextDecoder().decode(map.get(MANIFEST_NAME)!));
    m.version = EXPORT_VERSION + 1;
    newer.set(MANIFEST_NAME, reencode(m));
    await expect(parseArchive(newer)).rejects.toMatchObject({ problem: "newerVersion" });

    const b = device();
    await expect(b.transfer.preview(await zipOf(new Map([["x.json", reencode({})]])))).rejects.toMatchObject({ problem: "notAiw" });
    await expect(b.transfer.preview(new TextEncoder().encode("PK garbage"))).rejects.toBeInstanceOf(ZipError);
    expect(ArchiveError).toBeTruthy();
  });
});

describe("atomic import", () => {
  it("writes nothing when one project of the archive cannot be imported", async () => {
    const a = device();
    const one = await rich(a, "Unu");
    const two = await rich(a, "Doi");
    const all = await a.transfer.exportArchive("all");
    const b = device();
    // B already holds an entry with the same id as one of "Doi"'s entries, in another project
    const pv = await b.transfer.preview(all.bytes);
    const other = await b.projects.create("Alt proiect");
    await rawPut(b, "memory", { ...two.e.goal, projectId: other.id });
    const journalBefore = (await b.base.journal()).length;
    await expect(b.transfer.importArchive(pv)).rejects.toBeInstanceOf(ImportError);
    expect(await b.projects.get(one.p.id)).toBeUndefined(); // "Unu" was not half-imported
    expect((await b.base.journal()).length).toBe(journalBefore);
    expect((await b.base.verify()).ok).toBe(true);
  });

  it("refuses when this device changed since the preview", async () => {
    const a = device();
    const { p } = await rich(a);
    const back = await a.transfer.exportArchive([p.id]);
    await a.memory.create(p.id, { category: "fact", title: "Înainte de preview" });
    const pv = await a.transfer.preview(back.bytes);
    await a.memory.create(p.id, { category: "fact", title: "După preview" });
    await expect(a.transfer.importArchive(pv, { [p.id]: "replace" })).rejects.toMatchObject({ reason: "changed" });
    expect((await a.memory.list(p.id)).some((e) => e.title === "După preview")).toBe(true);
  });

  it("refuses a choice the preview did not offer", async () => {
    const a = device();
    const { p } = await rich(a);
    const b = device();
    const pv = await b.transfer.preview((await a.transfer.exportArchive([p.id])).bytes);
    await expect(b.transfer.importArchive(pv, { [p.id]: "replace" })).rejects.toBeInstanceOf(ImportError);
  });
});

async function rawPut(d: Device, store: string, value: unknown) {
  const db = await d.base.open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}


describe("every byte of an exported archive is protected", () => {
  it("flipping any single byte makes the import refuse the archive", async () => {
    const a = device();
    const p = await a.projects.create("Mic");
    await a.memory.create(p.id, { category: "goal", title: "Un obiectiv" });
    const { bytes } = await a.transfer.exportArchive([p.id]);
    const b = device();
    const accepted: number[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const bad = bytes.slice();
      bad[i] ^= 0x01;
      try {
        await b.transfer.preview(bad);
        accepted.push(i);
      } catch {
        /* refused: expected */
      }
    }
    // only bytes that carry no meaning may be changed: the file dates (DOS time/date, local + central)
    // and the "version made by / needed" fields; everything else is detected
    const v = new DataView(bytes.buffer);
    const harmless = new Set<number>();
    for (let i = 0; i + 4 <= bytes.length; i++) {
      const sig = v.getUint32(i, true);
      if (sig === 0x04034b50) [4, 5, 10, 11, 12, 13].forEach((o) => harmless.add(i + o));
      if (sig === 0x02014b50) [4, 5, 6, 7, 12, 13, 14, 15, 34, 35, 36, 37, 38, 39, 40, 41].forEach((o) => harmless.add(i + o));
    }
    expect(accepted.filter((i) => !harmless.has(i))).toEqual([]);
  }, 60_000);
});

describe("crafted archives (independent review findings)", () => {
  /** Re-seals a tampered project file: recomputes every fingerprint and chain link, as a careful forger would. */
  async function reseal(pf: ProjectFile): Promise<Map<string, Uint8Array>> {
    let prev: { seq: number; hash: string } | null = null;
    for (const e of pf.events) {
      e.dataHash = await sha256(canonical(e.data));
      if (prev && e.seq === prev.seq + 1) e.prev = prev.hash;
      e.hash = await eventHash(e);
      prev = e;
    }
    return new Map((await archiveFiles([pf], { app: "x", exportedAt: "2026-11-07T10:00:00.000Z", scope: "project", sourceJournal: { ok: true, events: 1 } })).map((f) => [f.name, f.data]));
  }
  async function source() {
    const a = device();
    const r = await rich(a);
    const map = await readZip((await a.transfer.exportArchive([r.p.id])).bytes);
    const pf = JSON.parse(new TextDecoder().decode(map.get(`projects/${r.p.id}.json`)!)) as ProjectFile;
    return { a, r, pf };
  }

  it("an untouched archive re-sealed the same way is accepted (the forger's tool is correct)", async () => {
    const { pf } = await source();
    await expect(parseArchive(await reseal(pf))).resolves.toBeTruthy();
  });

  it("refuses malformed data in an OLDER version (it would crash the search later)", async () => {
    const { pf } = await source();
    const created = pf.events.find((e) => e.type === "memory.created" && e.entityId === pf.memory.find((m) => m.version === 3)!.id)!;
    (created.data as Record<string, unknown>).title = {} as unknown as string;
    (created.data as Record<string, unknown>).body = 42 as unknown as string;
    await expect(parseArchive(await reseal(pf))).rejects.toMatchObject({ problem: "history" });
  });

  it("refuses link events with invalid data and import records inside the history", async () => {
    const { pf } = await source();
    const l = structuredClone(pf);
    (l.events.find((e) => e.type === "link.created")!.data as Record<string, unknown>).type = "owns";
    await expect(parseArchive(await reseal(l))).rejects.toMatchObject({ problem: "history" });

    const m = structuredClone(pf);
    const last = m.events.at(-1)!;
    m.events.push({ ...last, seq: last.seq + 1, type: "project.imported", entityId: undefined, data: { mode: "add", name: m.project.name, archive: "0".repeat(64), exportedAt: "2026-11-07T10:00:00.000Z", app: "x", sourceProject: m.project.id, events: 1 } } as never);
    delete (m.events.at(-1) as { entityId?: string }).entityId;
    await expect(parseArchive(await reseal(m))).rejects.toMatchObject({ problem: "inconsistent" });
  });

  it("refuses records that do not match their history (title, flags, AI entry shown as confirmed, links)", async () => {
    const { pf } = await source();
    const t = structuredClone(pf);
    const e = t.memory.find((x) => x.category === "goal")!;
    e.important = !e.important; // no event says so
    await expect(parseArchive(await reseal(t))).rejects.toMatchObject({ problem: "inconsistent" });

    const ai = structuredClone(pf);
    const pending = ai.memory.find((x) => x.confirmation === "pending")!;
    Object.assign(pending, { confirmation: "confirmed", confirmedAt: pending.createdAt }); // skip the user's confirmation
    await expect(parseArchive(await reseal(ai))).rejects.toMatchObject({ problem: "inconsistent" });

    const dropped = structuredClone(pf);
    dropped.events = dropped.events.filter((x) => x.type !== "memory.edited"); // older versions removed
    for (const x of dropped.memory) if (x.version > 1) x.version = 1;
    await expect(parseArchive(await reseal(dropped))).rejects.toMatchObject({ problem: "inconsistent" });
  });

  it("refuses link sets the app would never create (wrong category, cycle, duplicates)", async () => {
    const { pf } = await source();
    const facts = pf.memory.filter((x) => x.category === "fact" && x.confirmation === "confirmed");
    const ctx = pf.memory.find((x) => x.category === "context" && !x.archived)!;
    const addLink = async (f: ProjectFile, from: string, to: string, type: string) => {
      const id = newLinkId();
      f.links.push({ id, projectId: f.project.id, from, to, type: type as never, reason: "", createdAt: f.project.createdAt, v: 1 });
      const last = f.events.at(-1)!;
      f.events.push({ seq: last.seq + 1, ts: last.ts, type: "link.created", projectId: f.project.id, entityId: id, dataHash: "", data: { from, to, type, reason: "" }, prev: last.hash, hash: "" });
    };
    const wrongCat = structuredClone(pf);
    await addLink(wrongCat, facts[0].id, ctx.id, "replaces");
    await expect(parseArchive(await reseal(wrongCat))).rejects.toMatchObject({ problem: "inconsistent" });

    const cycle = structuredClone(pf); // fact derived_from context already exists; add context derived_from fact
    await addLink(cycle, ctx.id, facts[0].id, "derived_from");
    await expect(parseArchive(await reseal(cycle))).rejects.toMatchObject({ problem: "inconsistent" });

    const dup = structuredClone(pf); // goal related_to instruction exists; add the reverse
    const rel = dup.links.find((x) => x.type === "related_to")!;
    await addLink(dup, rel.to, rel.from, "related_to");
    await expect(parseArchive(await reseal(dup))).rejects.toMatchObject({ problem: "inconsistent" });
  });

  it("refuses removed or reordered neighbouring events, and impossible field combinations", async () => {
    const { pf } = await source();
    // remove one event between two neighbours, without re-sealing the chain (only the file fingerprint)
    const gap = structuredClone(pf);
    const i = gap.events.findIndex((e, k) => k > 0 && k < gap.events.length - 1 && gap.events[k - 1].seq + 1 === e.seq && gap.events[k + 1].seq === e.seq + 1);
    gap.events.splice(i, 1);
    const files = new Map((await archiveFiles([gap], { app: "x", exportedAt: "2026-11-07T10:00:00.000Z", scope: "project", sourceJournal: { ok: true, events: 1 } })).map((f) => [f.name, f.data]));
    await expect(parseArchive(files)).rejects.toBeInstanceOf(ArchiveError); // caught by the chain or by the replay

    const combo = structuredClone(pf);
    combo.memory.find((x) => x.confirmation === "pending")!.confirmedAt = combo.project.createdAt;
    await expect(parseArchive(await reseal(combo))).rejects.toMatchObject({ problem: "inconsistent" });

    const nh = structuredClone(pf);
    nh.project.nameHistory.push({ name: "‮evil\u0007", until: nh.project.createdAt });
    await expect(parseArchive(await reseal(nh))).rejects.toMatchObject({ problem: "invalidRecord" });
  });

  it("a re-imported copy keeps this device's import record as the latest one, with the earlier one inside", async () => {
    const a = device();
    const { p } = await rich(a);
    const b = device();
    await b.transfer.importArchive(await b.transfer.preview((await a.transfer.exportArchive([p.id])).bytes)); // add on B
    const back = await b.transfer.exportArchive([p.id]);
    const res = await a.transfer.importArchive(await a.transfer.preview(back.bytes), { [p.id]: "copy" });
    const copyId = res.imported[0].id;
    const markers = (await a.base.journal()).filter((e) => e.projectId === copyId && e.type === "project.imported");
    expect(markers).toHaveLength(1);
    expect(markers[0].data).toMatchObject({ mode: "copy", sourceProject: p.id, previous: { mode: "add", sourceProject: p.id } });
    expect((await a.memory.verify(copyId)).ok).toBe(true);
    expect((await a.memory.versions(copyId)).size).toBeGreaterThan(0);
    // and the copy exports and imports again
    const c = device();
    await c.transfer.importArchive(await c.transfer.preview((await a.transfer.exportArchive([copyId])).bytes));
    expect((await c.memory.verify(copyId)).ok).toBe(true);
  });

  it("projects with the same name inside one archive get free names", async () => {
    const a = device();
    await a.projects.create("X");
    const b = device();
    await b.projects.create("X");
    const ids = (await a.projects.list()).map((p) => p.id).concat((await b.projects.list()).map((p) => p.id));
    void ids;
    const c = device();
    await c.transfer.importArchive(await c.transfer.preview((await a.transfer.exportArchive("all")).bytes));
    await c.transfer.importArchive(await c.transfer.preview((await b.transfer.exportArchive("all")).bytes));
    expect((await c.projects.list()).map((p) => p.name).sort()).toEqual(["X", "X (2)"]);
  });

  it("a failure DURING the write transaction leaves everything as it was", async () => {
    const a = device();
    await rich(a, "Unu");
    await rich(a, "Doi");
    const all = await a.transfer.exportArchive("all");
    const b = device();
    await b.projects.create("Existent");
    const before = { projects: await b.projects.list(), journal: await b.base.journal() };
    const pv = await b.transfer.preview(all.bytes);
    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { add: (...a: unknown[]) => unknown } } }).IDBObjectStore.prototype;
    const add = proto.add;
    let n = 0;
    proto.add = function (this: unknown, ...args: unknown[]) {
      if (++n === 20) throw new DOMException("simulated full disk", "QuotaExceededError");
      return add.apply(this, args);
    };
    try {
      await expect(b.transfer.importArchive(pv)).rejects.toMatchObject({ kind: "quota" });
    } finally {
      proto.add = add;
    }
    expect(await b.projects.list()).toEqual(before.projects);
    expect(await b.base.journal()).toEqual(before.journal);
    expect((await b.base.verify()).ok).toBe(true);
    // and the same import then succeeds
    await b.transfer.importArchive(pv);
    expect((await b.projects.list()).length).toBe(3);
  });
});
