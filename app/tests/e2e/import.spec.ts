// AIW-06.1 in the browser: conversations from the user's own ChatGPT / Claude export become chats;
// one is continued in the chat with the free model (simulated: no real network call).
import { expect, test } from "@playwright/test";
import { newProject, setRo } from "./helpers";

test.use({ serviceWorkers: "block" });

const CLAUDE = [
  { uuid: "u1", name: "Plan site firmă", updated_at: "2026-11-01T10:00:00Z", chat_messages: [
    { sender: "human", text: "Fă-mi un plan pentru site." }, { sender: "assistant", text: "Pasul 1: pagina de start." }] },
  { uuid: "u2", name: "Rețetă", updated_at: "2026-10-01T10:00:00Z", chat_messages: [{ sender: "human", text: "Ce gătesc?" }, { sender: "assistant", text: "Ciorbă." }] },
];

const SSE = (text: string) => text.split(/(?<= )/).map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join("") + "data: [DONE]\n\n";

test("import from a Claude export, then continue the conversation in the chat for free", async ({ page, context }) => {
  const external: string[] = [];
  const sent: { messages: { role: string; content: string }[] }[] = [];
  await context.route(/^https?:\/\/(?!localhost)/, (r) => (external.push(r.request().url()), r.abort()));
  await context.route("https://text.pollinations.ai/openai", async (r) => {
    sent.push(JSON.parse(r.request().postData()!));
    await r.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: SSE("Pasul 2: pagina de contact.") });
  });
  // Puter is never needed here: a fake that is not signed in
  await context.route(/\/vendor\/puter\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.puter={auth:{isSignedIn:()=>false,signIn:async()=>{},signOut(){},getUser:async()=>({})},ai:{chat:async()=>{throw {status:401}}}};" }));

  await setRo(page);
  const pid = await newProject(page, "Firma");
  await page.locator('.tab[data-route="import"]').click();
  await expect(page.locator("h1")).toHaveText("Import");
  await page.locator('input[name="export"]').setInputFiles({ name: "conversations.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(CLAUDE)) });
  await expect(page.locator("[data-conversations]")).toHaveAttribute("data-conversations", "2");
  await page.locator('[data-conv="Plan site firmă"] input').check();
  await page.locator('[data-action="import-chats"]').click();
  await expect(page.locator("[data-import-result]")).toContainText("Plan site firmă");
  // marked as imported, so it is not picked twice by mistake
  await expect(page.locator('[data-conv="Plan site firmă"]')).toContainText("importată deja");

  await page.locator('[data-imported="Plan site firmă"]').click();
  await expect(page.locator('[data-msg="ask"] .bubble')).toHaveText(["Fă-mi un plan pentru site."]);
  await expect(page.locator('[data-msg="reply"] .bubble')).toHaveText(["Pasul 1: pagina de start."]);

  // not connected to Puter: the free mode works without an account
  await page.locator('[data-action="use-free"]').click();
  await expect(page.locator('[data-action="model"]')).toHaveAttribute("data-model", "free:gpt-oss-20b");
  await page.locator("#chat-input").fill("Și apoi?");
  await page.locator('[data-action="send"]').click();
  await expect(page.locator('[data-msg="reply"] .bubble').last()).toHaveText("Pasul 2: pagina de contact.");
  // the imported conversation travels with the question
  const roles = sent[0].messages.map((m) => m.role);
  expect(roles).toEqual(["system", "user", "assistant", "user"]);
  expect(sent[0].messages[1].content).toBe("Fă-mi un plan pentru site.");
  expect(external).toEqual([]);
  await page.goto(`./#/chat/${encodeURIComponent(pid)}`);
});

test("a file that is not an export is refused with a clear message", async ({ page }) => {
  await setRo(page);
  await newProject(page, "Firma");
  await page.goto("./#/import");
  await page.locator('input[name="export"]').setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('[{"foo":1}]') });
  await expect(page.locator("[data-import-error]")).toContainText("Nu recunosc fișierul");
});
