/* SURAKSHA service worker: app-shell caching, offline fallback, Web Push display and click handling. */
const VERSION = "2026-11-20.1";
const STATIC_CACHE = `suraksha-static-${VERSION}`;
const PAGE_CACHE = `suraksha-pages-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/maskable-192.png", "/icons/badge-96.png"];
// Only public, non-personal pages are kept for offline viewing. SOS, dashboards and API responses are never cached.
const PUBLIC_PAGES = new Set(["/", "/shelters", "/evacuation", "/alerts"]);
const SEVERITIES = new Set(["advisory", "warning", "severe", "critical"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

self.addEventListener("install", (event) => {
  // No skipWaiting here: a new version waits until the page asks for it (controlled update).
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      for (const key of await caches.keys()) if (key.startsWith("suraksha-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // map tiles, API, fonts: network only

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    // Content-hashed build assets: cache-first.
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok && PUBLIC_PAGES.has(url.pathname)) (await caches.open(PAGE_CACHE)).put(url.pathname, res.clone());
          return res;
        } catch {
          const saved = PUBLIC_PAGES.has(url.pathname) ? await caches.match(url.pathname, { cacheName: PAGE_CACHE }) : undefined;
          return saved || (await caches.match(OFFLINE_URL)) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
  }
});

/** Only same-origin, path-relative URLs are ever opened from a notification. */
function safeUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/alerts";
  const url = new URL(value, self.location.origin);
  return url.origin === self.location.origin ? url.pathname + url.search : "/alerts";
}

function parsePayload(event) {
  try {
    const d = event.data ? event.data.json() : null;
    if (!d || typeof d !== "object" || !UUID.test(d.alertId) || typeof d.title !== "string" || typeof d.body !== "string" || !SEVERITIES.has(d.severity)) return null;
    return {
      alertId: d.alertId,
      title: d.title.slice(0, 150),
      body: d.body.slice(0, 700),
      severity: d.severity,
      url: safeUrl(d.url),
      sentAt: typeof d.sentAt === "string" ? Date.parse(d.sentAt) : NaN,
      expired: typeof d.expiresAt === "string" && Date.parse(d.expiresAt) <= Date.now(),
    };
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const n = parsePayload(event);
  // Browsers require a visible notification for every push, so an unreadable payload still shows a neutral one.
  const title = n ? n.title : "SURAKSHA";
  const options = n
    ? {
        body: n.expired ? `Expired: ${n.body}` : n.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: n.alertId, // the same alert never stacks twice
        renotify: false,
        requireInteraction: n.severity === "critical",
        timestamp: Number.isFinite(n.sentAt) ? n.sentAt : Date.now(),
        data: { url: n.url, alertId: n.alertId, severity: n.severity },
      }
    : { body: "Open SURAKSHA to see the latest alert.", icon: "/icons/icon-192.png", badge: "/icons/badge-96.png", tag: "suraksha-generic", data: { url: "/alerts" } };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "suraksha:push", alertId: n && n.alertId });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        try {
          await existing.navigate(url);
        } catch {
          existing.postMessage({ type: "suraksha:navigate", url }); // uncontrolled window: let the app route
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
