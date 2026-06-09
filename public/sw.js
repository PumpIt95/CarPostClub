const APP_ICON = "/icons/carpostclub-icon-192.png";
const APP_BADGE = "/icons/carpostclub-apple-touch-icon.png";
const CACHE_VERSION = "carpostclub-pwa-v56";
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
  "/upload-monkey.svg",
  "/dealership-logos/3-nissan.webp",
  "/dealership-logos/15-kia.webp",
  "/dealership-logos/18-gm.webp",
  "/dealership-logos/31-volkswagen.webp",
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

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isApiPath(url.pathname)) return;

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
      notificationId: payload.notificationId || payload.messageId || "",
      messageId: payload.messageId || "",
      albumId: payload.albumId || "",
      mediaCount: payload.mediaCount || 0,
      author: payload.author || "",
    },
    timestamp: notificationTimestamp(payload.timestamp),
    actions: notificationActions(payload),
    renotify: true,
  };

  event.waitUntil(Promise.all([
    broadcastPushPayload(payload),
    self.registration.showNotification(title, options),
  ]));
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

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(refreshPushSubscription(event));
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

async function refreshPushSubscription(event) {
  try {
    const publicKey = await fetchPushPublicKey();
    if (!publicKey) return;

    const subscription = event.newSubscription || await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const oldEndpoint = event.oldSubscription?.endpoint || "";
    if (oldEndpoint && oldEndpoint !== subscription.endpoint) {
      await fetch("/api/push/subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ endpoint: oldEndpoint }),
      }).catch(() => null);
    }

    await fetch("/api/push/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ subscription: serializePushSubscription(subscription) }),
    });
  } catch {
    // The page will repair the subscription on the next authenticated app load.
  }
}

async function fetchPushPublicKey() {
  const response = await fetch("/api/push/config", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) return "";
  const config = await response.json().catch(() => null);
  return typeof config?.publicKey === "string" ? config.publicKey : "";
}

function serializePushSubscription(subscription) {
  return typeof subscription?.toJSON === "function" ? subscription.toJSON() : subscription;
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function broadcastPushPayload(payload) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  await Promise.all(windows.map((client) => {
    try {
      client.postMessage({
        type: "carpostclub:push",
        payload,
      });
    } catch {
      // Window clients can disappear while a push event is being handled.
    }
    return null;
  }));
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

function isApiPath(pathname) {
  return pathname.startsWith("/api/");
}

function isStaticAsset(pathname) {
  return CORE_ASSETS.includes(pathname)
    || pathname.startsWith("/icons/")
    || /\.(?:css|js|svg|png|webmanifest)$/i.test(pathname);
}
