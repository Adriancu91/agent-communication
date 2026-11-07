// AIW-02: project manager, tested on iPhone 15, iPhone SE (WebKit = Safari's engine), Android and PC.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices, expect, test, webkit, type Page } from "@playwright/test";

async function create(page: Page, name: string, description = "") {
  const before = await page.locator(".row").count();
  await page.locator('[data-action="new-project"]').first().click();
  const form = page.locator("#project-form");
  await form.getByLabel(/^Nume|^Name/).fill(name);
  if (description) await form.locator("textarea").fill(description);
  await form.locator("button[type=submit]").click();
  await expect(form).toBeHidden();
  await expect(page.locator(".row")).toHaveCount(before + 1);
}
const row = (page: Page, name: string) => page.locator(`.row[data-project="${name}"]`);
async function menu(page: Page, name: string, item: RegExp) {
  await row(page, name).locator(".icon-button").click();
  await page.locator("#project-menu").getByRole("button", { name: item }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("./#/proiecte");
  await page.evaluate(() => localStorage.setItem("aiw.lang", "ro"));
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Proiecte");
});

test("create, open, edit description; data survive a reload", async ({ page }) => {
  await expect(page.locator(".card.empty")).toBeVisible();
  await create(page, "Ofertă Brăila", "Lot DEEE pentru client");
  await row(page, "Ofertă Brăila").locator(".row-main").click();
  await expect(page).toHaveURL(/#\/proiect\/P-/);
  await expect(page.locator("h1")).toHaveText("Ofertă Brăila");
  await expect(page.locator(".description")).toHaveText("Lot DEEE pentru client");
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Ofertă Brăila");
  await page.getByRole("link", { name: /Proiecte/ }).first().click();
  await expect(row(page, "Ofertă Brăila")).toBeVisible();
});

test("name is required; the dialog keeps what was typed", async ({ page }) => {
  await page.locator('[data-action="new-project"]').click();
  const form = page.locator("#project-form");
  await form.locator("textarea").fill("descriere păstrată");
  await form.locator("button[type=submit]").click();
  await expect(form.locator(".form-error")).toHaveText("Numele e obligatoriu.");
  await expect(form.locator("textarea")).toHaveValue("descriere păstrată");
  await form.getByLabel(/^Nume/).fill("x".repeat(81));
  await form.locator("button[type=submit]").click();
  await expect(form.locator(".form-error")).toContainText("80");
  await form.getByRole("button", { name: "Anulează" }).click();
  await expect(page.locator(".row")).toHaveCount(0);
});

test("search ignores diacritics; order recent / A–Z (Romanian rules), remembered", async ({ page }) => {
  for (const n of ["Șantier Iași", "Ăla nou", "Ala", "Zebra", "Sapte"]) await create(page, n);
  await expect(page.locator(".list .row-name")).toHaveText(["Sapte", "Zebra", "Ala", "Ăla nou", "Șantier Iași"]);
  await page.getByRole("radio", { name: "A–Z" }).click();
  await expect(page.locator(".list .row-name")).toHaveText(["Ala", "Ăla nou", "Sapte", "Șantier Iași", "Zebra"]);
  await page.reload();
  await expect(page.locator(".row")).toHaveCount(5);
  await expect(page.locator(".list .row-name")).toHaveText(["Ala", "Ăla nou", "Sapte", "Șantier Iași", "Zebra"]);
  await page.getByRole("searchbox").fill("santier iasi");
  await expect(page.locator(".list .row-name")).toHaveText(["Șantier Iași"]);
  await page.getByRole("searchbox").fill("nu există");
  await expect(page.getByText("Niciun proiect nu se potrivește căutării.")).toBeVisible();
});

test("pin to top and unpin; pinning does not change the 'recent' order", async ({ page }) => {
  for (const n of ["Primul", "Al doilea", "Al treilea"]) await create(page, n);
  await menu(page, "Primul", /Fixează sus/);
  await expect(page.locator(".row").first()).toHaveAttribute("data-project", "Primul");
  await expect(row(page, "Primul").locator(".pin")).toBeVisible();
  await page.getByRole("radio", { name: "A–Z" }).click();
  await expect(page.locator(".row").first()).toHaveAttribute("data-project", "Primul");
  await menu(page, "Primul", /Nu mai fixa/);
  await page.getByRole("radio", { name: "Recente" }).click();
  await expect(page.locator(".list .row-name")).toHaveText(["Al treilea", "Al doilea", "Primul"]);
});

test("rename keeps the history of names", async ({ page }) => {
  await create(page, "Nume vechi");
  await menu(page, "Nume vechi", /Editează/);
  await page.locator("#project-form").getByLabel(/^Nume/).fill("Nume nou");
  await page.locator("#project-form button[type=submit]").click();
  await expect(row(page, "Nume nou")).toBeVisible();
  await row(page, "Nume nou").locator(".row-main").click();
  await page.getByRole("button", { name: "Editează" }).click();
  await page.locator("#project-form").getByLabel(/^Nume/).fill("Nume final");
  await page.locator("#project-form button[type=submit]").click();
  await expect(page.locator("h1")).toHaveText("Nume final");
  await expect(page.locator(".history li .row-name")).toHaveText(["Nume nou", "Nume vechi"]);
});

test("trash with confirmation, undo, restore; definitive delete needs a second confirmation", async ({ page }) => {
  await create(page, "De șters");
  await create(page, "Rămâne");
  // cancel: nothing happens
  await menu(page, "De șters", /Mută în coș/);
  await page.locator("#confirm").getByRole("button", { name: "Anulează" }).click();
  await expect(row(page, "De șters")).toBeVisible();
  // move to trash, then undo from the toast
  await menu(page, "De șters", /Mută în coș/);
  await page.locator("#confirm").getByRole("button", { name: "Mută în coș" }).click();
  await expect(row(page, "De șters")).toBeHidden();
  await page.locator(".toast").getByRole("button", { name: "Anulează" }).click();
  await expect(row(page, "De șters")).toBeVisible();
  // trash again, restore from the trash
  await menu(page, "De șters", /Mută în coș/);
  await page.locator("#confirm").getByRole("button", { name: "Mută în coș" }).click();
  await expect(page.locator(".trash-link")).toHaveText("Coș (1)");
  await page.locator(".trash-link").click();
  await row(page, "De șters").getByRole("button", { name: "Restaurează" }).click();
  await expect(page.getByText("Coșul e gol.")).toBeVisible();
  await page.goto("./#/proiecte");
  await expect(row(page, "De șters")).toBeVisible();
  // in the trash the name keeps a readable width (it once wrapped letter by letter on narrow phones)
  await menu(page, "De șters", /Mută în coș/);
  await page.locator("#confirm").getByRole("button", { name: "Mută în coș" }).click();
  await page.goto("./#/cos");
  const nameBox = await row(page, "De șters").locator(".row-name").boundingBox();
  const rowBox = await row(page, "De șters").boundingBox();
  expect(nameBox!.width).toBeGreaterThan(rowBox!.width * 0.8);
  await row(page, "De șters").getByRole("button", { name: "Restaurează" }).click();
  await page.goto("./#/proiecte");
  // definitive: first the trash, then a dialog whose button stays disabled until the box is ticked
  await menu(page, "De șters", /Mută în coș/);
  await page.locator("#confirm").getByRole("button", { name: "Mută în coș" }).click();
  await page.goto("./#/cos");
  await row(page, "De șters").getByRole("button", { name: "Șterge definitiv" }).click();
  const dlg = page.locator("#confirm");
  const go = dlg.getByRole("button", { name: "Șterge definitiv" });
  await expect(go).toBeDisabled();
  await dlg.getByRole("button", { name: "Anulează" }).click();
  await expect(row(page, "De șters")).toBeVisible();
  await row(page, "De șters").getByRole("button", { name: "Șterge definitiv" }).click();
  await dlg.getByRole("checkbox").check();
  await go.click();
  await expect(page.getByText("Coșul e gol.")).toBeVisible();
  await page.goto("./#/proiecte");
  await expect(page.locator(".list .row-name")).toHaveText(["Rămâne"]);
  // the name is gone from the device (journal included)
  const raw = await page.evaluate(() => new Promise<string>((resolve) => {
    const r = indexedDB.open("aiw");
    r.onsuccess = () => {
      const tx = r.result.transaction(["projects", "events"]);
      const a = tx.objectStore("projects").getAll();
      const b = tx.objectStore("events").getAll();
      tx.oncomplete = () => { resolve(JSON.stringify([a.result, b.result])); r.result.close(); };
    };
  }));
  expect(raw).not.toContain("De șters");
  expect(raw).toContain("Rămâne");
});

test("Romanian letters, emoji, long names and HTML in a name stay plain text", async ({ page }) => {
  const nasty = '<img src=x onerror="document.title=\'HACK\'">';
  for (const n of ["Țară și școală 🇷🇴🚀", "a".repeat(80), nasty]) await create(page, n);
  await expect(page.locator(".row-name", { hasText: "Țară și școală 🇷🇴🚀" })).toBeVisible();
  await expect(page.locator(".row-name", { hasText: nasty })).toBeVisible();
  expect(await page.locator(".list img").count()).toBe(0);
  expect(await page.title()).toBe("AI Workspace");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("200 projects: the list, search and ordering stay fast", async ({ page }) => {
  // 200 projects written straight into the app's database (the write path itself is tested above
  // and in the unit tests); here we measure the screens.
  await page.evaluate(() => new Promise<void>((resolve) => {
    const r = indexedDB.open("aiw");
    r.onsuccess = () => {
      const tx = r.result.transaction("projects", "readwrite");
      const st = tx.objectStore("projects");
      for (let i = 0; i < 200; i++) {
        const ts = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
        st.put({ id: `P-seed-${i}`, name: `Proiect ${i} ${i % 3 ? "client" : "șantier"}`, description: "Descriere ".repeat(20),
          createdAt: ts, updatedAt: ts, pinned: i % 50 === 0, deletedAt: null, nameHistory: [], v: 1 });
      }
      tx.oncomplete = () => { r.result.close(); resolve(); };
    };
  }));
  const t0 = Date.now();
  await page.reload();
  await expect(page.locator(".row")).toHaveCount(200);
  const load = Date.now() - t0;
  const t1 = Date.now();
  await page.getByRole("searchbox").fill("santier");
  await expect(page.locator(".row")).toHaveCount(67);
  const search = Date.now() - t1;
  const t2 = Date.now();
  await page.getByRole("searchbox").fill("");
  await page.getByRole("radio", { name: "A–Z" }).click();
  await expect(page.locator(".row").nth(4)).toBeVisible();
  const sort = Date.now() - t2;
  console.log(`200 proiecte (${test.info().project.name}): încărcare ${load} ms, căutare ${search} ms, ordonare ${sort} ms`);
  expect(load).toBeLessThan(3000);
  expect(search).toBeLessThan(1000);
  expect(sort).toBeLessThan(1000);
  await page.locator(".trash-link").scrollIntoViewIfNeeded();
  await expect(page.locator(".trash-link")).toBeInViewport();
});

test("another tab sees the changes", async ({ page, context }) => {
  const other = await context.newPage();
  await other.goto("./#/proiecte");
  await create(page, "Din prima filă");
  await expect(other.locator('.row[data-project="Din prima filă"]')).toBeVisible();
  await other.close();
});

test("iPhone: clear notice about separate storage (Safari vs home screen), only on iPhone", async ({ page }, info) => {
  const iphone = info.project.name.startsWith("iphone");
  await expect(page.locator('[data-notice="ios"]')).toHaveCount(iphone ? 1 : 0);
  if (iphone) {
    await expect(page.locator('[data-notice="ios"]')).toContainText("spații de stocare separate");
    await page.getByRole("button", { name: "Am înțeles" }).click();
    await page.reload();
    await expect(page.locator('[data-notice="ios"]')).toHaveCount(0);
  }
  await page.goto("./#/setari");
  await expect(page.getByText(/alt spațiu de stocare decât Safari/)).toBeVisible(); // always explained in Settings
});

test("Settings report persistent storage honestly", async ({ page }) => {
  await create(page, "Cere stocare persistentă");
  await page.goto("./#/setari");
  const card = page.locator("[data-persist]");
  await expect(card).not.toHaveAttribute("data-persist", "unknown");
  const state = await card.getAttribute("data-persist");
  const text = await card.textContent();
  if (state === "persisted") expect(text).toContain("se pot pierde totuși");
  if (state === "not-persisted") expect(text).toContain("nu a acceptat");
  expect(text).not.toMatch(/permanent|pentru totdeauna|garantat/i);
  await expect(card).toContainText("Spațiu folosit");
});

test("not enough storage space: clear message, nothing half-saved, typed text kept", async ({ browser, baseURL, browserName }, info) => {
  test.skip(browserName !== "chromium", "the storage limit can only be lowered in Chromium (Chrome DevTools Protocol)");
  // A fresh browser whose storage limit is lowered before the app opens its database
  // (Chromium reads the limit when the storage is opened), as on a phone that is full.
  const ctx = await browser.newContext({ ...info.project.use });
  await ctx.addInitScript(() => localStorage.setItem("aiw.lang", "ro"));
  const page = await ctx.newPage();
  const origin = new URL(baseURL!).origin;
  await page.goto(origin + "/licenses.txt");
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: 1 });
  await page.goto(origin + "/#/proiecte");
  await page.locator('[data-action="new-project"]').first().click();
  const form = page.locator("#project-form");
  await form.getByLabel(/^Nume/).fill("Nu încape");
  await form.locator("textarea").fill("text care nu trebuie pierdut");
  await form.locator("button[type=submit]").click();
  await expect(form.locator(".form-error")).toContainText("Spațiu de stocare insuficient");
  await expect(form.locator(".form-error")).toContainText("NU a fost salvată");
  await expect(form.getByLabel(/^Nume/)).toHaveValue("Nu încape");
  await expect(form.locator("textarea")).toHaveValue("text care nu trebuie pierdut");
  // a second attempt gives the same clear answer; nothing was half-saved
  await form.locator("button[type=submit]").click();
  await expect(form.locator(".form-error")).toContainText("Spațiu de stocare insuficient");
  await form.getByRole("button", { name: "Anulează" }).click();
  await expect(page.locator(".row")).toHaveCount(0);
  const saved = await page.evaluate(() => new Promise<number>((resolve) => {
    const r = indexedDB.open("aiw");
    r.onsuccess = () => {
      const tx = r.result.transaction(["projects", "events"]);
      const a = tx.objectStore("projects").count();
      const b = tx.objectStore("events").count();
      tx.oncomplete = () => { resolve(a.result + b.result); r.result.close(); };
    };
  }));
  expect(saved).toBe(0);
  // the app keeps working (navigation, settings)
  await page.goto(origin + "/#/setari");
  await expect(page.locator("h1")).toHaveText("Setări");
  await ctx.close();
});

test.describe("closing the browser completely", () => {
  for (const engine of ["chromium", "webkit"] as const) {
    test(`projects are still there after the browser is closed (${engine === "webkit" ? "iPhone engine" : "Chrome/Android engine"})`, async ({ baseURL }, info) => {
      test.skip(info.project.name !== "pc", "runs once per engine");
      const profile = mkdtempSync(join(tmpdir(), `aiw-${engine}-`));
      const launcher = engine === "webkit" ? webkit : chromium;
      const opts = engine === "webkit" ? { ...devices["iPhone 15"] } : {};
      try {
        let ctx = await launcher.launchPersistentContext(profile, { ...opts, headless: true });
        let p = ctx.pages()[0] ?? (await ctx.newPage());
        await p.goto(baseURL + "#/proiecte");
        await p.evaluate(() => localStorage.setItem("aiw.lang", "ro"));
        await p.reload();
        await create(p, "Supraviețuiește închiderii ✅", "descriere");
        await menu(p, "Supraviețuiește închiderii ✅", /Fixează sus/);
        await expect(row(p, "Supraviețuiește închiderii ✅").locator(".pin")).toBeVisible(); // saved before closing
        await ctx.close();

        ctx = await launcher.launchPersistentContext(profile, { ...opts, headless: true });
        p = ctx.pages()[0] ?? (await ctx.newPage());
        await p.goto(baseURL + "#/proiecte");
        await expect(row(p, "Supraviețuiește închiderii ✅")).toBeVisible();
        await expect(row(p, "Supraviețuiește închiderii ✅").locator(".pin")).toBeVisible();
        await ctx.close();
      } finally {
        rmSync(profile, { recursive: true, force: true });
      }
    });
  }
});
