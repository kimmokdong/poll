// 캐시 이름은 빌드할 때 파일 내용의 해시로 바뀐다(scripts/build-assets.js). 손으로 올릴 필요가 없다.
const CACHE = 'maeum-signal-__BUILD_HASH__';
// 처음 설치할 때는 화면 뼈대만 받는다. 큰 그림은 실제로 쓰일 때 캐시한다.
const CORE = ['/', '/styles.css', '/app.js', '/display/', '/display.css', '/display.js', '/manifest.webmanifest', '/assets/app-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

// 같은 HTML을 쓰는 주소는 하나의 캐시 항목으로 모은다. 방 코드마다 TV 주소가 쌓이지 않게 한다.
function cacheKey(url) {
  if (url.pathname === '/' || url.pathname === '/index.html') return '/';
  if (url.pathname === '/display' || url.pathname.startsWith('/display/')) return '/display/';
  if (url.pathname === '/manual') return '/manual/';
  return url.pathname;
}

function cacheable(response) {
  return response.ok && response.type === 'basic' && !response.redirected;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const key = cacheKey(url);
  event.respondWith(fetch(request).then((response) => {
    if (cacheable(response)) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => null));
    }
    return response;
  }).catch(async () => (await caches.match(key)) || Response.error()));
});
