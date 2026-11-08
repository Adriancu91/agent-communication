// Generated at build time. Same-origin only; never caches or contacts anything else.
const CACHE = "aiw-021569dc6814";
const ASSETS = ["./","./assets/freeai-COwZEpFK.js","./assets/index-CBnsd2zW.js","./assets/index-Cg2lBjxi.css","./licenses.txt","./manifest.webmanifest","./icons/icon.svg","./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png","./sandbox.html"];
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
