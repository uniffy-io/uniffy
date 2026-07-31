// Notification-only service worker: web-push display + click routing.
// No fetch interception and no auth - authenticated asset reads use the asset cookie, not a worker.

// The worker has no route table - a URN cannot be turned into a path here, so the
// click target is the in-app resolver route, which owns the mapping.
function resolverUrl(payload) {
  if (!payload.source_urn) return '/';
  const params = new URLSearchParams({ urn: payload.source_urn });
  if (payload.notification_type) params.set('type', String(payload.notification_type));
  if (payload.metadata && Object.keys(payload.metadata).length > 0) {
    params.set('meta', JSON.stringify(payload.metadata));
  }
  return `/n?${params.toString()}`;
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Uniffy', body: event.data.text() };
  }

  const title = payload.title || 'Uniffy';
  const options = {
    body: payload.body || '',
    icon: '/favicon-96x96.png',
    badge: '/favicon-96x96.png',
    data: { url: resolverUrl(payload) },
    tag: payload.notification_type ? String(payload.notification_type) : 'uniffy-notification',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            client.postMessage({ type: 'PUSH_NOTIFICATION_CLICK', url });
            return;
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

self.addEventListener('pushsubscriptionchange', () => {
  console.warn('[notification-worker] pushsubscriptionchange - subscription lost');
});

// Activate immediately so push works on first enable without a reload.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
