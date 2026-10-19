// main.js — boot, game loop, screen routing.
// Title screen → journey map → play a level → result dialog → next level / retry / map.
// The render loop lives in renderer.js; this file owns the turn logic (swap, resolve
// cascades, win/lose) and awaits the renderer's animations between steps.

import { Board, FISH_POINTS, goalsMet, goalsLeft } from "./board.js";
import { generateLevel } from "./generator.js";
import { mulberry32 } from "./rng.js";
import { Renderer } from "./renderer.js";
import { attachInput } from "./input.js";
import {
  PLAYER, loadProgress, saveProgress, requestPersistence, recordPlay, recordResult, useBooster,
} from "./storage.js";
import { createBoosterTray, BOOSTER_INFO } from "./boosters.js";
import { createJourney, milestoneMessage } from "./journey.js";
import { createUI, GOAL_ICONS } from "./ui.js";
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
const tray = createBoosterTray({ onUse: (kind) => useBoosterNow(kind) });
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
  aiming: false,   // Paw Swipe armed: the next tap on the board swipes that cat away
  catsRecorded: 0, // cats already counted in her stats (an Out of moves → +5 Moves rescue)
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
  tray.hide();
  setAiming(false);
  canvas.hidden = true;
  journey.show();
}

function playLevel(n) {
  journey.hide();
  canvas.hidden = false;
  ui.showHud();
  tray.show();
  if (!renderer) {
    renderer = new Renderer(canvas);
    canvas.addEventListener("pointerdown", unlockAudio); // iOS can re-suspend audio
    input = attachInput(canvas, renderer, {
      canInteract: () => !game.busy && !game.over,
      onSelect: (cell) => { renderer.selected = cell; armHint(); },
      onSwap: (a, b) => playSwap(a, b),
      onTap: (cell) => {
        if (!game.aiming) return false;
        pawSwipe(cell);
        return true;
      },
    });
    window.addEventListener("resize", () => renderer.layout(ui.hudBottom(), tray.top()));
    if (isLocal) window.purrfect = { game, renderer, progress, startLevel: playLevel, showJourney }; // dev/test handle
  }
  startLevel(n);
}

function startLevel(n) {
  game.level = n;
  game.lvl = generateLevel(n);
  const { boardShape, tiles, colors, refillSeed, moves, blockers } = game.lvl;
  game.board = new Board(boardShape, tiles, colors, mulberry32(refillSeed), blockers);
  game.movesLeft = moves;
  game.score = 0;
  game.cats = 0;
  game.bestCascade = 0;
  game.busy = false;
  game.over = false;
  game.abandoned = false;
  game.catsRecorded = 0;
  setAiming(false);
  recordPlay(progress);
  saveProgress(progress);
  updateHud();
  renderer.setBoard(game.board);
  renderer.layout(ui.hudBottom(), tray.top());
  ui.toast(...goalText(game.lvl));
  armHint();
}

// "Untangle the yarn 🧶" etc. — shown as the level starts, with a tip while she learns.
function goalText({ objective, targets }) {
  if (objective === "score") return [`Score ${fmt(targets.score)} ${GOAL_ICONS.score}`];
  const parts = [];
  if (targets.yarn) parts.push(`Untangle the yarn ${GOAL_ICONS.yarn}`);
  if (targets.boxes) parts.push(`Open the boxes ${GOAL_ICONS.boxes}`);
  if (targets.fish) parts.push(`Drop ${targets.fish} fish ${GOAL_ICONS.fish}`);
  let tip = null;
  if (game.level <= 30) {
    if (targets.fish) tip = "Tip: you can swipe a fish down";
    else if (targets.boxes) tip = "Match next to a box to open it";
  }
  return [parts.join(" + "), tip];
}

function updateHud() {
  ui.update({
    level: game.level,
    movesLeft: game.movesLeft,
    score: game.score,
    target: game.lvl.targets.score,
    goals: goalsLeft(game.board, game.lvl.targets),
  });
  tray.update(progress.boosters, !game.busy && !game.over);
}

// --- Boosters ---------------------------------------------------------------------

function setAiming(on) {
  game.aiming = on;
  tray.setArmed(on ? "paw" : null);
  canvas.classList.toggle("aiming", on);
}

function useBoosterNow(kind) {
  if (game.busy || game.over) return;
  if (kind === "paw") {
    // Tap once to aim, tap again to change her mind. Nothing is spent until she swipes.
    setAiming(!game.aiming);
    if (game.aiming) ui.toast("Tap a cat to swipe it away 🐾", null, 1800);
    return;
  }
  setAiming(false);
  if (kind === "shuffle") return catnipShuffle();
  if (kind === "moves") {
    if (!useBooster(progress, "moves")) return;
    saveProgress(progress);
    game.movesLeft += 5;
    sfx.sparkle();
    ui.toast("+5 moves! ➕");
    updateHud();
  }
}

async function pawSwipe(cell) {
  setAiming(false);
  const { board } = game;
  if (game.busy || game.over || !board.canPaw(cell.r, cell.c)) return;
  if (!useBooster(progress, "paw")) return;
  saveProgress(progress);
  game.busy = true;
  renderer.hint = null;
  clearTimeout(game.hintTimer);
  updateHud();
  buzz(20);
  await resolveCascades(null, cell);
  await afterTurn();
}

async function catnipShuffle() {
  if (!useBooster(progress, "shuffle")) return;
  saveProgress(progress);
  game.busy = true;
  renderer.hint = null;
  clearTimeout(game.hintTimer);
  updateHud();
  sfx.sparkle();
  game.board.shuffle();
  await renderer.animateShuffle();
  await resolveCascades();
  await afterTurn();
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

  const nudge = board.isFishNudge(a, b); // a fish treat swimming down a cell
  board.swap(a, b);
  sfx.swap();
  await renderer.animateSwap(a, b);
  if (!nudge && !board.isSpecialSwap(a, b) && board.findMatches().length === 0) {
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
  await afterTurn();
}

// Win, lose, or reshuffle a stuck board and hand control back to her.
async function afterTurn() {
  const { board } = game;
  if (game.abandoned) return;
  if (goalsMet(board, game.lvl.targets, game.score)) return finish(true);
  if (game.movesLeft <= 0) return finish(false);

  if (!board.hasLegalMove()) {
    board.shuffle();
    await renderer.animateShuffle();
    await resolveCascades();
  }
  game.busy = false;
  updateHud();
  armHint();
}

// Clear → fall → refill, repeating while new matches form. Each cascade step
// multiplies the points, so chain reactions are worth chasing. `swap` (the move just
// made) decides where new specials land and fires special swaps on the first step;
// `poke` is a Paw Swipe's cell.
async function resolveCascades(swap = null, poke = null) {
  const { board } = game;
  await collectFish();
  for (let cascade = 1; ; cascade++) {
    const step = board.resolveStep(cascade === 1 ? swap : null, cascade === 1 ? poke : null);
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
    renderer.animateGoals(step);
    await renderer.animateStep(step);
    await renderer.animateCollapse(board.collapse());
    await collectFish();
  }
}

// Fish treats that have reached the bottom are collected; the column then refills,
// which can land another treat on the bottom.
async function collectFish() {
  const { board } = game;
  for (;;) {
    const got = board.collectFish();
    if (!got.length) return;
    game.score += FISH_POINTS * got.length;
    updateHud();
    sfx.sparkle();
    buzz(25);
    await renderer.animateCollect(got);
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
    cats: game.cats - game.catsRecorded, bestCascade: game.bestCascade,
  });
  game.catsRecorded = game.cats;
  saveProgress(progress);
  updateHud();
  const toMap = { label: "Map", secondary: true, onClick: showJourney };

  if (won) {
    sfx.win();
    buzz([30, 60, 30]);
    const titles = ["Purrfect!", "Pawsome!", "Meow-velous!"];
    const spare = game.movesLeft === 1 ? "1 move" : `${game.movesLeft} moves`;
    const ribbon = (result.firstWin && milestoneMessage(level))
      || (result.improved ? `New best on this level — ${result.stars} stars! 🌟` : null)
      || (result.newBest ? `Your highest score ever, ${PLAYER}! 🏅` : null);
    const gift = earnedText(result.earned);
    setTimeout(() => ui.showDialog({
      title: titles[result.stars - 1],
      body: `Level ${fmt(level)} done with ${fmt(game.score)} points and ${spare} to spare.`,
      ribbon: [ribbon, gift].filter(Boolean).join(" ") || null,
      stars: result.stars,
      win: true,
      actions: [toMap, { label: "Next level", onClick: () => playLevel(level + 1) }],
    }), 350);
  } else {
    sfx.lose();
    const left = goalsLeft(game.board, game.lvl.targets).filter((g) => g.left > 0);
    const total = left.reduce((sum, g) => sum + g.left, 0);
    const body = target != null
      ? `${fmt(game.score)} of ${fmt(target)} points. ` +
        (game.score >= 0.75 * target ? "So close — one more go?" : `The cats believe in you, ${PLAYER}.`)
      : `Just ${left.map((g) => `${g.left} ${GOAL_ICONS[g.kind]}`).join(" and ")} to go. ` +
        (total <= 3 ? "So close — one more go?" : `The cats believe in you, ${PLAYER}.`);
    const actions = [toMap, { label: "Try again", onClick: () => playLevel(level) }];
    const have = progress.boosters.moves;
    if (have > 0) {
      actions.unshift({
        label: `Keep going: +5 moves (${have})`,
        className: "booster-offer",
        onClick: () => keepGoing(),
      });
    }
    setTimeout(() => ui.showDialog({ title: "Out of moves", body, actions }), 350);
  }
}

// "Out of moves" → spend a +5 Moves booster and carry on from the same board.
function keepGoing() {
  if (!useBooster(progress, "moves")) return;
  saveProgress(progress);
  game.movesLeft += 5;
  game.over = false;
  game.busy = false;
  sfx.sparkle();
  ui.toast("+5 moves! You've got this 💕");
  updateHud();
  armHint();
}

// "You earned a Paw Swipe! 🐾" for the win dialog (world gifts give one of each).
function earnedText(earned) {
  if (!earned.length) return null;
  const one = (k) => `${BOOSTER_INFO[k].name} ${BOOSTER_INFO[k].icon}`;
  if (earned.length >= 3) {
    // recordResult lists the three-star booster first, then the world's three.
    const extra = earned.slice(0, earned.length - 3);
    return `🎁 World gift: one of every booster${extra.length ? `, plus a ${one(extra[0])} for 3 stars` : ""}!`;
  }
  return `🎁 You earned a ${one(earned[0])}!`;
}
