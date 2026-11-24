/* Service worker: la app (incluido el modelo y el WASM) funciona sin conexión tras la primera carga.
 * - Navegación (HTML): red primero, caché como respaldo -> los despliegues nuevos se ven enseguida.
 * - Resto de recursos del mismo origen: caché primero, y se rellenan al pedirse (WASM, modelo, JS, CSS).
 * - Todo lo que sea de otro origen (señalización PeerJS, STUN) NO se toca.
 * Sube CACHE_VERSION para invalidar la caché en un despliegue.
 */
const CACHE_VERSION = 'v2';
const CACHE = `vpt-${CACHE_VERSION}`;
const SHELL = ['./', './index.html', './receiver.html', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vpt-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (req.headers.has('range')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
