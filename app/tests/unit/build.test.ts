// Checks the built app (dist/): strict security policy, no external address, offline file list complete.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIST = resolve(__dirname, "../../dist");
const built = existsSync(join(DIST, "index.html"));

function all(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? all(p) : [p];
  });
}

describe.runIf(built)("built app (run `npm run build` first)", () => {
  const html = built ? readFileSync(join(DIST, "index.html"), "utf8") : "";

  it("has a strict Content-Security-Policy", () => {
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:/);
  });

  it("contains no paid API address and no external script, font or tracker", () => {
    const api = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|api\.groq\.com|models\.github\.ai|googletagmanager|google-analytics|fonts\.googleapis/i;
    for (const f of all(DIST).filter((p) => /\.(js|css|html|json|webmanifest)$/.test(p))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(api);
    }
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
  });

  it("the offline worker lists every built file, and only own files", () => {
    const sw = readFileSync(join(DIST, "sw.js"), "utf8");
    const list = JSON.parse(/const ASSETS = (\[.*?\]);/s.exec(sw)![1]) as string[];
    for (const a of list) {
      expect(a.startsWith("./"), a).toBe(true);
      if (a !== "./") expect(existsSync(join(DIST, a)), a).toBe(true);
    }
    const files = all(DIST).map((p) => "./" + p.slice(DIST.length + 1)).filter((p) => p !== "./sw.js" && p !== "./index.html");
    for (const f of files) expect(list, f).toContain(f);
  });

  it("the offline worker ignores Vary (servers send Vary: Origin; without this, offline loads fail)", () => {
    const sw = readFileSync(join(DIST, "sw.js"), "utf8");
    expect(sw).toContain("ignoreVary: true");
    expect(sw).toMatch(/origin !== self\.location\.origin\) return/);
  });
});
