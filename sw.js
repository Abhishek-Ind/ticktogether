const CACHE = "ticktogether-v1";
const STATIC = [
  "./",
  "./index.html",
  "./group.html",
  "./app.js",
  "./group.js",
  "./styles.css",
  "./group.css",
  "./supabaseClient.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always try network, fall back to cache for static assets
self.addEventListener("fetch", (event) => {
  // Only handle same-origin GET requests; let Supabase/ESM requests pass through
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (event.request.method !== "GET" || !isSameOrigin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
