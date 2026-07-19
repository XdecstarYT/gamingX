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
  const url = data.url || '/';
  const isCall = typeof url === 'string' && url.indexOf('call=') !== -1;
  const options = {
    body: data.body || '',
    tag: data.tag || (isCall ? 'gx-call' : undefined),
    renotify: isCall || undefined,
    data: { url },
    // calls: stay on screen until acted on, stronger buzz, Answer/Decline actions
    requireInteraction: isCall,
    vibrate: isCall ? [400, 200, 400, 200, 400, 200, 400] : [80, 40, 80],
    actions: isCall ? [{ action: 'answer', title: '✅ Answer' }, { action: 'decline', title: '❌ Decline' }] : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'decline') return; // dismiss; caller will time out as missed
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { if (c.navigate && url !== '/') { try { c.navigate(url); } catch (e) {} } return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
