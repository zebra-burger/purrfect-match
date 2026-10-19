// Run: node --test tests/*.test.mjs
// The cloud-backup Worker, against an in-memory stand-in for its KV namespace.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

const ID = "0123456789abcdef0123456789abcdef";
const URL_BASE = "https://sync.example.test/v1/save/";

function env() {
  const store = new Map();
  return { store, SAVES: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } } };
}

const call = (e, method, path, body, origin = "https://zebra-burger.github.io") =>
  worker.fetch(new Request(URL_BASE + path, { method, body, headers: { Origin: origin } }), e);

test("save then load round-trips the backup code", async () => {
  const e = env();
  assert.equal((await call(e, "GET", ID)).status, 204, "nothing saved yet");
  const put = await call(e, "PUT", ID, JSON.stringify({ code: "zAbc_-123", level: 42 }));
  assert.equal(put.status, 200);
  const got = await call(e, "GET", ID);
  assert.equal(got.status, 200);
  const data = await got.json();
  assert.equal(data.code, "zAbc_-123");
  assert.equal(data.level, 42);
  assert.ok(data.savedAt > 0);
  assert.equal(got.headers.get("Access-Control-Allow-Origin"), "https://zebra-burger.github.io");
  const home = await call(e, "GET", ID, undefined, "https://orangezebra.cloud");
  assert.equal(home.headers.get("Access-Control-Allow-Origin"), "https://orangezebra.cloud");
});

test("rejects bad ids, bad bodies and oversized saves", async () => {
  const e = env();
  assert.equal((await call(e, "GET", "not-an-id")).status, 404);
  assert.equal((await call(e, "PUT", ID, "{nope")).status, 400);
  assert.equal((await call(e, "PUT", ID, JSON.stringify({ code: "<script>", level: 1 }))).status, 400);
  assert.equal((await call(e, "PUT", ID, JSON.stringify({ code: "zabc", level: 0 }))).status, 400);
  assert.equal((await call(e, "PUT", ID, JSON.stringify({ code: "z" + "a".repeat(300000), level: 2 }))).status, 413);
  assert.equal((await call(e, "DELETE", ID)).status, 405);
  assert.equal(e.store.size, 0);
});

test("CORS preflight only echoes known origins", async () => {
  const e = env();
  const ok = await call(e, "OPTIONS", ID, undefined, "http://localhost:8765");
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "http://localhost:8765");
  const other = await call(e, "OPTIONS", ID, undefined, "https://evil.example");
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
