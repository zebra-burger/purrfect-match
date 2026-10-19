// storage.js — progress in localStorage: current level, stars, bests, settings.
// Includes export/import (share code) so a new phone keeps her progress. M3.
//
// Save format v2 (v1 was just { level }):
//   level      highest unlocked level (the one she's "on")
//   stars      string, one char per level: "0" not yet won, "1".."3" best stars
//   stats      lifetime numbers for the journey screen
//   backup     when/at which level the last backup was sent
//
// Every storage access is wrapped — private mode or blocked storage must never stop
// the game from starting. Backups are compressed into a URL-safe code that restores
// by opening a link, and restoring always merges (it can never lose progress).

const KEY = "purrfect-match:save";
export const PLAYER = "Wifey";

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
  if (!won) return { stars: 0, newBest: false, firstWin: false, improved: false };

  const stars = starsForResult(movesLeft, moves);
  const before = starsFor(progress, level);
  const firstWin = before === 0;
  if (stars > before) {
    const arr = progress.stars.padEnd(level, "0").split("");
    arr[level - 1] = String(stars);
    progress.stars = arr.join("");
    if (stars === 3) s.threeStars++;
  }
  if (firstWin) s.wins++;
  const newBest = score > s.bestScore;
  if (newBest) s.bestScore = score;
  progress.level = Math.max(progress.level, level + 1);
  return { stars, newBest, firstWin, improved: stars > before && !firstWin };
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
  return out;
}
