// AIW-04 in the browser: export a project, import it on a clean "device" (a new browser context),
// damaged archives, duplicates (same / changed / same name), atomicity, offline.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { addEntry, entryRow, newProject, openEntry, openMemory, seedProposal, setRo } from "./helpers";

const CATS = ["goal", "instruction", "decision", "fact", "context", "issue", "step"] as const;

/** A project with all 7 memory types, an edited entry (2 versions), a link and a pending AI proposal. */
async function richProject(page: Page, name: string) {
  const pid = await newProject(page, name);
  await openMemory(page, pid);
  for (const c of CATS) await addEntry(page, c, `${c} din ${name}`, `Text ${c}`);
  await openEntry(page, `fact din ${name}`);
  await page.getByRole("button", { name: "Editează" }).click();
  await page.locator('#entry-form textarea[name="body"]').fill("Text fact, versiunea 2");
  await page.locator('#entry-form button[type="submit"]').click();
  await expect(page.locator('[data-card="versions"] li')).toHaveCount(2);
  // a "derived from" link: fact ← context
  await page.locator('[data-action="link"]').click();
  const lf = page.locator("#link-form");
  await lf.locator('select[name="type"]').selectOption("derived_from");
  const target = lf.locator('select[name="target"] option', { hasText: `context din ${name}` });
  await lf.locator('select[name="target"]').selectOption(await target.getAttribute("value"));
  await lf.locator('button[type="submit"]').click();
  await expect(page.locator('[data-link="derived_from"]')).toHaveCount(1);
  await seedProposal(page, pid, `Propunere AI în ${name}`, "ChatGPT");
  return pid;
}

async function exportFrom(page: Page, trigger: () => Promise<void>, path: string) {
  await trigger();
  await expect(page.locator("#export-ready")).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-action="download-export"]').click()]);
  expect(dl.suggestedFilename()).toMatch(/^ai-workspace-.+\.zip$/);
  await dl.saveAs(path);
  await page.locator("#export-ready").getByRole("button", { name: "Închide" }).click();
  return path;
}

/** Offline mode is ready once the service worker controls the page; in the iPhone engine that sometimes needs one reload. */
async function waitOffline(page: Page) {
  await page.goto("./#/setari");
  await expect(async () => {
    if ((await page.locator("[data-offline]").getAttribute("data-offline")) !== "ready") {
      await page.reload();
      await expect(page.locator("[data-offline]")).toHaveAttribute("data-offline", "ready", { timeout: 3000 });
    }
  }).toPass({ timeout: 30_000 });
}

async function chooseArchive(page: Page, path: string) {
  await page.goto("./#/setari");
  await page.locator("#import-file").setInputFiles(path);
}

/** A second "device": a new browser context (empty storage) with the same phone / PC profile. */
async function cleanDevice(browser: Browser, _use: Page) {
  const u = test.info().project.use;
  const ctx = await browser.newContext({
    baseURL: u.baseURL, viewport: u.viewport, userAgent: u.userAgent, deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile, hasTouch: u.hasTouch, locale: u.locale,
  });
  const page = await ctx.newPage();
  await setRo(page);
  return page;
}

test("a project with all 7 memory types moves to a clean device without losing anything", async ({ page, browser }, info) => {
  await setRo(page);
  const pid = await richProject(page, "Oferta Brăila");
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}`);
  const zip = await exportFrom(page, () => page.locator('.actions [data-action="export-project"]').click(), info.outputPath("p.zip"));

  const other = await cleanDevice(browser, page);
  await chooseArchive(other, zip);
  const dlg = other.locator("#import-dialog");
  await expect(dlg.locator('[data-integrity="ok"]')).toBeVisible();
  const item = dlg.locator('[data-import="Oferta Brăila"]');
  await expect(item).toHaveAttribute("data-match", "new");
  await expect(item).toContainText("8 informații");
  await expect(item).toContainText("1 legături");
  await expect(item).toContainText("1 versiuni anterioare");
  await expect(item).toContainText("1 propuneri neconfirmate");
  await dlg.locator('[data-action="confirm-import"]').click();
  await expect(other.locator(".toast")).toContainText("Import reușit: 1");

  await openMemory(other, pid);
  for (const c of CATS) await expect(entryRow(other, `${c} din Oferta Brăila`).first()).toBeAttached();
  await openEntry(other, "fact din Oferta Brăila");
  await expect(other.locator('[data-card="versions"] li')).toHaveCount(2); // the earlier version came along
  await expect(other.locator('[data-link="derived_from"]')).toHaveCount(1); // and the link
  // the proposal stays a proposal, outside the official memory
  await other.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie/context`);
  await expect(other.locator('[data-ctx-item="goal din Oferta Brăila"]')).toBeVisible();
  await expect(other.locator('[data-ctx-item="Propunere AI în Oferta Brăila"]')).toHaveCount(0);
  await expect(other.locator('[data-omitted="Propunere AI în Oferta Brăila"]')).toBeVisible();
  // the destination's history verifies
  await other.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie/istoric`);
  await other.locator('[data-action="verify"]').click();
  await expect(other.locator('[data-integrity="ok"]')).toBeVisible();
  await other.context().close();
});

test("damaged or foreign files are refused and change nothing", async ({ page }, info) => {
  await setRo(page);
  await newProject(page, "Existent");
  const pid = await newProject(page, "De exportat");
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}`);
  const zip = await exportFrom(page, () => page.locator('.actions [data-action="export-project"]').click(), info.outputPath("p.zip"));

  const bytes = readFileSync(zip);
  const damaged = Buffer.from(bytes);
  // a byte inside the project's data (just before the central directory), not in the file dates
  const cdOffset = damaged.readUInt32LE(damaged.length - 22 + 16);
  damaged[cdOffset - 20] ^= 0xff;
  writeFileSync(info.outputPath("damaged.zip"), damaged);
  writeFileSync(info.outputPath("text.zip"), "nu e o arhivă");
  writeFileSync(info.outputPath("cut.zip"), bytes.subarray(0, bytes.length - 30));

  for (const [file, text] of [["damaged.zip", "deteriorată"], ["text.zip", "nu e o arhivă"], ["cut.zip", "deteriorată"]] as const) {
    await chooseArchive(page, info.outputPath(file));
    await expect(page.locator("[data-import-error]")).toContainText(text);
    await expect(page.locator("#import-dialog")).toHaveCount(0);
  }
  await page.goto("./#/proiecte");
  await expect(page.locator(".list .row")).toHaveCount(2);
});

test("duplicates: identical is skipped, a changed copy can replace, same name becomes a new copy", async ({ page, browser }, info) => {
  await setRo(page);
  const pid = await newProject(page, "Comun");
  await openMemory(page, pid);
  await addEntry(page, "goal", "Obiectiv inițial");
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}`);
  const zip = await exportFrom(page, () => page.locator('.actions [data-action="export-project"]').click(), info.outputPath("p.zip"));

  // identical: default "skip", nothing to import
  await chooseArchive(page, zip);
  await expect(page.locator('[data-import="Comun"]')).toHaveAttribute("data-match", "same");
  await expect(page.locator('[data-action="confirm-import"]')).toBeDisabled();
  await page.locator("#import-dialog").getByRole("button", { name: "Anulează" }).click();

  // changed here after the export → "replace" brings back the exported state
  await openMemory(page, pid);
  await addEntry(page, "step", "Pas adăugat după export");
  await chooseArchive(page, zip);
  const item = page.locator('[data-import="Comun"]');
  await expect(item).toHaveAttribute("data-match", "sameId");
  await item.locator('[data-choice="replace"]').click();
  await expect(page.locator("[data-replace-note]")).toBeVisible();
  // replacing needs a copy of the version here first (or an explicit "I do not need it")
  await expect(page.locator('[data-action="confirm-import"]')).toBeDisabled();
  await page.locator('[data-action="backup-before-replace"]').click();
  const [backup] = await Promise.all([page.waitForEvent("download"), page.locator('#export-ready [data-action="download-export"]').click()]);
  expect(backup.suggestedFilename()).toMatch(/^ai-workspace-comun-/);
  await page.locator("#export-ready").getByRole("button", { name: "Închide" }).click();
  await page.locator('[data-action="backup-ok"]').check();
  await page.locator('[data-action="confirm-import"]').click();
  await expect(page.locator(".toast")).toContainText("Import reușit");
  await openMemory(page, pid);
  await expect(entryRow(page, "Pas adăugat după export")).toHaveCount(0);
  await expect(entryRow(page, "Obiectiv inițial").first()).toBeAttached();

  // another device with a different project of the same name → imported as "Comun (2)"
  const other = await cleanDevice(browser, page);
  await newProject(other, "Comun");
  await chooseArchive(other, zip);
  await expect(other.locator('[data-import="Comun"]')).toHaveAttribute("data-match", "sameName");
  await expect(other.locator('[data-rename="Comun (2)"]')).toBeVisible();
  await other.locator('[data-import="Comun"] summary').click(); // the contents can be checked before importing
  await expect(other.locator('[data-import-entry="Obiectiv inițial"]')).toBeVisible();
  await other.locator('[data-action="confirm-import"]').click();
  await other.goto("./#/proiecte");
  await expect(other.locator('.row[data-project="Comun (2)"]')).toHaveCount(1);
  await other.context().close();
});

test("export all and import work without internet", async ({ page, context, browser, browserName }, info) => {
  // Same rule as the AIW-01/03 offline tests: Playwright's WebKit does not reliably start service workers,
  // so the offline part runs in the Chromium profiles; the iPhone profiles check export/import above.
  test.skip(browserName === "webkit", "offline checked in Chromium (Playwright WebKit service worker limitation)");
  await setRo(page);
  await newProject(page, "Unu");
  await newProject(page, "Doi");
  await waitOffline(page);
  await context.setOffline(true);
  await page.reload();
  const zip = await exportFrom(page, () => page.locator('[data-action="export-all"]').click(), info.outputPath("all.zip"));
  await context.setOffline(false);

  const other = await cleanDevice(browser, page);
  await waitOffline(other);
  await other.context().setOffline(true);
  await other.reload();
  await chooseArchive(other, zip);
  await expect(other.locator("#import-dialog .import-item")).toHaveCount(2);
  await other.locator('[data-action="confirm-import"]').click();
  await expect(other.locator(".toast")).toContainText("Import reușit: 2");
  await other.goto("./#/proiecte");
  await expect(other.locator(".list .row")).toHaveCount(2);
  await other.context().close();
});
