const CACHE = "ticktogether-v2";
const STATIC = [
  "./",
  "./index.html",
  "./group.html",
  "./app.js",
  "./group.js",
  "./styles.css",
  "./group.css",
  "./supabaseClient.js",
  "./config.js",
  "./register-sw.js",
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

// ── Push Notifications ────────────────────────────────────────────────────────

// Called by the Supabase alarm-push Edge Function when an alarm becomes ringing.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {}

  const title = data.title || "⏰ Alarm ringing";
  const options = {
    body: data.body || "A timer has completed.",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: data.alarmId || "alarm",   // replace any existing notification for same alarm
    renotify: true,                 // vibrate/sound even if replacing same tag
    requireInteraction: true,       // stay visible until user taps it
    data: {
      // Validate the code format before embedding it in a URL to prevent
      // a malformed push payload from injecting unexpected query parameters.
      url: /^[0-9A-F]{6}$/.test(data.groupCode ?? "")
        ? `./group.html?code=${data.groupCode}`
        : "./group.html",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification opens (or focuses) the group page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./group.html";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // If a group page tab is already open, focus it
        for (const client of windowClients) {
          if (client.url.includes("group.html") && "focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        // Otherwise open a new tab
        return clients.openWindow(target);
      })
  );
});

// ── Network-first fetch ────────────────────────────────────────────────────────

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
