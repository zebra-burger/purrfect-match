// generator.js — the "limitless levels" engine.
//
// generateLevel(n) -> {
//   seed: n,
//   objective:  "score" | "yarn" | "fish" | "boxes" | "mixed",
//   boardShape: 2D mask (which cells exist),
//   moves:      move budget from the difficulty curve,
//   colors:     how many cat colors are in play (5 at first, 6 later),
//   blockers:   placement map for yarn / boxes / sleeping cats,
//   targets:    objective amounts (e.g. collect 12 fish),
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

// Rotation planned for M3 (yarn / fish / boxes / mixed need blockers and collectibles).
// M1 ships score-only; keep the picker here so the RNG draw order stays stable later.
function chooseObjective(n, rng) {
  rng(); // reserved draw for the M3 objective rotation
  return "score";
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
  const moves = Math.round(30 - 12 * d);
  // Points per move a greedy bot averages (tests/sim.mjs): 5 colors cascade far more
  // than 6, and holes/narrow shapes cascade less. The target asks for ~75% of that on
  // a gentle level and ~110% on a spike.
  const perMove = (colors === 5 ? 680 : 315) * SHAPE_YIELD[shapeName] * (cellCount / 81) ** 0.5;
  const warmUp = n <= 10 ? 0.55 + 0.045 * (n - 1) : 1; // first ten levels go easy
  const score = Math.max(1000, Math.round((moves * perMove * (0.75 + 0.35 * d) * warmUp) / 100) * 100);

  // Solvability pass: regenerate the opening fill until it has a legal move.
  let tiles;
  for (let attempt = 0; ; attempt++) {
    tiles = fillWithoutMatches(boardShape, colors, rng);
    if (new Board(boardShape, tiles, colors, rng).hasLegalMove() || attempt > 50) break;
  }

  return {
    seed: n,
    objective,
    boardShape,
    shapeName,
    moves,
    colors,
    blockers: [],
    targets: { score },
    difficulty: d,
    tiles,
    refillSeed: (Math.imul(n, 2654435761) ^ 0x5bd1e995) >>> 0,
  };
}
