// Run: node --test tests/*.test.mjs
// Cloud sync against a fake Worker (fetch and localStorage are stubbed).
import { test } from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const { loadProgress, exportCode } = await import("../src/storage.js");
const { syncNow, account } = await import("../src/cloud.js");

const TOKEN = "ab".repeat(32);
const signIn = () => localStorage.setItem("purrfect-match:session", JSON.stringify({ token: TOKEN, email: "wifey@example.com" }));

function fakeCloud(initial = null) {
  const cloud = { body: initial, puts: 0, auth: [] };
  globalThis.fetch = async (url, init = {}) => {
    cloud.auth.push(init.headers?.Authorization);
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return new Response(null, { status: 401 });
    if (init.method === "PUT") { cloud.body = init.body; cloud.puts++; return new Response('{"ok":true}', { status: 200 }); }
    return cloud.body ? new Response(cloud.body, { status: 200 }) : new Response(null, { status: 204 });
  };
  return cloud;
}

test("signed out: nothing is sent", async () => {
  mem.clear();
  const cloud = fakeCloud();
  const r = await syncNow(loadProgress());
  assert.equal(r.signedOut, true);
  assert.equal(cloud.auth.length, 0);
});

test("signed in: first sync uploads; a later sync pulls progress made elsewhere", async () => {
  mem.clear(); signIn();
  const cloud = fakeCloud();
  const phone = loadProgress();
  phone.level = 12;
  assert.equal((await syncNow(phone)).ok, true);
  assert.equal(cloud.puts, 1);
  assert.ok(cloud.auth.every((a) => a === `Bearer ${TOKEN}`));
  const other = loadProgress();
  other.level = 40;
  cloud.body = JSON.stringify({ code: await exportCode(other), level: 40 });
  const r = await syncNow(phone);
  assert.equal(r.pulled, true);
  assert.equal(phone.level, 40);
});

test("an unreadable cloud copy is replaced only when it isn't further along", async () => {
  mem.clear(); signIn();
  const ahead = fakeCloud(JSON.stringify({ code: "zNOTREALLYABACKUP", level: 900 }));
  const phone = loadProgress();
  phone.level = 25;
  assert.equal((await syncNow(phone)).ok, false, "left alone: it may be her real progress");
  assert.equal(ahead.puts, 0);
  assert.equal(phone.level, 25);

  const behind = fakeCloud(JSON.stringify({ code: "zNOTREALLYABACKUP", level: 3 }));
  assert.equal((await syncNow(phone)).ok, true);
  assert.equal(JSON.parse(behind.body).level, 25, "a damaged older copy is replaced");
});

test("an older cloud copy never lowers progress", async () => {
  mem.clear(); signIn();
  const cloud = fakeCloud();
  const phone = loadProgress();
  phone.level = 25;
  const old = loadProgress(); old.level = 3;
  cloud.body = JSON.stringify({ code: await exportCode(old), level: 3 });
  await syncNow(phone);
  assert.equal(phone.level, 25);
});

test("a level that ends mid-sync gets its own sync, and 'backed up' reports what was sent", async () => {
  mem.clear(); signIn();
  const sent = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") { sent.push(JSON.parse(init.body).level); return new Response("{}", { status: 200 }); }
    await gate; // the first pull is slow
    return new Response(null, { status: 204 });
  };
  const phone = loadProgress();
  phone.level = 5;
  const first = syncNow(phone);
  phone.level = 6;            // she finishes a level while that sync is still running
  const second = syncNow(phone);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(sent, [6, 6].slice(0, sent.length));
  assert.equal(sent.at(-1), 6, "level 6 reached the cloud");
  assert.equal(phone.cloud.lastLevel, 6);
});

test("an expired session signs the phone out quietly", async () => {
  mem.clear();
  localStorage.setItem("purrfect-match:session", JSON.stringify({ token: "cd".repeat(32), email: "x" }));
  fakeCloud();
  const r = await syncNow(loadProgress());
  assert.equal(r.signedOut, true);
  assert.equal(account(), null);
});

test("the session token never ends up inside a backup code", async () => {
  mem.clear(); signIn();
  const p = loadProgress();
  const code = await exportCode(p);
  const { importCode } = await import("../src/storage.js");
  assert.ok(!JSON.stringify(await importCode(code)).includes(TOKEN));
});
