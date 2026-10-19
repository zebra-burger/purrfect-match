// Run: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadProgress, recordResult, recordPlay, starsFor, totalStars, starsForResult,
  exportCode, importCode, mergeProgress,
} from "../src/storage.js";

// loadProgress falls back to a fresh save when localStorage is missing (as in Node).
const fresh = () => loadProgress();

test("stars come from moves to spare", () => {
  assert.equal(starsForResult(10, 30), 3);
  assert.equal(starsForResult(4, 30), 2);
  assert.equal(starsForResult(0, 30), 1);
});

test("winning unlocks the next level and keeps the best stars", () => {
  const p = fresh();
  const r1 = recordResult(p, { level: 1, won: true, score: 5000, movesLeft: 2, moves: 30, cats: 90, bestCascade: 3 });
  assert.equal(r1.stars, 1);
  assert.ok(r1.firstWin);
  assert.equal(p.level, 2);
  const r2 = recordResult(p, { level: 1, won: true, score: 6000, movesLeft: 15, moves: 30, cats: 80 });
  assert.equal(r2.stars, 3);
  assert.ok(r2.improved);
  recordResult(p, { level: 1, won: true, score: 100, movesLeft: 0, moves: 30 });
  assert.equal(starsFor(p, 1), 3, "a worse replay never lowers stars");
  assert.equal(p.stats.wins, 1);
  assert.equal(p.stats.cats, 170);
  assert.equal(p.stats.bestCascade, 3);
});

test("losing records stats but unlocks nothing", () => {
  const p = fresh();
  recordResult(p, { level: 1, won: false, score: 10, movesLeft: 0, moves: 30, cats: 12 });
  assert.equal(p.level, 1);
  assert.equal(totalStars(p), 0);
  assert.equal(p.stats.cats, 12);
});

test("day streak counts each day once", () => {
  const p = fresh();
  recordPlay(p); recordPlay(p);
  assert.equal(p.stats.daysPlayed, 1);
  assert.equal(p.stats.dayStreak, 1);
  assert.equal(p.stats.plays, 2);
});

test("backup codes round-trip, even for a long journey", async () => {
  const p = fresh();
  p.level = 6801;
  p.stars = Array.from({ length: 6800 }, (_, i) => String(1 + (i % 3))).join("");
  p.stats.cats = 1234567;
  const code = await exportCode(p);
  assert.ok(code.length < 8000, `code is ${code.length} chars`);
  const back = await importCode(`https://example.test/#restore=${code}`);
  assert.equal(back.level, 6801);
  assert.equal(back.stars, p.stars);
  assert.equal(back.stats.cats, 1234567);
});

test("restoring merges and never loses progress", () => {
  const phone = fresh(); phone.level = 40; phone.stars = "3310";
  const backup = fresh(); backup.level = 25; backup.stars = "1233"; backup.stats.cats = 999;
  const m = mergeProgress(phone, backup);
  assert.equal(m.level, 40);
  assert.equal(m.stars, "3333");
  assert.equal(m.stats.cats, 999);
});

test("old v1 saves upgrade cleanly", async () => {
  const back = await importCode("j" + Buffer.from(JSON.stringify({ level: 12 })).toString("base64url"));
  assert.equal(back.level, 12);
  assert.equal(back.stars, "");
  assert.equal(back.version, 2);
});
