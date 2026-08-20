const CACHE = 'cafendo-v3';
const ARCHIVOS = [
    'index.html',
    'app.html',
    'resumen.html',
    'estilos.css',
    'auth.js',
    'acceso.js',
    'app.js',
    'resumen.js',
    'manifest.webmanifest',
    'logo-slclab.png',
    'logo-cafe.jpg',
    'icons/icon-192.png',
    'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Los datos (login, pedidos, resumen) siempre van a la red: nunca a caché
    if (url.pathname.startsWith('/api/')) return;

    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then(cacheado => {
            const red = fetch(event.request)
                .then(respuesta => {
                    const copia = respuesta.clone();
                    caches.open(CACHE).then(cache => cache.put(event.request, copia));
                    return respuesta;
                })
                .catch(() => cacheado);
            return cacheado || red;
        })
    );
});
