// storage.js — progress in localStorage: current level, stars, bests, settings.
// Includes export/import (share code) so a new phone keeps her progress. M3.
//
// Save format v2 (v1 was just { level }):
//   level      highest unlocked level (the one she's "on")
//   stars      string, one char per level: "0" not yet won, "1".."3" best stars
//   stats      lifetime numbers for the journey screen
//   backup     when/at which level the last backup was sent
//   boosters   earned (never bought) booster counts: { paw, shuffle, moves }
//   boosterLog lifetime { earned, spent } per booster, so merging two copies (cloud
//              sync) can't hand back a booster she already used
//   syncId     random id for automatic cloud backup (cloud.js); cloud = last sync
//
// Every storage access is wrapped — private mode or blocked storage must never stop
// the game from starting. Backups are compressed into a URL-safe code that restores
// by opening a link, and restoring always merges (it can never lose progress).

const KEY = "purrfect-match:save";
export const PLAYER = "Wifey";

// Boosters are earned, never bought: one for every level she first three-stars
// (taking turns Paw Swipe → Catnip Shuffle → +5 Moves), and one of each as a gift
// when she finishes a world. No lives, no energy, no shop.
export const BOOSTERS = ["paw", "shuffle", "moves"];
export const MAX_BOOSTERS = 99;
const WORLD_SIZE = 20; // matches journey.js

const today = () => new Date().toISOString().slice(0, 10);

function fresh() {
  return {
    version: 2,
    level: 1,
    stars: "",
    stats: {
      wins: 0,
      plays: 0,
      cats: 0,
      bestCascade: 0,
      bestScore: 0,
      threeStars: 0,
      daysPlayed: 0,
      dayStreak: 0,
      bestDayStreak: 0,
      lastDay: null,
      firstDay: today(),
    },
    backup: { lastLevel: 1, lastAt: null },
    // One of each to start, so she meets them before she's earned any.
    boosters: { paw: 1, shuffle: 1, moves: 1 },
    boosterLog: { earned: { paw: 1, shuffle: 1, moves: 1 }, spent: { paw: 0, shuffle: 0, moves: 0 } },
    syncId: null,
    cloud: { lastAt: null, lastLevel: 0 },
    updatedAt: 0,
  };
}

// Accepts anything that looks like a save (v1, v2, or partial) and returns a clean v2.
function normalize(raw) {
  const p = fresh();
  if (!raw || typeof raw !== "object") return p;
  if (Number.isInteger(raw.level) && raw.level >= 1) p.level = raw.level;
  if (typeof raw.stars === "string" && /^[0-3]*$/.test(raw.stars)) p.stars = raw.stars;
  if (raw.stats && typeof raw.stats === "object") {
    for (const k of Object.keys(p.stats)) if (raw.stats[k] != null) p.stats[k] = raw.stats[k];
  }
  if (raw.backup && typeof raw.backup === "object") Object.assign(p.backup, raw.backup);
  if (raw.boosters && typeof raw.boosters === "object") {
    for (const k of BOOSTERS) {
      const v = raw.boosters[k];
      if (Number.isInteger(v) && v >= 0) p.boosters[k] = Math.min(v, MAX_BOOSTERS);
    }
  }
  // The log: older saves have none, so their stash counts as earned. If the count and
  // the log ever disagree, the count wins and the log is squared up to match it.
  const count = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
  const log = raw.boosterLog && typeof raw.boosterLog === "object" ? raw.boosterLog : null;
  for (const k of BOOSTERS) {
    let earned = count(log?.earned?.[k]) ?? p.boosters[k];
    let spent = count(log?.spent?.[k]) ?? 0;
    const drift = p.boosters[k] - (earned - spent);
    if (drift > 0) earned += drift; else spent -= drift;
    p.boosterLog.earned[k] = earned;
    p.boosterLog.spent[k] = spent;
  }
  if (/^[0-9a-f]{32}$/.test(String(raw.syncId || ""))) p.syncId = raw.syncId;
  if (raw.cloud && typeof raw.cloud === "object") Object.assign(p.cloud, raw.cloud);
  if (Number.isFinite(raw.updatedAt)) p.updatedAt = raw.updatedAt;
  return p;
}

export function loadProgress() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return fresh();
  }
}

export function saveProgress(progress) {
  progress.updatedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // storage unavailable: progress lasts for this session only
  }
}

// Ask the browser not to evict our storage under pressure. Installed PWAs on Chrome
// usually get this automatically; it's free to ask.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // not supported — fine
  }
}

// --- Stars ---------------------------------------------------------------------

export function starsFor(progress, n) {
  return Number(progress.stars[n - 1] || 0);
}

export function totalStars(progress) {
  let sum = 0;
  for (const ch of progress.stars) sum += Number(ch);
  return sum;
}

// 3 stars: finish with 30%+ of the moves left; 2 stars: 12%+; otherwise 1.
export function starsForResult(movesLeft, moves) {
  const spare = movesLeft / moves;
  return spare >= 0.3 ? 3 : spare >= 0.12 ? 2 : 1;
}

// --- Recording play ---------------------------------------------------------------

// Call when a level starts: counts the play and keeps the daily streak.
export function recordPlay(progress) {
  const s = progress.stats;
  s.plays++;
  const d = today();
  if (s.lastDay !== d) {
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    s.dayStreak = s.lastDay === yesterday ? s.dayStreak + 1 : 1;
    s.bestDayStreak = Math.max(s.bestDayStreak, s.dayStreak);
    s.daysPlayed++;
    s.lastDay = d;
  }
}

// Call when a level ends. Returns what's new, for the result dialog.
export function recordResult(progress, { level, won, score, movesLeft, moves, cats, bestCascade }) {
  const s = progress.stats;
  s.cats += cats || 0;
  s.bestCascade = Math.max(s.bestCascade, bestCascade || 0);
  if (!won) return { stars: 0, newBest: false, firstWin: false, improved: false, earned: [] };

  const stars = starsForResult(movesLeft, moves);
  const before = starsFor(progress, level);
  const firstWin = before === 0;
  const earned = [];
  if (stars > before) {
    const arr = progress.stars.padEnd(level, "0").split("");
    arr[level - 1] = String(stars);
    progress.stars = arr.join("");
    if (stars === 3) {
      s.threeStars++;
      earned.push(BOOSTERS[(s.threeStars - 1) % BOOSTERS.length]);
    }
  }
  if (firstWin && level % WORLD_SIZE === 0) earned.push(...BOOSTERS);
  for (const k of earned) addBooster(progress, k);
  if (firstWin) s.wins++;
  const newBest = score > s.bestScore;
  if (newBest) s.bestScore = score;
  progress.level = Math.max(progress.level, level + 1);
  return { stars, newBest, firstWin, improved: stars > before && !firstWin, earned };
}

// --- Boosters -----------------------------------------------------------------------

export function addBooster(progress, kind, n = 1) {
  const have = progress.boosters[kind] || 0;
  const add = Math.max(0, Math.min(MAX_BOOSTERS, have + n) - have);
  progress.boosters[kind] = have + add;
  if (progress.boosterLog) progress.boosterLog.earned[kind] += add;
}

// Spends one if she has it; returns whether it was spent.
export function useBooster(progress, kind) {
  if (!(progress.boosters[kind] > 0)) return false;
  progress.boosters[kind]--;
  if (progress.boosterLog) progress.boosterLog.spent[kind]++;
  return true;
}

// --- Backup codes -------------------------------------------------------------------

const b64url = {
  encode(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// "z…" = deflate-compressed JSON, "j…" = plain JSON (browsers without CompressionStream).
export async function exportCode(progress) {
  const json = new TextEncoder().encode(JSON.stringify({ ...progress, exportedAt: Date.now() }));
  if (typeof CompressionStream !== "undefined") {
    return "z" + b64url.encode(await pipe(json, new CompressionStream("deflate-raw")));
  }
  return "j" + b64url.encode(json);
}

export async function importCode(code) {
  const raw = String(code).trim().replace(/^.*#restore=/, "");
  const body = b64url.decode(raw.slice(1));
  const bytes = raw[0] === "z" ? await pipe(body, new DecompressionStream("deflate-raw")) : body;
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || !Number.isInteger(parsed.level)) throw new Error("Not a Purrfect Match backup");
  return normalize(parsed);
}

// Restoring never loses anything: highest level, best stars per level, best stats.
export function mergeProgress(a, b) {
  const out = normalize(a);
  out.level = Math.max(a.level, b.level);
  const len = Math.max(a.stars.length, b.stars.length);
  let stars = "";
  for (let i = 0; i < len; i++) stars += String(Math.max(Number(a.stars[i] || 0), Number(b.stars[i] || 0)));
  out.stars = stars;
  for (const k of Object.keys(out.stats)) {
    const x = a.stats[k], y = b.stats[k];
    if (typeof x === "number" && typeof y === "number") out.stats[k] = Math.max(x, y);
  }
  if (b.stats.firstDay && (!a.stats.firstDay || b.stats.firstDay < a.stats.firstDay)) out.stats.firstDay = b.stats.firstDay;
  out.backup.lastLevel = Math.max(a.backup.lastLevel || 1, b.backup.lastLevel || 1);
  out.backup.lastAt = Math.max(a.backup.lastAt || 0, b.backup.lastAt || 0) || null;
  // Boosters: the most ever earned minus the most ever spent, per kind — so a booster
  // earned on either copy is kept, and one used on either copy stays used.
  const nb = normalize(b);
  for (const k of BOOSTERS) {
    const earned = Math.max(out.boosterLog.earned[k], nb.boosterLog.earned[k]);
    const spent = Math.max(out.boosterLog.spent[k], nb.boosterLog.spent[k]);
    out.boosterLog.earned[k] = earned;
    out.boosterLog.spent[k] = spent;
    out.boosters[k] = Math.max(0, Math.min(MAX_BOOSTERS, earned - spent));
  }
  out.syncId = a.syncId || nb.syncId;
  out.cloud.lastAt = Math.max(a.cloud?.lastAt || 0, nb.cloud.lastAt || 0) || null;
  return out;
}
