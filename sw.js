// Service worker: makes the app work offline and handles notification taps.
// Bump VERSION whenever app files change so installed copies update.
const VERSION = 'v7';
const SHELL = `shell-${VERSION}`;
const IMAGES = 'images-v1';
const API = 'api-v1';

const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/nav.js', 'js/store.js', 'js/db.js', 'js/ui.js', 'js/hooks.js', 'js/sync.js',
  'js/api/tvmaze.js', 'js/api/trakt.js', 'js/api/omdb.js',
  'js/views/common.js', 'js/views/show.js', 'js/views/library.js', 'js/views/discover.js',
  'js/views/upcoming.js', 'js/views/lists.js', 'js/views/profile.js', 'js/views/install.js', 'js/views/following.js',
  'js/vendor/preact-htm.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg',
];

self.addEventListener('install', e => {
  // `cache: 'reload'` skips the HTTP cache so a new version never installs stale files.
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [SHELL, IMAGES, API];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Posters & stills: cache-first, they never change.
  if (url.hostname === 'static.tvmaze.com' || url.hostname.endsWith('trakt.tv') && request.destination === 'image') {
    e.respondWith(caches.open(IMAGES).then(async c => {
      const hit = await c.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok || res.type === 'opaque') { c.put(request, res.clone()); trim(IMAGES, 600); }
      return res;
    }).catch(() => Response.error()));
    return;
  }

  // TVmaze API: network-first, fall back to the last response when offline.
  if (url.hostname === 'api.tvmaze.com') {
    e.respondWith(fetch(request).then(res => {
      if (res.ok) caches.open(API).then(c => { c.put(request, res.clone()); trim(API, 300); });
      return res;
    }).catch(() => caches.match(request, { cacheName: API }).then(r => r || Response.error())));
    return;
  }

  // App shell: stale-while-revalidate so launches are instant and updates arrive next time.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(SHELL).then(async c => {
      const hit = await c.match(request, { ignoreSearch: true });
      const net = fetch(request).then(res => { if (res.ok) c.put(request, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '#/upcoming';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const scope = self.registration.scope;
    for (const w of wins) {
      if (w.url.startsWith(scope)) {
        w.postMessage({ type: 'navigate', url: target });
        return w.focus();
      }
    }
    return self.clients.openWindow(scope + target);
  })());
});

// Ready for real push messages if a push server is added later.
self.addEventListener('push', e => {
  const data = e.data?.json?.() || {};
  e.waitUntil(self.registration.showNotification(data.title || 'TV Tracker', { body: data.body, icon: 'icons/icon-192.png', data: { url: data.url } }));
});
