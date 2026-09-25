// Minimal service worker — exists only to satisfy PWA installability
// (Add to Home Screen). No caching or offline support, no push handling
// (not built yet); every fetch just passes
// straight through to the network.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {});
