// AIW-08 in the browser: the clean chat and the automatic pilot. Puter and the free service are both
// SIMULATED (no account, no network): the fake Puter records its calls; the free service answers by role.
import { expect, test, type Page } from "@playwright/test";
import { addEntry, newProject, openMemory, setRo } from "./helpers";

const FAKE_PUTER = `
(() => {
  const w = window;
  w.__puterCalls = [];
  const signed = () => localStorage.getItem("fake.puter") === "1";
  w.puter = {
    auth: {
      isSignedIn: signed,
      signIn: async () => { localStorage.setItem("fake.puter", "1"); return { success: true }; },
      signOut: () => localStorage.removeItem("fake.puter"),
      getUser: async () => { if (!signed()) throw { status: 401 }; return { username: "adrian" }; },
      getMonthlyUsage: async () => ({ allowanceInfo: { remaining: 42000000, monthUsageAllowance: 50000000 } }),
    },
    ai: {
      chat: async (messages, options) => {
        w.__puterCalls.push({ messages: JSON.parse(JSON.stringify(messages)), options: { ...options, signal: undefined } });
        const text = "Răspuns Puter " + w.__puterCalls.length + ".";
        return (async function* () { yield { type: "text", text }; yield { type: "usage", usageDetails: { inputTokens: 900, outputTokens: 40 } }; })();
      },
    },
  };
})();
`;

test.use({ serviceWorkers: "block" });

type Sent = { messages: { role: string; content: string }[] };
const SSE = (text: string) => text.split(/(?<= )/).map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join("") + "data: [DONE]\n\n";

/** The free service: the dispatch answer is set per test; summaries and passages are recognized by their instructions. */
async function setup(page: Page, opts: { signed: boolean; dispatch?: string | 429 }) {
  const free: Sent[] = [];
  const external: string[] = [];
  await page.context().route(/^https?:\/\/(?!localhost)/, (r) => (external.push(r.request().url()), r.abort()));
  await page.context().route(/\/vendor\/puter\.js(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_PUTER }));
  await page.context().route("https://text.pollinations.ai/openai", async (r) => {
    const body = JSON.parse(r.request().postData()!) as Sent;
    free.push(body);
    const sys = body.messages[0].content;
    const reply = sys.startsWith("Rezumă discuția") ? "REZUMAT-TEST: prețul rămâne 4,2 lei/kg."
      : sys.startsWith("Din documentele de mai jos") ? "EXTRAS-TEST: Prețul din document este 4,2 lei/kg, termen 15 decembrie."
      : sys.includes("REGULĂ DE PILOT") ? (opts.dispatch ?? "Salut! Cu ce te ajut?")
      : "Răspuns gratuit.";
    if (reply === 429) return r.fulfill({ status: 429, body: "busy" });
    await r.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: SSE(String(reply)) });
  });
  await setRo(page);
  // AIW-09: Puter.js is loaded at start only for someone who signed in before (the app's note of it)
  if (opts.signed) await page.evaluate(() => { localStorage.setItem("fake.puter", "1"); localStorage.setItem("aiw.puter.used", "1"); });
  const pid = await newProject(page, "Oferta Brăila");
  await openMemory(page, pid);
  await addEntry(page, "decision", "Preț 4,2 lei/kg", "Stabilit cu clientul", true);
  await page.goto(`./#/chat/${encodeURIComponent(pid)}`);
  await expect(page.locator('[data-action="model"]')).toHaveAttribute("data-model", "auto");
  return { free, external, pid };
}

const puterCalls = (page: Page) => page.evaluate(() => (window as unknown as { __puterCalls: { messages: { role: string; content: string }[]; options: Record<string, unknown> }[] }).__puterCalls ?? []);

async function say(page: Page, text: string, first = false) {
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.locator("#chat-input").fill(text);
  await page.locator('[data-action="send"]').click();
  if (first) {
    await expect(page.locator("#pilot-consent")).toContainText("Pollinations");
    await page.locator('[data-action="pilot-yes"]').click();
  }
}

test("a clean screen: the box is there at once; the options are in the menu", async ({ page }) => {
  const { external } = await setup(page, { signed: false });
  await expect(page.locator("#chat-input")).toBeVisible();
  await expect(page.locator("[data-connect]")).toHaveCount(0); // nothing to do before the first message
  await expect(page.locator('[data-action="economy"]')).toHaveCount(0);
  await page.locator('[data-action="menu"]').click();
  for (const a of ["economy", "prompts", "council-sheet", "account"]) await expect(page.locator(`#chat-menu [data-action="${a}"]`)).toBeVisible();
  await expect(page.locator('#chat-menu select[name="project"]')).toBeVisible();
  expect(external).toEqual([]);
});

test("no account: after one consent the free model answers everything; nothing goes before the consent", async ({ page }) => {
  const { free, external } = await setup(page, { signed: false });
  await page.locator("#chat-input").fill("Ce urmează în ofertă?");
  await page.locator('[data-action="send"]').click();
  await expect(page.locator("#pilot-consent")).toBeVisible();
  expect(free).toHaveLength(0);
  await page.locator('[data-action="pilot-yes"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns gratuit.");
  expect(free).toHaveLength(1);
  expect(free[0].messages[0].content).not.toContain("REGULĂ DE PILOT"); // no account: it simply answers
  expect(await puterCalls(page)).toHaveLength(0);
  await expect(page.locator("[data-pilot-route]")).toContainText("GPT-OSS 20B");
  // asked only once
  await say(page, "Și apoi?");
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(2);
  await expect(page.locator("#pilot-consent")).toHaveCount(0);
  expect(external).toEqual([]);
});

test("signed in, a simple question: the free model answers it and Puter is not used", async ({ page }) => {
  const { free } = await setup(page, { signed: true, dispatch: "Salut! Cu ce te ajut?" });
  await say(page, "Salut", true);
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Salut! Cu ce te ajut?");
  expect(free).toHaveLength(1);
  expect(free[0].messages[0].content).toContain("REGULĂ DE PILOT");
  expect(await puterCalls(page)).toHaveLength(0);
  await expect(page.locator("[data-pilot-route]")).toHaveAttribute("data-pilot-route", "simple");
});

test("signed in, an ordinary question: the free model hands it on, and only the paid answer is shown", async ({ page }) => {
  await setup(page, { signed: true, dispatch: "[[MEDIU]]" });
  await say(page, "Ce preț am stabilit cu clientul?", true);
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns Puter 1.");
  await expect(page.locator('[data-msg="reply"] .bubble')).not.toContainText("[[");
  const [c] = await puterCalls(page);
  expect(c.options.model).toBe("gemini-2.5-flash-lite");
  expect(c.messages[0].content).not.toContain("REGULĂ DE PILOT"); // the paid model gets the usual messages
  await expect(page.locator("[data-pilot-route]")).toHaveAttribute("data-pilot-route", "medium");
});

test("signed in: when the free service is busy, Puter answers anyway", async ({ page }) => {
  await setup(page, { signed: true, dispatch: 429 });
  await say(page, "Ce zici?", true);
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns Puter 1.");
  expect((await puterCalls(page))[0].options.model).toBe("gemini-2.5-flash-lite");
});

test("code is decided on the device: straight to the stronger model, with room for a long answer", async ({ page }) => {
  const { free } = await setup(page, { signed: true });
  await say(page, "Scrie-mi o funcție javascript care adună prețurile.", true);
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns Puter 1.");
  expect(free).toHaveLength(0);
  const [c] = await puterCalls(page);
  expect(c.options.model).toBe("gemini-3.5-flash");
  expect(c.options.max_tokens).toBe(2500);
  await expect(page.locator("[data-pilot-route]")).toHaveAttribute("data-pilot-route", "code");
});

test("a long document is read by the free model; the paid one gets only the passages that matter", async ({ page }) => {
  const { free } = await setup(page, { signed: true });
  const doc = "Clauză generală fără legătură cu prețul. ".repeat(220) + "Prețul final este 4,2 lei/kg.";
  await page.locator('input[name="attach"]').setInputFiles({ name: "contract.txt", mimeType: "text/plain", buffer: Buffer.from(doc) });
  await expect(page.locator("[data-file]")).toHaveCount(1);
  await say(page, "Ce preț scrie în contract?", true);
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns Puter 1.");
  expect(free).toHaveLength(1);
  expect(free[0].messages[1].content).toContain("Prețul final este 4,2 lei/kg.");
  const last = (await puterCalls(page))[0].messages.at(-1)!.content;
  expect(last).toContain("EXTRAS-TEST");
  expect(last).not.toContain("Clauză generală fără legătură cu prețul. Clauză");
  // the saved question keeps the whole file
  await expect(page.locator('[data-msg="ask"] .ask-files summary')).toContainText("contract.txt");
});

test("a long chat: the older part is summarized by the free model and travels with the next question", async ({ page }) => {
  const { free } = await setup(page, { signed: true });
  // code questions skip the free dispatcher, so the free service is used only for the summary
  for (const [i, q] of ["cod 1: funcție de adunare", "cod 2: funcție de scădere", "cod 3: funcție de înmulțire"].entries()) {
    await say(page, q, i === 0);
    await expect(page.locator('[data-msg="reply"]')).toHaveCount(i + 1);
  }
  await expect.poll(() => free.filter((f) => f.messages[0].content.startsWith("Rezumă discuția")).length).toBe(1);
  const asked = free.find((f) => f.messages[0].content.startsWith("Rezumă discuția"))!.messages[1].content;
  expect(asked).toContain("cod 1: funcție de adunare");
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("aiw.chat.summary.")).length)).toBe(1);
  await say(page, "cod 4: funcție de împărțire");
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(4);
  const sys = (await puterCalls(page))[3].messages[0].content;
  expect(sys).toContain("Rezumatul discuției mai vechi");
  expect(sys).toContain("REZUMAT-TEST");
});

test("choosing a model myself: the pilot is not used and nothing goes to the free service", async ({ page }) => {
  const { free } = await setup(page, { signed: true });
  await page.locator("#chat-input").fill("Salut");
  await page.locator('[data-action="send"]').click();
  await page.locator('[data-action="pilot-no"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns Puter 1.");
  await expect(page.locator('[data-action="model"]')).toHaveAttribute("data-model", "gemini-2.5-flash-lite");
  expect(free).toHaveLength(0);
});

test("a suggestion fills the box; a message sent before the consent is still sent after it", async ({ page }) => {
  const { free } = await setup(page, { signed: false });
  // AIW-09: a suggestion fills the box (the person completes it), it does not send by itself
  await page.locator('[data-starter="explain"]').click();
  await expect(page.locator("#chat-input")).toHaveValue(/Explică-mi simplu/);
  await page.locator("#chat-input").fill("Explică-mi simplu ce e un recuperator de căldură");
  await page.locator('[data-action="send"]').click();
  await expect(page.locator("#pilot-consent")).toBeVisible();
  await page.locator('[data-action="pilot-yes"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns gratuit.");
  expect(free).toHaveLength(1);
  await expect(page.locator('[data-msg="ask"]')).toHaveCount(1);
});

test("a Puter model chosen by hand, no account: one question — connect, or continue for free", async ({ page }) => {
  const { free } = await setup(page, { signed: false });
  await page.locator('[data-action="model"]').click();
  await page.locator('[data-model-id="gpt-5-nano"]').click();
  await page.locator("#chat-input").fill("Ce urmează?");
  await page.locator('[data-action="send"]').click();
  await expect(page.locator("[data-connect]")).toBeVisible();
  expect(free).toHaveLength(0);
  await page.locator('[data-action="use-free"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText("Răspuns gratuit.");
  await expect(page.locator('[data-action="model"]')).toHaveAttribute("data-model", "free:gpt-oss-20b");
  expect(free[0].messages.at(-1)!.content).toBe("Ce urmează?");
});

test("someone who already chatted on the default model (no saved settings) keeps it", async ({ page }) => {
  await setup(page, { signed: true });
  // as before AIW-08: a chat exists, but the settings were never saved
  await say(page, "cod: o funcție", true);
  await expect(page.locator('[data-msg="reply"]')).toHaveCount(1);
  await page.evaluate(() => localStorage.removeItem("aiw.chat"));
  await page.reload();
  await expect(page.locator('[data-action="model"]')).toHaveAttribute("data-model", "gemini-2.5-flash-lite");
});
