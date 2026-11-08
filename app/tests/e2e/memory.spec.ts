// AIW-03: project memory, tested on iPhone 15, iPhone SE (WebKit), Android and PC.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices, expect, test, webkit, type Page } from "@playwright/test";
import { addEntry, entryRow, newProject, openEntry, openMemory, seedProposal, setRo } from "./helpers";

const CATS = ["goal", "instruction", "decision", "fact", "context", "issue", "step"];

/** Fails the test if anything leaves the device. */
function noExternal(page: Page) {
  const out: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !/^(data|blob):/.test(u.protocol)) out.push(r.url());
  });
  return out;
}

test.beforeEach(async ({ page }) => setRo(page));

test("all seven categories: empty states, create in each, render on this screen, nothing leaves the device", async ({ page }) => {
  const ext = noExternal(page);
  const pid = await newProject(page, "Memorie completă");
  await openMemory(page, pid);
  for (const c of CATS) await expect(page.locator(`[data-section="${c}"] .empty-line`)).toHaveText("Nimic aici încă.");
  for (const c of CATS) await addEntry(page, c, `Intrare ${c} – șase ăîâșț 🚀`, "rândul 1\nrândul 2");
  for (const c of CATS) await expect(page.locator(`[data-section="${c}"] .row`)).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('[data-cat="decision"]').click();
  await expect(page.locator(".mem-section")).toHaveCount(1);
  await openEntry(page, "Intrare decision – șase ăîâșț 🚀");
  await expect(page.locator(".entry-body")).toHaveText("rândul 1\nrândul 2");
  await expect(page.locator('[data-card="provenance"]')).toContainText("Tu");
  await expect(page.locator('[data-card="provenance"]')).toContainText("nespecificată");
  expect(ext).toEqual([]);
});

test("validation keeps the dialog and the typed text; cancel saves nothing", async ({ page }) => {
  const pid = await newProject(page, "Validare");
  await openMemory(page, pid);
  await page.locator('[data-action="add-memory"]').click();
  const f = page.locator("#entry-form");
  await f.locator('textarea[name="body"]').fill("text de păstrat");
  await f.locator('button[type="submit"]').click();
  await expect(f.locator(".form-error")).toHaveText("Titlul e obligatoriu.");
  await expect(f.locator('textarea[name="body"]')).toHaveValue("text de păstrat");
  await f.getByRole("button", { name: "Anulează" }).click();
  await expect(page.locator(".mem-section .row")).toHaveCount(0);
});

test("editing creates a version; importance persists after reload", async ({ page }) => {
  const pid = await newProject(page, "Versiuni");
  await openMemory(page, pid);
  await addEntry(page, "instruction", "Regula de limbă", "Scrie în română.");
  await openEntry(page, "Regula de limbă");
  await page.getByRole("button", { name: "Editează" }).click();
  await page.locator('#entry-form textarea[name="body"]').fill("Scrie în română, simplu.");
  await page.locator('#entry-form button[type="submit"]').click();
  await expect(page.locator(".toast")).toContainText("versiune nouă");
  await expect(page.locator('[data-card="versions"] li')).toHaveCount(2);
  await expect(page.locator('[data-version="2"]')).toContainText("curentă");
  await page.locator('[data-version="1"] summary').click();
  await expect(page.locator('[data-version="1"]')).toContainText("Scrie în română.");
  await page.getByRole("button", { name: "Marchează important" }).click();
  await expect(page.locator(".badges .tag.accent").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Nu mai e important" })).toBeVisible();
  await expect(page.locator('[data-card="provenance"]')).toContainText("2");
});

test("archive, restore, permanent delete with a second confirmation (cancel changes nothing)", async ({ page }) => {
  const pid = await newProject(page, "Arhivă");
  await openMemory(page, pid);
  await addEntry(page, "fact", "De arhivat");
  await openEntry(page, "De arhivat");
  await page.locator('[data-action="archive"]').click();
  await page.goBack();
  await expect(entryRow(page, "De arhivat")).toHaveCount(0);
  await page.locator('[data-view="archive"]').click();
  await expect(entryRow(page, "De arhivat")).toBeVisible();
  await openEntry(page, "De arhivat");
  await page.locator('[data-action="restore"]').click();
  await expect(page.locator('[data-action="archive"]')).toBeVisible();
  await page.locator('[data-action="archive"]').click();
  await page.locator('[data-action="purge"]').click();
  const dlg = page.locator("#confirm");
  await expect(dlg.getByRole("button", { name: "Șterge definitiv" })).toBeDisabled();
  await dlg.getByRole("button", { name: "Anulează" }).click();
  await expect(page.locator("h1")).toHaveText("De arhivat");
  await page.locator('[data-action="purge"]').click();
  await dlg.getByRole("checkbox").check();
  await dlg.getByRole("button", { name: "Șterge definitiv" }).click();
  await expect(page).toHaveURL(/\/memorie$/);
  await page.locator('[data-view="archive"]').click();
  await expect(page.getByText("Arhiva e goală.")).toBeVisible();
});

test("replacing a decision: explicit confirmation with a reason; the old decision stays, marked replaced", async ({ page }) => {
  const pid = await newProject(page, "Decizii");
  await openMemory(page, pid);
  await addEntry(page, "decision", "Ofertăm 4,2 lei/kg", "calcul din octombrie");
  await openEntry(page, "Ofertăm 4,2 lei/kg");
  await page.locator('[data-action="replace"]').click();
  const f = page.locator("#replace-form");
  await expect(f).toContainText("Decizia veche rămâne în memorie și în istoric");
  await f.locator('input[name="title"]').fill("Ofertăm 4,5 lei/kg");
  await f.locator('button[type="submit"]').click();
  await expect(f.locator(".form-error")).toHaveText("Scrie de ce se schimbă decizia.");
  await f.locator('input[name="reason"]').fill("Prețul cuprului a crescut");
  await f.locator('button[type="submit"]').click();
  await expect(page.locator("h1")).toHaveText("Ofertăm 4,5 lei/kg");
  await expect(page.locator('[data-link="replaces"]')).toContainText("Înlocuiește: Ofertăm 4,2 lei/kg");
  await expect(page.locator('[data-link="replaces"]')).toContainText("Prețul cuprului a crescut");
  await page.locator('[data-link="replaces"] a').click();
  await expect(page.locator("h1")).toHaveText("Ofertăm 4,2 lei/kg");
  await expect(page.locator(".badges")).toContainText("Înlocuită");
  await expect(page.locator(".entry-body")).toHaveText("calcul din octombrie");
  await expect(page.locator('[data-link="replaces"]')).toContainText("Înlocuită de: Ofertăm 4,5 lei/kg");
  await expect(page.locator('[data-action="replace"]')).toHaveCount(0);
});

test("resolving a problem with a new entry: the problem stays, marked resolved, linked to its solution", async ({ page }) => {
  const pid = await newProject(page, "Probleme");
  await openMemory(page, pid);
  await addEntry(page, "issue", "Lipsește certificatul");
  await openEntry(page, "Lipsește certificatul");
  await page.locator('[data-action="resolve"]').click();
  const f = page.locator("#resolve-form");
  await f.getByRole("radio", { name: "O intrare nouă" }).click();
  await f.locator('select[name="category"]').selectOption("step");
  await f.locator('input[name="title"]').fill("Am cerut certificatul la ANPM");
  await f.locator('button[type="submit"]').click();
  await expect(page.locator(".badges")).toContainText("Rezolvată");
  await expect(page.locator('[data-link="resolves"]')).toContainText("Rezolvată de: Am cerut certificatul la ANPM");
  await expect(page.locator('[data-action="resolve"]')).toHaveCount(0);
});

test("links: related_to works; duplicates in either direction are refused with a clear message; removal", async ({ page }) => {
  const pid = await newProject(page, "Legături");
  await openMemory(page, pid);
  await addEntry(page, "goal", "Obiectivul");
  await addEntry(page, "fact", "Faptul");
  await openEntry(page, "Faptul");
  await page.locator('[data-action="link"]').click();
  await page.locator('#link-form select[name="type"]').selectOption("related_to");
  await page.locator('#link-form button[type="submit"]').click();
  await expect(page.locator('[data-link="related_to"]')).toContainText("Legată de: Obiectivul");
  await page.locator('[data-link="related_to"] a').click();
  await page.locator('[data-action="link"]').click();
  await page.locator('#link-form select[name="type"]').selectOption("related_to");
  await page.locator('#link-form select[name="target"]').selectOption({ label: "Informație: Faptul" });
  await page.locator('#link-form button[type="submit"]').click();
  await expect(page.locator("#link-form .form-error")).toHaveText("Legătura există deja.");
  await page.locator("#link-form").getByRole("button", { name: "Anulează" }).click();
  await page.locator('[data-link="related_to"] .icon-button').click();
  await page.locator("#confirm").getByRole("button", { name: "Elimină legătura" }).click();
  await expect(page.locator('[data-card="links"]')).toContainText("Nicio legătură.");
});

test("search: diacritics ignored; earlier versions only when asked; archived and pending not shown", async ({ page }) => {
  const pid = await newProject(page, "Căutare");
  await openMemory(page, pid);
  await addEntry(page, "fact", "Prețul cuprului", "Furnizor din Brăila");
  await openEntry(page, "Prețul cuprului");
  await page.getByRole("button", { name: "Editează" }).click();
  await page.locator('#entry-form textarea[name="body"]').fill("Furnizor din Iași");
  await page.locator('#entry-form button[type="submit"]').click();
  await expect(page.locator('[data-card="versions"] li')).toHaveCount(2);
  await openMemory(page, pid);
  await addEntry(page, "fact", "Brăila arhivată");
  await openEntry(page, "Brăila arhivată");
  await page.locator('[data-action="archive"]').click();
  await expect(page.locator('[data-action="restore"]')).toBeVisible(); // saved before seeding
  await seedProposal(page, pid, "Brăila propusă de AI", "ChatGPT");
  await openMemory(page, pid);
  const search = page.getByRole("searchbox");
  await search.fill("PRETUL");
  await expect(page.locator(".list .row-name")).toHaveText(["Prețul cuprului"]);
  await search.fill("braila");
  await expect(page.getByText("Nimic nu se potrivește căutării în acest proiect.")).toBeVisible();
  await page.getByLabel("Include versiunile anterioare").check();
  await expect(page.locator(".list .row-name")).toHaveText(["Prețul cuprului"]);
  await expect(page.locator(".found-old")).toContainText("versiunea 1");
  await page.locator('[data-view="archive"]').click();
  await page.getByRole("searchbox").fill("braila");
  await expect(page.locator(".list .row-name")).toHaveText(["Brăila arhivată"]);
});

test("AI proposals: pending, outside memory and context; confirm makes it official; reject archives it", async ({ page }) => {
  const pid = await newProject(page, "Propuneri");
  await openMemory(page, pid);
  await seedProposal(page, pid, "Propunere de confirmat", "Gemini, 7 nov.");
  await seedProposal(page, pid, "Propunere de respins", null);
  await page.reload();
  await expect(page.locator('[data-view="pending"]')).toContainText("(2)");
  await expect(page.locator('.mem-section .row')).toHaveCount(0);
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie/context`);
  await expect(page.locator("[data-ctx-item]")).toHaveCount(0);
  await expect(page.locator('[data-omitted="Propunere de confirmat"]')).toContainText("neconfirmată");
  await openMemory(page, pid);
  await page.locator('[data-view="pending"]').click();
  await openEntry(page, "Propunere de confirmat");
  await expect(page.locator(".card.notice")).toContainText("Nu face parte din memoria oficială");
  await expect(page.locator('[data-card="provenance"]')).toContainText("Propunere AI");
  await expect(page.locator('[data-card="provenance"]')).toContainText("Gemini, 7 nov.");
  await page.getByRole("button", { name: "Confirmă" }).click();
  await expect(page.locator(".badges")).toContainText("Propunere AI, confirmată de tine");
  await expect(page.locator('[data-card="provenance"]')).toContainText("Confirmată la");
  await openMemory(page, pid);
  await expect(page.locator('[data-section="fact"] .row')).toHaveCount(1);
  await page.locator('[data-view="pending"]').click();
  await openEntry(page, "Propunere de respins");
  await page.getByRole("button", { name: "Respinge" }).click();
  await page.locator("#confirm").getByRole("button", { name: "Respinge" }).click();
  await expect(page.locator(".card.notice")).toContainText("Respinsă");
  await expect(page.locator('[data-action="restore"]')).toHaveCount(0);
  await openMemory(page, pid);
  await expect(page.locator('[data-section="fact"] .row-name')).toHaveText(["Propunere de confirmat"]);
});

test("user text is shown as text, never run as HTML", async ({ page }) => {
  const pid = await newProject(page, "Siguranță");
  await openMemory(page, pid);
  const evil = '<img src=x onerror="document.title=\'HACK\'">';
  await addEntry(page, "fact", evil, "<script>document.title='HACK2'</script>\n<b>bold?</b>");
  await expect(page.locator(".row-name", { hasText: evil })).toBeVisible();
  await openEntry(page, evil);
  await expect(page.locator(".entry-body")).toContainText("<script>");
  expect(await page.locator("main img, main script, main b").count()).toBe(0);
  expect(await page.title()).toBe("AI Workspace");
});

test("projects are isolated: memory, search and context never show another project's entries", async ({ page }) => {
  const a = await newProject(page, "Proiect A");
  await openMemory(page, a);
  await addEntry(page, "fact", "Secretul A");
  const b = await newProject(page, "Proiect B");
  await openMemory(page, b);
  await expect(page.locator(".mem-section .row")).toHaveCount(0);
  await page.getByRole("searchbox").fill("secretul");
  await expect(page.getByText("Nimic nu se potrivește căutării în acest proiect.")).toBeVisible();
  await page.goto(`./#/proiect/${encodeURIComponent(b)}/memorie/context`);
  await expect(page.locator("main")).not.toContainText("Secretul A");
});

test("Memory tab: last used project, selector, safe fallback when it is gone, empty state without projects", async ({ page }) => {
  await page.goto("./#/memorie");
  await expect(page.getByText("Memoria aparține unui proiect.")).toBeVisible();
  const a = await newProject(page, "Primul");
  await openMemory(page, a);
  await addEntry(page, "goal", "Obiectivul primului");
  const b = await newProject(page, "Al doilea");
  await page.goto("./#/memorie");
  await expect(page.getByLabel("Proiect")).toHaveValue(b); // the project opened last
  await page.getByLabel("Proiect").selectOption({ label: "Primul" });
  await expect(entryRow(page, "Obiectivul primului")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Proiect")).toHaveValue(a);
  await page.goto(`./#/proiect/${encodeURIComponent(a)}`);
  await page.getByRole("button", { name: "Mută în coș" }).click();
  await page.locator("#confirm").getByRole("button", { name: "Mută în coș" }).click();
  await expect(page).toHaveURL(/#\/proiecte$/);
  await page.goto("./#/memorie");
  await expect(page.locator('[data-notice="fallback"]')).toContainText("Am deschis „Al doilea”");
  await expect(page.getByLabel("Proiect")).toHaveValue(b);
});

test("project page shows the memory card with counts", async ({ page }) => {
  const pid = await newProject(page, "Card");
  await expect(page.locator('[data-card="memory"]')).toContainText("Memoria e goală");
  await openMemory(page, pid);
  await addEntry(page, "goal", "O1");
  await addEntry(page, "goal", "O2");
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}`);
  await expect(page.locator('[data-card="memory"]')).toContainText("Obiective: 2");
  await page.locator('[data-action="open-memory"]').click();
  await expect(page).toHaveURL(/\/memorie$/);
});

test("history and integrity: a clean history verifies; a changed version is reported; limits are explained", async ({ page }) => {
  const pid = await newProject(page, "Integritate");
  await openMemory(page, pid);
  await addEntry(page, "fact", "Cifra", "100");
  await openEntry(page, "Cifra");
  await page.getByRole("button", { name: "Editează" }).click();
  await page.locator('#entry-form textarea[name="body"]').fill("120");
  await page.locator('#entry-form button[type="submit"]').click();
  await expect(page.locator('[data-card="versions"] li')).toHaveCount(2);
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie/istoric`);
  await expect(page.locator('[data-event="memory.edited"]')).toBeVisible();
  await page.locator('[data-action="verify"]').click();
  await expect(page.locator('[data-integrity="ok"]')).toContainText("Istoricul e întreg");
  await expect(page.locator('[data-card="integrity"]')).toContainText("Nu este o garanție absolută");
  // change the first version directly in the database, outside the app
  await page.evaluate(() => new Promise<void>((resolve) => {
    const r = indexedDB.open("aiw");
    r.onsuccess = () => {
      const tx = r.result.transaction("events", "readwrite");
      const st = tx.objectStore("events");
      const all = st.getAll();
      all.onsuccess = () => {
        const ev = all.result.find((e: { data: { body?: string } | null }) => e.data?.body === "100");
        st.put({ ...ev, data: { ...ev.data, body: "999" } });
      };
      tx.oncomplete = () => { r.result.close(); resolve(); };
    };
  }));
  await page.locator('[data-action="verify"]').click();
  await expect(page.locator('[data-integrity="bad"]')).toContainText("a fost modificat");
});

test("context preview: deterministic sections, size limit with an omission report, memory unchanged", async ({ page }) => {
  const pid = await newProject(page, "Context");
  await openMemory(page, pid);
  await addEntry(page, "instruction", "Răspunde în română");
  await addEntry(page, "goal", "Obiectiv important", "", true);
  for (let i = 0; i < 6; i++) await addEntry(page, "fact", `Fapt ${i}`, "x".repeat(400));
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie/context`);
  await expect(page.locator("[data-ctx-section]").first()).toHaveAttribute("data-ctx-section", "instruction");
  await expect(page.locator("[data-ctx-item]")).toHaveCount(8);
  await page.locator('select[name="limit"]').selectOption("2000");
  await expect(page.locator("[data-omitted]").first()).toContainText("limita de mărime");
  await expect(page.locator('[data-ctx-item="Obiectiv important"]')).toBeVisible();
  const chars = Number(await page.locator("[data-chars]").getAttribute("data-chars"));
  expect(chars).toBeLessThanOrEqual(2000);
  await openMemory(page, pid);
  await expect(page.locator('[data-section="fact"] .row')).toHaveCount(6); // the full memory is untouched
});

test("keyboard: on desktop, Add opens with Enter, Escape closes, focus is visible", async ({ page }, info) => {
  test.skip(info.project.name !== "pc", "keyboard navigation is checked on desktop");
  const pid = await newProject(page, "Tastatură");
  await openMemory(page, pid);
  await page.locator('[data-action="add-memory"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#entry-form")).toBeVisible();
  await expect(page.locator('#entry-form input[name="title"]')).toBeFocused();
  await page.keyboard.type("Scris de la tastatură");
  await page.keyboard.press("Escape");
  await expect(page.locator("#entry-form")).toBeHidden();
  await expect(page.locator('[data-action="add-memory"]')).toBeFocused(); // focus returns to the opener
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
});

test("two tabs: an entry added in one appears in the other", async ({ page, context }) => {
  const pid = await newProject(page, "Două file");
  const other = await context.newPage();
  await other.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie`);
  await openMemory(page, pid);
  await addEntry(page, "step", "Din prima filă");
  await expect(other.locator('.row[data-entry="Din prima filă"]')).toBeVisible();
  await other.close();
});

test("dark theme renders the memory screens without overflow", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const pid = await newProject(page, "Întunecat");
  await openMemory(page, pid);
  await addEntry(page, "goal", "Obiectiv în tema întunecată", "", true);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // AIW-06 (new look approved by the owner): the dark background is now a deep blue-black, not #151515;
  // what this test protects is unchanged: the dark theme is applied
  const [r, g, b] = bg.match(/\d+/g)!.map(Number);
  expect(Math.max(r, g, b), bg).toBeLessThan(40);
  await openEntry(page, "Obiectiv în tema întunecată");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("storage write failure (disk full): clear message, typed entry kept, nothing half-saved, works again after", async ({ page }) => {
  // The browser's own "disk full" error is simulated inside the page (the same DOMException the
  // browser raises), so the real interface path is tested on every engine, including the iPhone one.
  const pid = await newProject(page, "Plin");
  await openMemory(page, pid);
  await addEntry(page, "fact", "Existentă");
  await page.evaluate(() => {
    const w = window as unknown as { __add?: typeof IDBObjectStore.prototype.add };
    w.__add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function () { throw new DOMException("disk full", "QuotaExceededError"); };
  });
  await page.locator('[data-action="add-memory"]').click();
  const f = page.locator("#entry-form");
  await f.locator('select[name="category"]').selectOption("decision");
  await f.locator('input[name="title"]').fill("Nu încape");
  await f.locator('textarea[name="body"]').fill("text care nu trebuie pierdut");
  await f.locator('button[type="submit"]').click();
  await expect(f.locator(".form-error")).toContainText("Spațiu de stocare insuficient");
  await expect(f.locator('input[name="title"]')).toHaveValue("Nu încape");
  await expect(f.locator('textarea[name="body"]')).toHaveValue("text care nu trebuie pierdut");
  await page.evaluate(() => {
    const w = window as unknown as { __add: typeof IDBObjectStore.prototype.add };
    IDBObjectStore.prototype.add = w.__add;
  });
  await expect(page.locator('[data-section="decision"] .row')).toHaveCount(0); // nothing half-saved
  await f.locator('button[type="submit"]').click(); // space is back: the same dialog saves
  await expect(f).toBeHidden();
  await expect(page.locator('[data-section="decision"] .row-name')).toHaveText(["Nu încape"]);
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie/istoric`);
  await page.locator('[data-action="verify"]').click();
  await expect(page.locator('[data-integrity="ok"]')).toBeVisible();
});

test.describe("browser closed and reopened, offline", () => {
  for (const engine of ["chromium", "webkit"] as const) {
    test(`memory survives a full browser close (${engine === "webkit" ? "iPhone engine" : "Chrome/Android engine"})`, async ({ baseURL }, info) => {
      test.skip(info.project.name !== "pc", "runs once per engine");
      const profile = mkdtempSync(join(tmpdir(), `aiw-mem-${engine}-`));
      const launcher = engine === "webkit" ? webkit : chromium;
      const opts = engine === "webkit" ? { ...devices["iPhone 15"] } : {};
      try {
        let ctx = await launcher.launchPersistentContext(profile, { ...opts, headless: true, baseURL });
        let p = ctx.pages()[0] ?? (await ctx.newPage());
        await setRo(p);
        const pid = await newProject(p, "Persistă");
        await openMemory(p, pid);
        await addEntry(p, "decision", "Decizie care rămâne", "text", true);
        await ctx.close();
        ctx = await launcher.launchPersistentContext(profile, { ...opts, headless: true, baseURL });
        p = ctx.pages()[0] ?? (await ctx.newPage());
        await p.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie`);
        await expect(entryRow(p, "Decizie care rămâne")).toBeVisible();
        await openEntry(p, "Decizie care rămâne");
        await expect(p.locator(".badges .tag.accent")).toBeVisible();
        await ctx.close();
      } finally {
        rmSync(profile, { recursive: true, force: true });
      }
    });
  }
});

test("a project in the trash: its memory can be read, not changed", async ({ page }) => {
  const pid = await newProject(page, "În coș");
  await openMemory(page, pid);
  await addEntry(page, "fact", "Se poate citi");
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}`);
  await page.getByRole("button", { name: "Mută în coș" }).click();
  await page.locator("#confirm").getByRole("button", { name: "Mută în coș" }).click();
  await expect(page).toHaveURL(/#\/proiecte$/);
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie`);
  await expect(page.locator('[data-notice="read-only"]')).toContainText("poate fi doar citită");
  await expect(page.locator('[data-action="add-memory"]')).toHaveCount(0);
  await openEntry(page, "Se poate citi");
  await expect(page.locator('[data-notice="read-only"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Editează" })).toHaveCount(0);
  await expect(page.locator('[data-action="archive"]')).toHaveCount(0);
});

test("integrity without a checkpoint on this device is reported as a partial check, not as whole", async ({ page }) => {
  const pid = await newProject(page, "Parțial");
  await openMemory(page, pid);
  await addEntry(page, "fact", "F");
  await page.evaluate(() => localStorage.removeItem("aiw.checkpoint:aiw"));
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie/istoric`);
  await page.locator('[data-action="verify"]').click();
  await expect(page.locator('[data-integrity="partial"]')).toContainText("Verificare parțială");
  await expect(page.locator('[data-integrity="ok"]')).toHaveCount(0);
});
