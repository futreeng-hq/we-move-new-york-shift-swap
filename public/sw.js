// WMNY Shift Swap — Service Worker
// Handles push notifications and offline app shell caching

// The cache name is stamped at build time — do NOT bump it by hand.
//
// scripts/stamp-sw.mjs rewrites the string below to `wmny-shell-<sha7>` during
// the Vercel build, so every deploy gets a fresh cache and `activate` drops the
// previous one. That matters because the fetch handler writes navigations into
// this cache: with a name that never changed, a returning or offline user was
// served shell HTML referencing /_next/static/ hashes the new deploy no longer
// had — a blank page — and the cache grew without bound.
//
// The literal here is the fallback, not a placeholder. If the stamp step never
// runs (a local `next build`, or a future pipeline that forgets it) this file is
// still a valid, working service worker with a static cache name. Degrading to
// the old stale-cache behaviour is bad; degrading to no service worker at all
// would be worse, so the committed file always stands on its own.
const CACHE_NAME = "wmny-shell-dev";

// App shell: routes and static assets that must load offline
const SHELL_URLS = [
  "/",
  "/login",
  "/depots",
  "/manifest.json",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ─── Install: pre-cache the app shell ────────────────────────────────────────
// cache.addAll() is all-or-nothing: one entry that 404s, or that answers with a
// redirect, rejects the whole promise and the install FAILS — leaving no service
// worker at all, so no offline shell and no push. /depots redirects for a signed
// -out visitor, which is exactly that case. Cache each URL independently and let
// the misses go; a shell that is 6/7 cached beats no worker.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)))
    )
  );
  self.skipWaiting();
});

// ─── Activate: delete stale caches ───────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => clients.claim())
  );
});

// ─── Fetch: serve shell from cache, pass API/dynamic requests through ─────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // API calls: network-only — never cache user data
  if (url.pathname.startsWith("/api/")) return;

  // _next/static assets: cache-first (content-hashed filenames, safe forever)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            }
            return res;
          })
      )
    );
    return;
  }

  // Icons and manifest: cache-first
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/favicon.svg"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request))
    );
    return;
  }

  // Navigation requests (HTML pages): network-first, fall back to cached shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Cache the fresh page for next offline use
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(async () => {
          // Offline: return cached version of this exact URL, or the login shell
          const cached = await caches.match(request);
          return cached ?? caches.match("/login");
        })
    );
  }
});

// ─── Push notifications ───────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "WMNY Shift Swap", body: "New update", url: "/" };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      data: { url: payload.url ?? "/" },
      vibrate: [100, 50, 100],
    })
  );
});

// ─── Notification click: open app at the right URL ───────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (
            client.url.includes(self.location.origin) &&
            "focus" in client
          ) {
            client.navigate(url);
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
