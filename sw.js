/* ============================================================================
   GamingX service worker — handles background Web Push for the social apps.
   Registered at site root (scope "/") so one registration covers Penfrank,
   PenShare, PenTalk and PenWave. Only meaningful over https (Netlify etc.);
   browsers won't register a service worker from file://.
   ========================================================================== */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: 'GamingX', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'GamingX';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.focus(); return; } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
