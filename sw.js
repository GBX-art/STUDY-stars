// Study Stars service worker: answers notification buttons and lets the app work offline.
const CACHE = 'study-stars-v2';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first, cached copy when offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', e => {
  const n = e.notification, choice = e.action, d = n.data || {};
  n.close();
  e.waitUntil((async () => {
    if (d.kind === 'ask' && choice === 'gon') {
      await self.registration.showNotification('You will definitely regret this decision', {
        body: 'You will get C- for your exam.', tag: 'regret', icon: 'icon-192.png'
      });
    }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const msg = { type: 'answer', choice: d.kind === 'ask' ? (choice || 'open') : 'open', askAt: d.askAt };
    if (wins.length) {
      wins.forEach(w => w.postMessage(msg));
      // Clicking the message itself (not a button) brings the app to the front.
      if (!choice) { try { await wins[0].focus(); } catch (err) {} }
    } else {
      const u = new URL(self.registration.scope);
      if (d.kind === 'ask' && choice) { u.searchParams.set('answer', choice); u.searchParams.set('askAt', d.askAt); }
      await self.clients.openWindow(u.href);
    }
  })());
});
