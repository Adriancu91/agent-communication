// AIW-09: the pure parts of the chat-first screen — picture requests, titles and search, the export.
import { describe, expect, it } from "vitest";
import {
  chatTitle, conversationMarkdown, describeImage, exportFileName, IMAGE_GAP_S, imageOfReply, imageProblem, imageReply, imageRequest, imageUrl,
  isImageUrl, searchChats, starterPrompts, titleFrom,
} from "../../src/chat";
import type { Exchange } from "../../src/core";

describe("picture requests", () => {
  it("recognises a request to make a picture, in Romanian and English, and leaves the rest alone", () => {
    for (const q of ["Fă o imagine cu o pisică pe lună", "Generează-mi te rog o poză cu un câine", "fa o poza cu masina mea", "Creează un logo pentru firma mea",
      "Desenează un tablou cu munți", "Fă-mi un afiș pentru concert", "Make an image of a cat in space", "make me a picture of a dog", "Draw a sketch of a house"]) {
      expect(imageRequest(q), q).toBe(q);
    }
    for (const q of ["Fă un rezumat al imaginii", "Fă o listă cu poze", "Ce vezi în poză?", "Draw a cat", "Cum fac o imagine mai clară în Photoshop?", "Imaginea de ansamblu e bună",
      "Fă o imagine\n\nFișier atașat: a.txt\n```\nx\n```", "",
      // idioms and requests about pictures, not for one (found by the independent review)
      "Fă o imagine de ansamblu asupra pieței", "Fă-mi o imagine de ansamblu a proiectului", "Create an image caption for this photo", "Create a banner text for the website",
      "Design a logo concept in words", "Fă o poză de profil mai bună (sfaturi)"]) {
      expect(imageRequest(q), q).toBeNull();
    }
  });

  it("the command is explicit and keeps only the description", () => {
    expect(imageRequest("/imagine un apus peste mare")).toBe("un apus peste mare");
    expect(imageRequest("/img: pisică")).toBe("pisică");
    expect(imageRequest("/imagine")).toBeNull();
    expect(imageRequest("/imaginea mea")).toBeNull(); // not the command
  });

  it("builds the picture's address with the safety filter and no public feed; only exactly such addresses are pictures", () => {
    const url = imageUrl("o pisică pe lună", 42);
    expect(url).toBe("https://image.pollinations.ai/prompt/o%20pisic%C4%83%20pe%20lun%C4%83?width=1024&height=1024&seed=42&model=sana&safe=true&nofeed=true");
    expect(isImageUrl(url)).toBe(true);
    // an apostrophe (and ( ) ! *) is encoded too, so the address passes its own check (independent review)
    const quoted = imageUrl("a child's room (cozy)!", 7);
    expect(quoted).toContain("child%27s%20room%20%28cozy%29%21");
    expect(isImageUrl(quoted)).toBe(true);
    expect(isImageUrl("https://example.com/prompt/x")).toBe(false);
    expect(isImageUrl("https://image.pollinations.ai/other")).toBe(false);
    expect(isImageUrl(url + " onerror=x")).toBe(false);
    expect(isImageUrl(url + "#f")).toBe(false);
    expect(isImageUrl(url.replace("model=sana", "model=flux"))).toBe(false);
    expect(isImageUrl(url.replace("&safe=true", ""))).toBe(false);
    expect(isImageUrl(url + "&key=secret")).toBe(false);
    expect(isImageUrl("https://image.pollinations.ai/prompt/../x?width=1024&height=1024&seed=1&model=sana&safe=true&nofeed=true")).toBe(false);
    expect(isImageUrl("https://image.pollinations.ai/prompt/a%2Fb?width=1024&height=1024&seed=1&model=sana&safe=true&nofeed=true")).toBe(false);
    expect(imageUrl("a".repeat(2000), 1).length).toBeLessThan(1200);
  });

  it("the saved answer is markdown with the description; it is read back only for addresses made here", () => {
    const url = imageUrl("un far pe stâncă la apus", 1);
    const text = imageReply("un far [pe] stâncă\nla apus", url);
    expect(text).toBe(`![un far pe stâncă la apus](${url})`);
    expect(imageOfReply(text)).toEqual({ alt: "un far pe stâncă la apus", url });
    expect(imageOfReply("![x](https://evil.example/x.jpg)")).toBeNull();
    expect(imageOfReply("![x](https://image.pollinations.ai/prompt/x?seed=1)")).toBeNull(); // not an address made here
    expect(imageOfReply(`text apoi ${text}`)).toBeNull();
    expect(describeImage(text, "ro")).toBe("🎨 Imagine: un far pe stâncă la apus");
    expect(describeImage("un răspuns obișnuit", "en")).toBeNull();
  });

  it("reads the service's refusals: the free limit with its waiting time, busy, the content filter", () => {
    const limit = imageProblem(402, '{"error":{"code":"FREE_LIMIT","message":"Free limit reached: 1 image every 45 seconds per IP. Retry after 34s"}}', null);
    expect(limit.problem).toBe("limit");
    expect(limit.wait).toBe(34);
    expect(imageProblem(402, "", "12").wait).toBe(12);
    expect(imageProblem(402, "", null).wait).toBe(IMAGE_GAP_S);
    expect(imageProblem(429, "", "5")).toMatchObject({ problem: "busy", wait: 5 });
    expect(imageProblem(400, "blocked by the safe content filter", null).problem).toBe("unsafe");
    expect(imageProblem(500, "", null).problem).toBe("unknown");
  });

  it("the welcome's suggestions: six, with the picture command and the document one that opens the files", () => {
    for (const lang of ["ro", "en"] as const) {
      const s = starterPrompts(lang);
      expect(s).toHaveLength(6);
      expect(s.find((x) => x.id === "image")).toMatchObject({ text: "/imagine ", action: "image", open: true });
      expect(s.find((x) => x.id === "doc")?.action).toBe("attach");
      expect(new Set(s.map((x) => x.id)).size).toBe(6);
    }
  });
});

const ex = (kind: Exchange["kind"], text: string, at: string): Exchange => ({ id: `X-${at}`, sessionId: "S-1", projectId: "P-1", kind, text, pack: null, proposals: [], createdAt: at, v: 1 });

describe("the conversation list", () => {
  it("a title from the first question: first line, no files, no markdown, cut at a word", () => {
    expect(titleFrom("Cât costă transportul?")).toBe("Cât costă transportul?");
    expect(titleFrom("  **Plan** pentru site\nși altceva")).toBe("Plan pentru site");
    expect(titleFrom("Rezumă\n\nFișier atașat: oferta.pdf\n```\ntext lung\n```")).toBe("Rezumă");
    expect(titleFrom("/imagine un far pe stâncă")).toBe("un far pe stâncă");
    const long = titleFrom("Aceasta este o întrebare foarte lungă despre transportul de fier vechi către Brăila săptămâna viitoare");
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/\s…$/);
    expect(titleFrom("   ")).toBe("");
  });

  it("imports keep their own title; a chat without questions has none", () => {
    expect(chatTitle({ task: "Plan site firmă" }, "altceva")).toBe("Plan site firmă");
    expect(chatTitle({ task: "" }, "Prima întrebare")).toBe("Prima întrebare");
    expect(chatTitle({ task: "" }, undefined)).toBe("");
  });

  it("search ignores diacritics and case, needs every word, and an empty search keeps everything", () => {
    const chats = [{ id: "a", text: "Cât costă transportul la Brăila?" }, { id: "b", text: "Oferta pentru fier vechi" }];
    const by = (c: (typeof chats)[number]) => c.text;
    expect(searchChats(chats, "braila TRANSPORT", by).map((c) => c.id)).toEqual(["a"]);
    expect(searchChats(chats, "fier braila", by)).toEqual([]);
    expect(searchChats(chats, "  ", by)).toHaveLength(2);
  });

  it("the export is readable markdown with both sides, pictures as their description, no proposals block", () => {
    const steps = [
      ex("ask", "Cât costă?", "2026-11-09T10:00:00.000Z"),
      ex("reply", "Cam 120 lei.\n\n```aiw-propuneri\n[{\"tip\":\"informatie\",\"titlu\":\"x\"}]\n```", "2026-11-09T10:00:05.000Z"),
      ex("ask", "/imagine un camion", "2026-11-09T10:01:00.000Z"),
      ex("reply", imageReply("un camion", imageUrl("un camion", 3)), "2026-11-09T10:01:09.000Z"),
    ];
    const md = conversationMarkdown({ title: "Cât costă?", project: "Personal", assistant: "Auto ✦", steps, lang: "ro", date: (iso) => iso.slice(11, 16) });
    expect(md).toContain("# Cât costă?");
    expect(md).toContain("Proiect: Personal");
    expect(md).toContain("**Tu** · 10:00\n\nCât costă?");
    expect(md).toContain("**Auto ✦** · 10:00\n\nCam 120 lei.");
    expect(md).not.toContain("aiw-propuneri");
    expect(md).toContain("🎨 Imagine: un camion");
    expect(md).not.toContain("image.pollinations.ai");
    expect(md).toContain("Exportat din AI Workspace");
    expect(exportFileName("Cât costă transportul la Brăila?")).toBe("Cat-costa-transportul-la-Braila.md");
    expect(exportFileName("")).toBe("conversatie.md");
  });
});
