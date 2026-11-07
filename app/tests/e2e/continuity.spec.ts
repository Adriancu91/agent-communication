// AIW-05 in the browser: launcher → package → session → AI reply → review → official memory;
// moving the work to another assistant; offline; sessions travel with the export.
import { expect, test, type Page } from "@playwright/test";
import { addEntry, entryRow, newProject, openMemory, seedProposal, setRo } from "./helpers";

async function project(page: Page) {
  const pid = await newProject(page, "Oferta Brăila");
  await openMemory(page, pid);
  await addEntry(page, "goal", "Câștigăm licitația", "Termen: 15 decembrie");
  await addEntry(page, "instruction", "Răspunde în română");
  await addEntry(page, "decision", "Preț 4,2 lei/kg", "", true);
  await addEntry(page, "issue", "Lipsește certificatul ANPM");
  await addEntry(page, "step", "Trimite oferta");
  await seedProposal(page, pid, "Propunere încă neconfirmată", "ChatGPT");
  return pid;
}

const REPLY = `Am verificat oferta. Prețul cuprului a crescut.

\`\`\`aiw-propuneri
[
  {"tip": "decizie", "titlu": "Preț 4,5 lei/kg", "text": "Ajustat după piață", "inlocuieste": "D1", "motiv": "Cuprul a crescut"},
  {"tip": "informatie", "titlu": "Certificatul ANPM a fost cerut", "rezolva": "P1"},
  {"tip": "pas", "titlu": "Trimite oferta"},
  {"tip": "pas", "titlu": "Sună clientul vineri"},
  {"tip": "problema", "titlu": "Transportul nu e stabilit"}
]
\`\`\``;

/**
 * The share sheet and the clipboard are simulated (the real ones are system dialogs a test cannot drive):
 * navigator.share records what was shared, the clipboard is a variable. Popups to AI sites are closed.
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const w = window as unknown as { __shared: string[]; __clip: string };
    w.__shared = [];
    w.__clip = "";
    Object.defineProperty(navigator, "share", { configurable: true, value: async (d: { text: string }) => void w.__shared.push(d.text) });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => void (w.__clip = t), readText: async () => w.__clip } });
  });
  await context.route(/^https:\/\/(chatgpt\.com|claude\.ai|gemini\.google\.com)\//, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>AI</title>" }));
});

async function startSession(page: Page, provider: "claude" | "chatgpt" = "claude") {
  await page.goto("./#/lansator");
  await expect(page.locator('select[name="project"]')).toHaveValue(/P-/);
  await page.locator(`[data-provider="${provider}"]`).click();
  await page.locator('textarea[name="task"]').fill("Actualizează prețul și pașii.");
  await page.locator('[data-step="pack"] summary', { hasText: "Vezi pachetul" }).click();
  const pack = page.locator("[data-pack]");
  await expect(pack).toContainText("# Pachet de continuitate: Oferta Brăila");
  await expect(pack).toContainText("[D1] ★ Preț 4,2 lei/kg");
  await expect(pack).toContainText("Actualizează prețul și pașii.");
  await expect(pack).not.toContainText("Propunere încă neconfirmată"); // proposals are never handed over
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const popup = touch ? null : page.waitForEvent("popup");
  // one tap: phones get the share sheet (choose the AI app), computers get copy + the AI site in a new tab
  await page.locator('[data-action="send-pack"]').click();
  await expect(page.locator('[data-step="work"]')).toBeVisible();
  const sent = await page.evaluate(() => {
    const w = window as unknown as { __shared: string[]; __clip: string };
    return { __shared: w.__shared, __clip: w.__clip };
  });
  if (touch) {
    expect(sent.__shared).toHaveLength(1);
    expect(sent.__shared[0]).toContain("# Pachet de continuitate: Oferta Brăila");
  } else {
    const p = await popup!;
    expect(p.url()).toBe(provider === "claude" ? "https://claude.ai/new" : "https://chatgpt.com/"); // nothing in the address
    await p.close();
    expect(sent.__clip).toContain("# Pachet de continuitate: Oferta Brăila");
    await expect(page.locator("[data-copied]")).toBeVisible();
  }
  const open = page.locator('[data-step="work"] [data-action="open-ai"]');
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");
}

/** Back from the AI app: "Copy" there, one tap here. */
async function bringBack(page: Page, reply: string) {
  await page.evaluate((r) => { (window as unknown as { __clip: string }).__clip = r; }, reply);
  await page.locator('[data-action="bring-back"]').click();
  await expect(page.locator("[data-session-page]")).toBeVisible();
  await expect(page.locator("#reply-dialog [data-found]")).toBeVisible(); // analysed at once
}

/** From the session page: one tap reads the copied reply. */
async function addReply(page: Page, reply: string) {
  await page.evaluate((r) => { (window as unknown as { __clip: string }).__clip = r; }, reply);
  await page.locator('[data-action="add-reply"]').click();
  await expect(page.locator("#reply-dialog [data-found]")).toBeVisible();
}

test("launcher → package → session → AI reply → review: only accepted proposals become official", async ({ page }) => {
  await setRo(page);
  const pid = await project(page);
  await startSession(page);
  await bringBack(page, REPLY);
  await expect(page.locator('[data-kind="sent"]')).toContainText("Pachet de continuitate dat AI-ului");
  const dlg = page.locator("#reply-dialog");
  await expect(dlg.locator('[data-found="block"]')).toContainText("5 propuneri");
  // compared with the memory: "Trimite oferta" already exists → rejected by default
  await expect(dlg.locator('[data-review="Trimite oferta"]')).toHaveAttribute("data-match", "duplicate");
  await expect(dlg.locator('[data-review="Trimite oferta"] [data-verdict="reject"]')).toHaveAttribute("aria-checked", "true");
  await expect(dlg.locator('[data-review="Preț 4,5 lei/kg"] [data-relation="replaces"]')).toContainText("Preț 4,2 lei/kg");
  await expect(dlg.locator('[data-review="Certificatul ANPM a fost cerut"] [data-relation="resolves"]')).toContainText("Lipsește certificatul ANPM");
  // proposals with a relation have no default: they must be accepted or rejected now (no "later")
  await expect(dlg.locator("[data-undecided]")).toHaveAttribute("data-undecided", "2");
  await expect(dlg.locator('[data-action="save-review"]')).toBeDisabled();
  await expect(dlg.locator('[data-review="Preț 4,5 lei/kg"] [data-verdict="later"]')).toHaveCount(0);
  // accept the price and the certificate, edit the call step, leave the transport problem undecided
  await dlg.locator('[data-review="Preț 4,5 lei/kg"] [data-verdict="accept"]').click();
  await dlg.locator('[data-review="Certificatul ANPM a fost cerut"] [data-verdict="accept"]').click();
  const call = dlg.locator('[data-review="Sună clientul vineri"]');
  await call.locator('input[name="title"]').fill("Sună clientul joi");
  await call.locator('[data-verdict="accept"]').click();
  await dlg.locator('[data-action="save-review"]').click();
  await expect(page.locator(".toast")).toContainText("Salvat: 3 acceptate, 1 respinse, 1 de decis");

  const steps = page.locator('[data-kind="reply"]');
  await expect(steps.locator('[data-proposal="Preț 4,5 lei/kg"]')).toHaveAttribute("data-state", "confirmed");
  await expect(steps.locator('[data-proposal="Trimite oferta"]')).toHaveAttribute("data-state", "rejected");
  await expect(steps.locator('[data-proposal="Transportul nu e stabilit"]')).toHaveAttribute("data-state", "pending");

  // the official memory: the old price is replaced, the problem resolved, the edited step kept with the AI's version
  await openMemory(page, pid);
  await expect(entryRow(page, "Preț 4,5 lei/kg").first()).toBeAttached();
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie/context`);
  await expect(page.locator('[data-ctx-item="Preț 4,5 lei/kg"]')).toBeVisible();
  await expect(page.locator('[data-ctx-item="Preț 4,2 lei/kg"]')).toHaveCount(0);
  await expect(page.locator('[data-ctx-item="Lipsește certificatul ANPM"]')).toHaveCount(0);
  await expect(page.locator('[data-ctx-item="Transportul nu e stabilit"]')).toHaveCount(0);
  await expect(page.locator('[data-omitted="Transportul nu e stabilit"]')).toBeVisible();
  await openMemory(page, pid);
  await page.locator(".row", { hasText: "Sună clientul joi" }).first().locator(".row-main").click();
  await expect(page.locator('[data-card="versions"] li')).toHaveCount(2); // the AI's text is version 1
  await page.locator('[data-version="1"] summary').click();
  await expect(page.locator('[data-version="1"]')).toContainText("Sună clientul vineri");
  // and the history still verifies
  await page.goto(`./#/proiect/${encodeURIComponent(pid)}/memorie/istoric`);
  await page.locator('[data-action="verify"]').click();
  await expect(page.locator('[data-integrity="ok"]')).toBeVisible();
});

test("moving the work from Claude to ChatGPT: the second package carries the accepted result and the saved reply", async ({ page }) => {
  await setRo(page);
  await project(page);
  await startSession(page);
  await bringBack(page, REPLY);
  await page.locator('[data-action="accept-all-save"]').click(); // one tap: new accepted, duplicate rejected, saved
  await expect(page.locator(".toast")).toContainText("Salvat: 4 acceptate, 1 respinse, 0 de decis");

  await page.locator('[data-action="continue-elsewhere"]').first().click();
  await expect(page.locator("[data-continues]")).toContainText("Claude");
  await expect(page.locator('[data-provider="chatgpt"]')).toHaveAttribute("aria-checked", "true"); // another assistant suggested
  // saved replies are included only on request, with a warning, and without their proposals block
  await expect(page.locator('[data-history="0"]')).toHaveAttribute("aria-checked", "true");
  await page.locator('[data-history="1"]').click();
  await expect(page.locator("[data-history-warn]")).toBeVisible();
  await page.locator('[data-step="pack"] summary', { hasText: "Vezi pachetul" }).click();
  const pack = page.locator("[data-pack]");
  await expect(pack).toContainText("pentru ChatGPT");
  await expect(pack).toContainText("Preț 4,5 lei/kg");
  await expect(pack).not.toContainText("[D1] ★ Preț 4,2 lei/kg"); // replaced: no contradiction in the context
  await expect(pack).toContainText("### Răspuns de la Claude");
  await expect(pack).toContainText("Am verificat oferta. Prețul cuprului a crescut.");
  await expect(pack).toContainText("blocul de propuneri a fost scos");
  await expect(pack).not.toContainText('"tip": "pas", "titlu": "Trimite oferta"');
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (!touch) {
    const [p] = await Promise.all([page.waitForEvent("popup"), page.locator('[data-action="send-pack"]').click()]);
    expect(p.url()).toBe("https://chatgpt.com/");
    await p.close();
  } else await page.locator('[data-action="send-pack"]').click();
  await expect(page.locator('[data-action="open-ai"]')).toHaveAttribute("href", "https://chatgpt.com/");
  await page.locator('[data-action="open-session"]').click();
  await expect(page.locator("[data-session-page] h1")).toContainText("ChatGPT · Oferta Brăila");
  await expect(page.locator("[data-session-page]")).toContainText("continuă sesiunea cu Claude");

  await page.goto("./#/continuitate");
  await expect(page.locator('[data-list="open"] .row')).toHaveCount(2);
});

test("a reply without the block: sections are read; an empty result can still be saved", async ({ page }) => {
  await setRo(page);
  await project(page);
  await startSession(page);
  await page.locator('[data-action="open-session"]').click();
  await expect(page.locator("[data-awaiting]")).toContainText("Aștept răspunsul de la Claude");
  await addReply(page, "**Pași următori:**\n- Verifică stocul\n- Cere avans");
  await expect(page.locator('[data-found="sections"]')).toContainText("2 propuneri");
  await page.locator('[data-action="save-review"]').click();
  await expect(page.locator(".toast")).toContainText("0 acceptate, 0 respinse, 2 de decis");
  await page.locator('[data-action="add-note"]').click();
  await page.locator('#note-form textarea[name="note"]').fill("Clientul vrea răspuns până vineri.");
  await page.locator('#note-form button[type="submit"]').click();
  await expect(page.locator('[data-kind="note"]')).toContainText("Clientul vrea răspuns până vineri.");
  // nothing copied: the paste box opens, and the reply can also be pasted by hand
  await page.evaluate(() => { (window as unknown as { __clip: string }).__clip = ""; });
  await page.locator('[data-action="add-reply"]').click();
  await page.locator('[data-action="paste-clipboard"]').click();
  await expect(page.locator("#reply-dialog [role=alert]")).toContainText("Nu am găsit niciun text copiat");
  await page.locator('#reply-dialog textarea[name="reply"]').fill("Mulțumesc, am înțeles.");
  await page.locator('[data-action="analyse"]').click();
  await expect(page.locator('[data-found="none"]')).toBeVisible();
  await page.locator('[data-action="save-review"]').click();
  await expect(page.locator('[data-kind="reply"]')).toHaveCount(2);
  await page.locator('[data-action="close-session"]').click();
  await expect(page.locator('[data-status="closed"]')).toBeVisible();
  await expect(page.locator('[data-action="add-reply"]')).toHaveCount(0);
});

test("the whole flow works without internet", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "offline checked in Chromium (Playwright WebKit service worker limitation)");
  await setRo(page);
  await project(page);
  await page.goto("./#/setari");
  await expect(async () => {
    if ((await page.locator("[data-offline]").getAttribute("data-offline")) !== "ready") {
      await page.reload();
      await expect(page.locator("[data-offline]")).toHaveAttribute("data-offline", "ready", { timeout: 3000 });
    }
  }).toPass({ timeout: 30_000 });
  await context.setOffline(true);
  await page.reload();
  await startSession(page);
  await bringBack(page, REPLY);
  await page.locator('[data-action="accept-all-save"]').click();
  await expect(page.locator(".toast")).toContainText("Salvat");
  await context.setOffline(false);
});

test("Android share sheet: a reply shared into the app goes straight to the session's review", async ({ page }) => {
  await setRo(page);
  await project(page);
  await startSession(page);
  const sid = await page.locator('[data-step="work"]').getAttribute("data-session");
  // the AI app shares the reply to AI Workspace: the app opens with it in the address
  await page.goto("./?aiw_title=Claude&aiw_text=" + encodeURIComponent(REPLY));
  await expect(page.locator("[data-receive]")).toBeVisible();
  expect(new URL(page.url()).search).toBe(""); // the reply is removed from the address at once
  await expect(page.locator("[data-received]")).toContainText("Am verificat oferta");
  await page.locator(`[data-receive-session="${sid}"] button`).click();
  await expect(page.locator('#reply-dialog [data-found="block"]')).toContainText("5 propuneri");
  await page.locator('#reply-dialog [data-review="Preț 4,5 lei/kg"] [data-verdict="accept"]').click();
  await page.locator('#reply-dialog [data-review="Certificatul ANPM a fost cerut"] [data-verdict="reject"]').click();
  await page.locator('[data-action="save-review"]').click();
  await expect(page.locator(".toast")).toContainText("Salvat: 1 acceptate");
});
