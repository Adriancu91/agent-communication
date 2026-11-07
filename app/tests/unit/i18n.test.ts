import { describe, expect, it } from "vitest";
import { DICTS } from "../../src/ui/i18n";

describe("texts", () => {
  it("Romanian and English have exactly the same keys, none empty", () => {
    const ro = Object.keys(DICTS.ro).sort();
    expect(Object.keys(DICTS.en).sort()).toEqual(ro);
    for (const lang of ["ro", "en"] as const) {
      for (const k of ro) expect(DICTS[lang][k as keyof typeof DICTS.ro].trim(), `${lang}.${k}`).not.toBe("");
    }
  });

  it("the interface never asks for an API key", () => {
    const text = JSON.stringify(DICTS);
    expect(text).not.toMatch(/\bAPI key\b|cheie API/i);
  });
});
