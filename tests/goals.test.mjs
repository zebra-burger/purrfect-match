// Run: node --test tests/*.test.mjs
// Level goals: yarn, boxes, fish treats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Board } from "../src/board.js";
import { mulberry32 } from "../src/rng.js";

// Rows of digits for cats; "B"/"b" a 2-/1-layer box, "F" a fish treat, "." a hole.
// `yarnRows` gives layer counts per cell ("0"–"2"), same shape.
function boardFrom(lines, { yarnRows = null, fishTotal = 0, seed = 1, colors = 6 } = {}) {
  const mask = lines.map((line) => [...line].map((ch) => ch !== "."));
  const tiles = lines.map((line) => [...line].map((ch) => (/\d/.test(ch) ? Number(ch) : null)));
  const boxes = lines.map((line) => [...line].map((ch) => (ch === "B" ? 2 : ch === "b" ? 1 : 0)));
  const fish = [];
  lines.forEach((line, r) => [...line].forEach((ch, c) => { if (ch === "F") fish.push({ r, c }); }));
  const yarn = yarnRows ? yarnRows.map((line) => [...line].map(Number)) : null;
  return new Board(mask, tiles, colors, mulberry32(seed), { yarn, boxes, fish, fishTotal: fishTotal || fish.length });
}

test("matching on yarn unpicks one layer per clear", () => {
  const b = boardFrom(["111", "234"], { yarnRows: ["120", "000"] });
  assert.equal(b.yarnLeft(), 3);
  const step = b.resolveStep();
  assert.equal(step.yarnHits.length, 2);
  assert.equal(b.yarnLeft(), 1, "the double layer keeps one");
  assert.equal(step.points, 60 + 2 * 40);
});

test("a match next to a box knocks off one layer; a blast hits it directly", () => {
  const b = boardFrom(["111", "2B4", "354"]);
  const step = b.resolveStep();
  assert.deepEqual(step.boxHits.map(({ r, c, left }) => [r, c, left]), [[1, 1, 1]]);
  assert.equal(b.boxesLeft(), 1);
  assert.equal(b.get(1, 1), null, "boxes hold no tile");

  const z = boardFrom(["1112", "3b45", "4563"]);
  z.grid[0][0].special = "zoomie"; z.grid[0][0].dir = "col";
  const zs = z.resolveStep();
  assert.ok(zs.boxHits.some(({ r, c }) => r === 1 && c === 1), "adjacent match");
  assert.equal(z.boxesLeft(), 0);
});

test("each box is hit at most once per step", () => {
  const b = boardFrom(["111", "1B3", "145"]);
  const step = b.resolveStep();
  assert.equal(step.boxHits.length, 1);
  assert.equal(b.boxesLeft(), 1);
});

test("tiles fall through boxes, and a broken box opens for refill", () => {
  const b = boardFrom(["2", "b", "x"]);
  const { falls, spawns } = b.collapse();
  assert.deepEqual(falls.map((f) => [f.fromR, f.toR]), [[0, 2]]);
  assert.equal(spawns.length, 1);
  assert.equal(b.grid[1][0], null);
  b.boxes[1][0] = 0;
  b.grid[1][0] = null;
  const again = b.collapse();
  assert.equal(again.spawns.length + again.falls.length >= 1, true);
  assert.ok(b.grid[1][0]);
});

test("fish never match, blasts skip them, and they're collected at the bottom", () => {
  const b = boardFrom(["F12", "113", "234"], { fishTotal: 1 });
  assert.equal(b.findMatches().length, 0);
  // Clear the cat under the fish with a Zoomie blast along row 1.
  b.grid[1][0].special = "zoomie"; b.grid[1][0].dir = "row";
  b.grid[1][2].color = 1;
  const step = b.resolveStep();
  assert.ok(!step.removed.some(({ tile }) => tile.special === "fish"));
  b.collapse();
  assert.equal(b.grid[1][0].special, "fish", "fish fell one row");
  b.grid[2][0] = null;
  b.collapse();
  const got = b.collectFish();
  assert.equal(got.length, 1);
  assert.equal(b.fishCollected, 1);
});

test("fish keep spawning until the level's total is on its way", () => {
  const b = boardFrom(["123", "234", "345"], { fishTotal: 3, seed: 3 });
  let spawned = 0;
  for (let i = 0; i < 200 && b.fishToSpawn > 0; i++) {
    for (let c = 0; c < 3; c++) {
      const t = b.grid[0][c];
      if (t && t.special === "fish") { b.grid[0][c] = null; spawned++; } else b.grid[0][c] = null;
    }
    b.collapse();
  }
  assert.equal(b.fishToSpawn, 0);
  assert.ok(spawned + b.fishOnBoard() >= 2);
});

test("a fish treat is not a special swap, but it can be swapped into a match", () => {
  const b = boardFrom(["F1", "21", "31"]);
  const disco = boardFrom(["F1", "23"]);
  disco.grid[0][1].special = "disco"; disco.grid[0][1].color = null;
  assert.equal(disco.isSpecialSwap({ r: 0, c: 0 }, { r: 0, c: 1 }), false);
  const m = boardFrom(["F11", "123", "345"]);
  // swapping the fish with the 1 below it lines up 1,1,1 on the top row
  assert.ok(m.swapMakesMatch({ r: 0, c: 0 }, { r: 1, c: 0 }));
  assert.ok(b);
});

test("clones copy the goal layers", () => {
  const b = boardFrom(["111", "2b4"], { yarnRows: ["111", "000"] });
  const c = b.clone(() => 0);
  c.resolveStep();
  assert.equal(b.yarnLeft(), 3);
  assert.equal(b.boxesLeft(), 1);
  assert.equal(c.yarnLeft(), 0);
  assert.equal(c.boxesLeft(), 0);
});
