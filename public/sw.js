/* NugaTech PWA — shell offline (OLA 4).
 * Network-first para HTML y /assets/*: evita chunks JS obsoletos tras deploy. */
const CACHE_SHELL = 'nugacore-shell-v4';
const OFFLINE_URLS = ['/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL)
      .then((cache) => cache.addAll(OFFLINE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Borra TODO cache viejo (v1/v2) para no servir shell/HTML obsoleto.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  // Chunks Vite: siempre red. Nunca cachear — un 404 real es mejor que HTML.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then((res) => {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        // Defensa: si el origen devolviera HTML por error, no se lo pases al
        // module loader (evita el MIME check failure).
        if (res.ok && url.pathname.endsWith('.js') && ct.includes('text/html')) {
          return new Response('/* stale asset */', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
        return res;
      }),
    );
    return;
  }

  // Documento / SPA: network-first; fallback offline solo si no hay red.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request)),
    );
    return;
  }

  // Manifest y estáticos menores: cache con fallback a red.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
