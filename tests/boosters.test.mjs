// Run: node --test tests/*.test.mjs
// Earned boosters: Paw Swipe, Catnip Shuffle, +5 Moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadProgress, recordResult, useBooster, addBooster, mergeProgress, exportCode, importCode, MAX_BOOSTERS,
} from "../src/storage.js";
import { Board } from "../src/board.js";
import { mulberry32 } from "../src/rng.js";

const win = (p, level, movesLeft = 15) => recordResult(p, { level, won: true, score: 5000, movesLeft, moves: 30 });

test("a new save starts with one of each booster", () => {
  assert.deepEqual(loadProgress().boosters, { paw: 1, shuffle: 1, moves: 1 });
});

test("each newly three-starred level earns a booster, taking turns", () => {
  const p = loadProgress();
  assert.deepEqual(win(p, 1).earned, ["paw"]);
  assert.deepEqual(win(p, 1).earned, [], "replaying a 3-star level earns nothing more");
  assert.deepEqual(win(p, 2, 1).earned, [], "1 star earns nothing");
  assert.deepEqual(win(p, 2).earned, ["shuffle"], "improving to 3 stars does");
  assert.deepEqual(win(p, 3).earned, ["moves"]);
  assert.deepEqual(win(p, 4).earned, ["paw"]);
  assert.deepEqual(p.boosters, { paw: 3, shuffle: 2, moves: 2 });
  const lost = recordResult(p, { level: 5, won: false, score: 0, movesLeft: 0, moves: 30 });
  assert.deepEqual(lost.earned, []);
});

test("finishing a world for the first time gifts one of every booster", () => {
  const p = loadProgress();
  p.level = 20; // she's reached level 20
  assert.deepEqual(win(p, 20, 1).earned, ["paw", "shuffle", "moves"]);
  assert.deepEqual(p.boosters, { paw: 2, shuffle: 2, moves: 2 });
  assert.deepEqual(win(p, 20, 1).earned, [], "only the first time");
  p.level = 40;
  assert.deepEqual(win(p, 40).earned, ["paw", "paw", "shuffle", "moves"], "3 stars + world gift");
});

test("using a booster spends one, never below zero; counts are capped", () => {
  const p = loadProgress();
  assert.ok(useBooster(p, "moves"));
  assert.equal(useBooster(p, "moves"), false);
  assert.equal(p.boosters.moves, 0);
  addBooster(p, "paw", 500);
  assert.equal(p.boosters.paw, MAX_BOOSTERS);
});

test("backups carry boosters, and a merge keeps everything earned on either copy", async () => {
  const a = loadProgress();
  addBooster(a, "paw", 4);                        // paw 5
  const back = await importCode(await exportCode(a));
  assert.deepEqual(back.boosters, a.boosters);
  const b = loadProgress();
  addBooster(b, "shuffle", 3);                    // shuffle 4
  assert.deepEqual(mergeProgress(a, b).boosters, { paw: 5, shuffle: 4, moves: 1 });
  assert.deepEqual(mergeProgress(b, a).boosters, { paw: 5, shuffle: 4, moves: 1 });
  // An old save with no boosters field merges cleanly.
  const old = { ...loadProgress(), boosters: undefined };
  assert.equal(mergeProgress(a, old).boosters.paw, 5);
});

test("a booster used on the phone stays used when an older cloud copy merges in", async () => {
  const cloud = loadProgress();
  addBooster(cloud, "moves", 2);                  // 3 +5 Moves, synced to the cloud
  const phone = await importCode(await exportCode(cloud));
  assert.ok(useBooster(phone, "moves"));          // she spends one offline → 2
  const merged = mergeProgress(phone, await importCode(await exportCode(cloud)));
  assert.equal(merged.boosters.moves, 2);
  assert.equal(mergeProgress(cloud, phone).boosters.moves, 2);
  // …and syncing the merged copy back again changes nothing.
  assert.deepEqual(mergeProgress(merged, merged).boosters, merged.boosters);
});

test("old saves with a stash but no log keep the stash", async () => {
  const back = await importCode("j" + Buffer.from(JSON.stringify({ level: 9, boosters: { paw: 4, shuffle: 0, moves: 2 } })).toString("base64url"));
  assert.deepEqual(back.boosters, { paw: 4, shuffle: 0, moves: 2 });
  assert.deepEqual(back.boosterLog.earned, { paw: 4, shuffle: 0, moves: 2 });
});

test("junk booster values in a save are ignored", async () => {
  const p = loadProgress();
  p.boosters = { paw: -3, shuffle: "lots", moves: 2.5 };
  const back = await importCode(await exportCode(p));
  assert.deepEqual(back.boosters, { paw: 1, shuffle: 1, moves: 1 });
});

function boardFrom(lines) {
  const mask = lines.map((line) => [...line].map((ch) => ch !== "."));
  const tiles = lines.map((line) => [...line].map((ch) => (/\d/.test(ch) ? Number(ch) : null)));
  return new Board(mask, tiles, 6, mulberry32(1));
}

test("Paw Swipe clears exactly the tile it touches", () => {
  const b = boardFrom(["123", "456", "123"]);
  const hit = b.get(1, 1);
  const step = b.resolveStep(null, { r: 1, c: 1 });
  assert.deepEqual(step.removed.map(({ r, c, tile }) => [r, c, tile.id]), [[1, 1, hit.id]]);
  assert.deepEqual(step.groups, []);
  assert.equal(b.get(1, 1), null);
  assert.equal(b.get(0, 0).color, 1, "neighbours untouched");
});

test("Paw Swipe on a special sets it off", () => {
  const b = boardFrom(["1234", "5612", "3456"]);
  Object.assign(b.grid[1][1], { special: "zoomie", dir: "row" });
  const step = b.resolveStep(null, { r: 1, c: 1 });
  assert.equal(step.removed.length, 4, "the whole row");
  assert.equal(step.blasts[0].special, "zoomie");
});

test("Paw Swipe can't take a fish treat", () => {
  const mask = [[true, true], [true, true]];
  const b = new Board(mask, [[1, 2], [null, 3]], 6, mulberry32(1), { fish: [{ r: 1, c: 0 }], fishTotal: 1 });
  assert.equal(b.canPaw(1, 0), false);
  assert.equal(b.canPaw(0, 0), true);
  assert.equal(b.resolveStep(null, { r: 1, c: 0 }), null);
});
