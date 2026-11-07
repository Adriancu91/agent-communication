// Builds the REAL AIW-02 app (commit fe039c0, PR #5) into .baseline/aiw02-dist, for the browser
// migration test (tests/e2e/migration.spec.ts). Uses a temporary git worktree; nothing in the
// working copy changes. Run: node scripts/build-aiw02-baseline.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const app = resolve(new URL("..", import.meta.url).pathname);
// AIW-02 as in PR #5. The tag "aiw-02-baseline" (if present) keeps it reachable after a squash merge;
// otherwise the commit itself, reachable as long as the AIW-02 / AIW-03 history is kept.
const has = (ref) => { try { execFileSync("git", ["-C", app, "rev-parse", "--verify", "--quiet", ref + "^{commit}"]); return true; } catch { return false; } };
const COMMIT = process.env.AIW02_COMMIT ?? (has("aiw-02-baseline") ? "aiw-02-baseline" : "fe039c0");
const out = join(app, ".baseline", "aiw02-dist");
const repo = execFileSync("git", ["-C", app, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const wt = mkdtempSync(join(tmpdir(), "aiw02-"));
rmSync(wt, { recursive: true, force: true });
try {
  execFileSync("git", ["-C", repo, "worktree", "add", "--detach", wt, COMMIT], { stdio: "inherit" });
  symlinkSync(join(app, "node_modules"), join(wt, "app", "node_modules"), "dir"); // same tool versions
  rmSync(out, { recursive: true, force: true });
  execFileSync(join(app, "node_modules", ".bin", "vite"), ["build", "--outDir", out, "--emptyOutDir"], { cwd: join(wt, "app"), stdio: "inherit" });
  if (!existsSync(join(out, "index.html"))) throw new Error("baseline build failed");
  console.log(`AIW-02 (${COMMIT}) construit în ${out}`);
} finally {
  execFileSync("git", ["-C", repo, "worktree", "remove", "--force", wt], { stdio: "inherit" });
}
