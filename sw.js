const CACHE = "kai-trad-v170-icon-dist-fix";
const STATIC = ["/", "/index.html", "/app.css", "/app.js", "/manifest.webmanifest", "/icon.svg", "/kai-trad-logo.png", "/pwa-icon-192.png", "/pwa-icon-512.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(event.request, copy));
    return res;
  }).catch(() => caches.match(event.request).then((r) => r || caches.match("/index.html"))));
});
