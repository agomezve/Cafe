const CACHE = 'cafendo-v9';
const ARCHIVOS = [
    'index.html',
    'app.html',
    'resumen.html',
    'estilos.css',
    'catalogo.js',
    'auth.js',
    'acceso.js',
    'app.js',
    'avisos.js',
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

// El aviso de las 10:30. Llega aunque la app esté cerrada: de esto se encarga
// el navegador, que despierta al service worker solo para esto.
self.addEventListener('push', (event) => {
    let datos = {};
    try {
        datos = event.data ? event.data.json() : {};
    } catch {
        // Si el aviso viniera sin datos o mal formados, se enseña el de siempre
    }

    event.waitUntil(self.registration.showNotification(datos.titulo || 'Cafendo', {
        body: datos.cuerpo || '¿Qué quieres hoy?',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        // Con el mismo tag, un aviso nuevo reemplaza al anterior en vez de
        // apilarse: nadie quiere cinco "¿Qué quieres hoy?" en la pantalla.
        tag: 'turno-cafe',
        data: { url: datos.url || 'app.html' },
    }));
});

// Al tocar el aviso se abre la pantalla del pedido; si la app ya estaba
// abierta se reutiliza esa ventana en vez de abrir otra.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const destino = new URL(event.notification.data?.url || 'app.html', self.location.origin).href;

    event.waitUntil((async () => {
        const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const abierta = ventanas.find(v => v.url.startsWith(self.location.origin));
        if (abierta) {
            if ('navigate' in abierta) await abierta.navigate(destino).catch(() => {});
            return abierta.focus();
        }
        return self.clients.openWindow(destino);
    })());
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
