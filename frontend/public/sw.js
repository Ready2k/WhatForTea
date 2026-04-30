/* Service worker — handles Web Push notifications and offline recipe caching */

const CACHE_NAME = 'wft-cache-v2';
const STATIC_URLS = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Navigation requests (HTML pages) always use network-first so new deployments
  // are never blocked by a cached copy of the old HTML shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/manifest.json').then(() => fetch('/')))
    );
    return;
  }

  // Strategy: Network-first for API, but fallback to cache for specific recipes
  if (url.pathname.startsWith('/api/v1/recipes/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Strategy: Cache-first for static assets (icons, manifests — not JS/CSS which
  // Next.js serves with long-lived Cache-Control headers and content hashes).
  event.respondWith(
    caches.match(request).then(response => response || fetch(request))
  );
});


self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "What's for Tea?", body: event.data.text() };
  }

  const { title = "What's for Tea?", body = '', url = '/', tag = 'wft' } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      tag,
      data: { url },
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
