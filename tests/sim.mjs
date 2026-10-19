// sim.mjs — headless bot that plays a generated level, for calibrating the
// difficulty curve. Mirrors main.js's resolve loop without animation.
//   node tests/sim.mjs [fromLevel] [toLevel]
import { Board, MATCH_POINTS } from "../src/board.js";
import { generateLevel } from "../src/generator.js";
import { mulberry32 } from "../src/rng.js";

// Resolve cascades after a swap; returns points scored.
export function resolve(board) {
  let points = 0;
  for (let cascade = 1; ; cascade++) {
    const groups = board.findMatches();
    if (!groups.length) break;
    for (const g of groups) points += MATCH_POINTS[g.kind] * cascade;
    board.clear(groups);
    board.collapse();
  }
  if (!board.hasLegalMove()) board.shuffle();
  return points;
}

// Greedy bot: takes the move with the biggest immediate match (ties → lowest on the board,
// which is what most humans do to fish for cascades). `botRng` adds a little sloppiness.
export function playLevel(n, botRng = mulberry32(n * 31 + 7)) {
  const lvl = generateLevel(n);
  const board = new Board(lvl.boardShape, lvl.tiles, lvl.colors, mulberry32(lvl.refillSeed));
  let score = 0;
  for (let move = 0; move < lvl.moves; move++) {
    const moves = board.findMoves();
    let best = null, bestValue = -1;
    for (const [a, b] of moves) {
      board.swap(a, b);
      const la = board.lineAt(a.r, a.c), lb = board.lineAt(b.r, b.c);
      board.swap(a, b);
      const size = [la.h, la.v, lb.h, lb.v].filter((x) => x >= 3).reduce((s, x) => s + x, 0);
      const value = size * 10 + Math.max(a.r, b.r) + botRng() * 8;
      if (value > bestValue) { bestValue = value; best = [a, b]; }
    }
    board.swap(best[0], best[1]);
    score += resolve(board);
    if (score >= lvl.targets.score) return { won: true, score, target: lvl.targets.score, movesLeft: lvl.moves - move - 1 };
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
