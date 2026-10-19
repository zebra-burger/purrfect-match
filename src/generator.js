// generator.js — the "limitless levels" engine.
//
// generateLevel(n) -> {
//   seed: n,
//   objective:  "score" | "yarn" | "fish" | "boxes" | "cats" | "mixed",
//   boardShape: 2D mask (which cells exist),
//   moves:      move budget from the difficulty curve,
//   colors:     how many cat colors are in play (5 at first, 6 later),
//   blockers:   { yarn, boxes: 2D layer counts or null, fish: [{r, c}], fishTotal,
//                 sleepy: [{r, c}] sleeping cats },
//   targets:    what wins the level: { score } or any of { yarn, boxes, fish, cats }
//               (total yarn layers / box layers / fish treats to collect / cats to wake),
// }
// plus, so a level is fully reproducible:
//   shapeName:  which board shape was picked,
//   difficulty: 0..1 from the curve,
//   tiles:      opening color grid (null for holes), guaranteed to have a move,
//   refillSeed: seed for the refill RNG the board draws new tiles from.
//
// Difficulty curve: slow sawtooth — ramps over ~20 levels, then a breather,
// with a spike every 10th level. A solvability pass regenerates any board
// that opens with no legal move.
//
// Implemented in M1. Contract kept stable so board.js / ui.js can build against it.

import { mulberry32, pick, randInt } from "./rng.js";
import { Board, fillWithoutMatches } from "./board.js";

const CYCLE = 20;

// 0 (gentle) .. 1 (hard). Breather at the start of each 20-level cycle, ramp through
// it, spike on every 10th level, and a slow creep across cycles so 6,800 isn't level 20.
export function difficulty(n) {
  if (n <= 3) return 0.05 * (n - 1);
  const p = (n - 1) % CYCLE;
  const cycle = Math.floor((n - 1) / CYCLE);
  let d = p < 2 ? 0.12 : 0.18 + 0.55 * ((p - 2) / (CYCLE - 3));
  if (n % 10 === 0) d += 0.2;
  d += Math.min(0.12, cycle * 0.006);
  return Math.min(1, d);
}

// --- Board shapes (9×9 max) -------------------------------------------------

const grid = (rows, cols, fn) =>
  Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => fn(r, c)));

const SHAPES = {
  rectangle: (rng) => {
    const [rows, cols] = pick(rng, [[8, 8], [9, 8], [9, 9], [8, 9]]);
    return grid(rows, cols, () => true);
  },
  diamond: () => grid(9, 9, (r, c) => Math.abs(r - 4) + Math.abs(c - 4) <= 5),
  donut: () => grid(9, 9, (r, c) => {
    const corner = (r === 0 || r === 8) && (c === 0 || c === 8);
    const hole = r >= 3 && r <= 5 && c >= 3 && c <= 5;
    return !corner && !hole;
  }),
  catHead: () => grid(9, 9, (r, c) => {
    if (r === 0) return c <= 1 || c >= 7;                 // ear tips
    if (r === 1) return c <= 2 || c >= 6;                 // ears
    if (r === 8) return c >= 2 && c <= 6;                 // chin
    if (r === 7) return c >= 1 && c <= 7;
    return true;
  }),
  randomHoles: (rng) => {
    // Mirror-symmetric holes in a 9×9, kept off the edges so nothing gets isolated.
    const mask = grid(9, 9, () => true);
    const holes = randInt(rng, 2, 4);
    for (let i = 0; i < holes; i++) {
      const r = randInt(rng, 1, 7), c = randInt(rng, 1, 3);
      mask[r][c] = false;
      mask[r][8 - c] = false;
    }
    return mask;
  },
};

// Relative scoring yield of each shape vs. a 9×9 rectangle, measured with tests/sim.mjs.
const SHAPE_YIELD = { rectangle: 1, diamond: 0.88, donut: 0.63, catHead: 0.82, randomHoles: 0.74 };

function chooseShape(n, rng) {
  if (n <= 5) return "rectangle";
  return pick(rng, ["rectangle", "rectangle", "diamond", "donut", "catHead", "randomHoles"]);
}

// --- Objectives ---------------------------------------------------------------

// Each goal is introduced on its own level first, then joins the rotation. Score-only
// levels draw nothing else from the RNG, so their boards are the same as before goals.
const INTRO = { 5: "yarn", 7: "fish", 9: "boxes", 11: "cats", 15: "mixed" };
const WEIGHTS = { score: 0.2, yarn: 0.3, fish: 0.2, boxes: 0.2, cats: 0.2, mixed: 0.1 };

function chooseObjective(n, rng) {
  const roll = rng();
  if (n <= 4) return "score";
  if (INTRO[n]) return INTRO[n];
  const open = Object.entries(INTRO).filter(([lvl]) => Number(lvl) < n).map(([, goal]) => goal);
  const pool = ["score", ...open];
  const total = pool.reduce((sum, g) => sum + WEIGHTS[g], 0);
  let x = roll * total;
  for (const g of pool) { x -= WEIGHTS[g]; if (x < 0) return g; }
  return "score";
}

// --- Blockers -------------------------------------------------------------------

// Picks `count` cells (mirrored left↔right, so boards look designed), honoring `ok`.
function mirroredCells(mask, count, rng, ok = () => true) {
  const rows = mask.length, cols = mask[0].length;
  const half = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c <= (cols - 1) / 2; c++) if (mask[r][c] && ok(r, c) && ok(r, cols - 1 - c)) half.push({ r, c });
  const out = [];
  while (out.length < count && half.length) {
    const { r, c } = half.splice(Math.floor(rng() * half.length), 1)[0];
    out.push({ r, c });
    if (c !== cols - 1 - c && mask[r][cols - 1 - c] && out.length < count) out.push({ r, c: cols - 1 - c });
  }
  return out;
}

const layerGrid = (mask) => mask.map((row) => row.map(() => 0));
const sum2d = (g) => g.flat().reduce((a, b) => a + b, 0);

// Amounts scale with difficulty; tuned against the bot in tests/sim.mjs.
const SLEEPY_BASE = 0.12, SLEEPY_SLOPE = 0.10, SLEEPY_MOVES = 0.65;
function placeBlockers(objective, mask, d, rng) {
  const cells = mask.flat().filter(Boolean).length;
  const out = { yarn: null, boxes: null, fish: [], fishTotal: 0, sleepy: [] };
  const parts = objective === "mixed" ? (rng() < 0.5 ? ["yarn", "fish"] : ["boxes", "yarn"]) : [objective];
  const share = parts.length > 1 ? 0.45 : 1;

  if (parts.includes("boxes")) {
    out.boxes = layerGrid(mask);
    const count = Math.round(cells * (0.13 + 0.05 * d) * share);
    for (const { r, c } of mirroredCells(mask, count, rng, (r) => r >= 2)) {
      out.boxes[r][c] = rng() < 0.15 + 0.3 * d ? 2 : 1;
    }
  }
  if (parts.includes("yarn")) {
    out.yarn = layerGrid(mask);
    const count = Math.round(cells * (0.12 + 0.02 * d) * share);
    const free = (r, c) => !out.boxes || !out.boxes[r][c];
    for (const { r, c } of mirroredCells(mask, count, rng, free)) {
      out.yarn[r][c] = rng() < Math.max(0, d - 0.5) * 0.4 ? 2 : 1;
    }
  }
  if (parts.includes("cats")) {
    // Sleeping cats curl up in the top two thirds, so there's room below to match next to them.
    const count = Math.max(4, Math.round(cells * (SLEEPY_BASE + SLEEPY_SLOPE * d) * share));
    const free = (r, c) => r < mask.length - 2 && (!out.boxes || !out.boxes[r][c]);
    out.sleepy = mirroredCells(mask, count, rng, free);
  }
  if (parts.includes("fish")) {
    out.fishTotal = Math.max(2, Math.round((3 + 2.2 * d) * (parts.length > 1 ? 0.6 : 1)));
    // The first treats start partway down so the goal gets moving straight away.
    const cols = mask[0].length;
    const startRow = Math.floor(mask.length / 2) - 1;
    const starts = [];
    for (let c = 0; c < cols; c++) {
      const r = mask.findIndex((row, rr) => rr >= startRow && row[c] && (!out.boxes || !out.boxes[rr][c]));
      if (r >= 0 && r < mask.length - 2) starts.push({ r, c });
    }
    for (let i = 0; i < Math.min(2, out.fishTotal) && starts.length; i++) {
      out.fish.push(starts.splice(Math.floor(rng() * starts.length), 1)[0]);
    }
  }
  return out;
}

// --- Assembly -----------------------------------------------------------------

export function generateLevel(n) {
  const rng = mulberry32(n);
  const d = difficulty(n);
  const objective = chooseObjective(n, rng);
  const shapeName = chooseShape(n, rng);
  const boardShape = SHAPES[shapeName](rng);
  const colors = n <= 12 || (d < 0.15 && rng() < 0.5) ? 5 : 6;

  const cellCount = boardShape.flat().filter(Boolean).length;
  // Sleeping cats wake easily, so those levels get a tighter budget instead of a crowded board.
  const moves = Math.round((30 - 12 * d) * (objective === "cats" ? SLEEPY_MOVES : 1));
  // Points per move a greedy bot averages (tests/sim.mjs): 5 colors cascade far more
  // than 6, and holes/narrow shapes cascade less. The target asks for ~75% of that on
  // a gentle level and ~110% on a spike.
  const perMove = (colors === 5 ? 680 : 315) * SHAPE_YIELD[shapeName] * (cellCount / 81) ** 0.5;
  const warmUp = n <= 10 ? 0.55 + 0.045 * (n - 1) : 1; // first ten levels go easy
  const score = Math.max(1000, Math.round((moves * perMove * (0.75 + 0.35 * d) * warmUp) / 100) * 100);

  const blockers = objective === "score" ? { yarn: null, boxes: null, fish: [], fishTotal: 0, sleepy: [] }
    : placeBlockers(objective, boardShape, d, rng);
  const targets = objective === "score" ? { score } : {};
  if (blockers.yarn) targets.yarn = sum2d(blockers.yarn);
  if (blockers.boxes) targets.boxes = sum2d(blockers.boxes);
  if (blockers.fishTotal) targets.fish = blockers.fishTotal;
  if (blockers.sleepy.length) targets.cats = blockers.sleepy.length;
  const fillMask = blockers.boxes ? boardShape.map((row, r) => row.map((v, c) => v && !blockers.boxes[r][c])) : boardShape;

  // Solvability pass: regenerate the opening fill until it has a legal move.
  let tiles;
  for (let attempt = 0; ; attempt++) {
    tiles = fillWithoutMatches(fillMask, colors, rng);
    if (new Board(boardShape, tiles, colors, rng, blockers).hasLegalMove() || attempt > 50) break;
  }

  return {
    seed: n,
    objective,
    boardShape,
    shapeName,
    moves,
    colors,
    blockers,
    targets,
    difficulty: d,
    tiles,
    refillSeed: (Math.imul(n, 2654435761) ^ 0x5bd1e995) >>> 0,
  };
}
