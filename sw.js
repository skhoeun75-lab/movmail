/* MovMail service worker — minimal and safe.
   Caches only the app shell so the site can install as a PWA.
   Navigation requests are network-first (so updates reach users),
   shell assets are cache-first, and API/proxy calls are never cached. */
var CACHE_NAME = "movmail-shell-v2";
var SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/logo.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "/apple-touch-icon.png",
  "/favicon.ico"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL);
    }).catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
        .map(function (k) { return caches.delete(k); }));
    }).catch(function () {})
  );
  self.clients.claim();
});

function isShellAsset(url) {
  return SHELL.indexOf(url.pathname) !== -1;
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // Never touch API / proxy traffic (different origin anyway, plus
  // these paths must always go to the network).
  if (url.origin !== self.location.origin) return;
  if (/^\/(saved|messages|accounts|token|domains)/.test(url.pathname)) return;

  if (req.mode === "navigate" || isShellAsset(url)) {
    // Navigation + shell: network first, fall back to cache offline.
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }
  // Other same-origin assets (fonts CSS etc.): cache first, then network.
  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); }).catch(function () {});
        }
        return res;
      });
    })
  );
});
