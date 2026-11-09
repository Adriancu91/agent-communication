// AIW-09 in the browser: the chat as the home screen (no project to make first), the welcome, what people
// expect from a chat (regenerate, edit, export, titles and search in the history) and free pictures.
// The free text service and the picture service are SIMULATED: nothing leaves the device.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDGooorqPuj/9k=",
  "base64",
);

const SSE = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;

interface World {
  external: string[];
  free: { messages: { role: string; content: string }[] }[];
  images: string[];
  /** how many times Puter.js was requested (AIW-09: not at all for someone who never signed in) */
  puterLoads: number;
  /** what the picture service answers next: a picture, or the free limit */
  imageMode: { next: "ok" | "limit" };
}

/** Both free services simulated; every other outside request is recorded and refused. */
async function setup(page: Page, opts: { lang?: "ro" | "en" } = {}): Promise<World> {
  const w: World = { external: [], free: [], images: [], puterLoads: 0, imageMode: { next: "ok" } };
  await page.context().route(/^https?:\/\/(?!localhost)/, (r) => (w.external.push(r.request().url()), r.abort()));
  await page.context().route(/\/vendor\/puter\.js(\?.*)?$/, (r) => (w.puterLoads++, r.fulfill({ status: 200, contentType: "text/javascript", body: "window.puter={auth:{isSignedIn:()=>false,signIn:async()=>{throw new Error('no')},getUser:async()=>{throw {status:401}}},ai:{}};" })));
  await page.context().route("https://text.pollinations.ai/openai", async (r) => {
    const body = JSON.parse(r.request().postData()!) as World["free"][number];
    w.free.push(body);
    const q = body.messages.at(-1)!.content;
    await r.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: SSE(`Răspuns la: ${q.slice(0, 40)}`) });
  });
  await page.context().route(/^https:\/\/image\.pollinations\.ai\//, async (r) => {
    w.images.push(r.request().url());
    if (w.imageMode.next === "limit") {
      return r.fulfill({ status: 402, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "access-control-expose-headers": "Retry-After", "retry-after": "30" },
        body: JSON.stringify({ status: 402, success: false, error: { code: "FREE_LIMIT", message: "Free limit reached: 1 image every 45 seconds per IP. Retry after 30s" } }) });
    }
    await r.fulfill({ status: 200, headers: { "content-type": "image/jpeg", "access-control-allow-origin": "*" }, body: TINY_JPEG });
  });
  await page.goto("./");
  await page.evaluate((lang) => { localStorage.setItem("aiw.lang", lang); localStorage.setItem("aiw.iosNotice", "1"); }, opts.lang ?? "ro");
  await page.reload();
  return w;
}

/** The first message: the pilot asks once for the consent (it uses the free service). */
async function firstSend(page: Page, text: string) {
  await page.locator("#chat-input").fill(text);
  await page.locator('[data-action="send"]').click();
  await expect(page.locator("#pilot-consent")).toBeVisible();
  await page.locator('[data-action="pilot-yes"]').click();
}
async function say(page: Page, text: string) {
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.locator("#chat-input").fill(text);
  await page.locator('[data-action="send"]').click();
}

test("you open the app and write: the chat is the home screen, a first project is made, nothing leaves the device", async ({ page }) => {
  const w = await setup(page);
  await expect(page).toHaveURL(/\/$|#\/$/);
  await expect(page.locator("h1")).toHaveText("Salut! Cu ce te ajut?");
  await expect(page.locator(".chat-project")).toHaveText("Personal");
  await expect(page.locator("#chat-input")).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(4);
  await expect(page.locator("[data-why-chips] li")).toHaveCount(3);
  await expect(page.locator("[data-starter]")).toHaveCount(6);
  await expect(page.locator('[data-action="import-link"]')).toBeVisible();
  // exactly one project was made, once (a reload makes no second one)
  await page.goto("./#/proiecte");
  await expect(page.locator(".row[data-project]")).toHaveCount(1);
  await expect(page.locator('.row[data-project="Personal"]')).toBeVisible();
  await page.goto("./");
  await page.reload();
  await page.goto("./#/proiecte");
  await expect(page.locator(".row[data-project]")).toHaveCount(1);
  expect(w.external).toEqual([]);

  // the first message: one consent, then the free model answers (no account)
  await page.goto("./");
  await firstSend(page, "Ce e un recuperator de căldură?");
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns la: Ce e un recuperator de căldură?");
  expect(w.free).toHaveLength(1);
  // an unknown address also opens the chat
  await page.goto("./#/ceva-ce-nu-exista");
  await expect(page.locator("#chat-input")).toBeVisible();
  expect(w.external).toEqual([]);
  // Puter.js (half a megabyte) was never loaded: this person never signed in; it loads when they tap Connect
  expect(w.puterLoads).toBe(0);
  await page.locator('[data-action="menu"]').click();
  await page.locator('#chat-menu [data-action="account"]').click();
  await expect.poll(() => w.puterLoads).toBe(1);
});

test("a suggestion fills the box (and can be completed) instead of sending by itself", async ({ page }) => {
  await setup(page);
  await page.locator('[data-starter="explain"]').click();
  await expect(page.locator("#chat-input")).toHaveValue(/^Explică-mi simplu/);
  await expect(page.locator('[data-msg="ask"]')).toHaveCount(0);
  await page.locator('[data-starter="image"]').click();
  await expect(page.locator("#chat-input")).toHaveValue("/imagine ");
});

test("regenerate asks the same question again; edit puts a question back in the box; the answer can be exported", async ({ page }) => {
  const w = await setup(page);
  await firstSend(page, "Prima întrebare");
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(1);
  await page.locator('[data-action="regenerate"]').click();
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(2);
  await expect(page.locator('[data-msg="ask"]')).toHaveCount(2);
  expect(w.free[1].messages.at(-1)!.content).toBe("Prima întrebare");
  // only the last answer has the button
  await expect(page.locator('[data-action="regenerate"]')).toHaveCount(1);
  await page.locator('[data-action="edit"]').first().click();
  await expect(page.locator("#chat-input")).toHaveValue("Prima întrebare");
  await expect(page.locator("#chat-input")).toBeFocused();

  // export: a markdown file with both sides
  await page.locator('[data-action="menu"]').click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-action="export-chat"]').click()]);
  expect(dl.suggestedFilename()).toBe("Prima-intrebare.md");
  const text = readFileSync((await dl.path())!, "utf8");
  expect(text).toContain("# Prima întrebare");
  expect(text).toContain("**Tu**");
  expect(text).toContain("Răspuns la: Prima întrebare");
  expect(text).toContain("Proiect: Personal");
});

test("the history shows titles from the first question, finds words without diacritics and leads to the import", async ({ page }) => {
  await setup(page);
  await firstSend(page, "Cât costă transportul la Brăila?");
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(1);
  for (const q of ["Oferta pentru fier vechi", "Ce acte trebuie la vamă?", "Program de lucru sâmbăta"]) {
    await page.locator('[data-action="new-chat"]').click();
    await say(page, q);
    await expect(page.locator('[data-msg="reply"]')).toHaveCount(1);
  }
  await page.locator('[data-action="history"]').click();
  const sheet = page.locator("#chat-history");
  await expect(sheet.locator("[data-chat-item]")).toHaveCount(4);
  await expect(sheet.locator(".chat-row-title").first()).toHaveText("Program de lucru sâmbăta");
  await expect(sheet.locator('[data-chat-item][aria-current="true"] .chat-row-title')).toHaveText("Program de lucru sâmbăta");
  await sheet.locator('input[name="search-chats"]').fill("braila transport");
  await expect(sheet.locator("[data-chat-item]")).toHaveCount(1);
  await expect(sheet.locator(".chat-row-title")).toHaveText("Cât costă transportul la Brăila?");
  await sheet.locator('input[name="search-chats"]').fill("nimic-din-astea");
  await expect(sheet.locator("[data-chat-item]")).toHaveCount(0);
  await expect(sheet).toContainText("Nicio conversație");
  await sheet.locator('input[name="search-chats"]').fill("");
  await sheet.locator('[data-chat-item]').nth(2).click(); // "Oferta pentru fier vechi"
  await expect(page.locator('[data-msg="ask"] .bubble')).toHaveText("Oferta pentru fier vechi");
  await page.locator('[data-action="history"]').click();
  await expect(sheet.locator('[data-action="import-link"]')).toHaveAttribute("href", "#/import");
});

test("a description becomes a picture (free service, one consent), kept on the device and shown large; the limit shows how long to wait", async ({ page }) => {
  const w = await setup(page);
  await page.locator("#chat-input").fill("Fă o imagine cu un far pe o stâncă, la apus");
  await page.locator('[data-action="send"]').click();
  // the picture service is also the free service: one consent, then the picture
  await expect(page.locator("#image-consent")).toBeVisible();
  expect(w.images).toEqual([]);
  await page.locator('[data-action="image-yes"]').click();
  await expect(page.locator('[data-msg="reply"] [data-gen-image] img')).toBeVisible();
  expect(w.images).toHaveLength(1);
  expect(w.images[0]).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\/F%C4%83%20o%20imagine%20cu%20un%20far.*model=sana.*safe=true/);
  expect(w.free).toHaveLength(0); // no text model was asked
  await expect(page.locator('[data-msg="reply"] .msg-meta')).toContainText("Pollinations");
  // shown from the device's cache (an object address), not asked again
  await expect(page.locator("[data-gen-image] img")).toHaveAttribute("src", /^blob:/);
  await page.locator("[data-gen-image]").click();
  await expect(page.locator("#image-lightbox img")).toBeVisible();
  await expect(page.locator("#image-lightbox")).toContainText("Fă o imagine cu un far");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-action="save-image"]').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.jpg$/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#image-lightbox")).toHaveCount(0);
  // after a reload the picture is still there, still from the cache, still without a new request
  await page.reload();
  await expect(page.locator("[data-gen-image] img")).toHaveAttribute("src", /^blob:/);
  expect(w.images).toHaveLength(1);

  // a second picture at once: the app knows the free rule — the text stays in the box, nothing is asked or saved
  await say(page, "/imagine un far ziua");
  await expect(page.locator(".toast")).toContainText("Mai așteaptă");
  await expect(page.locator("#chat-input")).toHaveValue("/imagine un far ziua");
  expect(w.images).toHaveLength(1);
  await expect(page.locator('[data-msg="ask"]')).toHaveCount(1);

  // the bytes gone from this device (Settings → Storage): a placeholder, loaded only on request and only outside the 45 s
  await page.goto("./#/setari");
  await expect(page.locator("[data-pictures]")).toHaveAttribute("data-pictures", "1");
  await page.locator('[data-action="clear-pictures"]').click();
  await expect(page.locator("[data-pictures]")).toHaveCount(0);
  await page.goto("./");
  await expect(page.locator("[data-image-missing]")).toBeVisible();
  expect(w.images).toHaveLength(1); // nothing fetched on its own
  await page.locator("[data-image-missing]").click();
  await expect(page.locator(".toast")).toContainText("Mai așteaptă");
  expect(w.images).toHaveLength(1);
  await page.evaluate(() => localStorage.removeItem("aiw.image.last")); // 45 s later
  await page.locator("[data-image-missing]").click();
  await expect(page.locator("[data-gen-image] img")).toBeVisible();
  expect(w.images).toHaveLength(2);
});

test("a picture line written by a model is never shown or fetched as a picture", async ({ page }) => {
  const w = await setup(page);
  // the free text model answers with an image line (its own service's address)
  await page.context().route("https://text.pollinations.ai/openai", async (r) => {
    w.free.push(JSON.parse(r.request().postData()!));
    await r.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" },
      body: SSE("Uite: ![x](https://image.pollinations.ai/prompt/x?width=1024&height=1024&seed=1&model=sana&safe=true&nofeed=true)") });
  });
  await firstSend(page, "Spune ceva");
  await expect(page.locator('[data-msg="reply"] .bubble')).toContainText("![x](https://image.pollinations.ai/prompt/x");
  await expect(page.locator("[data-gen-image], [data-image-missing], .bubble img")).toHaveCount(0);
  expect(w.images).toEqual([]);
});

test("the service's own refusal (free limit) is read, with its waiting time", async ({ page }) => {
  const w = await setup(page);
  w.imageMode.next = "limit";
  await page.locator("#chat-input").fill("/imagine o pisică");
  await page.locator('[data-action="send"]').click();
  await page.locator('[data-action="image-yes"]').click();
  await expect(page.locator("[data-failure]")).toContainText("45 de secunde");
  await expect(page.locator('[data-action="retry"]')).toContainText(/\(\d+ s\)/);
  expect(w.images).toHaveLength(1);
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(0);
});

test("Settings: why here, and the tools that left the tab bar", async ({ page }) => {
  await setup(page);
  await page.locator('.tab[data-route="setari"]').click();
  await expect(page.locator("[data-why] li")).toHaveCount(5);
  await expect(page.locator('[data-tools] a[data-route="import"]')).toHaveAttribute("href", "#/import");
  await expect(page.locator('[data-tools] a[data-route="continuitate"]')).toHaveAttribute("href", "#/continuitate");
  await page.locator('[data-tools] a[data-route="import"]').click();
  await expect(page.locator("h1")).toHaveText("Import");
  await page.goto("./#/continuitate");
  await expect(page.locator("h1")).toHaveText("Continuitate");
});

test("English: the welcome and the suggestions are translated", async ({ page }) => {
  await setup(page, { lang: "en" });
  await expect(page.locator("h1")).toHaveText("Hi! What can I do for you?");
  await expect(page.locator('[data-starter="image"]')).toHaveText(/Make a picture/);
  await expect(page.locator(".tab")).toHaveText(["Chat", "Projects", "Memory", "Settings"]);
});
