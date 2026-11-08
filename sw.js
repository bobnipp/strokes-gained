// Bump VERSION on every deploy so phones pick up the new files.
const VERSION = 'v4';
const SHELL = `shell-${VERSION}`, RUNTIME = 'runtime-v1';
const FILES = [
  './', 'index.html', 'app.css', 'ds.css', 'config.js', 'manifest.webmanifest',
  'js/app.js', 'js/sg.js', 'js/db.js', 'js/sync.js',
  'baseline/broadie-2011-scratch-v1.json',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co')) return; // live data, never cached

  if (url.origin === location.origin) {
    // config.js: network first, so key/URL changes apply without a VERSION bump.
    if (url.pathname.endsWith('/config.js')) {
      e.respondWith(fetch(req).then(r => { if (r.ok) caches.open(SHELL).then(c => c.put(req, r.clone())); return r; })
        .catch(() => caches.match(req, { ignoreSearch: true })));
      return;
    }
    // App shell: cache first, so the app opens instantly with no signal.
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit ||
      fetch(req).catch(() => req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
    return;
  }

  // Fonts and the Supabase library: serve cached copy, refresh in the background.
  e.respondWith(caches.open(RUNTIME).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});