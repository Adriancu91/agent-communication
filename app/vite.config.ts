import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/**
 * Writes sw.js with the exact list of built files, so the app works offline after the first load.
 * The cache name changes with the content: a new build replaces the old cache.
 */
function serviceWorker(): Plugin {
  return {
    name: "aiw-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map")).sort();
      const assets = ["./", ...files.map((f) => `./${f}`), ...PUBLIC_FILES];
      const version = createHash("sha256").update(JSON.stringify(assets)).update(
        Object.values(bundle).map((c) => ("code" in c ? c.code : String(c.source))).join(""),
      ).digest("hex").slice(0, 12);
      const source = SW_TEMPLATE.replace("__VERSION__", version).replace("__ASSETS__", JSON.stringify(assets));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/**
 * Writes licenses.txt with the license text of every library shipped inside the app
 * (MIT and similar licenses require their notice to travel with the code; minifying removes comments).
 */
function thirdPartyLicenses(): Plugin {
  return {
    name: "aiw-licenses",
    apply: "build",
    generateBundle() {
      const deps = Object.keys((pkg as { dependencies?: Record<string, string> }).dependencies ?? {}).sort();
      const parts = deps.map((name) => {
        const dir = new URL(`./node_modules/${name}/`, import.meta.url);
        const meta = JSON.parse(readFileSync(new URL("package.json", dir), "utf8")) as { version: string; license: string };
        const file = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"].find((f) => existsSync(new URL(f, dir)));
        if (!file) throw new Error(`No license file for ${name}`);
        return `${name} ${meta.version} (${meta.license})\n\n${readFileSync(new URL(file, dir), "utf8").trim()}\n`;
      });
      const head = "AI Workspace — third-party software included in this app / programe terțe incluse în aplicație\n";
      this.emitFile({ type: "asset", fileName: "licenses.txt", source: [head, ...parts].join("\n" + "-".repeat(60) + "\n") });
    },
  };
}

// Files copied from public/ (Vite does not list them in the bundle).
const PUBLIC_FILES = [
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

const SW_TEMPLATE = `// Generated at build time. Same-origin only; never caches or contacts anything else.
const CACHE = "aiw-__VERSION__";
const ASSETS = __ASSETS__;
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("aiw-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
// Cache first; on a miss the network; offline, the app page from any cache of this app.
// It must never answer with "nothing": during an update the previous cache may already be gone.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === "navigate") {
        const shell = await caches.match("./", { ignoreSearch: true, ignoreVary: true });
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
`;

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  base: "./",
  // AIW_BUILD_TAG is used only by the update test, to build a "newer" version of the same app
  define: { __APP_VERSION__: JSON.stringify(pkg.version + (process.env.AIW_BUILD_TAG ? `+${process.env.AIW_BUILD_TAG}` : "")) },
  plugins: [thirdPartyLicenses(), serviceWorker()],
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: { target: "es2020", sourcemap: false, assetsInlineLimit: 0, modulePreload: { polyfill: false } },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
} as never);
