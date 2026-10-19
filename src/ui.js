// ui.js — title screen, level map trail, HUD (moves/objective/score), dialogs. M3.
//
// The HUD (level, moves left, score vs. target, back-to-journey button) and the
// end-of-level dialog. The level map itself lives in journey.js.

const fmt = (n) => n.toLocaleString("en-US");

export const GOAL_ICONS = { yarn: "🧶", boxes: "📦", fish: "🐟", score: "⭐" };

export function createUI({ onMap } = {}) {
  const hud = document.createElement("div");
  hud.id = "hud";
  hud.hidden = true;
  hud.innerHTML = `
    <button type="button" class="hud-map" aria-label="Back to the journey map">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.3-9.2C1.5 8.6 3.6 5 7 5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.5 3.6 4.3 6.8C19.5 16.4 12 21 12 21z" fill="currentColor"/></svg>
      <span>Map</span>
    </button>
    <div class="hud-pill"><span class="hud-label">Level</span><span class="hud-value" data-level></span></div>
    <div class="hud-pill hud-moves"><span class="hud-label">Moves</span><span class="hud-value" data-moves></span></div>
    <div class="hud-pill hud-score">
      <span class="hud-label" data-goal-label>Score</span><span class="hud-value" data-score></span>
      <div class="hud-bar"><div class="hud-fill" data-fill></div></div>
      <div class="hud-goals" data-goals hidden></div>
    </div>`;

  const toast = document.createElement("div");
  toast.id = "toast";
  toast.hidden = true;

  const overlay = document.createElement("div");
  overlay.id = "overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="card">
      <div class="dialog-stars" data-stars></div>
      <h2 data-title></h2>
      <p data-body></p>
      <p class="dialog-ribbon" data-ribbon hidden></p>
      <div class="dialog-actions" data-actions></div>
    </div>`;

  document.body.append(hud, overlay, toast);
  let toastTimer = 0;
  const $ = (root, attr) => root.querySelector(`[${attr}]`);
  const moves = $(hud, "data-moves");
  hud.querySelector(".hud-map").addEventListener("click", () => onMap && onMap());

  return {
    hud,
    showHud() { hud.hidden = false; },
    hideHud() { hud.hidden = true; },
    // Bottom edge of the HUD, so the renderer can lay the board out beneath it.
    hudBottom() { return hud.getBoundingClientRect().bottom; },
    // goals: [{ kind, left }] on goal levels (replaces the score readout), else empty.
    update({ level, movesLeft, score, target, goals = [] }) {
      $(hud, "data-level").textContent = fmt(level);
      moves.textContent = movesLeft;
      moves.parentElement.classList.toggle("low", movesLeft <= 5);
      const onGoals = goals.length > 0;
      $(hud, "data-goal-label").textContent = onGoals ? "Goal" : "Score";
      $(hud, "data-score").hidden = onGoals;
      $(hud, "data-fill").parentElement.hidden = onGoals;
      const box = $(hud, "data-goals");
      box.hidden = !onGoals;
      if (onGoals) {
        box.innerHTML = goals.map(({ kind, left }) =>
          `<span class="hud-goal${left ? "" : " done"}">${GOAL_ICONS[kind]}<b>${left ? left : "✓"}</b></span>`).join("");
      } else {
        $(hud, "data-score").textContent = `${fmt(score)} / ${fmt(target)}`;
        $(hud, "data-fill").style.width = `${Math.min(100, (100 * score) / target)}%`;
      }
    },
    // A friendly callout over the board (level goal at the start of a level).
    toast(text, sub = null, ms = 2600) {
      clearTimeout(toastTimer);
      toast.textContent = text;
      if (sub) {
        const small = document.createElement("small");
        small.textContent = sub;
        toast.append(small);
      }
      toast.hidden = false;
      toast.classList.remove("show");
      void toast.offsetWidth; // restart the animation
      toast.classList.add("show");
      toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
    },
    // actions: [{ label, onClick, secondary, className }]; stars: 0 hides the star row.
    showDialog({ title, body, ribbon, stars = 0, win, actions }) {
      $(overlay, "data-title").textContent = title;
      $(overlay, "data-body").textContent = body;
      const rib = $(overlay, "data-ribbon");
      rib.hidden = !ribbon;
      rib.textContent = ribbon || "";
      $(overlay, "data-stars").innerHTML = stars
        ? [1, 2, 3].map((i) => `<span class="${i <= stars ? "on" : ""}" style="animation-delay:${0.25 + i * 0.22}s">★</span>`).join("")
        : "";
      const box = $(overlay, "data-actions");
      box.innerHTML = "";
      for (const a of actions) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = a.label;
        if (a.secondary) b.className = "secondary";
        if (a.className) b.classList.add(a.className);
        b.addEventListener("click", () => { overlay.hidden = true; a.onClick(); });
        box.append(b);
      }
      overlay.classList.toggle("win", !!win);
      overlay.hidden = false;
    },
    hideDialog() { overlay.hidden = true; toast.hidden = true; },
  };
}
