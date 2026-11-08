// AIW-07: what attached files add to a message, the picture parts, and the text prepared for reading aloud.
import { describe, expect, it } from "vitest";
import { attachmentNote, capText, imagesOf, MAX_IMAGES, MAX_MESSAGE_TEXT, messageWithFiles, seesImages, withImages, type Attachment } from "../../src/chat";
import { chunks, speakable } from "../../src/ui/voice";

const a = (x: Partial<Attachment>): Attachment => ({ id: "F", kind: "text", name: "f.txt", text: "", images: [], pages: 0, cut: false, ...x });

describe("attached files", () => {
  it("the file's text goes after the question, fenced; a photo only by name", () => {
    const m = messageWithFiles("Ce scrie?", [a({ kind: "pdf", name: "o.pdf", text: "Preț\n```\n4,2", pages: 2 }), a({ kind: "image", name: "lot.jpg", images: ["data:image/jpeg;base64,AA"] })], "ro");
    expect(m.startsWith("Ce scrie?\n\nFișier atașat: o.pdf (2 pagini)\n```\n")).toBe(true);
    expect(m).toContain("Preț\n\\```\n4,2"); // a fence inside the file cannot close the block
    expect(m.endsWith("[poză atașată: lot.jpg]")).toBe(true);
    expect(attachmentNote(a({ kind: "pdf", name: "s.pdf", pages: 9, images: ["x", "y"], cut: true }), "en")).toBe("[Attached file: s.pdf (9 pages, the text was shortened, 2 scanned pages sent as images)]");
  });

  it("limits: one file's text, the whole message, the number of pictures", () => {
    expect(capText("a".repeat(50), 10)).toEqual({ text: "a".repeat(10) + "…", cut: true });
    const big = messageWithFiles("q", [a({ text: "x".repeat(40000) }), a({ text: "y".repeat(40000) }), a({ text: "z".repeat(40000) })], "ro");
    expect([...big].length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT + 1);
    expect(imagesOf([a({ images: ["1", "2", "3"] }), a({ images: ["4", "5"] })])).toHaveLength(MAX_IMAGES);
  });

  it("pictures ride on the last user message only, OpenAI-style", () => {
    const w = withImages([{ role: "system", content: "S" }, { role: "user", content: "Q" }], ["data:image/jpeg;base64,AA"]);
    expect(w[0]).toEqual({ role: "system", content: "S" });
    expect(w[1]).toEqual({ role: "user", content: [{ type: "text", text: "Q" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AA" } }] });
    expect(withImages([{ role: "user", content: "Q" }], [])).toEqual([{ role: "user", content: "Q" }]);
    expect(seesImages("deepseek-v4.1-flash")).toBe(false);
    expect(seesImages("free:gpt-oss-20b")).toBe(false);
    expect(seesImages("gemini-2.5-flash-lite")).toBe(true);
  });
});

describe("reading aloud", () => {
  it("no markdown, code or links are read", () => {
    expect(speakable("## Titlu\n- **4,2 lei** pe kg\n```js\nx()\n```\nVezi [aici](https://x.ro) și https://y.ro")).toBe("Titlu 4,2 lei pe kg Vezi aici și");
  });
  it("long text is cut into pieces at sentence ends", () => {
    const parts = chunks("Unu doi. ".repeat(60).trim(), 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(" ")).toBe("Unu doi. ".repeat(60).trim());
  });
});

describe("files in the history", () => {
  it("only the latest message with files carries their text again; older ones a short note", async () => {
    const { buildMessages, DEFAULT_ECONOMY } = await import("../../src/chat");
    const f1 = messageWithFiles("Prima", [a({ name: "a.pdf", kind: "pdf", text: "TEXT-A" })], "ro");
    const f2 = messageWithFiles("A doua", [a({ name: "b.txt", text: "TEXT-B" })], "ro");
    const m = buildMessages("S", [{ kind: "ask", text: f1 }, { kind: "reply", text: "ok" }, { kind: "ask", text: f2 }, { kind: "reply", text: "ok" }], "Și?", { ...DEFAULT_ECONOMY, history: 8 }, "ro");
    const all = m.map((x) => x.content).join("\n");
    expect(all).not.toContain("TEXT-A");
    expect(all).toContain("[Fișier atașat: a.pdf — textul a fost trimis mai devreme]");
    expect(all).toContain("TEXT-B");
  });
});
