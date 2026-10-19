// Purrfect Match on Cloudflare — one Worker serves the whole game at orangezebra.cloud:
// the static game files (Workers static assets, from the repo root) and the cloud
// backup API below. www. redirects to the bare domain so there's only ever one copy
// of her save (browsers keep storage per address).
//
// Cloud backup is tied to her Google account (Sign in with Google, no third party):
//   POST   /v1/auth/google  ← { credential }  Google ID token from the sign-in button.
//                           → { token, email, name }  a long-lived session for this phone
//   GET    /v1/me/save      → { code, level, savedAt }   (204 if nothing saved yet)
//   PUT    /v1/me/save      ← { code, level }            → { ok, savedAt }
//   DELETE /v1/session      signs this phone out
// The me/ and session routes need `Authorization: Bearer <token>`. Only a hash of each
// session token is stored, so the KV data alone can't be used to sign in. Saves are
// the same compressed backup code the share-link backup uses; the phone merges before
// it writes, so the server never has to understand them.
//
// Settings (wrangler.toml [vars]): GOOGLE_CLIENT_ID, and optionally ALLOWED_EMAILS
// (comma-separated) to limit backups to particular Google accounts.
// Deploy: sh worker/deploy.sh

const HOME = "orangezebra.cloud";

const MAX_BODY = 256 * 1024; // a 10,000-level journey is ~10 KB; this is plenty
const SESSION_TTL = 60 * 60 * 24 * 400; // seconds; renewed whenever the phone syncs
const RENEW_AFTER = 1000 * 60 * 60 * 24 * 30; // ms
const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const ALLOWED_ORIGINS = [`https://${HOME}`, "http://localhost:8000", "http://localhost:8765"];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === `www.${HOME}`) {
      url.hostname = HOME;
      return Response.redirect(url.toString(), 301);
    }
    if (!url.pathname.startsWith("/v1/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }
    return handleApi(request, env, url);
  },
};

async function handleApi(request, env, url) {
  const cors = corsHeaders(request.headers.get("Origin") || "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const route = `${request.method} ${url.pathname}`;

  if (route === "POST /v1/auth/google") return signIn(request, env, cors);

  const session = await sessionFor(request, env);
  if (!session) return json({ error: "signed out" }, 401, cors);

  if (route === "DELETE /v1/session") {
    await env.SAVES.delete(session.key);
    return json({ ok: true }, 200, cors);
  }

  const saveKey = `user:${session.sub}`;
  if (route === "GET /v1/me/save") {
    const saved = await env.SAVES.get(saveKey);
    if (!saved) return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
    return new Response(saved, {
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (route === "PUT /v1/me/save") {
    const body = await request.text();
    if (body.length > MAX_BODY) return json({ error: "too big" }, 413, cors);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return json({ error: "bad json" }, 400, cors);
    }
    if (!data || typeof data.code !== "string" || !/^[zj][A-Za-z0-9_-]+$/.test(data.code)
        || !Number.isInteger(data.level) || data.level < 1) {
      return json({ error: "not a backup" }, 400, cors);
    }
    // Phones merge before they upload, so a save is never further behind than what's
    // stored; if one is, something's wrong — keep the stored copy.
    const stored = JSON.parse((await env.SAVES.get(saveKey)) || "null");
    if (stored && Number.isInteger(stored.level) && data.level < stored.level) {
      return json({ error: "behind the saved copy", level: stored.level }, 409, cors);
    }
    const savedAt = Date.now();
    await env.SAVES.put(saveKey, JSON.stringify({ code: data.code, level: data.level, savedAt }));
    return json({ ok: true, savedAt }, 200, cors);
  }

  return json({ error: "not found" }, 404, cors);
}

// --- Sign-in -------------------------------------------------------------------------

async function signIn(request, env, cors) {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: "sign-in not set up" }, 503, cors);
  let credential;
  try {
    ({ credential } = await request.json());
  } catch {
    return json({ error: "bad json" }, 400, cors);
  }
  const claims = await verifyGoogleToken(String(credential || ""), env.GOOGLE_CLIENT_ID).catch(() => null);
  if (!claims) return json({ error: "sign-in failed" }, 401, cors);
  if (!emailAllowed(env, claims.email)) {
    return json({ error: "this Google account isn't on the list" }, 403, cors);
  }
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const session = { sub: claims.sub, email: claims.email, name: claims.name || "", renewedAt: Date.now() };
  await env.SAVES.put(`session:${await sha256(token)}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  return json({ token, email: claims.email, name: session.name }, 200, cors);
}

function emailAllowed(env, email) {
  const allowed = String(env.ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !allowed.length || allowed.includes(String(email).toLowerCase());
}

// The session behind `Authorization: Bearer <token>`, renewed now and then so a
// phone that keeps playing never gets signed out. Taking an account off
// ALLOWED_EMAILS signs its phones out on their next request.
async function sessionFor(request, env) {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  const key = `session:${await sha256(m[1])}`;
  const raw = await env.SAVES.get(key);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (!emailAllowed(env, session.email)) {
    await env.SAVES.delete(key);
    return null;
  }
  if (Date.now() - (session.renewedAt || 0) > RENEW_AFTER) {
    session.renewedAt = Date.now();
    await env.SAVES.put(key, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  }
  return { ...session, key };
}

// Checks a Google ID token: RS256 signature against Google's published keys, issuer,
// audience (our client id), expiry, and a verified email. Returns its claims.
export async function verifyGoogleToken(jwt, clientId, now = Date.now()) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("not a JWT");
  const [h, p, sig] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  if (header.alg !== "RS256" || !header.kid) throw new Error("unexpected token type");
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown signing key");
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlDecode(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("bad signature");
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error("wrong issuer");
  if (claims.aud !== clientId) throw new Error("wrong audience");
  if (!(claims.exp * 1000 > now)) throw new Error("expired");
  if (!claims.sub || !claims.email || claims.email_verified !== true) throw new Error("no verified email");
  return claims;
}

let certCache = { keys: null, until: 0 };
export function setGoogleKeysForTest(keys) { certCache = { keys, until: Infinity }; }

async function googleKeys() {
  if (certCache.keys && Date.now() < certCache.until) return certCache.keys;
  const res = await fetch(GOOGLE_CERTS);
  if (!res.ok) throw new Error("couldn't fetch Google's keys");
  const maxAge = Number((res.headers.get("Cache-Control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
  certCache = { keys: (await res.json()).keys, until: Date.now() + maxAge * 1000 };
  return certCache.keys;
}

function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}
