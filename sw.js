const CACHE = 'cap704-v3';
const CORE = ['./', './index.html', './manifest.json', './ridgeline-ui.css', './rl-mark-denali-white.png', './icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

function networkFirst(req) {
  return fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 頁面與題庫資料要先抓網路，修正過的題目才會送到手機上；離線時退回快取
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req).then(r => r || caches.match('./index.html')));
    return;
  }
  if (url.pathname.includes('/data/')) {
    e.respondWith(networkFirst(req));
    return;
  }

  // 題目圖片不會變，看過一次就留在快取裡
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
