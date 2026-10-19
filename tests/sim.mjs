// sim.mjs — headless bot that plays a generated level, for calibrating the
// difficulty curve. Mirrors main.js's resolve loop without animation.
//   node tests/sim.mjs [fromLevel] [toLevel]
import { Board, FISH_POINTS, goalsMet } from "../src/board.js";
export { goalsMet };
import { generateLevel } from "../src/generator.js";
import { mulberry32 } from "../src/rng.js";

// Resolve cascades after a swap (collecting fish as they land); returns points scored.
export function resolve(board, swap) {
  let points = 0;
  while (board.collectFish().length) { points += FISH_POINTS; board.collapse(); }
  for (let cascade = 1; ; cascade++) {
    const step = board.resolveStep(cascade === 1 ? swap : null);
    if (!step) break;
    points += step.points * cascade;
    board.collapse();
    while (board.collectFish().length) { points += FISH_POINTS; board.collapse(); }
  }
  if (!board.hasLegalMove()) board.shuffle();
  return points;
}

// Greedy bot: looks one step ahead (no cascades) and takes the move that scores most
// right now, plus bonuses for making a special and for progress on the level's goals —
// roughly how a seasoned player reads the board. Ties → lowest on the board (fishing
// for cascades). `botRng` adds sloppiness.
const MAKE_BONUS = { zoomie: 120, boom: 160, disco: 300 };
const fishDepth = (b) => {
  let d = 0;
  for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) if (b.grid[r][c]?.special === "fish") d += r;
  return d;
};
export function playLevel(n, botRng = mulberry32(n * 31 + 7), target, maxMoves) {
  const lvl = generateLevel(n);
  const board = new Board(lvl.boardShape, lvl.tiles, lvl.colors, mulberry32(lvl.refillSeed), lvl.blockers);
  const targets = target != null ? { ...lvl.targets, score: target } : lvl.targets;
  let score = 0;
  const budget = maxMoves ?? lvl.moves;
  for (let move = 0; move < budget; move++) {
    const moves = board.findMoves();
    let best = null, bestValue = -1;
    for (const [a, b] of moves) {
      const look = board.clone(() => 0.99);
      const depth = fishDepth(look);
      look.swap(a, b);
      const step = look.resolveStep([a, b]) || { points: 0, created: [], yarnHits: [], boxHits: [], wakes: [] };
      const made = step.created.reduce((s, c) => s + MAKE_BONUS[c.tile.special], 0);
      let goal = 0;
      if (targets.yarn) goal += 160 * step.yarnHits.length;
      if (targets.boxes) goal += 120 * step.boxHits.length;
      if (targets.cats) goal += 200 * step.wakes.length;
      if (targets.fish) {
        if (step) look.collapse();
        goal += 220 * (fishDepth(look) - depth) + 900 * look.collectFish().length;
      }
      const scoreWeight = targets.score != null ? 1 : 0.3;
      const value = step.points * scoreWeight + made + goal + Math.max(a.r, b.r) * 3 + botRng() * 40;
      if (value > bestValue) { bestValue = value; best = [a, b]; }
    }
    board.swap(best[0], best[1]);
    score += resolve(board, best);
    if (goalsMet(board, targets, score)) return { won: true, score, target: lvl.targets.score, movesLeft: budget - move - 1 };
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
    for (const k of [key, lvl.objective, `${lvl.objective}/${key}`]) {
      (buckets[k] ||= [0, 0])[0] += r.won;
      buckets[k][1]++;
    }
  }
  console.log(`levels ${from}-${to}: bot won ${wins}/${to - from + 1}`);
  for (const [k, [w, t]] of Object.entries(buckets)) console.log(`  ${k}: ${w}/${t} (${Math.round((100 * w) / t)}%)`);
}
