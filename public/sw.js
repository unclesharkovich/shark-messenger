const CACHE = 'shark-v4';

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(cache => 
            cache.addAll(['/', '/index.html', '/shark-theme.css', '/shark-app.js', '/manifest.json'])
        )
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys => 
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.url.includes('socket.io')) return;
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
            if (resp.status === 200) {
                const clone = resp.clone();
                caches.open(CACHE).then(cache => cache.put(e.request, clone));
            }
            return resp;
        }))
    );
});
