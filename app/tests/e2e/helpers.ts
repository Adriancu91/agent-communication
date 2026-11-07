// Shared helpers for the browser tests.
import { expect, type Page } from "@playwright/test";
import { makeEvent, newEntryId, type JournalEvent, type MemoryEntry } from "../../src/core";

export async function setRo(page: Page) {
  await page.goto("./#/proiecte");
  await page.evaluate(() => { localStorage.setItem("aiw.lang", "ro"); localStorage.setItem("aiw.iosNotice", "1"); });
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Proiecte");
}

export async function newProject(page: Page, name: string) {
  await page.goto("./#/proiecte");
  await page.locator('[data-action="new-project"]').first().click();
  await page.locator("#project-form input").fill(name);
  await page.locator("#project-form button[type=submit]").click();
  await expect(page.locator("#project-form")).toBeHidden();
  await page.locator(`.row[data-project="${name}"] .row-main`).click();
  await expect(page.locator("h1")).toHaveText(name);
  return decodeURIComponent(/#\/proiect\/([^/]+)$/.exec(page.url())![1]);
}

export async function openMemory(page: Page, projectId: string) {
  await page.goto(`./#/proiect/${encodeURIComponent(projectId)}/memorie`);
  await expect(page.locator('[data-action="add-memory"]')).toBeVisible();
}

export async function addEntry(page: Page, category: string, title: string, body = "", important = false) {
  await page.locator('[data-action="add-memory"]').click();
  const f = page.locator("#entry-form");
  await f.locator('select[name="category"]').selectOption(category);
  await f.locator('input[name="title"]').fill(title);
  if (body) await f.locator('textarea[name="body"]').fill(body);
  if (important) await f.locator('input[name="important"]').check();
  await f.locator('button[type="submit"]').click();
  await expect(f).toBeHidden();
  await expect(page.locator(`.row[data-entry="${title.replace(/"/g, '\\"')}"]`).first()).toBeAttached();
}

export const entryRow = (page: Page, title: string) => page.locator(`.row[data-entry="${title.replace(/"/g, '\\"')}"]`);

export async function openEntry(page: Page, title: string) {
  await entryRow(page, title).first().locator(".row-main").click();
  await expect(page.locator("h1")).toHaveText(title);
}

/**
 * Inserts an AI proposal exactly as MemoryStore.propose would (same record, same fingerprinted event),
 * since AIW-03 has no AI integration to create one through the interface.
 */
export async function seedProposal(page: Page, projectId: string, title: string, source: string | null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const tail = await page.evaluate(() => new Promise<{ seq: number; hash: string } | null>((resolve) => {
      const r = indexedDB.open("aiw");
      r.onsuccess = () => {
        const c = r.result.transaction("events").objectStore("events").openCursor(null, "prev");
        c.onsuccess = () => { const v = c.result?.value as JournalEvent | undefined; resolve(v ? { seq: v.seq, hash: v.hash } : null); r.result.close(); };
      };
    }));
    const ts = new Date().toISOString();
    const entry: MemoryEntry = {
      id: newEntryId(), projectId, category: "fact", title, body: "", important: false, status: "active", archived: false,
      author: "ai", source, confirmation: "pending", confirmedAt: null, createdAt: ts, updatedAt: ts, version: 1, v: 1,
    };
    const ev = await makeEvent(tail, ts, "memory.created", projectId, {
      category: "fact", title, body: "", important: false, author: "ai", source, confirmation: "pending", version: 1,
    }, entry.id);
    // written only if the journal did not move meanwhile (same rule as the app's write path)
    const ok = await page.evaluate(([entry, ev, tailSeq]) => new Promise<boolean>((resolve) => {
      const r = indexedDB.open("aiw");
      r.onsuccess = () => {
        const tx = r.result.transaction(["memory", "events"], "readwrite");
        const c = tx.objectStore("events").openCursor(null, "prev");
        c.onsuccess = () => {
          const seq = (c.result?.value as JournalEvent | undefined)?.seq ?? 0;
          if (seq !== tailSeq) { tx.abort(); return; }
          tx.objectStore("memory").add(entry);
          tx.objectStore("events").add(ev);
        };
        tx.oncomplete = () => {
          localStorage.setItem("aiw.checkpoint:aiw", JSON.stringify({ seq: (ev as JournalEvent).seq, hash: (ev as JournalEvent).hash }));
          r.result.close();
          resolve(true);
        };
        tx.onabort = () => { r.result.close(); resolve(false); };
      };
    }), [entry, ev, tail?.seq ?? 0] as const);
    if (ok) return entry.id;
  }
  throw new Error("could not seed the proposal");
}
