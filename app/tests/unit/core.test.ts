import { describe, expect, it } from "vitest";
import {
  charCount, checkName, cleanName, makeEvent, matches, searchKey, sortProjects, verifyChain, type JournalEvent, type Project,
} from "../../src/core";

const p = (name: string, extra: Partial<Project> = {}): Project => ({
  id: "P-" + name, name, description: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  pinned: false, deletedAt: null, nameHistory: [], v: 1, ...extra,
});

describe("names", () => {
  it("cleans and validates", () => {
    expect(cleanName("  Proiect   nou  ")).toBe("Proiect nou");
    expect(checkName("")).toBe("empty");
    expect(checkName(cleanName("   "))).toBe("empty");
    expect(checkName("a".repeat(80))).toBeNull();
    expect(checkName("a".repeat(81))).toBe("tooLong");
    expect(checkName("abc\u0007")).toBe("invalidChars");
    expect(checkName("abc‮evil")).toBe("invalidChars"); // right-to-left override (disguised names)
  });
  it("counts emoji and Romanian letters as one character each", () => {
    expect(charCount("Șantier 🏗️")).toBe(10);
    expect(checkName("🚀".repeat(80))).toBeNull();
    expect(cleanName("Șantier")).toBe("Șantier"); // decomposed comma-below becomes one letter
  });
});

describe("search and order", () => {
  it("search ignores diacritics and case", () => {
    expect(searchKey("Mămăligă ȘTIUCĂ")).toBe("mamaliga stiuca");
    expect(matches(p("Țesături și Ștergătoare"), "tesaturi")).toBe(true);
    expect(matches(p("Alt proiect"), "stergatoare")).toBe(false);
    expect(matches(p("x", { description: "Ofertă pentru Brăila" }), "braila")).toBe(true);
  });
  it("pinned first; alphabetical follows Romanian rules; recent by last change", () => {
    const list = [p("Zebra"), p("Ăla"), p("Ala"), p("Șase"), p("Sapte"), p("Pin", { pinned: true }),
      p("Nou", { updatedAt: "2026-05-01T00:00:00Z" })];
    expect(sortProjects(list, "alpha").map((x) => x.name)).toEqual(["Pin", "Ala", "Ăla", "Nou", "Sapte", "Șase", "Zebra"]);
    expect(sortProjects(list, "recent")[1].name).toBe("Nou");
    expect(sortProjects([p("proiect 10"), p("proiect 9")], "alpha").map((x) => x.name)).toEqual(["proiect 9", "proiect 10"]);
  });
});

describe("journal", () => {
  async function chain(n: number): Promise<JournalEvent[]> {
    const out: JournalEvent[] = [];
    for (let i = 0; i < n; i++) out.push(await makeEvent(out.at(-1) ?? null, `2026-01-0${i + 1}T00:00:00Z`, "project.renamed", "P-1", { name: `n${i}` }));
    return out;
  }
  it("a clean chain verifies", async () => {
    expect(await verifyChain(await chain(4))).toMatchObject({ ok: true, events: 4 });
  });
  it("any change is detected: content, order, removal", async () => {
    const c = await chain(4);
    expect((await verifyChain(c.map((e, i) => (i === 1 ? { ...e, data: { name: "fals" } } : e)))).ok).toBe(false);
    expect((await verifyChain(c.map((e, i) => (i === 2 ? { ...e, ts: "2030-01-01T00:00:00Z" } : e)))).ok).toBe(false);
    expect((await verifyChain([c[0], c[2], c[3]])).ok).toBe(false);
  });
  it("erased content (definitive delete) keeps the chain valid", async () => {
    const c = await chain(3);
    const r = await verifyChain(c.map((e, i) => (i === 1 ? { ...e, data: null } : e)));
    expect(r).toMatchObject({ ok: true, erased: 1 });
  });
});
