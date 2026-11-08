// AIW-06 in the browser: the in-app chat, with a SIMULATED Puter (no real account, no network call).
// The app's vendor/puter.js is replaced by a small fake that records every call and answers from a queue.
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
  await expect(page.locator("h1")).toHaveText("Chat AI");
  if (connect) {
    await expect(page.locator("[data-connect]")).toBeVisible();
    await page.locator('[data-action="connect"]').click();
    await expect(page.locator('[data-action="account"]')).toHaveAttribute("data-account", "in");
  }
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
  await expect(page.locator('[data-action="account"]')).toContainText("adrian");
  await expect(page.locator("[data-empty-chat]")).toContainText("Oferta Brăila");
  // the estimate is shown before sending; compact memory is cheaper than the full package
  await page.locator("#chat-input").fill("Unde suntem?");
  await expect(page.locator("[data-saved]")).toBeVisible();

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
  await page.locator('[data-starter="next"]').click();
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

  await page.locator('[data-action="economy"]').click();
  await page.locator('[data-preset-choice="max"]').click();
  await page.locator("#eco-sheet .sheet-actions .button:not(.secondary)").click();
  await expect(page.locator('[data-action="economy"]')).toHaveAttribute("data-preset", "max");

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
  await queue(page, { error: { status: 402, message: "insufficient funds" } }, "Acum merge.");
  await send(page, "Test");
  await expect(page.locator("[data-failure]")).toContainText("Creditul din contul Puter s-a terminat");
  await page.locator('[data-action="retry"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Acum merge.");
  await expect(page.locator('[data-msg="ask"]')).toHaveCount(1);
  const c = (await calls(page))[1];
  expect(c.messages.filter((m) => m.role === "user")).toHaveLength(1);
});

test("templates: a ready-made one fills the box; my own are saved and reused", async ({ page }) => {
  const pid = await project(page);
  await openChat(page, pid);
  await page.locator('[data-prompt="risks"]').click();
  await expect(page.locator("#chat-input")).toHaveValue(/riscuri/);
  await page.locator('[data-action="prompts"]').click();
  const sheet = page.locator("#prompts-sheet");
  await sheet.locator('input[name="prompt-label"]').fill("Oferta pe scurt");
  await sheet.locator('textarea[name="prompt-text"]').fill("Rezumă oferta în 3 rânduri.");
  await sheet.locator('button[type="submit"]').click();
  await expect(sheet.locator('[data-my-prompt="Oferta pe scurt"]')).toBeVisible();
  await sheet.locator(".sheet-actions .button.secondary").click();
  await page.reload();
  await page.locator("#chat-input").fill("");
  await page.locator('[data-prompt^="U-"]').click();
  await expect(page.locator("#chat-input")).toHaveValue("Rezumă oferta în 3 rânduri.");
});

test("without a project the chat explains what to do; nothing is loaded from outside", async ({ page }) => {
  await setRo(page);
  await page.goto("./#/chat");
  await expect(page.locator(".hero-empty")).toContainText("Pentru chat ai nevoie de un proiect.");
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
