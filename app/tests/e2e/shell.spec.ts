import { spawn } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["proiecte", "memorie", "continuitate", "lansator", "setari"] as const;

/** Records every request that leaves the app's own origin, and every page error. */
function watch(page: Page) {
  const external: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !u.protocol.startsWith("data") && !u.protocol.startsWith("blob")) {
      external.push(r.url());
    }
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return { external, errors };
}

test("every screen opens, without errors and without leaving the device", async ({ page }) => {
  const w = watch(page);
  await page.goto("./");
  await expect(page.locator("h1")).toBeVisible();
  for (const r of ROUTES) {
    await page.locator(`.tab[data-route="${r}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#/${r}$`));
    await expect(page.locator(`.tab[data-route="${r}"]`)).toHaveAttribute("aria-current", "page");
    await expect(page.locator("h1")).toBeVisible();
  }
  await page.goBack();
  await expect(page).toHaveURL(/#\/lansator$/);
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test("fits the screen: no sideways scrolling, touch targets at least 44 px", async ({ page }, info) => {
  await page.goto("./#/setari");
  for (const r of ROUTES) {
    await page.goto(`./#/${r}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, r).toBeLessThanOrEqual(0);
  }
  const small = await page.$$eval("a, button", (els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => ({ t: e.textContent?.trim(), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
      .filter((b) => b.h < 44 || b.w < 44),
  );
  expect(small).toEqual([]);
  const bg = await page.locator(".tabbar").evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg, "the tab bar is opaque, text never shows through").toMatch(/^rgb\(/);
  const bar = await page.locator(".tabbar").boundingBox();
  const vp = page.viewportSize()!;
  if (info.project.name === "pc") {
    expect(bar!.x).toBe(0); // side bar on wide screens
    expect(bar!.height).toBeGreaterThan(vp.height * 0.9);
  } else {
    expect(Math.round(bar!.y + bar!.height)).toBe(vp.height); // bottom tab bar on phones
  }
});

test("Romanian / English switch, remembered after reload", async ({ page }) => {
  await page.goto("./#/setari");
  await page.getByRole("radio", { name: "English" }).click();
  await expect(page.locator("h1")).toHaveText("Settings");
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Settings");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("radio", { name: "Română" }).click();
  await expect(page.locator("h1")).toHaveText("Setări");
});

test("the security policy is active in the page", async ({ page }) => {
  await page.goto("./");
  const blocked = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/", { mode: "no-cors" });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});

test("works offline after the first load (server switched off)", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright's WebKit does not support service workers in tests; checked manually on iPhone");
  // A separate server that this test really switches off (Playwright's simulated offline mode
  // bypasses the service worker, so it does not show the real behaviour).
  const port = 4300 + Math.floor(Math.random() * 500);
  const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore", detached: true });
  const url = `http://localhost:${port}/`;
  try {
    await expect.poll(async () => (await fetch(url).then((r) => r.status).catch(() => 0)), { timeout: 20_000 }).toBe(200);
    await page.goto(url + "#/setari");
    await expect(page.locator('[data-offline="ready"]')).toBeVisible({ timeout: 15_000 });
    process.kill(-server.pid!, "SIGTERM");
    await expect.poll(async () => (await fetch(url).then((r) => r.status).catch(() => 0)), { timeout: 10_000 }).toBe(0);
    await page.reload();
    await expect(page.locator("h1")).toHaveText(/Setări|Settings/);
    await page.locator('.tab[data-route="memorie"]').click();
    await expect(page.locator("h1")).toHaveText(/Memorie|Memory/);
    await page.goto(url + "#/proiecte"); // a fresh navigation, not only a reload
    await expect(page.locator("h1")).toHaveText(/Proiecte|Projects/);
  } finally {
    try { process.kill(-server.pid!, "SIGTERM"); } catch { /* already stopped */ }
  }
});

test("adding to the home screen stays optional", async ({ page }) => {
  await page.goto("./#/setari");
  await expect(page.getByRole("heading", { name: /opțional|optional/i })).toBeVisible();
  await expect(page.locator(".card.notice")).toBeVisible(); // backup warning always shown
});
