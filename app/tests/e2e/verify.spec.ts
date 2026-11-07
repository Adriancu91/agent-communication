// AIW-01 final verification (requested by Adrian and Gepeto, 7 November 2026).
// 1. where data is stored, and that nothing leaves the device;
// 2-3. real offline: load with internet, close the browser completely, cut the network, reopen;
//      every file of the app must come from the device.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

const ROUTES = ["proiecte", "memorie", "continuitate", "lansator", "setari"];
const DIST = resolve(new URL(".", import.meta.url).pathname, "../../dist");

function startServer(port: number): ChildProcess {
  return spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore", detached: true });
}
function stopServer(s: ChildProcess) {
  try {
    process.kill(-s.pid!, "SIGTERM");
  } catch {
    /* already stopped */
  }
}
const status = (url: string) => fetch(url).then((r) => r.status).catch(() => 0);

/** Everything the page asks for, and everything that failed. */
function record(page: Page) {
  const requests: string[] = [];
  const failed: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  return { requests, failed };
}

async function useEverything(page: Page) {
  for (const r of ROUTES) {
    await page.locator(`.tab[data-route="${r}"]`).click();
    await expect(page.locator("h1")).toBeVisible();
  }
  await page.getByRole("radio", { name: "English" }).click();
  await page.getByRole("radio", { name: "Română" }).click();
}

/** What the app keeps on this device. */
async function inventory(page: Page) {
  return page.evaluate(async () => ({
    localStorage: Object.keys(localStorage),
    sessionStorage: Object.keys(sessionStorage),
    cookies: document.cookie,
    indexedDB: (await indexedDB.databases?.())?.map((d) => d.name) ?? [],
    caches: await caches.keys(),
  }));
}

test.describe("AIW-01 verification", () => {
  test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== "chromium" || info.project.name !== "pc", "runs once, in Chromium");
  });

  test("1. data: projects only in the app's database on this device; nothing is sent anywhere", async ({ page }) => {
    const all: string[] = [];
    page.on("request", (r) => all.push(`${r.method()} ${r.url()}`));
    await page.goto("./#/setari");
    await expect(page.locator('[data-offline="ready"]')).toBeVisible({ timeout: 15_000 });
    await useEverything(page);
    await page.goto("./#/proiecte");
    await page.locator('[data-action="new-project"]').click();
    await page.getByLabel(/^Nume|^Name/).fill("Proiect de verificat 🔒");
    await page.locator("#project-form button[type=submit]").click();
    await expect(page.locator('[data-project="Proiect de verificat 🔒"]')).toBeVisible();
    const inv = await inventory(page);
    console.log("SALVAT PE DISPOZITIV:", JSON.stringify(inv));
    // preferences only (language, order, notices) in localStorage; the project itself is not there
    for (const k of inv.localStorage) expect(["aiw.lang", "aiw.sort", "aiw.persistAsked", "aiw.iosNotice"]).toContain(k);
    const ls = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(ls).not.toContain("verificat");
    expect(inv.sessionStorage).toEqual([]);
    expect(inv.cookies).toBe("");
    expect(inv.indexedDB).toEqual(["aiw"]);
    expect(inv.caches.every((c) => c.startsWith("aiw-"))).toBe(true);
    const stored = await page.evaluate(() => new Promise<string>((resolve) => {
      const r = indexedDB.open("aiw");
      r.onsuccess = () => {
        const g = r.result.transaction("projects").objectStore("projects").getAll();
        g.onsuccess = () => { resolve(JSON.stringify(g.result)); r.result.close(); };
      };
    }));
    expect(stored).toContain("Proiect de verificat");
    // Every request goes to the app's own address and is a GET for an app file: nothing is uploaded.
    const own = new URL(page.url()).origin;
    console.log("CERERI:", all.length, [...new Set(all.map((r) => r.replace(own, "")))].join(" | "));
    for (const r of all) expect(r.startsWith(`GET ${own}/`), r).toBe(true);
  });

  test("2-3. real offline: first load online, browser closed, network cut, app reopened", async () => {
    const port = 4600 + Math.floor(Math.random() * 300);
    const url = `http://localhost:${port}/`;
    const profile = mkdtempSync(join(tmpdir(), "aiw-profile-"));
    const server = startServer(port);
    let ctx: BrowserContext | undefined;
    try {
      await expect.poll(() => status(url), { timeout: 20_000 }).toBe(200);

      // First load, with internet.
      ctx = await chromium.launchPersistentContext(profile, { headless: true });
      const p1 = ctx.pages()[0] ?? (await ctx.newPage());
      const online = record(p1);
      await p1.goto(url + "#/setari");
      await expect(p1.locator('[data-offline="ready"]')).toBeVisible({ timeout: 15_000 });
      await useEverything(p1);
      const cached = await p1.evaluate(async () => {
        const out: string[] = [];
        for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url);
        return out;
      });
      // 3. every file the app asked for while online is in the offline cache, and every built file too
      for (const r of online.requests.filter((u) => !u.endsWith("/sw.js"))) {
        expect(cached, r).toContain(r.split("#")[0].split("?")[0]);
      }
      const sw = readFileSync(join(DIST, "sw.js"), "utf8");
      const listed = JSON.parse(/const ASSETS = (\[.*?\]);/s.exec(sw)![1]) as string[];
      expect(cached.length).toBe(listed.length);

      // Close the browser completely, then switch the "internet" off: server stopped AND every
      // connection forced through a dead proxy (nothing can be reached, not even localhost).
      await ctx.close();
      ctx = undefined;
      stopServer(server);
      await expect.poll(() => status(url), { timeout: 10_000 }).toBe(0);

      ctx = await chromium.launchPersistentContext(profile, {
        headless: true,
        args: ["--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>"],
      });
      const p2 = ctx.pages()[0] ?? (await ctx.newPage());
      const offline = record(p2);
      await p2.goto(url + "#/proiecte");
      await expect(p2.locator("h1")).toHaveText("Proiecte");
      for (const r of ROUTES) {
        await p2.locator(`.tab[data-route="${r}"]`).click();
        await expect(p2.locator("h1")).toBeVisible();
      }
      // Settings still show the saved language and "ready offline"; icons and styles loaded.
      await expect(p2.locator('[data-offline="ready"]')).toBeVisible();
      const styled = await p2.locator(".tabbar").evaluate((e) => getComputedStyle(e).position);
      expect(["fixed", "sticky"]).toContain(styled); // "static" would mean the styles did not load
      console.log("OFFLINE — cereri:", offline.requests.length, "eșuate:", offline.failed.length, offline.failed.join(" | "));
      expect(offline.failed.filter((f) => !f.includes("/sw.js"))).toEqual([]);
    } finally {
      await ctx?.close().catch(() => {});
      stopServer(server);
      rmSync(profile, { recursive: true, force: true });
    }
  });
});
