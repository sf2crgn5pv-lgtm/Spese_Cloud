const CACHE = "paolo-spese-cloud-v3";
const FILES = [
  "./", "./index.html", "./styles.css", "./accounts.js",
  "./app.js", "./auth.js", "./manifest.webmanifest", "./icons/icon.svg"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname === "/api" || u.pathname.startsWith("/api/")) return;

  e.respondWith((async () => {
    try {
      const response = await fetch(r);
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(c => c.put(r, copy));
      }
      return response;
    } catch (_) {
      const cached = await caches.match(r);
      if (cached) return cached;
      if (r.mode === "navigate") {
        const page = await caches.match("./index.html");
        if (page) return page;
      }
      return new Response("Non disponibile offline", {status:503});
    }
  })());
});
