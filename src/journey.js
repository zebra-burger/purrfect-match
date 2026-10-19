// journey.js — Wifey's journey: the level map trail, worlds, milestones, lifetime
// stats, and the backup/restore sheet.
//
// Levels are grouped into 20-level worlds (the same rhythm as the difficulty sawtooth,
// so every world starts with a breather). The trail is DOM, rendered as a window
// around her current level so level 6,800 is as quick to show as level 1.

import {
  PLAYER, saveProgress, starsFor, totalStars, importCode, mergeProgress,
} from "./storage.js";
import { generateLevel } from "./generator.js";
import { account, renderSignIn, signOut, syncNow } from "./cloud.js";
import { GOAL_ICONS } from "./ui.js";

// Goal icons for a level ("🧶", "🐟📦"…), memoized — levels never change.
const goalIconCache = new Map();
function goalIcons(n) {
  if (!goalIconCache.has(n)) {
    const { targets } = generateLevel(n);
    goalIconCache.set(n, Object.keys(targets).map((k) => GOAL_ICONS[k]).join(""));
  }
  return goalIconCache.get(n);
}

export const WORLD_SIZE = 20;

const WORLD_NAMES = [
  "Catnip Meadow", "Yarn Valley", "Tuna Bay", "Whisker Woods", "Pawprint Park",
  "Cushion Castle", "Sunbeam Sill", "Purrple Palace", "Ribbon River", "Mittens Mountain",
  "Biscuit Bakery", "Feather Forest", "Moonlight Rooftops", "Velvet Garden", "Sardine Seaside",
  "Snuggle Sands", "Bell Tower Bay", "Kitten Kingdom", "Lavender Lane", "Cloud Nine Cattery",
];

const ROMAN = ["", " II", " III", " IV", " V", " VI", " VII", " VIII", " IX", " X"];

export function worldOf(level) {
  const index = Math.floor((level - 1) / WORLD_SIZE);
  const lap = Math.floor(index / WORLD_NAMES.length);
  const name = WORLD_NAMES[index % WORLD_NAMES.length] + (ROMAN[lap] ?? ` ${lap + 1}`);
  return { number: index + 1, name, first: index * WORLD_SIZE + 1, last: (index + 1) * WORLD_SIZE };
}

// Candy Crush is where she was when this game was made — passing it deserves a party.
const CANDY_LEVEL = 6800;
const MILESTONES = new Set([10, 25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, CANDY_LEVEL, 7000, 8000, 9000, 10000]);

export function isMilestone(level) {
  return MILESTONES.has(level) || (level > 10000 && level % 5000 === 0);
}

// A message for finishing `level` for the first time, or null.
export function milestoneMessage(level) {
  const fmt = level.toLocaleString("en-US");
  if (level === CANDY_LEVEL) return `Level ${fmt} — you've caught up with Candy Crush, ${PLAYER}! Everything from here is brand new territory. 🍬➡️🐾`;
  if (level === 10) return `Ten levels in, ${PLAYER}! The kitties are very impressed.`;
  if (level === 100) return `Level 100, ${PLAYER}! Triple digits. 💯`;
  if (level === 1000) return `LEVEL 1,000! ${PLAYER}, you are a legend among cats. 👑`;
  if (isMilestone(level)) return `Level ${fmt}! What a journey, ${PLAYER}. 💕`;
  if (level % WORLD_SIZE === 0) {
    const done = worldOf(level), next = worldOf(level + 1);
    return `${done.name} complete! Next stop: ${next.name}. ✨`;
  }
  return null;
}

const fmt = (n) => Number(n).toLocaleString("en-US");
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const ROW = 92;          // px per level on the trail
const BANNER = 74;       // px per world banner
const AHEAD = 12;        // locked levels shown above the current one
const BEHIND = 60;       // finished levels shown below before "show earlier"

export function createJourney({ progress, onPlay, catSvg }) {
  const root = document.createElement("div");
  root.id = "journey";
  root.hidden = true;
  root.innerHTML = `
    <header class="j-head">
      <div class="j-title">
        <span class="j-hello">${PLAYER}'s Journey</span>
        <button type="button" class="j-icon" data-open="backup" aria-label="Backup">☁️</button>
      </div>
      <button type="button" class="j-cloud" data-open="backup" data-cloud></button>
      <button type="button" class="j-chips" data-open="stats" aria-label="Journey stats">
        <span class="chip"><b data-stars></b><small>stars</small></span>
        <span class="chip"><b data-done></b><small>levels</small></span>
        <span class="chip"><b data-streak></b><small>day streak</small></span>
      </button>
      <button type="button" class="j-reminder" data-open="backup" hidden></button>
    </header>
    <div class="j-scroll"><div class="j-trail"></div></div>
    <div class="j-foot"><button type="button" class="j-play"></button></div>
    <div class="j-sheet" hidden><div class="j-sheet-card"></div></div>`;
  document.body.append(root);

  const $ = (sel) => root.querySelector(sel);
  const scroll = $(".j-scroll");
  const trail = $(".j-trail");
  const sheet = $(".j-sheet");
  const sheetCard = $(".j-sheet-card");
  let lowest = 1;

  $(".j-play").addEventListener("click", () => onPlay(progress.level));
  root.querySelectorAll("[data-open]").forEach((el) =>
    el.addEventListener("click", () => (el.dataset.open === "stats" ? openStats() : openBackup())));
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

  function renderHeader() {
    const s = progress.stats;
    $("[data-stars]").textContent = `⭐ ${fmt(totalStars(progress))}`;
    $("[data-done]").textContent = `🐾 ${fmt(progress.level - 1)}`;
    $("[data-streak]").textContent = `🔥 ${s.dayStreak}`;
    $(".j-play").textContent = `Play level ${fmt(progress.level)}`;
    // The cloud copy is automatic; the one thing she has to do once is keep her
    // journey link somewhere (it's how a new phone finds her progress).
    const reminder = $(".j-reminder");
    reminder.hidden = !(progress.level > 3 && !account());
    reminder.textContent = "☁️ Sign in with Google to keep your journey safe";
    renderCloud();
  }

  function ago(t) {
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }

  function cloudText() {
    const c = progress.cloud;
    if (!account()) return "📱 Saved on this phone · sign in to back up";
    if (navigator.onLine === false) return "📱 Saved on this phone · backs up when you're online";
    if (c.lastAt && c.lastLevel >= progress.level) return `☁️ Backed up ${ago(c.lastAt)}`;
    return "📱 Saved on this phone · backing up…";
  }

  function renderCloud() {
    $("[data-cloud]").textContent = cloudText();
    const inSheet = sheetCard.querySelector("[data-cloud-status]");
    if (inSheet) inSheet.textContent = cloudText();
  }

  function renderTrail() {
    const current = progress.level;
    const top = current + AHEAD;
    if (lowest > current) lowest = Math.max(1, current - BEHIND);
    const items = []; // top → bottom
    for (let n = top; n >= lowest; n--) {
      items.push({ kind: "level", n });
      if ((n - 1) % WORLD_SIZE === 0) items.push({ kind: "world", world: worldOf(n) });
    }

    let y = 30;
    const points = [];
    const html = [];
    for (const item of items) {
      if (item.kind === "world") {
        const w = item.world;
        html.push(`<div class="j-world" style="top:${y}px"><small>World ${fmt(w.number)}</small>${w.name}</div>`);
        y += BANNER;
        continue;
      }
      const n = item.n;
      const x = 50 + Math.sin(n * 0.85) * 26;
      points.push([x, y + 28]);
      const state = n < current ? "done" : n === current ? "current" : "locked";
      const stars = starsFor(progress, n);
      const starHtml = state === "done"
        ? `<span class="j-stars">${"★".repeat(stars)}<i>${"★".repeat(3 - stars)}</i></span>` : "";
      const badge = n === CANDY_LEVEL ? `<span class="j-badge">🍬 Candy Crush level</span>`
        : isMilestone(n) ? `<span class="j-badge">🏆</span>` : "";
      const avatar = state === "current" ? `<span class="j-avatar">${catSvg}</span>` : "";
      const goal = state !== "done" ? `<span class="j-goal">${goalIcons(n)}</span>` : "";
      html.push(`<button type="button" class="j-node ${state}" data-level="${n}" style="left:${x}%;top:${y}px"
        ${state === "locked" ? "disabled" : ""} aria-label="Level ${n}">${avatar}<span class="j-num">${fmt(n)}</span>${starHtml}${goal}${badge}</button>`);
      y += ROW;
    }
    if (lowest > 1) {
      html.push(`<button type="button" class="j-earlier" style="top:${y}px">Show earlier levels</button>`);
      y += 70;
    }
    const d = points.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join(" ");
    trail.style.height = `${y + 20}px`;
    trail.innerHTML = `<svg class="j-path" viewBox="0 0 100 ${y + 20}" preserveAspectRatio="none">
      <path d="${d}" vector-effect="non-scaling-stroke"/></svg>` + html.join("");

    trail.querySelectorAll(".j-node:not(.locked)").forEach((el) =>
      el.addEventListener("click", () => onPlay(Number(el.dataset.level))));
    const earlier = trail.querySelector(".j-earlier");
    if (earlier) earlier.addEventListener("click", () => {
      const keep = scroll.scrollHeight - scroll.scrollTop;
      lowest = Math.max(1, lowest - BEHIND);
      renderTrail();
      scroll.scrollTop = scroll.scrollHeight - keep;
    });
  }

  function scrollToCurrent() {
    const node = trail.querySelector(".j-node.current");
    if (node) scroll.scrollTop = node.offsetTop - scroll.clientHeight * 0.55;
  }

  // --- Sheets ---

  function openSheet(html) {
    sheetCard.innerHTML = `<button type="button" class="j-close" aria-label="Close">×</button>${html}`;
    sheetCard.querySelector(".j-close").addEventListener("click", closeSheet);
    sheet.hidden = false;
  }

  function closeSheet() { sheet.hidden = true; }

  function openStats() {
    const s = progress.stats;
    const w = worldOf(progress.level);
    const since = s.firstDay ? new Date(s.firstDay + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "today";
    const rows = [
      ["🐾", "Levels completed", fmt(progress.level - 1)],
      ["⭐", "Stars collected", fmt(totalStars(progress))],
      ["🌟", "Three-star levels", fmt(s.threeStars)],
      ["🐱", "Kitties matched", fmt(s.cats)],
      ["🌍", "Current world", `${fmt(w.number)} · ${w.name}`],
      ["💥", "Biggest cascade", s.bestCascade ? `${s.bestCascade}×` : "—"],
      ["🏅", "Best level score", fmt(s.bestScore)],
      ["🔥", "Day streak (best)", `${s.dayStreak} (${s.bestDayStreak})`],
      ["📅", "Days played", fmt(s.daysPlayed)],
      ["💕", "Playing since", since],
    ];
    const next = [...MILESTONES].find((m) => m >= progress.level);
    openSheet(`
      <h2>${PLAYER}'s Journey</h2>
      <ul class="j-stats">${rows.map(([i, k, v]) => `<li><span>${i} ${k}</span><b>${v}</b></li>`).join("")}</ul>
      ${next ? `<p class="j-next">Next milestone: <b>level ${fmt(next)}</b>${next === CANDY_LEVEL ? " — your Candy Crush level 🍬" : ""}, ${fmt(next - progress.level + 1)} to go</p>` : ""}`);
  }

  function openBackup() {
    const me = account();
    openSheet(me ? `
      <h2>Your journey is safe 💕</h2>
      <p>Every level saves on this phone straight away — no button to press — and backs
        up to the cloud by itself whenever you're online.</p>
      <p class="j-status" data-cloud-status>${cloudText()}</p>
      <p>Signed in as <b>${escapeHtml(me.email)}</b>. Getting a new phone? Just sign in
        with Google there and everything comes back.</p>
      <button type="button" class="j-link" data-signout>Sign out of this phone</button>`
    : `
      <h2>Keep your journey safe 💕</h2>
      <p>Every level already saves on this phone — no button to press, online or offline.</p>
      <p>Sign in with Google and it also backs up to the cloud by itself. On a new phone,
        sign in again and everything comes back.</p>
      <div class="j-google" data-google></div>
      <p class="j-small" data-msg></p>
      <details class="j-restore">
        <summary>Bring back an old backup link</summary>
        <textarea rows="3" placeholder="Paste the backup link"></textarea>
        <button type="button" class="j-btn secondary" data-restore>Bring it back</button>
        <p class="j-small" data-restore-msg></p>
      </details>`);

    if (me) {
      sheetCard.querySelector("[data-signout]").addEventListener("click", async () => {
        await signOut();
        renderHeader();
        openBackup();
      });
      syncNow(progress).then(renderCloud);
      return;
    }
    renderSignIn(sheetCard.querySelector("[data-google]"), progress, afterSignIn);
    sheetCard.querySelector("[data-restore]").addEventListener("click", async () => {
      const text = sheetCard.querySelector("textarea").value.trim();
      try {
        offerRestore(await importCode(text));
      } catch {
        sheetCard.querySelector("[data-restore-msg]").textContent = "Hmm, that doesn't look like a backup link. 🙀";
      }
    });
  }

  // What happens once Google sign-in finishes (from the backup sheet or the welcome card).
  function afterSignIn(result) {
    if (!result.ok) {
      const msg = sheetCard.querySelector("[data-msg]");
      if (msg) msg.textContent = result.error || "Couldn't reach the cloud — your progress is still safe on this phone.";
      return;
    }
    if (result.pulled) return welcomeBack();
    renderHeader();
    openSheet(`<h2>All set! ☁️</h2><p>Your journey now backs up by itself, ${PLAYER}.</p>
      <button type="button" class="j-btn" data-ok>Let's play</button>`);
    sheetCard.querySelector("[data-ok]").addEventListener("click", closeSheet);
  }

  // A phone that has never played and isn't signed in: she may be coming back on a new
  // phone, so offer to bring her journey back before she starts again from level 1.
  const isFreshPhone = () => !account() && progress.level === 1 && !progress.stars.replace(/0/g, "")
    && !progress.stats.plays;

  function openWelcome() {
    openSheet(`
      <h2>Welcome, ${PLAYER}! 💕</h2>
      <p>Played before on another phone? Sign in with Google and your whole journey
        comes back — levels, stars and boosters.</p>
      <div class="j-google" data-google></div>
      <p class="j-small" data-msg></p>
      <button type="button" class="j-btn secondary" data-fresh>Start a new journey</button>
      <p class="j-small">You can sign in any time from ☁️ on the map. Your progress always
        saves on this phone, even offline.</p>`);
    sheetCard.querySelector("[data-fresh]").addEventListener("click", closeSheet);
    renderSignIn(sheetCard.querySelector("[data-google]"), progress, afterSignIn);
  }

  function welcomeBack() {
    lowest = Math.max(1, progress.level - BEHIND);
    refresh();
    openSheet(`<h2>Welcome back, ${PLAYER}! 💕</h2><p>You're on level ${fmt(progress.level)}.</p>
      <button type="button" class="j-btn" data-ok>Let's play</button>`);
    sheetCard.querySelector("[data-ok]").addEventListener("click", closeSheet);
  }

  // Confirm, then merge a backup into this phone's progress (never loses anything).
  function offerRestore(backup) {
    openSheet(`
      <h2>Restore journey?</h2>
      <p>Backup: <b>level ${fmt(backup.level)}</b>, ⭐ ${fmt(totalStars(backup))}<br>
        This phone: <b>level ${fmt(progress.level)}</b>, ⭐ ${fmt(totalStars(progress))}</p>
      <p class="j-small">They'll be combined — you keep the best of both.</p>
      <button type="button" class="j-btn" data-yes>Restore</button>
      <button type="button" class="j-btn secondary" data-no>Not now</button>`);
    sheetCard.querySelector("[data-no]").addEventListener("click", closeSheet);
    sheetCard.querySelector("[data-yes]").addEventListener("click", () => {
      Object.assign(progress, mergeProgress(progress, backup));
      saveProgress(progress);
      syncNow(progress).then(renderCloud);
      welcomeBack();
    });
  }

  function refresh() {
    renderHeader();
    renderTrail();
    requestAnimationFrame(scrollToCurrent);
  }

  return {
    show() {
      root.hidden = false;
      refresh();
      if (isFreshPhone() && sheet.hidden) openWelcome();
    },
    hide() { root.hidden = true; closeSheet(); },
    // After a background sync: redraw if she's looking at the map.
    synced({ pulled } = {}) {
      if (root.hidden) return;
      if (pulled) refresh(); else renderCloud();
    },

    // Called at boot when the page was opened from a backup link.
    async restoreFromLink(code) {
      try {
        const backup = await importCode(code);
        root.hidden = false;
        refresh();
        offerRestore(backup);
        return true;
      } catch {
        return false;
      }
    },
  };
}
