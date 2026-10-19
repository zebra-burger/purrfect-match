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
//
// Difficulty curve: slow sawtooth — ramps over ~20 levels, then a breather,
// with a spike every 10th level. A solvability pass regenerates any board
// that opens with no legal move.
//
// Implemented in M1. Contract kept stable so board.js / ui.js can build against it.

import { mulberry32 } from "./rng.js";

export function generateLevel(n) {
  const rng = mulberry32(n);
  throw new Error(`generateLevel(${n}) not implemented yet — M1 (rng ready: ${typeof rng})`);
}
