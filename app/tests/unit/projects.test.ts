import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStore, ValidationError } from "../../src/projects";
import { StorageError, toStorageError } from "../../src/storage";

let store: ProjectStore;
let clock = 0;
beforeEach(() => {
  clock = Date.parse("2026-11-07T10:00:00Z");
  store = new ProjectStore("test-" + Math.random(), () => new Date((clock += 1000)));
});
afterEach(() => store.close());

describe("projects", () => {
  it("create, read back, journal", async () => {
    const a = await store.create("  Ofertă  Brăila ", " pentru client ");
    expect(a.name).toBe("Ofertă Brăila");
    expect(a.description).toBe("pentru client");
    expect((await store.list()).map((x) => x.id)).toEqual([a.id]);
    expect(await store.verify()).toMatchObject({ ok: true, events: 1 });
  });

  it("refuses empty or too long names and leaves nothing behind", async () => {
    await expect(store.create("   ")).rejects.toBeInstanceOf(ValidationError);
    await expect(store.create("x".repeat(81))).rejects.toMatchObject({ field: "name", reason: "tooLong" });
    await expect(store.create("ok", "d".repeat(501))).rejects.toMatchObject({ field: "description" });
    expect(await store.list()).toEqual([]);
    expect(await store.journal()).toEqual([]);
  });

  it("rename keeps the name history; same name changes nothing", async () => {
    const a = await store.create("Unu");
    await store.rename(a.id, "Doi");
    const b = await store.rename(a.id, "Trei");
    expect(b.nameHistory.map((h) => h.name)).toEqual(["Unu", "Doi"]);
    await store.rename(a.id, "Trei");
    expect((await store.journal()).length).toBe(3);
  });

  it("pinning does not change the 'recent' date", async () => {
    const a = await store.create("A");
    const b = await store.setPinned(a.id, true);
    expect(b.pinned).toBe(true);
    expect(b.updatedAt).toBe(a.updatedAt);
  });

  it("trash, restore, definitive delete only from the trash, names erased from the journal", async () => {
    const a = await store.create("Secret", "text privat");
    await store.rename(a.id, "Secret 2");
    await expect(store.purge(a.id)).rejects.toMatchObject({ kind: "conflict" });
    expect((await store.trash(a.id)).deletedAt).not.toBeNull();
    expect((await store.restore(a.id)).deletedAt).toBeNull();
    await store.trash(a.id);
    await store.purge(a.id);
    expect(await store.list()).toEqual([]);
    const j = await store.journal();
    expect(JSON.stringify(j)).not.toMatch(/Secret|privat/);
    expect(await store.verify()).toMatchObject({ ok: true, erased: 5 });
  });

  it("concurrent changes are serialised; the chain stays valid", async () => {
    const created = await Promise.all(Array.from({ length: 20 }, (_, i) => store.create(`P${i}`)));
    await Promise.all(created.map((p, i) => store.rename(p.id, `R${i}`)));
    expect((await store.list()).length).toBe(20);
    expect(await store.verify()).toMatchObject({ ok: true, events: 40 });
  });

  it("a second store on the same database sees the changes (another tab)", async () => {
    const name = "shared-" + Math.random();
    const s1 = new ProjectStore(name);
    const s2 = new ProjectStore(name);
    await s1.create("Din fila 1");
    expect((await s2.list()).map((p) => p.name)).toEqual(["Din fila 1"]);
    s1.close();
    s2.close();
  });

  it("a write that fails half-way (disk full) changes nothing; existing projects stay intact", async () => {
    const a = await store.create("Existent");
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function () {
      throw new DOMException("full", "QuotaExceededError");
    };
    try {
      await expect(store.create("Nou")).rejects.toMatchObject({ kind: "quota" });
      await expect(store.rename(a.id, "Schimbat")).rejects.toMatchObject({ kind: "quota" });
    } finally {
      IDBObjectStore.prototype.add = add;
    }
    const list = await store.list();
    expect(list.map((p) => p.name)).toEqual(["Existent"]);
    expect(list[0].nameHistory).toEqual([]);
    expect(await store.verify()).toMatchObject({ ok: true, events: 1 });
    expect((await store.rename(a.id, "După")).name).toBe("După"); // works again afterwards
  });

  it("browser errors become clear kinds", () => {
    expect(toStorageError(new DOMException("x", "QuotaExceededError")).kind).toBe("quota");
    expect(toStorageError(new DOMException("x", "InvalidStateError")).kind).toBe("closed");
    expect(toStorageError(new StorageError("blocked")).kind).toBe("blocked");
    expect(toStorageError(new Error("weird")).kind).toBe("unknown");
  });
});
