/* global caches, clients, fetch, location, Response, self, URL */

const BUILD_VERSION = "dev";
const BUILD_ASSETS = [];
const CACHE_PREFIX = "floyd-feeder-shell-";
const CACHE_NAME = CACHE_PREFIX + BUILD_VERSION;
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.svg",
  "/icon-512.svg",
  ...BUILD_ASSETS,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (request.method !== "GET" || requestUrl.origin !== location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(() => caches.open(CACHE_NAME)
          .then((cache) => cache.match("/index.html"))
          .then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (!APP_SHELL.includes(requestUrl.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME)
      // Use the precache key so module requests still match responses that vary by Origin.
      .then((cache) => cache.match(requestUrl.pathname))
      .then((cached) => cached ?? fetch(request)),
  );
});
