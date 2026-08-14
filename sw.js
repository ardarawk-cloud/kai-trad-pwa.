const CACHE = "kai-trad-v1105-frontend-freeze-guard";
const STATIC = ["/", "/index.html", "/app.css", "/app.js", "/broker-v183.js", "/dashboard-pad.js", "/validation-v110.js", "/calibration-ui-v1102.js", "/volume-audit-ui-v1104.js", "/volume-reliability-ui-v1105.js", "/manifest.webmanifest", "/icon.svg", "/kai-trad-logo.png", "/pwa-icon-192.png", "/pwa-icon-512.png"];

self.addEventListener("install", (event) => event.waitUntil(
  caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())
));

self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

async function fetchWithTimeout(request, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;

  if (url.pathname === "/api/health" || url.pathname === "/api/state") {
    event.respondWith(
      fetchWithTimeout(req, 9000).catch(() => new Response(JSON.stringify({
        error: "API timeout",
        retryable: true,
      }), {
        status: 504,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      }))
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((cached) => cached || caches.match("/index.html")))
  );
});
