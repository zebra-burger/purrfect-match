// Run: node --test tests/*.test.mjs
// The Worker: Google sign-in, sessions and account saves, against an in-memory KV and
// a locally generated stand-in for Google's signing key.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { setGoogleKeysForTest, verifyGoogleToken } from "../worker/index.js";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const BASE = "https://orangezebra.cloud";

const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
setGoogleKeysForTest([publicJwk]);

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
async function googleToken(overrides = {}, { kid = "test-kid", key = keyPair.privateKey } = {}) {
  const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1234567890", email: "wifey@example.com",
    email_verified: true, name: "Wifey", exp: Math.floor(Date.now() / 1000) + 3600, ...overrides,
  }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(new Uint8Array(sig))}`;
}

function env(vars = {}) {
  const store = new Map();
  return {
    store, GOOGLE_CLIENT_ID: CLIENT_ID, ...vars,
    SAVES: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => { store.set(k, v); },
      delete: async (k) => { store.delete(k); },
    },
  };
}

const call = (e, method, path, { body, token, origin = BASE } = {}) => worker.fetch(new Request(BASE + path, {
  method, body, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
}), e);

async function signIn(e, overrides) {
  const res = await call(e, "POST", "/v1/auth/google", { body: JSON.stringify({ credential: await googleToken(overrides) }) });
  return { res, data: res.status === 200 ? await res.json() : null };
}

test("signing in with Google gives this phone a session, and only its hash is stored", async () => {
  const e = env();
  const { res, data } = await signIn(e);
  assert.equal(res.status, 200);
  assert.match(data.token, /^[0-9a-f]{64}$/);
  assert.equal(data.email, "wifey@example.com");
  const keys = [...e.store.keys()];
  assert.equal(keys.length, 1);
  assert.ok(keys[0].startsWith("session:") && !keys[0].includes(data.token));
});

test("saves belong to the signed-in account", async () => {
  const e = env();
  const { data } = await signIn(e);
  assert.equal((await call(e, "GET", "/v1/me/save", { token: data.token })).status, 204, "nothing saved yet");
  const put = await call(e, "PUT", "/v1/me/save", { token: data.token, body: JSON.stringify({ code: "zAbc_-123", level: 42 }) });
  assert.equal(put.status, 200);
  const got = await (await call(e, "GET", "/v1/me/save", { token: data.token })).json();
  assert.equal(got.code, "zAbc_-123");
  assert.equal(got.level, 42);

  // A second phone signing in to the same Google account sees the same save.
  const second = (await signIn(e)).data;
  assert.notEqual(second.token, data.token);
  assert.equal((await (await call(e, "GET", "/v1/me/save", { token: second.token })).json()).level, 42);

  // A different Google account sees nothing of hers.
  const stranger = (await signIn(e, { sub: "999", email: "someone@example.com" })).data;
  assert.equal((await call(e, "GET", "/v1/me/save", { token: stranger.token })).status, 204);
});

test("no session, no save", async () => {
  const e = env();
  assert.equal((await call(e, "GET", "/v1/me/save")).status, 401);
  assert.equal((await call(e, "GET", "/v1/me/save", { token: "a".repeat(64) })).status, 401);
  assert.equal((await call(e, "PUT", "/v1/me/save", { body: JSON.stringify({ code: "zabc", level: 2 }) })).status, 401);
});

test("signing out ends that phone's session", async () => {
  const e = env();
  const { data } = await signIn(e);
  assert.equal((await call(e, "DELETE", "/v1/session", { token: data.token })).status, 200);
  assert.equal((await call(e, "GET", "/v1/me/save", { token: data.token })).status, 401);
});

test("forged, expired or wrong-app Google tokens are refused", async () => {
  const other = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const bad = [
    await googleToken({}, { key: other.privateKey }),                     // not signed by Google
    await googleToken({ aud: "someone-elses-app.apps.googleusercontent.com" }),
    await googleToken({ iss: "https://evil.example" }),
    await googleToken({ exp: Math.floor(Date.now() / 1000) - 10 }),
    await googleToken({ email_verified: false }),
    await googleToken({}, { kid: "unknown-kid" }),
    "not.a.jwt",
  ];
  for (const t of bad) await assert.rejects(verifyGoogleToken(t, CLIENT_ID));
  const e = env();
  const res = await call(e, "POST", "/v1/auth/google", { body: JSON.stringify({ credential: bad[0] }) });
  assert.equal(res.status, 401);
  assert.equal(e.store.size, 0);
});

test("ALLOWED_EMAILS limits who can back up", async () => {
  const e = env({ ALLOWED_EMAILS: "Wifey@example.com, gary@example.com" });
  assert.equal((await signIn(e)).res.status, 200, "case-insensitive match");
  assert.equal((await signIn(e, { sub: "2", email: "stranger@example.com" })).res.status, 403);
});

test("rejects bad bodies and oversized saves", async () => {
  const e = env();
  const { data } = await signIn(e);
  const put = (body) => call(e, "PUT", "/v1/me/save", { token: data.token, body });
  assert.equal((await put("{nope")).status, 400);
  assert.equal((await put(JSON.stringify({ code: "<script>", level: 1 }))).status, 400);
  assert.equal((await put(JSON.stringify({ code: "zabc", level: 0 }))).status, 400);
  assert.equal((await put(JSON.stringify({ code: "z" + "a".repeat(300000), level: 2 }))).status, 413);
  assert.equal([...e.store.keys()].filter((k) => k.startsWith("user:")).length, 0);
});

test("sign-in is off until a client id is configured", async () => {
  const e = env({ GOOGLE_CLIENT_ID: "" });
  assert.equal((await signIn(e)).res.status, 503);
});

test("CORS only echoes known origins", async () => {
  const e = env();
  const ok = await call(e, "OPTIONS", "/v1/me/save", { origin: "http://localhost:8765" });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "http://localhost:8765");
  assert.match(ok.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  const other = await call(e, "OPTIONS", "/v1/me/save", { origin: "https://evil.example" });
  assert.equal(other.headers.get("Access-Control-Allow-Origin"), "https://orangezebra.cloud");
});

test("www redirects to the bare domain; everything else is the game's files", async () => {
  const e = env();
  const www = await worker.fetch(new Request("https://www.orangezebra.cloud/?level=3"), e);
  assert.equal(www.status, 301);
  assert.equal(www.headers.get("Location"), "https://orangezebra.cloud/?level=3");
  const served = [];
  e.ASSETS = { fetch: async (req) => { served.push(new URL(req.url).pathname); return new Response("ok"); } };
  await worker.fetch(new Request("https://orangezebra.cloud/src/main.js"), e);
  assert.deepEqual(served, ["/src/main.js"]);
});
