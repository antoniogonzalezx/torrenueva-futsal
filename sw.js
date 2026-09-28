// La app 2025/26 vivía en la raíz. Este service worker limpia su caché y se desinstala,
// para que quien la tenga instalada vea la portada nueva con los enlaces por equipo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('multas-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    (await self.clients.matchAll({ type: 'window' })).forEach(c => c.navigate(c.url));
  })());
});
