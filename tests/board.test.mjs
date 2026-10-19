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

// --- Special cats -----------------------------------------------------------------

// Puts a special on the tile at (r, c). Disco Cats are colorless.
function makeSpecial(b, r, c, special, dir) {
  const t = b.grid[r][c];
  t.special = special;
  if (dir) t.dir = dir;
  if (special === "disco") t.color = null;
  return t;
}

const at = (b, r, c) => b.grid[r][c];

test("match-4 from a horizontal swap makes a row Zoomie at the swapped cell", () => {
  const b = boardFrom(["11121", "23412", "45645"]);
  const a = { r: 0, c: 4 }, d = { r: 0, c: 3 };
  b.swap(a, d);
  const step = b.resolveStep([a, d]);
  assert.equal(step.created.length, 1);
  assert.deepEqual([step.created[0].r, step.created[0].c], [0, 3]);
  assert.equal(at(b, 0, 3).special, "zoomie");
  assert.equal(at(b, 0, 3).dir, "row");
  assert.equal(step.removed.length, 3);
  assert.equal(step.points, 120);
});

test("match-4 from a vertical swap makes a column Zoomie", () => {
  const b = boardFrom(["2313", "1121", "4545"]);
  const a = { r: 0, c: 2 }, d = { r: 1, c: 2 };
  b.swap(a, d);
  const step = b.resolveStep([a, d]);
  assert.equal(step.created.length, 1);
  assert.deepEqual([step.created[0].r, step.created[0].c], [1, 2]);
  assert.equal(at(b, 1, 2).dir, "col");
});

test("cascade-made Zoomie follows its line", () => {
  const b = boardFrom(["2", "1", "1", "1", "1"]);
  const step = b.resolveStep();
  assert.equal(step.created[0].tile.special, "zoomie");
  assert.equal(step.created[0].tile.dir, "col");
});

test("match-5 line makes a colorless Disco Cat; L/T makes a Boom Cat", () => {
  const b = boardFrom(["11111", "23232"]);
  const step = b.resolveStep();
  assert.equal(step.created[0].tile.special, "disco");
  assert.equal(step.created[0].tile.color, null);
  assert.equal(b.findMatches().length, 0, "a Disco Cat never matches");

  const l = boardFrom(["123", "145", "111"]);
  const ls = l.resolveStep();
  assert.equal(ls.created[0].tile.special, "boom");
  assert.deepEqual([ls.created[0].r, ls.created[0].c], [2, 0], "Boom Cat sits on the corner");
});

test("a matched Zoomie clears its whole row", () => {
  const b = boardFrom(["111234", "345612", "456123"]);
  makeSpecial(b, 0, 1, "zoomie", "row");
  const step = b.resolveStep();
  assert.equal(step.removed.length, 6);
  assert.ok(b.grid[0].every((t) => t === null));
  assert.equal(step.points, 60 + 3 * 30);
  assert.equal(step.blasts[0].special, "zoomie");
});

test("a matched column Zoomie clears its column", () => {
  const b = boardFrom(["1112", "2345", "3456", "4561"]);
  makeSpecial(b, 0, 2, "zoomie", "col");
  b.resolveStep();
  for (let r = 0; r < 4; r++) assert.equal(b.grid[r][2], null);
  assert.ok(b.grid[1][0] && b.grid[1][3]);
});

test("a matched Boom Cat clears the 3×3 around it", () => {
  const b = boardFrom(["23456", "11145", "34562", "45623"]);
  makeSpecial(b, 1, 1, "boom");
  const step = b.resolveStep();
  const cleared = step.removed.map(({ r, c }) => `${r},${c}`).sort();
  assert.deepEqual(cleared, ["0,0", "0,1", "0,2", "1,0", "1,1", "1,2", "2,0", "2,1", "2,2"]);
});

test("specials chain: a Zoomie blast sets off a Boom Cat in its path", () => {
  const b = boardFrom(["11123", "23456", "34562", "45623"]);
  makeSpecial(b, 0, 0, "zoomie", "col");
  makeSpecial(b, 2, 0, "boom");
  const step = b.resolveStep();
  assert.deepEqual(step.blasts.map((x) => x.special), ["zoomie", "boom"]);
  assert.equal(b.grid[1][1], null, "boom cleared next to itself");
  assert.equal(b.grid[3][1], null);
});

test("Disco + cat clears every cat of that color", () => {
  const b = boardFrom(["1213", "2324", "1415"]);
  makeSpecial(b, 0, 1, "disco");
  const a = { r: 0, c: 0 }, d = { r: 0, c: 1 };
  assert.ok(b.swapMakesMatch(a, d), "disco swap is always legal");
  b.swap(a, d);
  const step = b.resolveStep([a, d]);
  // The 1s at (0,1) after swap, (0,2)... count: original 1s at (0,0),(0,2),(2,0),(2,2) + disco.
  assert.equal(step.removed.length, 5);
  for (const row of b.grid) for (const t of row) assert.ok(!t || t.color !== 1);
});

test("Disco + Zoomie turns that color into Zoomies and fires them", () => {
  const b = boardFrom(["1213", "3424", "5156"]);
  makeSpecial(b, 0, 1, "disco");
  makeSpecial(b, 0, 0, "zoomie", "row");
  const a = { r: 0, c: 0 }, d = { r: 0, c: 1 };
  b.swap(a, d);
  const step = b.resolveStep([a, d]);
  // 1s at (0,2) and (2,1) become Zoomies: three Zoomies fire across row 0 and column 1.
  assert.equal(step.blasts.filter((x) => x.special === "zoomie").length, 3);
  assert.equal(step.removed.length, 6);
  assert.ok(b.grid[0].every((t) => t === null));
});

test("Disco + Disco clears the whole board", () => {
  const b = boardFrom(["1234", "3412", "2143"]);
  makeSpecial(b, 1, 1, "disco");
  makeSpecial(b, 1, 2, "disco");
  const a = { r: 1, c: 1 }, d = { r: 1, c: 2 };
  b.swap(a, d);
  const step = b.resolveStep([a, d]);
  assert.equal(step.removed.length, 12);
  assert.equal(step.points, 12 * 30);
});

test("Zoomie + Zoomie clears a cross through the swapped cell", () => {
  const b = boardFrom(["12345", "23456", "34512", "45123"]);
  makeSpecial(b, 2, 1, "zoomie", "row");
  makeSpecial(b, 2, 2, "zoomie", "row");
  const a = { r: 2, c: 1 }, d = { r: 2, c: 2 };
  assert.ok(b.swapMakesMatch(a, d));
  b.swap(a, d);
  const step = b.resolveStep([a, d]);
  assert.equal(step.removed.length, 5 + 4 - 1);
  assert.ok(b.grid[2].every((t) => t === null));
  for (let r = 0; r < 4; r++) assert.equal(b.grid[r][2], null);
});

test("Boom + Boom clears a 5×5", () => {
  const b = boardFrom(["123456", "234561", "345612", "456123", "561234", "612345"]);
  makeSpecial(b, 2, 2, "boom");
  makeSpecial(b, 2, 3, "boom");
  const a = { r: 2, c: 2 }, d = { r: 2, c: 3 };
  b.swap(a, d);
  const step = b.resolveStep([a, d]);
  assert.equal(step.removed.length, 25);
});

test("a plain swap next to a special is not a special swap", () => {
  const b = boardFrom(["1234", "3412"]);
  makeSpecial(b, 0, 0, "zoomie", "row");
  assert.equal(b.isSpecialSwap({ r: 0, c: 0 }, { r: 0, c: 1 }), false);
});

test("resolveStep returns null on a quiet board", () => {
  assert.equal(boardFrom(["123", "231"]).resolveStep(), null);
});
