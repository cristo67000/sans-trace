// Sans trace — service worker : mise en cache complète pour l'usage hors ligne,
// et réception des photos envoyées par le menu « Partager » du téléphone.
const VERSION = '1.0.1';
const CACHE = `sans-trace-${VERSION}`;
const PARTAGE = 'sans-trace-partage';
const FICHIERS = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/moteur.js', 'manifest.webmanifest',
  'icons/icone-192.png', 'icons/icone-512.png', 'icons/icone-masquable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((noms) => Promise.all(noms.filter((n) => n.startsWith('sans-trace-') && n !== CACHE && n !== PARTAGE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

async function recevoir(requete) {
  try {
    const donnees = await requete.formData();
    const cache = await caches.open(PARTAGE);
    for (const k of await cache.keys()) await cache.delete(k);
    let i = 0;
    for (const f of donnees.getAll('photos')) {
      if (!(f instanceof File)) continue;
      await cache.put(`partage/${i++}`, new Response(f, {
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nom': encodeURIComponent(f.name || 'photo') },
      }));
    }
  } catch { /* la page s'ouvrira simplement vide */ }
  return Response.redirect('./?partage=1', 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method === 'POST' && url.pathname.endsWith('/recevoir')) { e.respondWith(recevoir(e.request)); return; }
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
