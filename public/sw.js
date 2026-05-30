const APP_ICON = "/icons/icon-192.png";
const APP_BADGE = "/icons/apple-touch-icon.png";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || "Konner Photos";
  const options = {
    body: payload.body || "Photos are ready.",
    icon: payload.icon || APP_ICON,
    badge: payload.badge || APP_BADGE,
    tag: payload.tag || "konnercars-photos",
    data: {
      url: payload.url || "/",
    },
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
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
      title: "Konner Photos",
      body: event.data.text(),
      url: "/",
    };
  }
}
