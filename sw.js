/**
 * Embiggen — sw.js
 * T3.2: Service Worker + Offline Support
 *
 * Caches all static assets on first install and serves them from cache on
 * every subsequent request, allowing the app to function fully offline.
 * Increment CACHE_NAME whenever assets change to trigger a cache refresh.
 */

'use strict';

const CACHE_NAME = 'embiggen-v7';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './fonts/Anton-Regular.woff2',
  './fonts/ndot-45-inspired-by-nothing.woff2',
  './fonts/BarlowCondensed-SemiBold.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// ---------------------------------------------------------------------------
// Install — cache all static assets
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — delete caches from previous versions
// ---------------------------------------------------------------------------

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Fetch — serve from cache, fall back to network
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
