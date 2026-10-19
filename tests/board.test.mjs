// Run: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { Board, fillWithoutMatches } from "../src/board.js";
import { mulberry32 } from "../src/rng.js";

const full = (rows, cols) => Array.from({ length: rows }, () => Array(cols).fill(true));

// Builds a board from rows of digits; "." is a hole, "x" an empty (null) cell.
function boardFrom(lines, colorCount = 6, seed = 1) {
  const mask = lines.map((line) => [...line].map((ch) => ch !== "."));
  const colors = lines.map((line) => [...line].map((ch) => (/\d/.test(ch) ? Number(ch) : null)));
  return new Board(mask, colors, colorCount, mulberry32(seed));
}

const colorsOf = (b) => b.grid.map((row, r) => row.map((t, c) => (!b.mask[r][c] ? "." : t ? t.color : "x")).join(""));

test("detects a horizontal three", () => {
  const b = boardFrom(["000", "123", "231"]);
  const m = b.findMatches();
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, "three");
  assert.equal(m[0].cells.length, 3);
});

test("detects four and five in a line", () => {
  assert.equal(boardFrom(["1111", "2323"]).findMatches()[0].kind, "four");
  assert.equal(boardFrom(["11111", "23232"]).findMatches()[0].kind, "five");
});

test("merges an L shape into one group", () => {
  const m = boardFrom(["123", "145", "111"]).findMatches();
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, "lt");
  assert.equal(m[0].cells.length, 5);
});

test("merges a T shape into one group", () => {
  const t = boardFrom(["111", "213", "314"]);
  const m = t.findMatches();
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, "lt");
  assert.equal(m[0].cells.length, 5);
});

test("holes break runs", () => {
  assert.equal(boardFrom(["11.1", "2323"]).findMatches().length, 0);
});

test("separate groups stay separate", () => {
  const m = boardFrom(["111", "234", "555"]).findMatches();
  assert.equal(m.length, 2);
});

test("clear + collapse drops tiles and refills every cell", () => {
  const b = boardFrom(["234", "567", "111"]);
  const removed = b.clear(b.findMatches());
  assert.equal(removed.length, 3);
  const { falls, spawns } = b.collapse();
  assert.equal(falls.length, 6);
  assert.equal(spawns.length, 3);
  assert.deepEqual(colorsOf(b).slice(1), ["234", "567"]);
  assert.ok(spawns.every((s) => s.fromR < 0 && s.toR === 0));
  assert.ok(b.grid.every((row) => row.every(Boolean)));
});

test("gravity passes through holes", () => {
  const b = boardFrom(["2", ".", "x"]);
  const { falls, spawns } = b.collapse();
  assert.deepEqual(falls.map((f) => [f.fromR, f.toR]), [[0, 2]]);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].toR, 0);
  assert.equal(b.grid[1][0], null);
});

test("finds legal moves and rejects dead boards", () => {
  const live = boardFrom(["1121", "2345"]);
  assert.deepEqual(live.findMoves(), [[{ r: 0, c: 2 }, { r: 0, c: 3 }]]);
  assert.equal(live.swapMakesMatch({ r: 0, c: 0 }, { r: 0, c: 1 }), false);
  const dead = boardFrom(["123", "231", "312"]);
  assert.equal(dead.hasLegalMove(), false);
});

test("swapMakesMatch leaves the board unchanged", () => {
  const b = boardFrom(["1121", "2345"]);
  const before = colorsOf(b);
  assert.ok(b.swapMakesMatch({ r: 0, c: 2 }, { r: 0, c: 3 }));
  assert.deepEqual(colorsOf(b), before);
});

test("shuffle yields no standing matches and a legal move", () => {
  const b = boardFrom(["123", "231", "312"], 3);
  assert.ok(b.shuffle(mulberry32(7)));
  assert.equal(b.findMatches().length, 0);
  assert.ok(b.hasLegalMove());
});

test("fillWithoutMatches never opens with a match", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const colors = fillWithoutMatches(full(9, 9), 5, mulberry32(seed));
    const b = new Board(full(9, 9), colors, 5, mulberry32(seed));
    assert.equal(b.findMatches().length, 0, `seed ${seed}`);
  }
});
