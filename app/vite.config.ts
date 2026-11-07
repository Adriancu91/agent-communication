import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      if (req.mode === "navigate") return caches.match("./");
      return fetch(req);
    }),
  );
});
`;

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [serviceWorker()],
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: { target: "es2020", sourcemap: false, assetsInlineLimit: 0 },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
} as never);
