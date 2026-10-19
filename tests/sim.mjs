// sim.mjs — headless bot that plays a generated level, for calibrating the
// difficulty curve. Mirrors main.js's resolve loop without animation.
//   node tests/sim.mjs [fromLevel] [toLevel]
import { Board } from "../src/board.js";
import { generateLevel } from "../src/generator.js";
import { mulberry32 } from "../src/rng.js";

// Resolve cascades after a swap; returns points scored.
export function resolve(board, swap) {
  let points = 0;
  for (let cascade = 1; ; cascade++) {
    const step = board.resolveStep(cascade === 1 ? swap : null);
    if (!step) break;
    points += step.points * cascade;
    board.collapse();
  }
  if (!board.hasLegalMove()) board.shuffle();
  return points;
}

// Greedy bot: looks one step ahead (no cascades) and takes the move that scores most
// right now, plus a bonus for making a special — roughly how a seasoned player reads
// the board. Ties → lowest on the board (fishing for cascades). `botRng` adds sloppiness.
const MAKE_BONUS = { zoomie: 120, boom: 160, disco: 300 };
export function playLevel(n, botRng = mulberry32(n * 31 + 7), target) {
  const lvl = generateLevel(n);
  const board = new Board(lvl.boardShape, lvl.tiles, lvl.colors, mulberry32(lvl.refillSeed));
  let score = 0;
  for (let move = 0; move < lvl.moves; move++) {
    const moves = board.findMoves();
    let best = null, bestValue = -1;
    for (const [a, b] of moves) {
      const look = board.clone(() => 0);
      look.swap(a, b);
      const step = look.resolveStep([a, b]);
      const made = step.created.reduce((s, c) => s + MAKE_BONUS[c.tile.special], 0);
      const value = step.points + made + Math.max(a.r, b.r) * 3 + botRng() * 40;
      if (value > bestValue) { bestValue = value; best = [a, b]; }
    }
    board.swap(best[0], best[1]);
    score += resolve(board, best);
    if (score >= (target ?? lvl.targets.score)) return { won: true, score, target: lvl.targets.score, movesLeft: lvl.moves - move - 1 };
  }
  return { won: false, score, target: lvl.targets.score, movesLeft: 0 };
}

if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  const from = Number(process.argv[2] || 1), to = Number(process.argv[3] || 100);
  let wins = 0;
  const buckets = {};
  for (let n = from; n <= to; n++) {
    const lvl = generateLevel(n);
    const r = playLevel(n);
    wins += r.won;
    const key = lvl.difficulty < 0.3 ? "easy" : lvl.difficulty < 0.6 ? "mid" : "hard";
    (buckets[key] ||= [0, 0])[0] += r.won;
    buckets[key][1]++;
  }
  console.log(`levels ${from}-${to}: bot won ${wins}/${to - from + 1}`);
  for (const [k, [w, t]] of Object.entries(buckets)) console.log(`  ${k}: ${w}/${t} (${Math.round((100 * w) / t)}%)`);
}
