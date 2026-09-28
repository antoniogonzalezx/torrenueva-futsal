self.PREFIX = 'tfs-senior-';
self.CACHE_NAME = 'tfs-senior-v4';
self.PRECACHE = [
  './', './manifest.webmanifest', './icon-192.png', './apple-touch-icon.png',
  '../app/app.css', '../app/app.js', '../app/vendor/supabase-2.117.2.js',
  '../app/icons.js', '../app/fonts/inter-var.woff2', '../app/fonts/inter-var-ext.woff2',
];
importScripts('../app/sw-core.js');
