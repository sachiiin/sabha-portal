// Service worker — just enough to make the portal installable and to keep
// it usable on a weak signal in the mandir.
//
// Deliberately network-first for everything it handles. A cache-first
// worker would serve yesterday's JavaScript after a deploy, and this app
// already ships through GitHub Pages, which caches hard enough on its own.
// The cache here is a fallback for when the network fails, nothing more.

const VERSION = 'gm-v1';
const SHELL = [
  './',
  './index.html',
  './attendance.html',
  './history.html',
  './members.html',
  './utilities.html',
  './settings.html',
  './login.html',
  './register.html',
  './account.html',
  './platform-dashboard.html',
  './platform-houses.html',
  './platform-approvals.html',
  './platform-team.html',
  './css/styles.css',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // One bad URL must not fail the whole install, so each is added
      // on its own and a miss is shrugged off.
      .then((cache) => Promise.all(SHELL.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only this origin. Supabase calls and the CDN are left entirely alone —
  // an API response must never come out of a cache, and the browser's own
  // HTTP cache already handles the CDN well.
  if (url.origin !== self.location.origin) return;

  // The generated config carries the Supabase URL and key. Always live.
  if (url.pathname.endsWith('/js/config.js')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        // A deep link opened offline still deserves the app shell.
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
