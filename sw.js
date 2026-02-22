const CACHE = 'multas-v3';
const ASSETS = ['/manifest.json', '/escudo.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Supabase → siempre red, nunca caché
  if (url.includes('supabase.co')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // HTML → network-first: intenta red, si falla usa caché
  if (e.request.mode === 'navigate' || url.endsWith('.html') || url.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Resto → cache-first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
