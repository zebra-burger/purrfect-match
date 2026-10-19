// Service worker: caches the whole game for offline play.
// CACHE_VERSION names the cache; a new name makes installed phones fetch everything
// fresh. worker/deploy.sh stamps it with the commit being published, so every release
// rolls out even if nobody bumps it by hand.
const CACHE_VERSION = "purrfect-v0.9.2";

// Everything the game needs to boot and play with no network. Levels are generated
// on the phone, so there is no level data to fetch — once this is cached, it's endless offline.
const ASSETS = [
  "./",
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
    // Only a good copy of the game's own page refreshes the offline copy — never the
    // privacy page, a 404, or a redirect (browsers won't show those for a navigation).
    const home = new URL(self.registration.scope).pathname;
    const isHome = new URL(request.url).pathname === home;
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (isHome && res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put("./", copy));
          }
          return res;
        })
        .catch(() => caches.match("./"))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request))
  );
});
