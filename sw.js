// 오프라인에서도 앱이 열리도록 파일을 저장해 둔다. 앱을 고치면 VERSION 숫자를 올린다.
const VERSION = 'gagyebu-v2';
const ASSETS = ['./', './index.html', './parser.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
// 인터넷이 되면 항상 최신 파일을 받고(받은 건 저장), 안 되면 저장해 둔 파일로 연다
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const key = e.request.mode === 'navigate' ? './index.html' : e.request;
  e.respondWith(caches.open(VERSION).then(cache =>
    fetch(e.request).then(res => {
      if (res.ok && !url.search) cache.put(key, res.clone());
      return res;
    }).catch(() => cache.match(key, { ignoreSearch: true }))
  ));
});
