// Run: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateLevel, difficulty } from "../src/generator.js";
import { Board } from "../src/board.js";
import { mulberry32 } from "../src/rng.js";
import { playLevel } from "./sim.mjs";

test("same level number gives the same level", () => {
  for (const n of [1, 7, 42, 6800, 50000]) {
    assert.deepEqual(generateLevel(n), generateLevel(n));
  }
});

test("every level opens with a legal move, no standing match, and sane numbers", () => {
  const shapes = new Set();
  for (let n = 1; n <= 500; n++) {
    const lvl = generateLevel(n);
    shapes.add(lvl.shapeName);
    const b = new Board(lvl.boardShape, lvl.tiles, lvl.colors, mulberry32(lvl.refillSeed));
    assert.ok(b.hasLegalMove(), `level ${n} has no opening move`);
    assert.equal(b.findMatches().length, 0, `level ${n} opens with a match`);
    assert.ok(lvl.boardShape.length <= 9 && lvl.boardShape[0].length <= 9);
    assert.ok(lvl.moves >= 15 && lvl.moves <= 30);
    assert.ok(lvl.targets.score >= 1000);
    assert.equal(lvl.objective, "score");
  }
  assert.ok(shapes.size >= 3, `only saw shapes ${[...shapes]}`);
});

test("difficulty is a sawtooth with 10th-level spikes", () => {
  assert.ok(difficulty(1) < difficulty(19));
  assert.ok(difficulty(21) < difficulty(19), "breather after a cycle");
  assert.ok(difficulty(30) > difficulty(29) && difficulty(30) > difficulty(31), "spike on 10s");
  for (let n = 1; n <= 10000; n += 37) assert.ok(difficulty(n) >= 0 && difficulty(n) <= 1);
});

test("a greedy bot clears the opening levels", () => {
  for (let n = 1; n <= 5; n++) assert.ok(playLevel(n).won, `bot lost level ${n}`);
});
