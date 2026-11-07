// Real migration in a real browser: the AIW-02 app (built from commit fe039c0 by
// scripts/build-aiw02-baseline.mjs) creates projects; the browser is closed; the NEW app is served
// at the same address and opened with the same browser profile. Nothing may be lost.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, devices, expect, test, webkit } from "@playwright/test";
import { addEntry, entryRow } from "./helpers";

const APP = resolve(new URL(".", import.meta.url).pathname, "../..");
const BASELINE = join(APP, ".baseline", "aiw02-dist");

function serve(dir: string, port: number): ChildProcess {
  return spawn("npx", ["vite", "preview", "--outDir", dir, "--port", String(port), "--strictPort"], { cwd: APP, stdio: "ignore", detached: true });
}
function stop(s: ChildProcess) {
  try { process.kill(-s.pid!, "SIGTERM"); } catch { /* stopped */ }
}
const up = (url: string) => fetch(url).then((r) => r.status).catch(() => 0);

for (const engine of ["chromium", "webkit"] as const) {
  test(`AIW-02 data survive the upgrade to AIW-03 (${engine === "webkit" ? "iPhone engine" : "Chrome/Android engine"})`, async ({}, info) => {
    test.skip(info.project.name !== "pc", "runs once per engine");
    test.skip(!existsSync(join(BASELINE, "index.html")), "run `node scripts/build-aiw02-baseline.mjs` first");
    test.setTimeout(90_000);
    const port = 5100 + Math.floor(Math.random() * 400);
    const url = `http://localhost:${port}/`;
    const profile = mkdtempSync(join(tmpdir(), `aiw-mig-${engine}-`));
    const launcher = engine === "webkit" ? webkit : chromium;
    const opts = engine === "webkit" ? { ...devices["iPhone 15"] } : {};
    let server = serve(BASELINE, port);
    try {
      // 1. AIW-02: create, rename, pin, trash
      await expect.poll(() => up(url), { timeout: 20_000 }).toBe(200);
      let ctx = await launcher.launchPersistentContext(profile, { ...opts, headless: true });
      let p = ctx.pages()[0] ?? (await ctx.newPage());
      await p.goto(url + "#/proiecte");
      await p.evaluate(() => { localStorage.setItem("aiw.lang", "ro"); localStorage.setItem("aiw.iosNotice", "1"); });
      await p.reload();
      const mk = async (name: string, desc = "") => {
        await p.locator('[data-action="new-project"]').first().click();
        await p.locator("#project-form input").fill(name);
        if (desc) await p.locator("#project-form textarea").fill(desc);
        await p.locator("#project-form button[type=submit]").click();
        await expect(p.locator(`.row[data-project="${name}"]`)).toBeVisible();
      };
      await mk("Ofertă Brăila", "lot DEEE 12 tone");
      await mk("Șantier Iași 🏗️");
      await mk("Arhivat");
      await p.locator('.row[data-project="Ofertă Brăila"] .icon-button').click();
      await p.locator("#project-menu").getByRole("button", { name: /Editează/ }).click();
      await p.locator("#project-form input").fill("Ofertă Brăila v2");
      await p.locator("#project-form button[type=submit]").click();
      await expect(p.locator('.row[data-project="Ofertă Brăila v2"]')).toBeVisible();
      await p.locator('.row[data-project="Șantier Iași 🏗️"] .icon-button').click();
      await p.locator("#project-menu").getByRole("button", { name: /Fixează/ }).click();
      await expect(p.locator('.row[data-project="Șantier Iași 🏗️"] .pin')).toBeVisible();
      await p.locator('.row[data-project="Arhivat"] .icon-button').click();
      await p.locator("#project-menu").getByRole("button", { name: /Mută în coș/ }).click();
      await p.locator("#confirm").getByRole("button", { name: /Mută în coș/ }).click();
      await expect(p.locator('.row[data-project="Arhivat"]')).toHaveCount(0);
      const before = await p.evaluate(() => new Promise<string>((resolve) => {
        const r = indexedDB.open("aiw");
        r.onsuccess = () => {
          const tx = r.result.transaction(["projects", "events"]);
          const a = tx.objectStore("projects").getAll();
          const b = tx.objectStore("events").getAll();
          tx.oncomplete = () => { resolve(JSON.stringify([a.result.sort((x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id)), b.result])); r.result.close(); };
        };
      }));
      await ctx.close();
      stop(server);
      await expect.poll(() => up(url), { timeout: 10_000 }).toBe(0);

      // 2. AIW-03 at the same address, same browser profile
      server = serve(join(APP, "dist"), port);
      await expect.poll(() => up(url), { timeout: 20_000 }).toBe(200);
      ctx = await launcher.launchPersistentContext(profile, { ...opts, headless: true });
      p = ctx.pages()[0] ?? (await ctx.newPage());
      await p.goto(url + "#/proiecte");
      // Real update behaviour of an offline-capable app: where a service worker exists (Chromium),
      // the first open may still run the cached AIW-02 code while the new version installs in the
      // background; it takes over at the next open. Until then the database stays at version 1.
      let opens = 1;
      const dbVersion = () => p.evaluate(() => new Promise<number>((resolve) => {
        const r = indexedDB.open("aiw");
        r.onsuccess = () => { const v = r.result.version; r.result.close(); resolve(v); };
      }));
      while ((await dbVersion()) < 2 && opens < 6) {
        await p.waitForTimeout(1000);
        await p.reload();
        await expect(p.locator('[data-action="new-project"]').first()).toBeVisible();
        opens++;
      }
      console.log(`${engine}: noua versiune activă după ${opens} deschidere(i)`);
      expect(opens).toBeLessThanOrEqual(3);
      const after = await p.evaluate(() => new Promise<{ data: string; version: number; stores: string[] }>((resolve) => {
        const r = indexedDB.open("aiw");
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction(["projects", "events"]);
          const a = tx.objectStore("projects").getAll();
          const b = tx.objectStore("events").getAll();
          tx.oncomplete = () => {
            resolve({ data: JSON.stringify([a.result.sort((x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id)), b.result]), version: db.version, stores: [...db.objectStoreNames].sort() });
            db.close();
          };
        };
      }));
      expect(after.version).toBe(2);
      expect(after.stores).toEqual(["events", "links", "memory", "meta", "projects"]);
      expect(after.data).toBe(before); // projects (names, descriptions, pins, dates, trash, name history) and journal identical
      await expect(p.locator('.row[data-project="Ofertă Brăila v2"]')).toBeVisible();
      await expect(p.locator('.row[data-project="Șantier Iași 🏗️"] .pin')).toBeVisible();
      await expect(p.locator(".trash-link")).toHaveText("Coș (1)");
      await p.locator('.row[data-project="Ofertă Brăila v2"] .row-main').click();
      await expect(p.locator(".history li .row-name")).toHaveText(["Ofertă Brăila"]);
      // memory works on the migrated project, and the whole history verifies
      await p.locator('[data-action="open-memory"]').click();
      await addEntry(p, "goal", "Primul obiectiv după actualizare");
      await expect(entryRow(p, "Primul obiectiv după actualizare")).toBeVisible();
      await p.locator(".mem-links a").first().click();
      await p.locator('[data-action="verify"]').click();
      await expect(p.locator('[data-integrity="ok"]')).toBeVisible();
      await ctx.close();
    } finally {
      stop(server);
      rmSync(profile, { recursive: true, force: true });
    }
  });
}
