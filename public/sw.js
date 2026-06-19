const APP_ICON = "/icons/carpostclub-icon-192.png";
const APP_BADGE = "/icons/carpostclub-apple-touch-icon.png";
const CACHE_VERSION = "carpostclub-pwa-v74";
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
  "/dealership-logos/2-greenlight.webp",
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
  const targetUrl = notificationTargetPath(payload);
  const options = {
    body: Object.prototype.hasOwnProperty.call(payload, "body") ? String(payload.body || "") : "Open CarPostClub.",
    icon: payload.icon || APP_ICON,
    badge: payload.badge || APP_BADGE,
    tag: payload.tag || "carpostclub",
    data: {
      url: targetUrl,
      kind: payload.kind || "",
      type: payload.type || "",
      route: payload.route || "",
      notificationType: payload.notificationType || "",
      notificationId: payload.notificationId || payload.messageId || "",
      uploadId: payload.uploadId || "",
      messageId: payload.messageId || "",
      albumId: payload.albumId || "",
      dealershipId: payload.dealershipId || "",
      inventoryTypeId: payload.inventoryTypeId || "",
      inventoryKey: payload.inventoryKey || "",
      stockNumber: payload.stockNumber || "",
      mediaId: payload.mediaId || "",
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
  const targetUrl = new URL(notificationTargetPath(event.notification.data || {}), self.location.origin).href;

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

function notificationTargetPath(payload = {}) {
  const explicitPath = cleanNavigationPath(payload.url);
  const routePath = cleanNavigationPath(payload.route);
  if (chatPath(explicitPath) || chatPath(routePath)) return "/chat";
  if (routePath) {
    if (routePath.startsWith("/gallery")) return mediaGalleryPath(payload, routePath);
    return routePath;
  }

  const route = notificationToken(payload.route);
  if (route === "notifications" || route === "notification_panel") {
    return notificationsPath(payload, explicitPath);
  }
  if (route === "media_gallery" || route === "gallery") {
    return mediaGalleryPath(payload, explicitPath);
  }
  if (route === "vehicle_media_intake" || route === "home" || route === "inventory") {
    return intakePath(payload, explicitPath);
  }

  const type = notificationToken(payload.notificationType || payload.type || payload.kind);
  if (type === "upload" || type === "media_upload" || type === "new_media_upload" || type === "inventory_removed") {
    return mediaGalleryPath(payload, explicitPath);
  }
  if (type === "chat" || type === "chat_reaction") {
    return "/chat";
  }
  if (type === "price_change") {
    return notificationsPath(payload, explicitPath);
  }
  if (type === "inventory_added" || type === "new_inventory") {
    return intakePath(payload, explicitPath);
  }

  if (explicitPath) return explicitPath;
  return "/";
}

function mediaGalleryPath(payload = {}, fallbackPath = "") {
  const fallback = cleanNavigationPath(fallbackPath);
  const params = notificationParams(payload, fallback);
  params.delete("openAlbum");
  const query = params.toString();
  return query ? `/gallery?${query}` : "/gallery";
}

function notificationsPath(payload = {}, fallbackPath = "") {
  const fallback = cleanNavigationPath(fallbackPath);
  const params = notificationParams(payload, fallback);
  params.set("openNotifications", "1");
  const notificationId = payload.notificationId || payload.messageId;
  if (notificationId && !params.has("notificationId")) {
    params.set("notificationId", String(notificationId).slice(0, 120));
  }
  const query = params.toString();
  return query ? `/?${query}` : "/?openNotifications=1";
}

function intakePath(payload = {}, fallbackPath = "") {
  const fallback = cleanNavigationPath(fallbackPath);
  if (fallback && !fallback.startsWith("/gallery")) return fallback;
  const params = notificationParams(payload, fallback);
  params.delete("albumId");
  params.delete("openAlbum");
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function notificationParams(payload = {}, fallbackPath = "") {
  const params = new URLSearchParams();
  const fallback = cleanNavigationPath(fallbackPath);
  const questionIndex = fallback.indexOf("?");
  if (questionIndex >= 0) {
    for (const [key, value] of new URLSearchParams(fallback.slice(questionIndex + 1))) {
      if (value) params.set(key, value);
    }
  }
  setParamIfMissing(params, "dealershipId", payload.dealershipId);
  setParamIfMissing(params, "inventoryTypeId", payload.inventoryTypeId);
  setParamIfMissing(params, "inventoryKey", payload.inventoryKey || payload.vin);
  setParamIfMissing(params, "albumId", payload.albumId);
  if (payload.stockNumber && !params.has("stockNumber")) params.set("stockNumber", String(payload.stockNumber).slice(0, 80));
  return params;
}

function setParamIfMissing(params, key, value) {
  const text = String(value || "").trim();
  if (text && !params.has(key)) params.set(key, text.slice(0, 160));
}

function cleanNavigationPath(value) {
  const text = String(value || "").trim();
  if (!text || !text.startsWith("/") || text.startsWith("//")) return "";
  return text.slice(0, 512);
}

function chatPath(path) {
  const cleanPath = cleanNavigationPath(path);
  if (!cleanPath) return "";
  try {
    const url = new URL(cleanPath, self.location.origin);
    return url.pathname === "/chat" || url.searchParams.get("openChat") === "1" ? "/chat" : "";
  } catch {
    return "";
  }
}

function notificationToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
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
