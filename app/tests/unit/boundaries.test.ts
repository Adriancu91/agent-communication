// Every module may import only the modules allowed in src/modules.json.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../src");
const rules = JSON.parse(readFileSync(join(SRC, "modules.json"), "utf8")) as Record<string, string[] | string>;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("module boundaries", () => {
  it("every folder in src/ is a declared module", () => {
    const dirs = readdirSync(SRC).filter((n) => statSync(join(SRC, n)).isDirectory());
    for (const d of dirs) expect(Object.keys(rules), d).toContain(d);
  });

  it("imports respect the architecture", () => {
    const bad: string[] = [];
    for (const f of files(SRC)) {
      const own = relative(SRC, f).split(sep)[0];
      if (!(own in rules)) continue; // main.tsx, env.d.ts: the entry point may import anything
      const allowed = new Set([own, ...(rules[own] as string[])]);
      for (const m of readFileSync(f, "utf8").matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']/g)) {
        const spec = m[1] ?? m[2];
        if (!spec.startsWith(".")) {
          if (!["preact", "preact/hooks"].includes(spec)) bad.push(`${relative(SRC, f)} → ${spec} (bibliotecă nedeclarată)`);
          continue;
        }
        const target = relative(SRC, resolve(f, "..", spec)).split(sep)[0];
        if (target.startsWith("..") || !allowed.has(target)) bad.push(`${relative(SRC, f)} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
