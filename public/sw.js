// Minimal service worker: only shows notifications and routes taps back to the
// inbox. It deliberately has no fetch handler, so nothing is cached.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const threadKey = event.notification.data && event.notification.data.threadKey;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((windowClient) => new URL(windowClient.url).origin === self.location.origin);

    if (client) {
      await client.focus();
      if (threadKey) client.postMessage({ type: 'inbox-notification-click', threadKey });
      return;
    }

    await self.clients.openWindow(threadKey ? `/?thread=${encodeURIComponent(threadKey)}` : '/');
  })());
});
