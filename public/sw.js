self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { type: 'call:created', title: 'BeaconDesk Alert', body: event.data.text() };
  }

  if (payload.type === 'call:dismiss' && payload.callId) {
    const tag = `call-${payload.callId}`;
    event.waitUntil(
      self.registration.getNotifications({ tag }).then((notifications) => {
        notifications.forEach((n) => n.close());
      })
    );
    return;
  }

  if (payload.type === 'call:created' || payload.type === 'test') {
    const title = payload.title || 'Participant Requesting Help';
    const body = payload.body || 'Tap to view the facilitator dashboard.';
    const tag = payload.callId ? `call-${payload.callId}` : 'beacondesk-test';

    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        tag,
        renotify: true,
        requireInteraction: true,
        vibrate: [250, 100, 250],
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: {
          url: '/dashboard',
          callId: payload.callId || null,
        },
      })
    );
  }
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'CLOSE_CALL_NOTIFICATION' && data.callId) {
    const tag = `call-${data.callId}`;
    event.waitUntil(
      self.registration.getNotifications({ tag }).then((notifications) => {
        notifications.forEach((n) => n.close());
      })
    );
  }

  if (data.type === 'SHOW_CALL_NOTIFICATION' && data.title) {
    const tag = data.callId ? `call-${data.callId}` : 'beacondesk-alert';
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body || '',
        tag,
        renotify: true,
        requireInteraction: true,
        vibrate: [250, 100, 250],
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: {
          url: '/dashboard',
          callId: data.callId || null,
        },
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/dashboard') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
