/* Service worker compartido. Cada equipo define CACHE_NAME, PREFIX y PRECACHE antes de importarlo. */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(self.CACHE_NAME).then(c => c.addAll(self.PRECACHE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(self.PREFIX) && k !== self.CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Red primero (así las actualizaciones llegan al momento), caché si no hay conexión.
// Supabase, GIPHY y cualquier otro origen pasan directos.
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(self.CACHE_NAME).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./') : undefined)))
  );
});

// Notificaciones push (las envía la edge function «notify»).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Torrenueva FS', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Torrenueva FS', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag,
    icon: new URL('icon-192.png', self.registration.scope).href,
    badge: new URL('icon-192.png', self.registration.scope).href,
    data: { url: new URL(d.url || './', self.registration.scope).href },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if (c) return c.focus().then(w => w.navigate ? w.navigate(url) : w);
    return self.clients.openWindow(url);
  }));
});
