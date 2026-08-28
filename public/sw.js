const CACHE = "washero-operator-v4";
const SHELL = ["/operator", "/operator/hoy", "/operator/login"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/operator")) return;
  if (url.pathname.includes("/reserva/")) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && request.mode === "navigate") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match("/operator/hoy"))),
  );
});

function parsePushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    try {
      const text = event.data.text();
      if (!text) return {};
      return JSON.parse(text);
    } catch {
      return { body: String(event.data.text?.() ?? "") };
    }
  }
}

function resolveOperatorUrl(rawUrl) {
  const fallback = new URL("/operator/hoy", self.location.origin).href;
  if (!rawUrl || typeof rawUrl !== "string") return fallback;
  try {
    const url = new URL(rawUrl, self.location.origin);
    if (url.origin !== self.location.origin) return fallback;
    if (!url.pathname.startsWith("/operator")) return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event);
  const title = payload.title || "Washero";
  const body = payload.body || "Tenés una actualización operativa.";
  const url = payload.url || "/operator/hoy";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.booking_id ? `booking-${payload.booking_id}` : "washero-operator",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = resolveOperatorUrl(event.notification?.data?.url);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (!client.url.includes("/operator")) continue;

        if ("navigate" in client && typeof client.navigate === "function") {
          return client.navigate(targetUrl).then(() => client.focus());
        }

        if ("focus" in client) {
          client.postMessage({ type: "washero-open-url", url: targetUrl });
          return client.focus();
        }
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
