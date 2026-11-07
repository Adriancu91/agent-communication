// Checks the license of every installed package. Allowed: permissive licenses compatible with a
// proprietary product. Anything else (GPL, AGPL, unknown) fails. Run: npm run licenses
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "MPL-2.0", "CC0-1.0", "Python-2.0", "CC-BY-4.0"]);
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const bad = [];
const seen = {};
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path) continue;
  let lic = info.license;
  if (!lic) {
    const pj = join(new URL("..", import.meta.url).pathname, path, "package.json");
    if (existsSync(pj)) lic = JSON.parse(readFileSync(pj, "utf8")).license;
  }
  const ids = String(lic ?? "UNKNOWN").replace(/[()]/g, "").split(/\s+OR\s+/);
  const ok = ids.some((id) => id.split(/\s+AND\s+/).every((p) => ALLOWED.has(p.trim())));
  const kind = info.dev ? "dev" : "app";
  seen[kind] = (seen[kind] ?? 0) + 1;
  if (!ok) bad.push(`${path.replace(/^node_modules\//, "")} (${lic ?? "fără licență"}, ${kind})`);
}
console.log(`Pachete verificate: ${seen.app ?? 0} în aplicație, ${seen.dev ?? 0} doar pentru construire/teste.`);
if (bad.length) {
  console.error("Licențe nepermise sau necunoscute:\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log("OK: toate licențele sunt permisive.");
