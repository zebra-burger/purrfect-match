// boosters.js — the booster tray under the board. M4.
//
// Three earned boosters (never bought — see storage.js for how she earns them):
//   paw      Paw Swipe: tap it, then tap any cat to swipe it away (free, no move spent)
//   shuffle  Catnip Shuffle: shuffles the board
//   moves    +5 Moves
// The tray only shows counts and says which one she tapped; main.js does the playing.

export const BOOSTER_INFO = {
  paw: { icon: "🐾", name: "Paw Swipe", short: "Paw" },
  shuffle: { icon: "🌿", name: "Catnip Shuffle", short: "Shuffle" },
  moves: { icon: "➕", name: "+5 Moves", short: "+5" },
};

export function createBoosterTray({ onUse }) {
  const tray = document.createElement("div");
  tray.id = "booster-tray";
  tray.hidden = true;
  const buttons = {};
  for (const [kind, info] of Object.entries(BOOSTER_INFO)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `booster booster-${kind}`;
    b.innerHTML = `<span class="booster-icon" aria-hidden="true">${info.icon}</span>` +
      `<span class="booster-name">${info.short}</span><b class="booster-count"></b>`;
    b.addEventListener("click", () => { if (!b.disabled) onUse(kind); });
    buttons[kind] = b;
    tray.append(b);
  }
  document.body.append(tray);

  return {
    show() { tray.hidden = false; },
    hide() { tray.hidden = true; },
    // Top edge of the tray, so the renderer keeps the board above it.
    top() { return tray.hidden ? window.innerHeight : tray.getBoundingClientRect().top; },
    // counts: { paw, shuffle, moves }; ready: false while a move is playing out.
    update(counts, ready = true) {
      for (const [kind, b] of Object.entries(buttons)) {
        const n = counts[kind] || 0;
        b.querySelector(".booster-count").textContent = n;
        b.disabled = !ready || n <= 0;
        b.classList.toggle("empty", n <= 0);
        b.setAttribute("aria-label", `${BOOSTER_INFO[kind].name}: ${n} left`);
      }
    },
    // Highlights the booster waiting for a tap on the board (Paw Swipe), or none.
    setArmed(kind) {
      for (const [k, b] of Object.entries(buttons)) b.classList.toggle("armed", k === kind);
    },
  };
}
