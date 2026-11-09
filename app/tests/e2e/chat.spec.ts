// AIW-06 in the browser: the in-app chat, with a SIMULATED Puter (no real account, no network call).
// The app's vendor/puter.js is replaced by a small fake that records every call and answers from a queue.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { addEntry, newProject, openMemory, seedProposal, setRo } from "./helpers";

const FAKE_PUTER = `
(() => {
  const w = window;
  w.__puterCalls = [];
  w.__puterReplies = w.__puterReplies || [];
  const signed = () => localStorage.getItem("fake.puter") === "1";
  w.puter = {
    auth: {
      isSignedIn: signed,
      signIn: async () => { localStorage.setItem("fake.puter", "1"); return { success: true, token: "t" }; },
      signOut: () => localStorage.removeItem("fake.puter"),
      getUser: async () => { if (!signed()) throw { status: 401 }; return { username: "adrian" }; },
      getMonthlyUsage: async () => ({ allowanceInfo: { remaining: 42000000, monthUsageAllowance: 50000000 } }),
    },
    ai: {
      chat: async (messages, options) => {
        w.__puterCalls.push({ messages: JSON.parse(JSON.stringify(messages)), options: { ...options, signal: undefined } });
        const next = w.__puterReplies.shift() ?? "Răspuns de test.";
        if (typeof next === "object" && next.error) throw next.error;
        const delay = typeof next === "object" && next.slow ? next.slow : 5;
        const words = String(typeof next === "object" ? next.text : next).split(/(?<= )/);
        return (async function* () {
          for (const t of words) { await new Promise((r) => setTimeout(r, delay)); yield { type: "text", text: t }; }
          yield { type: "usage", usageDetails: { inputTokens: 1234, outputTokens: 56 } };
        })();
      },
    },
  };
})();
`;

// the offline worker would fetch vendor/puter.js itself, out of the fake's reach on WebKit: not needed here
test.use({ serviceWorkers: "block" });

const external: string[] = [];
test.beforeEach(async ({ context }) => {
  external.length = 0;
  await context.route(/\/vendor\/puter\.js(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_PUTER }));
  // nothing may reach the real Puter (or anything else) from these tests
  await context.route(/^https?:\/\/(?!localhost)/, (r) => {
    external.push(r.request().url());
    return r.abort();
  });
});
test.afterEach(() => expect(external).toEqual([]));

const queue = (page: Page, ...replies: unknown[]) => page.evaluate((r) => ((window as unknown as { __puterReplies: unknown[] }).__puterReplies = r), replies);
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __puterCalls: { messages: { role: string; content: string }[]; options: Record<string, unknown> }[] }).__puterCalls);

async function project(page: Page) {
  await setRo(page);
  // AIW-08: a new user starts on the automatic pilot; these older tests keep a fixed model, as a user who
  // chose one (the pilot has its own tests below)
  await page.evaluate(() => localStorage.setItem("aiw.chat", JSON.stringify({ model: "gemini-2.5-flash-lite" })));
  const pid = await newProject(page, "Oferta Brăila");
  await openMemory(page, pid);
  await addEntry(page, "goal", "Câștigăm licitația", "Termen: 15 decembrie");
  await addEntry(page, "decision", "Preț 4,2 lei/kg", "Stabilit cu clientul, după oferta din octombrie", true);
  await addEntry(page, "issue", "Lipsește certificatul ANPM");
  await seedProposal(page, pid, "Propunere încă neconfirmată", "ChatGPT");
  return pid;
}

async function openChat(page: Page, pid: string, connect = true) {
  await page.goto(`./#/chat/${encodeURIComponent(pid)}`);
  // AIW-09: an empty chat greets the person (its heading); a chat with messages keeps the hidden "Chat AI" heading
  await expect(page.locator("h1")).toHaveText(/Chat AI|Salut! Cu ce te ajut\?/);
  if (connect) {
    // AIW-08: no connect card in front of the chat any more; the account is in the Options menu
    await menu(page, "account");
    await menuOpen(page);
    await expect(page.locator('[data-action="account"]')).toHaveAttribute("data-account", "in");
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  }
}

/** AIW-08: the chat's options (saving, prompts, council, voice, account) are in the ⋯ menu. */
async function menuOpen(page: Page) {
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.locator('[data-action="menu"]').click();
  await expect(page.locator("#chat-menu")).toBeVisible();
}
async function menu(page: Page, action: string) {
  await menuOpen(page);
  await page.locator(`#chat-menu [data-action="${action}"]`).click();
}

async function send(page: Page, text: string) {
  await expect(page.locator("dialog[open]")).toHaveCount(0); // a closing sheet keeps the page inert for a moment
  await page.locator("#chat-input").fill(text);
  await expect(page.locator("#chat-input")).toHaveValue(text);
  await page.locator('[data-action="send"]').click();
}

test("connect once, ask, the answer streams in and is saved with the question", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await page.locator("#chat-input").fill("Unde suntem?");
  await menuOpen(page);
  await expect(page.locator('[data-action="account"]')).toContainText("adrian");
  // the saving is shown before sending (AIW-06.1: on the Saving button, details in its sheet, not over the box)
  await expect(page.locator('[data-action="economy"]')).toContainText(/−\d+%/);
  await page.keyboard.press("Escape");
  // AIW-09: the project's name is on the line under the top bar (the welcome itself greets the person)
  await expect(page.locator(".chat-project")).toHaveText("Oferta Brăila");
  await expect(page.locator("[data-empty-chat]")).toBeVisible();
  await expect(page.locator(".composer [data-estimate]")).toHaveCount(0);

  await queue(page, "Suntem la etapa de ofertă. Prețul rămâne 4,2 lei/kg.");
  await page.locator('[data-action="send"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Suntem la etapa de ofertă. Prețul rămâne 4,2 lei/kg.");
  await expect(page.locator('[data-msg="ask"] .bubble')).toHaveText("Unde suntem?");
  await expect(page.locator("[data-usage]")).toContainText("↑1.2k");

  const [c] = await calls(page);
  expect(c.options.model).toBe("gemini-2.5-flash-lite");
  expect(c.options.max_tokens).toBe(1200);
  expect(c.options.stream).toBe(true);
  const sys = c.messages[0];
  expect(sys.role).toBe("system");
  // the compact table: official memory only, with references; never a pending proposal
  expect(sys.content).toContain("memorie[3]{ref,tip,titlu,text,imp}:");
  expect(sys.content).toMatch(/D1,decizie,Preț 4,2 lei\/kg|D1,decizie,"Preț 4,2 lei\/kg"/);
  expect(sys.content).not.toContain("Propunere încă neconfirmată");
  expect(sys.content).toContain("aiw-propuneri");
  expect(c.messages.at(-1)).toEqual({ role: "user", content: "Unde suntem?" });

  // saved in the project: still there after reloading, and listed among the sessions
  await page.reload();
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(1);
  await expect(page.locator('[data-msg="ask"]')).toHaveCount(1);
  await page.goto("./#/continuitate");
  await expect(page.locator("body")).toContainText("gemini-2.5-flash-lite");
});

test("proposals in an answer wait for review; accepted ones enter the official memory", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await queue(page, `Propun doi pași.

\`\`\`aiw-propuneri
[{"tip": "pas", "titlu": "Sună clientul vineri"}, {"tip": "informatie", "titlu": "Certificatul a fost cerut", "rezolva": "P1"}]
\`\`\``);
  // AIW-09: the welcome's suggestions fill the box instead of sending; the ready-made prompt is in the Prompts sheet
  await menu(page, "prompts");
  await page.locator('[data-prompt="next"]').click();
  await page.locator('[data-action="send"]').click();
  const card = page.locator("[data-pending]");
  await expect(card).toContainText("2 propuneri pentru memorie");
  await expect(page.locator('[data-msg="pending"] .bubble')).toHaveText("Propun doi pași."); // the block is not shown as text
  // a new message waits until the proposals are reviewed
  await page.locator("#chat-input").fill("altceva");
  await expect(page.locator('[data-action="send"]')).toBeDisabled();

  await page.locator('[data-action="review"]').click();
  const dlg = page.locator("#reply-dialog");
  await expect(dlg.locator("[data-review]")).toHaveCount(2);
  // the relation (resolves P1) must be decided explicitly
  await dlg.locator('[data-review="Certificatul a fost cerut"] [data-verdict="accept"]').click();
  await dlg.locator('[data-review="Sună clientul vineri"] [data-verdict="accept"]').click();
  await dlg.locator('[data-action="save-review"]').click();
  await expect(dlg).toBeHidden();
  await expect(page.locator("[data-pending]")).toHaveCount(0);
  await expect(page.locator('[data-msg="reply"]')).toContainText("Propun doi pași.");
  await expect(page.locator('[data-msg="reply"] .msg-meta')).toContainText("2 propuneri revizuite");

  await openMemory(page, pid);
  await expect(page.locator('.row[data-entry="Sună clientul vineri"]')).toBeAttached();
  await expect(page.locator('.row[data-entry="Certificatul a fost cerut"]')).toBeAttached();
});

test("saving presets change what is sent; another model continues the same conversation", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await queue(page, "Primul răspuns.", "Al doilea răspuns.");
  await send(page, "Prima întrebare");
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(1);

  await menu(page, "economy");
  await page.locator('[data-preset-choice="max"]').click();
  await page.locator("#eco-sheet .sheet-actions .button:not(.secondary)").click();
  await menuOpen(page);
  await expect(page.locator('[data-action="economy"]')).toHaveAttribute("data-preset", "max");
  await page.keyboard.press("Escape");

  await page.locator('[data-action="model"]').click();
  await page.locator('[data-model-id="claude-haiku-5-5"]').click();
  await expect(page.locator('[data-action="model"]')).toHaveAttribute("data-model", "claude-haiku-5-5");

  await send(page, "A doua întrebare");
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(2);
  const c = (await calls(page))[1];
  expect(c.options.model).toBe("claude-haiku-5-5");
  expect(c.options.max_tokens).toBe(600);
  const sys = c.messages[0].content;
  expect(sys).toContain("memorie[1]{"); // only the important item
  expect(sys).toContain("Preț 4,2 lei/kg");
  expect(sys).not.toContain("Câștigăm licitația");
  expect(sys).toContain("telegrafice");
  // the earlier exchange travels with the new question (window of 2)
  expect(c.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  expect(c.messages[1].content).toBe("Prima întrebare");

  // two chats now (one per model), the second continuing the first
  await page.locator('[data-action="history"]').click();
  await expect(page.locator("[data-chat-item]")).toHaveCount(2);
});

test("an error is explained and the question can be retried without being saved twice", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  // AIW-06.1: with the automatic switch to the free model off, the credit error is explained here
  await page.locator('[data-action="model"]').click();
  await page.locator('#model-sheet input[name="auto-free"]').uncheck();
  await page.keyboard.press("Escape");
  await queue(page, { error: { status: 402, message: "insufficient funds" } }, "Acum merge.");
  await send(page, "Test");
  await expect(page.locator("[data-failure]")).toContainText("Creditul din contul Puter s-a terminat");
  await page.locator('[data-action="retry"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Acum merge.");
  await expect(page.locator('[data-msg="ask"]')).toHaveCount(1);
  const c = (await calls(page))[1];
  expect(c.messages.filter((m) => m.role === "user")).toHaveLength(1);
});

test("credit finished: a compact notice offers another account — the conversation stays here (AIW-09, Adrian)", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await page.locator('[data-action="model"]').click();
  await page.locator('#model-sheet input[name="auto-free"]').uncheck();
  await page.keyboard.press("Escape");
  await queue(page, { error: { status: 402, message: "insufficient funds" } }, "Merge cu noul cont.");
  await send(page, "Test");
  await expect(page.locator("[data-failure]")).toContainText("Creditul din contul Puter s-a terminat");
  const bar = page.locator("[data-credit-out]");
  await expect(bar).toContainText("rămân aici");
  // another account: sign out + sign in, in one tap; the chat and its question are still here
  await bar.locator('[data-action="switch-account"]').click();
  await expect(bar).toHaveCount(0);
  await expect(page.locator('[data-msg="ask"] .bubble')).toHaveText("Test");
  await menuOpen(page);
  await expect(page.locator('[data-action="account"]')).toHaveAttribute("data-account", "in");
  await page.keyboard.press("Escape");
  await page.locator('[data-action="retry"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Merge cu noul cont.");
  await expect(page.locator('[data-msg="ask"]')).toHaveCount(1);
  // the account sheet offers the switch too
  await menu(page, "account");
  await expect(page.locator('#chat-account [data-action="switch-account"]')).toBeVisible();
  await expect(page.locator("#chat-account")).toContainText("rămân în aplicație");
});

test("templates: a ready-made one fills the box; my own are saved and reused", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await menu(page, "prompts");
  await page.locator('[data-prompt="risks"]').click();
  await expect(page.locator("#chat-input")).toHaveValue(/riscuri/);
  await menu(page, "prompts");
  const sheet = page.locator("#prompts-sheet");
  await sheet.locator('input[name="prompt-label"]').fill("Oferta pe scurt");
  await sheet.locator('textarea[name="prompt-text"]').fill("Rezumă oferta în 3 rânduri.");
  await sheet.locator('button[type="submit"]').click();
  await expect(sheet.locator('[data-my-prompt="Oferta pe scurt"]')).toBeVisible();
  await sheet.locator(".sheet-actions .button.secondary").click();
  await page.reload();
  await page.locator("#chat-input").fill("");
  await menu(page, "prompts");
  await page.locator('[data-prompt^="U-"]').click();
  await expect(page.locator("#chat-input")).toHaveValue("Rezumă oferta în 3 rânduri.");
});

test("without a project the chat makes the first one itself; nothing is loaded from outside", async ({ page }) => {
  // AIW-09 (Adrian): nobody has to create a project before writing — the chat makes "Personal" (home.spec checks the rest)
  const external: string[] = [];
  page.on("request", (r) => { if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(r.url())) external.push(r.url()); });
  await setRo(page);
  await page.goto("./#/chat");
  await expect(page.locator(".chat-project")).toHaveText("Personal");
  await expect(page.locator("#chat-input")).toBeVisible();
  expect(external).toEqual([]);
});

test("the chat fits the screen in light and dark: no sideways scrolling, touch targets at least 44 px", async ({ page }) => {
  const pid = await project(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await openChat(page, pid, scheme === "light");
    if (scheme === "light") {
      await queue(page, "Un răspuns destul de lung ca să ocupe mai multe rânduri pe un telefon mic, cu cuvinte-foarte-lungi-fara-spatii-care-nu-au-voie-sa-impinga-pagina-in-lateral.");
      await send(page, "Test de așezare");
      await expect(page.locator('[data-msg="reply"]')).toHaveCount(1);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, scheme).toBeLessThanOrEqual(0);
    const small = await page.$$eval("a, button, textarea, select", (els) =>
      els
        .filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest(".chips"))
        .map((e) => ({ t: e.textContent?.trim().slice(0, 30), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }))
        .filter((b) => b.h < 44 || b.w < 44),
    );
    expect(small, scheme).toEqual([]);
  }
});

test("an answer that arrives after moving to another chat stays with its own chat", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await queue(page, "Primul chat.");
  await send(page, "Întrebare în primul chat");
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(1);
  await page.locator('[data-action="new-chat"]').click();
  await queue(page, { slow: 150, text: 'Propun un pas.\n\n```aiw-propuneri\n[{"tip": "pas", "titlu": "Pas din al doilea chat"}]\n```' });
  await send(page, "Întrebare în al doilea chat");
  await expect(page.locator('[data-msg="streaming"]')).toBeVisible();
  // while the answer is still coming, go back to the first chat
  await page.locator('[data-action="history"]').click();
  await expect(page.locator("[data-chat-item]")).toHaveCount(2);
  await page.locator("[data-chat-item]").last().click(); // the oldest: the first chat
  await expect(page.locator('[data-msg="ask"] .bubble')).toHaveText(["Întrebare în primul chat"]);
  await page.waitForTimeout(1200); // the slow answer has finished by now
  await expect(page.locator("[data-pending]")).toHaveCount(0); // not shown in the wrong chat
  await page.locator('[data-action="history"]').click();
  await page.locator("[data-chat-item]").first().click();
  await expect(page.locator('[data-msg="ask"] .bubble')).toHaveText(["Întrebare în al doilea chat"]);
  await expect(page.locator("[data-pending]")).toContainText("1 propuneri pentru memorie");
});

test("retry after the model changed: the question goes back into the box instead of being answered by another model", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await queue(page, { error: { status: 503, message: "upstream error" } });
  await send(page, "Întrebare care eșuează");
  await expect(page.locator("[data-failure]")).toBeVisible();
  await page.locator('[data-action="model"]').click();
  await page.locator('[data-model-id="gpt-5-nano"]').click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.locator('[data-action="retry"]').click();
  await expect(page.locator("#chat-input")).toHaveValue("Întrebare care eșuează");
  expect(await calls(page)).toHaveLength(1); // nothing was sent again
});

test("an outside reply shared to the app is never offered to an in-app chat", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await queue(page, "Ok.");
  await send(page, "Salut");
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(1);
  await page.goto("./?aiw_text=" + encodeURIComponent("Răspuns din altă aplicație") + "#/primire");
  await expect(page.locator("[data-received]")).toBeVisible();
  await expect(page.locator("[data-receive-session]")).toHaveCount(0);
});

test("Puter credit runs out: after one consent, the same question continues on the free model", async ({ page, context }) => {
  const free: { messages: { role: string; content: string }[] }[] = [];
  await context.route("https://text.pollinations.ai/openai", async (r) => {
    free.push(JSON.parse(r.request().postData()!));
    const body = ["Răspuns ", "gratuit."].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join("") + "data: [DONE]\n\n";
    await r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
  });
  const pid = await project(page);
  await openChat(page, pid);
  await queue(page, { error: { status: 402, message: "insufficient funds" } });
  await send(page, "Ce urmează?");
  // the first time, the user is asked before anything goes to the free service
  await expect(page.locator("#free-consent")).toContainText("Pollinations");
  expect(free).toHaveLength(0);
  await page.locator('[data-action="consent-free"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns gratuit.");
  await expect(page.locator('[data-action="model"]')).toHaveAttribute("data-model", "free:gpt-oss-20b");
  await expect(page.locator("[data-failure]")).toHaveCount(0);
  // the question goes once (not twice) to the free model
  expect(free[0].messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["Ce urmează?"]);
});

test("the account sheet closes with its button and by tapping outside", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await menu(page, "account");
  await expect(page.locator("#chat-account")).toBeVisible();
  await expect(page.locator("#chat-account")).not.toContainText("Deschide Puter");
  await page.locator('#chat-account [data-action="close-sheet"]').click();
  await expect(page.locator("#chat-account")).toHaveCount(0);
  await menu(page, "account");
  await expect(page.locator("#chat-account")).toBeVisible();
  await page.mouse.click(5, 5); // outside the sheet
  await expect(page.locator("#chat-account")).toHaveCount(0);
});

test("a form never closes on a tap outside it (typed text is kept)", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await menu(page, "prompts");
  const sheet = page.locator("#prompts-sheet");
  await sheet.locator('input[name="prompt-label"]').fill("Text nesalvat");
  await page.mouse.click(5, 5);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('input[name="prompt-label"]')).toHaveValue("Text nesalvat");
});

// ---------- AIW-07: files and voice ----------
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC", "base64");

test("photo, PDF and .docx are read on the device and go with the question; the photo as a picture", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await page.locator('input[name="attach"]').setInputFiles([
    { name: "lot.png", mimeType: "image/png", buffer: PNG },
    { name: "oferta.pdf", mimeType: "application/pdf", buffer: readFileSync("tests/fixtures/oferta.pdf") },
    { name: "contract.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: readFileSync("tests/fixtures/contract.docx") },
  ]);
  await expect(page.locator("[data-file]")).toHaveCount(3);
  await queue(page, "Am văzut poza, oferta și contractul.");
  await send(page, "Ce vezi?");
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Am văzut poza, oferta și contractul.");
  const last = (await calls(page))[0].messages.at(-1)! as unknown as { role: string; content: { type: string; text?: string; image_url?: { url: string } }[] };
  expect(last.role).toBe("user");
  const text = last.content.find((p) => p.type === "text")!.text!;
  expect(text).toContain("Ce vezi?");
  expect(text).toContain("Oferta DEEE pagina unu: pret 4.2 lei pe kg");
  expect(text).toContain("Pagina doi: termen 15 decembrie");
  expect(text).toContain("Contract de colectare\nCantitate: 2 tone");
  expect(text).toContain("[poză atașată: lot.png]");
  const pics = last.content.filter((p) => p.type === "image_url");
  expect(pics).toHaveLength(1);
  expect(pics[0].image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
  // saved: the question with the files' text (folded), the photo only by name; the box is empty again
  await expect(page.locator("[data-file]")).toHaveCount(0);
  await expect(page.locator('[data-msg="ask"] .ask-files summary')).toContainText("oferta.pdf");
  await page.reload();
  await expect(page.locator('[data-msg="ask"] .ask-files summary')).toContainText("contract.docx");
});

test("a model that cannot see pictures is not sent a photo", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await page.locator('[data-action="model"]').click();
  await page.locator('[data-model-id="deepseek-v4.1-flash"]').click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.locator('input[name="attach"]').setInputFiles({ name: "lot.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[data-action="send"]').click();
  await expect(page.locator(".toast")).toContainText("nu poate vedea poze");
  expect(await calls(page)).toHaveLength(0);
});

test("voice: dictation fills the box; the hands-free conversation sends at the pause and reads the answer", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__spoken = [];
    class FakeRecognition {
      lang = ""; continuous = false; interimResults = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() {
        const said = (w.__say as string[]).shift() ?? "";
        setTimeout(() => {
          if (said) this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: said } }] });
          else this.onerror?.({ error: "no-speech" });
          this.onend?.();
        }, 30);
      }
      stop() {} abort() {}
    }
    w.__say = ["Care e prețul?", "Mulțumesc"];
    for (const k of ["SpeechRecognition", "webkitSpeechRecognition"]) Object.defineProperty(window, k, { value: FakeRecognition, configurable: true, writable: true });
    const synth = { speak: (u: { text: string; onend?: () => void }) => { (w.__spoken as string[]).push(u.text); setTimeout(() => u.onend?.(), 10); }, cancel() {}, getVoices: () => [] };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    w.SpeechSynthesisUtterance = class { text: string; lang = ""; voice = null; rate = 1; onend: (() => void) | null = null; onerror = null; constructor(t: string) { this.text = t; } };
  });
  const pid = await project(page);
  await openChat(page, pid);
  // dictation only fills the box
  await page.locator('[data-action="mic"]').click();
  await expect(page.locator("#chat-input")).toHaveValue("Care e prețul?");
  expect(await calls(page)).toHaveLength(0);
  await page.locator("#chat-input").fill("");
  // hands-free: listen → send → read the answer → listen again
  await page.evaluate(() => ((window as unknown as { __say: string[] }).__say = ["Care e prețul?", ""]));
  await queue(page, "Prețul e **4,2 lei/kg**.");
  await menu(page, "hands-free");
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Prețul e 4,2 lei/kg.");
  await expect(page.locator('[data-msg="reply"] .bubble strong')).toHaveText("4,2 lei/kg"); // formatted, not raw
  // (a silent " " is spoken first, from the tap: it lets an iPhone read aloud later)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.filter((x) => x.trim()))).toEqual(["Prețul e 4,2 lei/kg."]);
  // the second listening heard nothing: the conversation stops by itself (AIW-08: its "on" pill above the box goes away)
  await expect(page.locator('.live-pills [data-action="hands-free"]')).toHaveCount(0);
  await menuOpen(page);
  await expect(page.locator('#chat-menu [data-action="hands-free"]')).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  expect((await calls(page)).map((c) => c.messages.at(-1)!.content)).toEqual(["Care e prețul?"]);
});

test("council: the same question to two models, then the judge compares; one answer saved with all three parts", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await menu(page, "council-sheet");
  const sheet = page.locator("#council-sheet");
  // default: three members; keep two
  await sheet.locator('[data-member="claude-haiku-5-5"]').click();
  await sheet.locator('[data-action="council-on"]').click();
  await expect(page.locator('[data-action="council"]')).toContainText("2 modele");
  await queue(page, "Prețul e bun.", "Prețul e prea mic.", "Sunt în dezacord: unul spune bun, altul mic. Concluzie: negociază.");
  await send(page, "E bun prețul de 4,2 lei/kg?");
  const reply = page.locator('[data-msg="reply"] .bubble');
  await expect(reply.locator("h4")).toHaveText(["Gemini 2.5 Flash-Lite", "GPT-5 nano", "Concluzia · Gemini 2.5 Flash-Lite"]);
  await expect(reply).toContainText("Prețul e bun.");
  await expect(reply).toContainText("Prețul e prea mic.");
  await expect(reply).toContainText("Concluzia · Gemini 2.5 Flash-Lite");
  await expect(reply).toContainText("Concluzie: negociază.");
  const c = await calls(page);
  expect(c.map((x) => x.options.model)).toEqual(["gemini-2.5-flash-lite", "gpt-5-nano", "gemini-2.5-flash-lite"]);
  expect(c[0].messages[0].content).toContain("Nu adăuga bloc de propuneri.");
  const judge = c[2].messages.at(-1)!.content;
  expect(judge).toContain("E bun prețul de 4,2 lei/kg?");
  expect(judge).toContain("### GPT-5 nano\nPrețul e prea mic.");
  // saved as one chat of the council
  await page.locator('[data-action="history"]').click();
  await expect(page.locator("[data-chat-item]").first()).toContainText("⚖");
});

test("code agent: a page from the answer runs isolated; its errors can be sent back to be fixed", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  const app = [
    "Iată aplicația:",
    "",
    "```html",
    "<!doctype html><html><body><h1 id='t'>Calculator DEEE</h1>",
    "<script>",
    "document.getElementById('t').textContent += ' gata';",
    "try { indexedDB.open('aiw'); document.body.append(' DB-DESCHIS'); } catch (e) { document.body.append(' DB-BLOCAT'); }",
    "fetch('https://example.com/x').then(() => document.body.append(' NET-DESCHIS'), () => document.body.append(' NET-BLOCAT'));",
    "nuExista();",
    "</script></body></html>",
    "```",
  ].join("\n");
  await queue(page, app);
  await menu(page, "prompts");
  await page.locator('[data-prompt="app"]').click();
  await expect(page.locator("#chat-input")).toHaveValue(/singur fișier HTML/);
  await page.locator("#chat-input").fill("Fă un calculator.");
  await page.locator('[data-action="send"]').click();
  await page.locator('[data-action="run-code"]').click();
  const frame = page.frameLocator("#code-preview iframe");
  await expect(frame.locator("#t")).toHaveText("Calculator DEEE gata");
  // isolated: no access to the app's database, no network
  await expect(frame.locator("body")).toContainText("DB-BLOCAT");
  await expect(frame.locator("body")).toContainText("NET-BLOCAT");
  // WebKit hides the details of errors in an isolated page ("Script error."): an error is reported either way
  await expect(page.locator("[data-preview-errors]")).toContainText(/nuExista|Script error/);
  await page.locator('[data-action="fix-code"]').click();
  await expect(page.locator("#chat-input")).toHaveValue(/(nuExista|Script error)[\s\S]*Repară-l/);
});

test("the preview page does nothing when opened outside its sandbox", async ({ page }) => {
  await page.goto("./sandbox.html");
  await page.evaluate(() => window.postMessage({ type: "aiw-run", html: "<p id='x'>RULAT</p>" }, "*"));
  await page.waitForTimeout(200);
  await expect(page.locator("#x")).toHaveCount(0);
});
