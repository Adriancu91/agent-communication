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
    // AIW-06 (approved by the owner): the in-app chat may reach exactly Puter's API and, AIW-06.1 (asked by the
    // owner), the free Pollinations text service; nothing else
    const allowed = " https://api.puter.com wss://api.puter.com https://text.pollinations.ai";
    expect(/connect-src ([^;]+)/.exec(csp)?.[1].trim()).toBe("'self'" + allowed);
    expect(csp.replace(allowed, "")).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:|wss?:/);
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
    // AIW-06: only the chat's Puter.js is left out (loaded when the chat opens; the chat needs internet anyway)
    for (const f of files) if (f !== "./vendor/puter.js") expect(list, f).toContain(f);
    expect(list).not.toContain("./vendor/puter.js");
  });

  it("ships the license notice of every bundled library (licenses.txt)", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as { dependencies: Record<string, string> };
    const txt = readFileSync(join(DIST, "licenses.txt"), "utf8");
    for (const name of Object.keys(pkg.dependencies)) expect(txt, name).toContain(name);
    expect(txt).toContain("Permission is hereby granted");
  });

  it("the app code makes no network calls of its own (only the offline worker reads its own files)", () => {
    // AIW-06.1 (asked by the owner): the chat's free mode is the one exception — a separate file, loaded only
    // when the free model is used, whose only address is the free Pollinations text service
    let free = 0;
    for (const f of all(join(DIST, "assets")).filter((p) => p.endsWith(".js"))) {
      const code = readFileSync(f, "utf8");
      if (code.includes("https://text.pollinations.ai/openai")) {
        free++;
        expect(code.match(/https?:\/\/[a-z0-9.-]+/gi)?.filter((u) => u !== "https://text.pollinations.ai"), f).toEqual([]);
        expect(code, f).not.toMatch(/XMLHttpRequest|WebSocket|sendBeacon|EventSource|RTCPeerConnection|importScripts/);
        continue;
      }
      expect(code, f).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|RTCPeerConnection|importScripts/);
    }
    expect(free).toBe(1);
  });

  it("the offline worker ignores Vary (servers send Vary: Origin; without this, offline loads fail)", () => {
    const sw = readFileSync(join(DIST, "sw.js"), "utf8");
    expect(sw).toContain("ignoreVary: true");
    expect(sw).toMatch(/origin !== self\.location\.origin\) return/);
  });
});
