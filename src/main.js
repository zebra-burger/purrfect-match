// main.js — boot, game loop, screen routing.
// Title screen → journey map → play a level → result dialog → next level / retry / map.
// The render loop lives in renderer.js; this file owns the turn logic (swap, resolve
// cascades, win/lose) and awaits the renderer's animations between steps.

import { Board } from "./board.js";
import { generateLevel } from "./generator.js";
import { mulberry32 } from "./rng.js";
import { Renderer } from "./renderer.js";
import { attachInput } from "./input.js";
import {
  PLAYER, loadProgress, saveProgress, requestPersistence, recordPlay, recordResult,
} from "./storage.js";
import { createJourney, milestoneMessage } from "./journey.js";
import { createUI } from "./ui.js";
import { unlockAudio, sfx, buzz } from "./audio.js";
import { attachSoundToggle } from "./sound-toggle.js";

// Skip the service worker on localhost so development always loads fresh modules
// (add ?sw to the URL to test offline mode locally).
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if ("serviceWorker" in navigator && (!isLocal || new URLSearchParams(location.search).has("sw"))) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

const HINT_DELAY_MS = 6000;

const titleScreen = document.getElementById("title-screen");
const canvas = document.getElementById("game");
const ui = createUI({ onMap: () => showJourney() });
attachSoundToggle(ui.hud);
let renderer = null;
let input = null;

const progress = loadProgress();
requestPersistence();

const game = {
  level: progress.level,
  lvl: null,
  board: null,
  movesLeft: 0,
  score: 0,
  cats: 0,
  bestCascade: 0,
  busy: false,
  over: false,
  abandoned: false,
  hintTimer: 0,
};

const journey = createJourney({
  progress,
  onPlay: (n) => playLevel(n),
  catSvg: titleScreen.querySelector(".cat-mark svg").outerHTML,
});

const fmt = (n) => n.toLocaleString("en-US");
const status = titleScreen.querySelector(".status");
if (status) status.textContent = progress.level > 1 ? `Tap to play level ${fmt(progress.level)}` : "Tap to start your journey";

// ?level=N jumps straight into a level (handy for testing a reported "bad level N");
// it doesn't unlock anything. A #restore= link opens the restore prompt.
const jump = Number(new URLSearchParams(location.search).get("level"));
const restoreCode = location.hash.startsWith("#restore=") ? location.hash.slice(9) : null;
if (restoreCode) history.replaceState(null, "", location.pathname + location.search);

titleScreen.addEventListener("click", () => {
  unlockAudio();
  titleScreen.hidden = true;
  if (Number.isInteger(jump) && jump >= 1) playLevel(jump);
  else showJourney();
}, { once: true });

if (restoreCode) {
  titleScreen.hidden = true;
  journey.restoreFromLink(restoreCode).then((ok) => { if (!ok) showJourney(); });
}

function showJourney() {
  if (game.lvl && !game.over) game.abandoned = true;
  game.over = true;
  clearTimeout(game.hintTimer);
  if (input) input.clearSelection();
  ui.hideDialog();
  ui.hideHud();
  canvas.hidden = true;
  journey.show();
}

function playLevel(n) {
  journey.hide();
  canvas.hidden = false;
  ui.showHud();
  if (!renderer) {
    renderer = new Renderer(canvas);
    canvas.addEventListener("pointerdown", unlockAudio); // iOS can re-suspend audio
    input = attachInput(canvas, renderer, {
      canInteract: () => !game.busy && !game.over,
      onSelect: (cell) => { renderer.selected = cell; armHint(); },
      onSwap: (a, b) => playSwap(a, b),
    });
    window.addEventListener("resize", () => renderer.layout(ui.hudBottom()));
    if (isLocal) window.purrfect = { game, renderer, progress, startLevel: playLevel, showJourney }; // dev/test handle
  }
  startLevel(n);
}

function startLevel(n) {
  game.level = n;
  game.lvl = generateLevel(n);
  const { boardShape, tiles, colors, refillSeed, moves } = game.lvl;
  game.board = new Board(boardShape, tiles, colors, mulberry32(refillSeed));
  game.movesLeft = moves;
  game.score = 0;
  game.cats = 0;
  game.bestCascade = 0;
  game.busy = false;
  game.over = false;
  game.abandoned = false;
  recordPlay(progress);
  saveProgress(progress);
  updateHud();
  renderer.setBoard(game.board);
  renderer.layout(ui.hudBottom());
  armHint();
}

function updateHud() {
  ui.update({
    level: game.level,
    movesLeft: game.movesLeft,
    score: game.score,
    target: game.lvl.targets.score,
  });
}

function armHint() {
  clearTimeout(game.hintTimer);
  renderer.hint = null;
  if (game.over) return;
  game.hintTimer = setTimeout(() => {
    if (!game.busy && !game.over) renderer.hint = game.board.findMoves(1)[0] || null;
  }, HINT_DELAY_MS);
}

async function playSwap(a, b) {
  const { board } = game;
  if (game.busy || game.over || !board.get(a.r, a.c) || !board.get(b.r, b.c)) return;
  game.busy = true;
  renderer.hint = null;
  clearTimeout(game.hintTimer);

  board.swap(a, b);
  sfx.swap();
  await renderer.animateSwap(a, b);
  if (!board.isSpecialSwap(a, b) && board.findMatches().length === 0) {
    // Not a match: swing back, no move spent.
    board.swap(a, b);
    sfx.nope();
    await renderer.animateSwap(a, b);
    game.busy = false;
    armHint();
    return;
  }

  game.movesLeft--;
  updateHud();
  await resolveCascades([a, b]);

  if (game.score >= game.lvl.targets.score) return finish(true);
  if (game.movesLeft <= 0) return finish(false);

  if (!board.hasLegalMove()) {
    board.shuffle();
    await renderer.animateShuffle();
    await resolveCascades();
  }
  game.busy = false;
  armHint();
}

// Clear → fall → refill, repeating while new matches form. Each cascade step
// multiplies the points, so chain reactions are worth chasing. `swap` (the move just
// made) decides where new specials land and fires special swaps on the first step.
async function resolveCascades(swap = null) {
  const { board } = game;
  for (let cascade = 1; ; cascade++) {
    const step = board.resolveStep(cascade === 1 ? swap : null);
    if (!step) return;
    game.bestCascade = Math.max(game.bestCascade, cascade);
    game.score += step.points * cascade;
    game.cats += step.removed.length;
    updateHud();
    playStepSounds(step, cascade);
    if (cascade >= 2) {
      renderer.comboText(cascade - 1);
      if (cascade <= 4) sfx.combo(cascade - 1);
    }
    await renderer.animateStep(step);
    await renderer.animateCollapse(board.collapse());
  }
}

function playStepSounds({ blasts, created }, cascade) {
  sfx.pop(cascade);
  const kinds = new Set(blasts.map((b) => b.special));
  if (kinds.has("disco")) sfx.disco();
  if (kinds.has("boom")) sfx.boom();
  if (kinds.has("zoomie")) sfx.zoomie();
  if (created.length) sfx.sparkle();
  buzz(blasts.length ? 35 : cascade > 1 ? 18 : 12);
}

function finish(won) {
  if (game.abandoned) return;
  game.over = true;
  game.busy = false;
  input.clearSelection();
  const level = game.level;
  const target = game.lvl.targets.score;
  const result = recordResult(progress, {
    level, won, score: game.score, movesLeft: game.movesLeft, moves: game.lvl.moves,
    cats: game.cats, bestCascade: game.bestCascade,
  });
  saveProgress(progress);
  const toMap = { label: "Map", secondary: true, onClick: showJourney };

  if (won) {
    sfx.win();
    buzz([30, 60, 30]);
    const titles = ["Purrfect!", "Pawsome!", "Meow-velous!"];
    const spare = game.movesLeft === 1 ? "1 move" : `${game.movesLeft} moves`;
    const ribbon = (result.firstWin && milestoneMessage(level))
      || (result.improved ? `New best on this level — ${result.stars} stars! 🌟` : null)
      || (result.newBest ? `Your highest score ever, ${PLAYER}! 🏅` : null);
    setTimeout(() => ui.showDialog({
      title: titles[result.stars - 1],
      body: `Level ${fmt(level)} done with ${fmt(game.score)} points and ${spare} to spare.`,
      ribbon,
      stars: result.stars,
      win: true,
      actions: [toMap, { label: "Next level", onClick: () => playLevel(level + 1) }],
    }), 350);
  } else {
    sfx.lose();
    setTimeout(() => ui.showDialog({
      title: "Out of moves",
      body: `${fmt(game.score)} of ${fmt(target)} points. ` +
        (game.score >= 0.75 * target ? "So close — one more go?" : `The cats believe in you, ${PLAYER}.`),
      actions: [toMap, { label: "Try again", onClick: () => playLevel(level) }],
    }), 350);
  }
}
