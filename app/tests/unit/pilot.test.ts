// AIW-08: the automatic pilot's pure parts — what the device decides alone, the hand-on tags, the summary
// of the older part of a chat, and the document reader.
import { describe, expect, it } from "vitest";
import {
  AUTO, DEFAULT_ECONOMY, ROUTE, READ_FROM, buildMessages, decideLocally, finalTag, dispatchMessages, documentsOf, extractMessages, needsSummary,
  olderTurns, pilotEconomy, readTag, summaryMessages, withExtract, withSummary,
} from "../../src/chat";
import { assistantName, IMPORTED } from "../../src/core";

const fileBlock = (name: string, text: string) => `\n\nFișier atașat: ${name}\n\`\`\`\n${text}\n\`\`\``;

describe("dispatcher", () => {
  it("decides the clear cases on the device", () => {
    expect(decideLocally("Ce e asta?", 1)).toEqual({ level: "medium", why: "pictures" });
    expect(decideLocally("Rezumă" + fileBlock("a.txt", "x"), 0).why).toBe("files");
    expect(decideLocally("Fă-mi un script python pentru stoc", 0)).toEqual({ level: "code", why: "code" });
    expect(decideLocally("a".repeat(700), 0)).toEqual({ level: "hard", why: "long" });
    expect(decideLocally("Salut, ce faci?", 0)).toEqual({ level: null, why: "ask" });
    // words inside a file do not make the question "code"
    expect(decideLocally("Ce scrie aici?" + fileBlock("a.txt", "function html script"), 0).why).toBe("files");
  });

  it("reads the hand-on tag, waits while it may still be one, and takes anything else as the answer", () => {
    expect(readTag("")).toBe("pending");
    expect(readTag("[[MED")).toBe("pending");
    expect(readTag("[[MEDIU]]")).toBe("medium");
    expect(readTag(" [[ greu ]] ceva")).toBe("hard");
    expect(readTag("[[COD]]")).toBe("code");
    expect(readTag("[[HARD]]")).toBe("hard");
    expect(readTag("Salut!")).toBe("pending"); // short: decided when it ends (finalTag)
    expect(readTag("[1] este primul punct al listei")).toBeNull();
    // markdown around the tag is ignored; a short start is not shown until it is clear
    expect(readTag("**[[COD]]**")).toBe("code");
    expect(readTag("`[[GREU]]`")).toBe("hard");
    expect(readTag("OK.")).toBe("pending");
    expect(readTag("Bună ziua! Mă bucur să te ajut.")).toBeNull();
  });

  it("at the end, a short text holding a tag is a hand-on; a real answer that mentions one is not", () => {
    expect(finalTag("OK. [[MEDIU]]")).toBe("medium");
    expect(finalTag("> **[[GREU]]**")).toBe("hard");
    expect(finalTag("Salut!")).toBeNull();
    expect(finalTag("Pentru cod folosesc eticheta [[COD]], dar iată răspunsul complet la întrebarea ta despre preț.")).toBeNull();
  });

  it("adds the rule only to the system message; the routes never use the most expensive models", () => {
    const m = buildMessages("SISTEM", [], "Salut", DEFAULT_ECONOMY, "ro");
    const d = dispatchMessages(m, "ro");
    expect(d[0].content).toContain("SISTEM");
    expect(d[0].content).toContain("[[MEDIU]]");
    expect(d.slice(1)).toEqual(m.slice(1));
    expect(m[0].content).toBe("SISTEM"); // the original is unchanged
    expect(Object.values(ROUTE)).not.toContain("gpt-5.4");
    expect(Object.values(ROUTE)).not.toContain("claude-sonnet-5-5");
  });

  it("gives code room for a long answer, without lifting a 'no limit'", () => {
    expect(pilotEconomy("code", DEFAULT_ECONOMY).maxOutput).toBe(2500);
    expect(pilotEconomy("code", { ...DEFAULT_ECONOMY, maxOutput: 0 }).maxOutput).toBe(0);
    expect(pilotEconomy("medium", DEFAULT_ECONOMY)).toEqual(DEFAULT_ECONOMY);
  });

  it("a pilot chat is named Auto", () => {
    expect(IMPORTED[AUTO]).toBe("Auto ✦");
    expect(assistantName({ provider: "inapp", providerName: AUTO })).toBe("Auto ✦");
  });
});

describe("summary of the older part", () => {
  const turns = [1, 2, 3, 4].flatMap((i) => [{ kind: "ask", text: `întrebarea ${i}` }, { kind: "reply", text: `răspunsul ${i}` }]);

  it("the older turns are those before the history window (never starting it with an answer)", () => {
    expect(olderTurns(turns, 4).map((x) => x.text)).toEqual(["întrebarea 1", "răspunsul 1", "întrebarea 2", "răspunsul 2"]);
    expect(olderTurns(turns, 3)).toHaveLength(6); // the window would start with an answer: it moves on
    expect(olderTurns(turns, 0)).toEqual([]); // no history at all: no summary either
    expect(olderTurns(turns.slice(0, 2), 4)).toEqual([]);
  });

  it("is asked for when enough new turns are not covered; updates the previous one", () => {
    expect(needsSummary(1, null)).toBe(false);
    expect(needsSummary(2, null)).toBe(true);
    expect(needsSummary(4, { n: 2, text: "x" })).toBe(false);
    expect(needsSummary(6, { n: 2, text: "x" })).toBe(true);
    const m = summaryMessages(olderTurns(turns, 2), { n: 2, text: "REZUMAT VECHI" }, "ro");
    expect(m[1].content).toContain("REZUMAT VECHI");
    expect(m[1].content).not.toContain("întrebarea 1"); // already in the old summary
    expect(m[1].content).toContain("Utilizator: întrebarea 2");
  });

  it("rides in the system message", () => {
    expect(withSummary("SISTEM", { n: 2, text: "pe scurt" }, "ro")).toBe("SISTEM\n\n## Rezumatul discuției mai vechi (făcut automat)\npe scurt\n");
    expect(withSummary("SISTEM", null, "ro")).toBe("SISTEM");
  });
});

describe("document reader", () => {
  const long = "Clauză. ".repeat(1000) + "Prețul este 4,2 lei/kg.";
  const q = "Ce preț scrie?" + fileBlock("contract.txt", long);

  it("reads only long documents", () => {
    expect(extractMessages("Ce preț?" + fileBlock("a.txt", "scurt"), "ro")).toBeNull();
    const m = extractMessages(q, "ro")!;
    expect(long.length).toBeGreaterThan(READ_FROM);
    expect(m[0].content).toContain("Ce preț scrie?");
    expect(m[1].content).toContain("Prețul este 4,2 lei/kg.");
    expect(documentsOf(q).typed).toBe("Ce preț scrie?");
  });

  it("replaces the files with the passages; keeps the files when the reader found nothing useful", () => {
    const out = withExtract(q, "Prețul este 4,2 lei/kg, conform clauzei finale din contract.", "ro");
    expect(out).toContain("Ce preț scrie?");
    expect(out).toContain("contract.txt");
    expect(out).toContain("Prețul este 4,2 lei/kg, conform");
    expect(out).not.toContain("Clauză. Clauză.");
    expect(withExtract(q, "TOT", "ro")).toBe(q);
    expect(withExtract(q, "scurt", "ro")).toBe(q);
    expect(withExtract(q, "a ``` b".padEnd(60, "x"), "ro")).not.toMatch(/a ``` b/); // no fence can break out
    // a photo note and a file cut without its closing fence are kept as they were
    const mixed = q + "\n\n[poză atașată: lot.png]\n\nFișier atașat: tăiat.txt\n```\ntext tăiat…";
    const out2 = withExtract(mixed, "Prețul este 4,2 lei/kg, conform clauzei finale din contract.", "ro");
    expect(out2).toContain("[poză atașată: lot.png]");
    expect(out2).toContain("text tăiat…");
    expect(out2).not.toContain("Clauză. Clauză.");
  });
});
