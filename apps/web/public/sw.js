/* Tasknest — Service Worker Web Push (US-NO-01).
   Affiche la notification reçue ; clic ⇒ focus/ouvre l'app. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: 'Tasknest', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Tasknest';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      data: { url: data.url || '/tasks' },
      tag: data.tag,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/tasks';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const open = clients.find((c) => 'focus' in c);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    }),
  );
});
