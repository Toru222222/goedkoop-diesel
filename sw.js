// Minimale service worker zodat de app op het startscherm gezet kan worden.
// Altijd eerst het netwerk: prijzen moeten actueel zijn.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
