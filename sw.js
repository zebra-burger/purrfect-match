// Service worker: caches the whole game for offline play.
// Bump CACHE_VERSION on every release so installed phones pick up updates.
const CACHE_VERSION = "purrfect-v0.8.1";

// Everything the game needs to boot and play with no network. Levels are generated
// on the phone, so there is no level data to fetch — once this is cached, it's endless offline.
const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "styles/main.css",
  "styles/juice.css",
  "styles/boosters.css",
  "assets/fonts/fredoka-latin.woff2",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable.png",
  "src/main.js",
  "src/board.js",
  "src/generator.js",
  "src/rng.js",
  "src/renderer.js",
  "src/input.js",
  "src/storage.js",
  "src/ui.js",
  "src/journey.js",
  "src/cloud.js",
  "src/audio.js",
  "src/sound-toggle.js",
  "src/boosters.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pages: network-first so a new release shows up as soon as she's online,
// falling back to the cached game when she isn't (ignoring ?level= style queries).
// Everything else: cache-first — the cache is replaced wholesale on each version bump.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("index.html", copy));
          return res;
        })
        .catch(() => caches.match("index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request))
  );
});
