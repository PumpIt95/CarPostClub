const APP_ICON = "/icons/carpostclub-icon-192.png";
const APP_BADGE = "/icons/carpostclub-apple-touch-icon.png";
const CACHE_VERSION = "carpostclub-pwa-v11";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const CORE_ASSETS = [
  "/offline.html",
  "/styles.css",
  "/app.js",
  "/file-list.js",
  "/manifest.webmanifest",
  "/favicon.png",
  "/icons/carpostclub-icon-192.png",
  "/icons/carpostclub-icon-512.png",
  "/icons/carpostclub-icon-1024.png",
  "/icons/carpostclub-apple-touch-icon.png",
  "/share-card.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(CORE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name !== STATIC_CACHE && /(?:photos|carpostclub)-/.test(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNetworkOnlyPath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || "CarPostClub";
  const options = {
    body: payload.body || "Open CarPostClub.",
    icon: payload.icon || APP_ICON,
    badge: payload.badge || APP_BADGE,
    tag: payload.tag || "carpostclub",
    data: {
      url: payload.url || "/",
      kind: payload.kind || "",
      messageId: payload.messageId || "",
      author: payload.author || "",
    },
    timestamp: notificationTimestamp(payload.timestamp),
    actions: notificationActions(payload),
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin === self.location.origin && "focus" in client) {
        await client.focus();
        if ("navigate" in client) return client.navigate(targetUrl);
        return null;
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});

function parsePushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return {
      title: "CarPostClub",
      body: event.data.text(),
      url: "/",
    };
  }
}

function notificationTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function notificationActions(payload) {
  if (payload.kind !== "chat") return [];
  return [
    {
      action: "open-chat",
      title: "Open chat",
    },
  ];
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return await caches.match("/offline.html") || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const url = new URL(request.url);
  if (url.search && isStaticAsset(url.pathname)) {
    return await networkFirstVersionedStaticAsset(cache, request, url.pathname);
  }

  const cached = await cachedStaticResponse(cache, request);
  const refresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await refresh || Response.error();
}

async function networkFirstVersionedStaticAsset(cache, request, pathname) {
  const response = await fetch(request).then(async (networkResponse) => {
    if (networkResponse.ok) {
      await Promise.all([
        cache.put(request, networkResponse.clone()),
        cache.put(pathname, networkResponse.clone()),
      ]).catch(() => {});
    }
    return networkResponse;
  }).catch(() => null);

  return response
    || await cache.match(request)
    || await cache.match(pathname)
    || Response.error();
}

async function cachedStaticResponse(cache, request) {
  const cached = await cache.match(request);
  if (cached) return cached;

  const url = new URL(request.url);
  if (url.search && isStaticAsset(url.pathname)) {
    return await cache.match(url.pathname);
  }
  return null;
}

function isNetworkOnlyPath(pathname) {
  return pathname.startsWith("/api/")
    || pathname === "/login"
    || pathname === "/logout"
    || pathname === "/signup"
    || pathname.startsWith("/account/")
    || pathname.startsWith("/admin/");
}

function isStaticAsset(pathname) {
  return CORE_ASSETS.includes(pathname)
    || pathname.startsWith("/icons/")
    || /\.(?:css|js|svg|png|webmanifest)$/i.test(pathname);
}
