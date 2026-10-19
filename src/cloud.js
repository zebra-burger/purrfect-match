// cloud.js — automatic backup to the game's own Cloudflare Worker (worker/index.js).
//
// The phone picks a random sync id once and keeps it in the save. Whenever it's
// online it pulls the cloud copy, merges it in (mergeProgress never loses anything),
// and pushes the merged result back — so two phones sharing an id converge, and a new
// phone that opens her journey link (#sync=<id>) gets everything back.
//
// Everything here fails quietly: offline, blocked or slow, the game carries on and
// the next sync catches up.

import { exportCode, importCode, mergeProgress, saveProgress } from "./storage.js";

// Same address as the game when it's served from orangezebra.cloud; absolute elsewhere
// (local testing, or the old GitHub Pages copy while it forwards people over).
export const SYNC_URL = (typeof location !== "undefined" && location.hostname === "orangezebra.cloud")
  ? "/v1/save/" : "https://orangezebra.cloud/v1/save/";
const ID_RE = /^[0-9a-f]{32}$/;
const TIMEOUT_MS = 8000;

export const isSyncId = (id) => ID_RE.test(String(id || ""));

export function ensureSyncId(progress) {
  if (!isSyncId(progress.syncId)) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    progress.syncId = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    saveProgress(progress);
  }
  return progress.syncId;
}

// The link that brings her journey to a new phone.
export function journeyLink(progress) {
  return `${location.origin}${location.pathname}#sync=${ensureSyncId(progress)}`;
}

async function request(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

let inFlight = null;

// Pull → merge → push. Resolves to { ok, pulled } and never throws.
// Overlapping calls share one sync.
export function syncNow(progress) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false };
    const id = ensureSyncId(progress);
    try {
      let pulled = false;
      const res = await request(SYNC_URL + id);
      if (res.status === 200) {
        const remote = await res.json();
        const theirs = await importCode(remote.code);
        const before = progress.level;
        Object.assign(progress, mergeProgress(progress, theirs), { syncId: id });
        pulled = progress.level > before;
      } else if (res.status !== 204 && res.status !== 404) {
        return { ok: false };
      }
      const code = await exportCode(progress);
      const put = await request(SYNC_URL + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, level: progress.level }),
      });
      if (!put.ok) return { ok: false };
      progress.cloud = { lastAt: Date.now(), lastLevel: progress.level };
      saveProgress(progress);
      return { ok: true, pulled };
    } catch {
      return { ok: false };
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}

// Adopt a journey link's id (new phone), then pull everything down.
export async function joinJourney(progress, id) {
  if (!isSyncId(id)) return { ok: false };
  progress.syncId = id;
  saveProgress(progress);
  return syncNow(progress);
}
