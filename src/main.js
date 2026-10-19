// main.js — boot, game loop, screen routing.
// Title screen → tap → play the saved level → complete/fail dialog → next level/retry.
// The render loop lives in renderer.js; this file owns the turn logic (swap, resolve
// cascades, win/lose) and awaits the renderer's animations between steps.

import { Board, MATCH_POINTS } from "./board.js";
import { generateLevel } from "./generator.js";
import { mulberry32 } from "./rng.js";
import { Renderer } from "./renderer.js";
import { attachInput } from "./input.js";
import { loadProgress, saveProgress } from "./storage.js";
import { createUI } from "./ui.js";

// Skip the service worker on localhost so development always loads fresh modules.
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if ("serviceWorker" in navigator && !isLocal) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

const HINT_DELAY_MS = 6000;

const titleScreen = document.getElementById("title-screen");
const canvas = document.getElementById("game");
const ui = createUI();
let renderer = null;
let input = null;

const progress = loadProgress();
// ?level=N jumps straight to a level (handy for testing a reported "bad level N").
const jump = Number(new URLSearchParams(location.search).get("level"));
if (Number.isInteger(jump) && jump >= 1) progress.level = jump;

const game = {
  level: progress.level,
  lvl: null,
  board: null,
  movesLeft: 0,
  score: 0,
  busy: false,
  over: false,
  hintTimer: 0,
};

const status = titleScreen.querySelector(".status");
if (status) status.textContent = game.level > 1 ? `Tap to play level ${game.level.toLocaleString("en-US")}` : "Tap to play";

titleScreen.addEventListener("click", () => {
  titleScreen.hidden = true;
  canvas.hidden = false;
  ui.showHud();
  renderer = new Renderer(canvas);
  input = attachInput(canvas, renderer, {
    canInteract: () => !game.busy && !game.over,
    onSelect: (cell) => { renderer.selected = cell; armHint(); },
    onSwap: (a, b) => playSwap(a, b),
  });
  window.addEventListener("resize", () => renderer.layout(ui.hudBottom()));
  if (isLocal) window.purrfect = { game, renderer, startLevel }; // dev/test handle
  startLevel(game.level);
}, { once: true });

function startLevel(n) {
  game.level = n;
  game.lvl = generateLevel(n);
  const { boardShape, tiles, colors, refillSeed, moves } = game.lvl;
  game.board = new Board(boardShape, tiles, colors, mulberry32(refillSeed));
  game.movesLeft = moves;
  game.score = 0;
  game.busy = false;
  game.over = false;
  progress.level = n;
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
  await renderer.animateSwap(a, b);
  if (board.findMatches().length === 0) {
    // Not a match: swing back, no move spent.
    board.swap(a, b);
    await renderer.animateSwap(a, b);
    game.busy = false;
    armHint();
    return;
  }

  game.movesLeft--;
  updateHud();
  await resolveCascades();

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
// multiplies the points, so chain reactions are worth chasing.
async function resolveCascades() {
  const { board } = game;
  for (let cascade = 1; ; cascade++) {
    const groups = board.findMatches();
    if (!groups.length) return;
    for (const g of groups) game.score += MATCH_POINTS[g.kind] * cascade;
    updateHud();
    await renderer.animateClear(board.clear(groups));
    await renderer.animateCollapse(board.collapse());
  }
}

function finish(won) {
  game.over = true;
  game.busy = false;
  input.clearSelection();
  const score = game.score.toLocaleString("en-US");
  if (won) {
    progress.level = game.level + 1;
    saveProgress(progress);
    const spare = game.movesLeft === 1 ? "1 move" : `${game.movesLeft} moves`;
    setTimeout(() => ui.showDialog({
      title: "Purrfect!",
      body: `Level ${game.level.toLocaleString("en-US")} complete with ${score} points and ${spare} to spare.`,
      action: "Next level",
      win: true,
    }, () => startLevel(game.level + 1)), 350);
  } else {
    setTimeout(() => ui.showDialog({
      title: "Out of moves",
      body: `${score} of ${game.lvl.targets.score.toLocaleString("en-US")} points. ` +
        (game.score >= 0.75 * game.lvl.targets.score ? "So close — one more go?" : "The cats believe in you."),
      action: "Try again",
    }, () => startLevel(game.level)), 350);
  }
}
