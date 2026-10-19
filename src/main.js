// main.js — boot, game loop, screen routing.
// For now: registers the service worker so the placeholder page installs as a PWA.
// M1 will add: init board from generator, run the loop, route title → level map → game.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
