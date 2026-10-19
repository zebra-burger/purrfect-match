// Run: node --test tests/*.test.mjs
// Sleeping cats: woken by a match next door, a blast or a Paw Swipe; then a normal cat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Board, goalsMet, goalsLeft, WAKE_POINTS } from "../src/board.js";
import { generateLevel } from "../src/generator.js";
import { mulberry32 } from "../src/rng.js";

// Digits are cats; "S" is a sleeping cat whose color is given in `sleepColors` (in order).
function boardFrom(lines, sleepColors = []) {
  const mask = lines.map((line) => [...line].map((ch) => ch !== "."));
  const sleepy = [];
  const queue = [...sleepColors];
  const tiles = lines.map((line, r) => [...line].map((ch, c) => {
    if (ch === "S") { sleepy.push({ r, c }); return queue.shift(); }
    return /\d/.test(ch) ? Number(ch) : null;
  }));
  return new Board(mask, tiles, 6, mulberry32(1), { sleepy });
}

test("a match right next to a sleeping cat wakes it, as its own color", () => {
  const b = boardFrom(["111", "2S4", "354"], [5]);
  const sleeper = b.get(1, 1);
  assert.equal(sleeper.special, "sleepy");
  assert.equal(sleeper.color, null, "asleep: never part of a match");
  assert.equal(b.sleepyLeft(), 1);
  const step = b.resolveStep();
  assert.deepEqual(step.wakes.map(({ r, c }) => [r, c]), [[1, 1]]);
  assert.equal(step.points, 60 + WAKE_POINTS);
  assert.equal(b.get(1, 1), sleeper, "it stays put, now awake");
  assert.equal(sleeper.special, null);
  assert.equal(sleeper.color, 5);
  assert.equal(b.sleepyLeft(), 0);
});

test("a match that isn't next to it leaves it asleep", () => {
  const b = boardFrom(["111", "234", "5S6"], [2]);
  const step = b.resolveStep();
  assert.equal(step.wakes.length, 0);
  assert.equal(b.sleepyLeft(), 1);
});

test("a blast over a sleeping cat wakes it instead of clearing it", () => {
  const b = boardFrom(["1112", "34S5", "4563"], [0]);
  Object.assign(b.grid[0][0], { special: "zoomie", dir: "col" });
  Object.assign(b.grid[0][2], { special: "zoomie", dir: "col" });
  const sleeper = b.get(1, 2);
  const step = b.resolveStep();
  assert.ok(step.wakes.some(({ tile }) => tile === sleeper));
  assert.ok(!step.removed.some(({ tile }) => tile === sleeper));
  assert.equal(b.get(1, 2), sleeper);
});

test("sleeping cats can't be swapped, but fall like any cat", () => {
  const b = boardFrom(["12", "S3", "45"], [1]);
  assert.equal(b.swapMakesMatch({ r: 1, c: 0 }, { r: 1, c: 1 }), false);
  assert.equal(b.swapMakesMatch({ r: 1, c: 0 }, { r: 0, c: 0 }), false);
  assert.equal(b.isSpecialSwap({ r: 1, c: 0 }, { r: 1, c: 1 }), false);
  b.grid[2][0] = null;
  const { falls } = b.collapse();
  assert.ok(falls.some((f) => f.tile.special === "sleepy" && f.toR === 2));
});

test("a Disco Cat swapped with a sleeping cat does nothing", () => {
  const b = boardFrom(["1S", "23"], [4]);
  Object.assign(b.grid[0][0], { special: "disco", color: null });
  assert.equal(b.isSpecialSwap({ r: 0, c: 0 }, { r: 0, c: 1 }), false);
});

test("a Paw Swipe on a sleeping cat wakes it", () => {
  const b = boardFrom(["12", "S3"], [5]);
  assert.ok(b.canPaw(1, 0));
  const step = b.resolveStep(null, { r: 1, c: 0 });
  assert.equal(step.removed.length, 0);
  assert.equal(step.wakes.length, 1);
  assert.equal(b.get(1, 0).color, 5);
});

test("the woken cat can make a match on the next cascade step", () => {
  // Waking the middle cat (color 2) lines it up with the 2s either side.
  const b = boardFrom(["111", "2S2", "345"], [2]);
  b.resolveStep();
  b.collapse();
  const next = b.resolveStep();
  assert.ok(next && next.groups.some((g) => g.color === 2), "2-2-2 across the middle");
});

test("wake-the-cats goal: met once every sleeper is awake", () => {
  const b = boardFrom(["111", "2S4", "354"], [5]);
  const targets = { cats: 1 };
  assert.equal(goalsMet(b, targets, 0), false);
  assert.deepEqual(goalsLeft(b, targets), [{ kind: "cats", left: 1 }]);
  b.resolveStep();
  assert.equal(goalsMet(b, targets, 0), true);
});

test("the generator introduces sleeping cats on level 11 and keeps placing them", () => {
  const lvl = generateLevel(11);
  assert.equal(lvl.objective, "cats");
  assert.equal(lvl.targets.cats, lvl.blockers.sleepy.length);
  assert.ok(lvl.targets.cats >= 4);
  let seen = 0;
  for (let n = 12; n <= 400; n++) {
    const l = generateLevel(n);
    if (l.objective !== "cats") continue;
    seen++;
    const b = new Board(l.boardShape, l.tiles, l.colors, mulberry32(l.refillSeed), l.blockers);
    assert.equal(b.sleepyLeft(), l.targets.cats, `level ${n}`);
    assert.ok(b.hasLegalMove(), `level ${n} opens with a move`);
    for (const { r, c } of l.blockers.sleepy) assert.ok(r < l.boardShape.length - 2, "not on the bottom two rows");
  }
  assert.ok(seen > 20, `cats levels in rotation (${seen})`);
});
