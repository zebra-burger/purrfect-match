// ui.js — title screen, level map trail, HUD (moves/objective/score), dialogs. M3.
//
// M1: a DOM HUD (level, moves left, score vs. target) and a single end-of-level
// dialog. Built here so index.html stays a plain shell.

const fmt = (n) => n.toLocaleString("en-US");

export function createUI() {
  const hud = document.createElement("div");
  hud.id = "hud";
  hud.hidden = true;
  hud.innerHTML = `
    <div class="hud-pill"><span class="hud-label">Level</span><span class="hud-value" data-level></span></div>
    <div class="hud-pill hud-moves"><span class="hud-label">Moves</span><span class="hud-value" data-moves></span></div>
    <div class="hud-pill hud-score">
      <span class="hud-label">Score</span><span class="hud-value" data-score></span>
      <div class="hud-bar"><div class="hud-fill" data-fill></div></div>
    </div>`;

  const overlay = document.createElement("div");
  overlay.id = "overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="card">
      <h2 data-title></h2>
      <p data-body></p>
      <button type="button" data-action></button>
    </div>`;

  document.body.append(hud, overlay);
  const $ = (root, attr) => root.querySelector(`[${attr}]`);
  const moves = $(hud, "data-moves");
  let onAction = null;
  $(overlay, "data-action").addEventListener("click", () => {
    overlay.hidden = true;
    if (onAction) onAction();
  });

  return {
    hud,
    showHud() { hud.hidden = false; },
    // Bottom edge of the HUD, so the renderer can lay the board out beneath it.
    hudBottom() { return hud.getBoundingClientRect().bottom; },
    update({ level, movesLeft, score, target }) {
      $(hud, "data-level").textContent = fmt(level);
      moves.textContent = movesLeft;
      moves.parentElement.classList.toggle("low", movesLeft <= 5);
      $(hud, "data-score").textContent = `${fmt(score)} / ${fmt(target)}`;
      $(hud, "data-fill").style.width = `${Math.min(100, (100 * score) / target)}%`;
    },
    showDialog({ title, body, action, win }, then) {
      $(overlay, "data-title").textContent = title;
      $(overlay, "data-body").textContent = body;
      $(overlay, "data-action").textContent = action;
      overlay.classList.toggle("win", !!win);
      onAction = then;
      overlay.hidden = false;
    },
  };
}
