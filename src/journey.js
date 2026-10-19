// journey.js — Wifey's journey: the level map trail, worlds, milestones, lifetime
// stats, and the backup/restore sheet.
//
// Levels are grouped into 20-level worlds (the same rhythm as the difficulty sawtooth,
// so every world starts with a breather). The trail is DOM, rendered as a window
// around her current level so level 6,800 is as quick to show as level 1.

import {
  PLAYER, saveProgress, starsFor, totalStars, exportCode, importCode, mergeProgress,
} from "./storage.js";

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
        <button type="button" class="j-icon" data-open="backup" aria-label="Backup">💾</button>
      </div>
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
    const since = progress.level - (progress.backup.lastLevel || 1);
    const reminder = $(".j-reminder");
    reminder.hidden = !(progress.level > 10 && since >= 20);
    reminder.textContent = progress.backup.lastAt
      ? `💾 ${since} levels since your last backup — tap to keep them safe`
      : "💾 Keep your journey safe — tap to send yourself a backup";
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
      html.push(`<button type="button" class="j-node ${state}" data-level="${n}" style="left:${x}%;top:${y}px"
        ${state === "locked" ? "disabled" : ""} aria-label="Level ${n}">${avatar}<span class="j-num">${fmt(n)}</span>${starHtml}${badge}</button>`);
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

  function lastBackupText() {
    const b = progress.backup;
    if (!b.lastAt) return "No backup sent yet.";
    const days = Math.floor((Date.now() - b.lastAt) / 864e5);
    const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
    return `Last backup: level ${fmt(b.lastLevel)}, ${when}.`;
  }

  function openBackup() {
    openSheet(`
      <h2>Keep your journey safe 💕</h2>
      <p>Your progress lives on this phone. Send yourself a backup link — on a new phone,
        just open the link and everything comes back.</p>
      <button type="button" class="j-btn" data-send>Send backup link</button>
      <p class="j-small" data-last>${lastBackupText()}</p>
      <details class="j-restore">
        <summary>Restore from a backup</summary>
        <p class="j-small">Easiest: open the backup link on this phone. Or paste it here:</p>
        <textarea rows="3" placeholder="Paste backup link"></textarea>
        <button type="button" class="j-btn secondary" data-restore>Restore</button>
        <p class="j-small" data-msg></p>
      </details>`);

    sheetCard.querySelector("[data-send]").addEventListener("click", sendBackup);
    sheetCard.querySelector("[data-restore]").addEventListener("click", async () => {
      const text = sheetCard.querySelector("textarea").value;
      const msg = sheetCard.querySelector("[data-msg]");
      try {
        offerRestore(await importCode(text));
      } catch {
        msg.textContent = "Hmm, that doesn't look like a backup link. 🙀";
      }
    });
  }

  async function sendBackup() {
    const button = sheetCard.querySelector("[data-send]");
    const url = `${location.origin}${location.pathname}#restore=${await exportCode(progress)}`;
    const text = `${PLAYER}'s Purrfect Match backup — level ${fmt(progress.level)}, ⭐ ${fmt(totalStars(progress))}. Open this link to restore:`;
    let sent = false;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Purrfect Match backup", text, url });
        sent = true;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return; // she closed the share sheet
    }
    if (!sent) {
      try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        button.textContent = "Copied! Paste it somewhere safe 💌";
        sent = true;
      } catch {
        button.textContent = "Couldn't share — try again";
      }
    }
    if (sent) {
      progress.backup = { lastLevel: progress.level, lastAt: Date.now() };
      saveProgress(progress);
      sheetCard.querySelector("[data-last]").textContent = lastBackupText();
      renderHeader();
    }
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
      lowest = Math.max(1, progress.level - BEHIND);
      refresh();
      openSheet(`<h2>Welcome back, ${PLAYER}! 💕</h2><p>You're on level ${fmt(progress.level)}.</p>
        <button type="button" class="j-btn" data-ok>Let's play</button>`);
      sheetCard.querySelector("[data-ok]").addEventListener("click", closeSheet);
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
    },
    hide() { root.hidden = true; closeSheet(); },
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
