self.PREFIX = 'tfs-juvenil-';
self.CACHE_NAME = 'tfs-juvenil-v1';
self.PRECACHE = [
  './', './manifest.webmanifest', './icon-192.png', './apple-touch-icon.png',
  '../app/app.css', '../app/app.js', '../app/vendor/supabase-2.117.2.js',
  '../app/fonts/bigshoulders-800.woff2', '../app/fonts/bigshoulders-900.woff2',
  '../app/fonts/figtree-var.woff2', '../app/fonts/figtree-var-ext.woff2',
];
importScripts('../app/sw-core.js');
