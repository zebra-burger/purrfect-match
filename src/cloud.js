// cloud.js — automatic backup to the game's own Cloudflare Worker (worker/index.js),
// tied to her Google account.
//
// Sign in with Google once per phone; the Worker checks Google's token and hands back
// a long-lived session token that stays on this phone (never inside backups or links).
// From then on, whenever she's online, the phone pulls the cloud copy, merges it in
// (mergeProgress never loses anything) and pushes the merged result back. A new phone
// just signs in with the same Google account and everything comes back.
//
// Everything here fails quietly: offline, blocked or slow, the game carries on and the
// next sync catches up. Saving on the phone never waits for the network.

import { importCode, exportCode, mergeProgress, saveProgress } from "./storage.js";

// OAuth client id from Google Cloud (public; see README → "Google sign-in").
export const GOOGLE_CLIENT_ID = "249622716840-bmm76uh8a4i8ajm8lguluh2oris8aqdo.apps.googleusercontent.com";

const API = (typeof location !== "undefined" && location.hostname === "orangezebra.cloud")
  ? "/v1/" : "https://orangezebra.cloud/v1/";
const SESSION_KEY = "purrfect-match:session";
const TIMEOUT_MS = 8000;

// --- Session (this phone's sign-in) ---------------------------------------------------

export function account() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    return s && /^[0-9a-f]{64}$/.test(s.token) ? s : null;
  } catch {
    return null;
  }
}

function setAccount(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage blocked: she'll be asked to sign in again next time
  }
}

async function request(path, { token, ...init } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(API + path, {
      ...init,
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

// --- Sync -------------------------------------------------------------------------

let inFlight = null;

// Pull → merge → push. Resolves to { ok, pulled, signedOut } and never throws.
// Overlapping calls share one sync.
export function syncNow(progress) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const me = account();
    if (!me) return { ok: false, signedOut: true };
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false };
    try {
      let pulled = false;
      const res = await request("me/save", { token: me.token });
      if (res.status === 401) { setAccount(null); return { ok: false, signedOut: true }; }
      if (res.status === 200) {
        // A cloud copy that won't decode is ignored and overwritten below.
        let theirs = null;
        try { theirs = await importCode((await res.json()).code); } catch { theirs = null; }
        if (theirs) {
          const before = progress.level;
          Object.assign(progress, mergeProgress(progress, theirs));
          pulled = progress.level > before;
        }
      } else if (res.status !== 204) {
        return { ok: false };
      }
      const code = await exportCode(progress);
      const put = await request("me/save", { token: me.token, method: "PUT", body: JSON.stringify({ code, level: progress.level }) });
      if (put.status === 401) { setAccount(null); return { ok: false, signedOut: true }; }
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

// --- Sign in with Google -------------------------------------------------------------

let gsiLoading = null;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  gsiLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { gsiLoading = null; reject(new Error("offline")); };
    document.head.append(s);
  });
  return gsiLoading;
}

// Draws Google's own "Sign in with Google" button into `container`. When she signs in,
// the phone gets its session and syncs; `onDone({ ok, pulled, error })` reports back.
export async function renderSignIn(container, progress, onDone) {
  if (!GOOGLE_CLIENT_ID) {
    container.textContent = "Cloud backup is almost ready — check back soon.";
    return;
  }
  try {
    await loadGoogle();
  } catch {
    container.textContent = "Connect to the internet to sign in.";
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    auto_select: true,
    use_fedcm_for_prompt: true,
    callback: async ({ credential }) => {
      try {
        const res = await request("auth/google", { method: "POST", body: JSON.stringify({ credential }) });
        if (!res.ok) {
          const msg = res.status === 403 ? "That Google account can't back up this game." : "Sign-in didn't work — try again.";
          return onDone({ ok: false, error: msg });
        }
        const { token, email, name } = await res.json();
        setAccount({ token, email, name });
        onDone(await syncNow(progress));
      } catch {
        onDone({ ok: false, error: "Couldn't reach the cloud — try again." });
      }
    },
  });
  container.textContent = "";
  google.accounts.id.renderButton(container, { theme: "outline", size: "large", shape: "pill", text: "signin_with" });
}

export async function signOut() {
  const me = account();
  setAccount(null);
  try {
    if (me) await request("session", { token: me.token, method: "DELETE" });
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {
    // already signed out locally; the server session just expires
  }
}
