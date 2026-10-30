// Versión local: guarda toda la app en el dispositivo para que abra sin internet.
// Primero responde con lo guardado; si hay conexión, actualiza en segundo plano.
const CACHE = "barriles-local-v10";
const SHELL = [
  "./", "index.html", "styles.css?v=7", "app.js?v=5", "manifest.webmanifest",
  "fonts/big-shoulders-display-latin-600-normal.woff2",
  "fonts/big-shoulders-display-latin-800-normal.woff2",
  "fonts/ibm-plex-mono-latin-500-normal.woff2",
  "fonts/ibm-plex-mono-latin-600-normal.woff2",
  "fonts/public-sans-latin-400-normal.woff2",
  "fonts/public-sans-latin-500-normal.woff2",
  "fonts/public-sans-latin-600-normal.woff2",
  "fonts/public-sans-latin-700-normal.woff2",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "vendor/jsQR.js",
  "vendor/qrcode.min.js",
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("barriles-local-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const isPage = e.request.mode === "navigate";
  e.respondWith(caches.open(CACHE).then(async c => {
    const key = isPage ? "index.html" : e.request;
    const hit = await c.match(key, { ignoreSearch: isPage });
    const net = fetch(e.request, { cache: "no-cache" }).then(r => { if (r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});
