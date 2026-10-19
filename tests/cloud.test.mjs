// Run: node --test tests/*.test.mjs
// Cloud sync against a fake Worker (fetch is stubbed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadProgress, exportCode } from "../src/storage.js";
import { syncNow } from "../src/cloud.js";

function fakeCloud(initial = null) {
  const cloud = { body: initial, puts: 0 };
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") { cloud.body = init.body; cloud.puts++; return new Response('{"ok":true}', { status: 200 }); }
    return cloud.body ? new Response(cloud.body, { status: 200 }) : new Response(null, { status: 204 });
  };
  return cloud;
}

test("first sync uploads; a later sync pulls progress made elsewhere", async () => {
  const cloud = fakeCloud();
  const phone = loadProgress();
  phone.level = 12;
  assert.equal((await syncNow(phone)).ok, true);
  assert.equal(cloud.puts, 1);
  const other = loadProgress();
  other.level = 40;
  cloud.body = JSON.stringify({ code: await exportCode(other), level: 40 });
  const r = await syncNow(phone);
  assert.equal(r.pulled, true);
  assert.equal(phone.level, 40);
});

test("a damaged or tampered cloud copy is replaced, not fatal", async () => {
  const cloud = fakeCloud(JSON.stringify({ code: "zNOTREALLYABACKUP", level: 999999 }));
  const phone = loadProgress();
  phone.level = 25;
  const r = await syncNow(phone);
  assert.equal(r.ok, true);
  assert.equal(phone.level, 25, "junk never changes her progress");
  assert.match(JSON.parse(cloud.body).code, /^[zj]/);
  assert.equal(JSON.parse(cloud.body).level, 25, "cloud now holds her real progress");
});

test("an older cloud copy can never lower her progress", async () => {
  const old = loadProgress();
  old.level = 3;
  fakeCloud(JSON.stringify({ code: await exportCode(old), level: 3 }));
  const phone = loadProgress();
  phone.level = 50;
  await syncNow(phone);
  assert.equal(phone.level, 50);
});
