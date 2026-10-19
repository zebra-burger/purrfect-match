// Purrfect Match on Cloudflare — one Worker serves the whole game at orangezebra.cloud:
// the static game files (Workers static assets, from the repo root) and the cloud
// backup API below. www. redirects to the bare domain so there's only ever one copy
// of her save (browsers keep storage per address).
//
// Cloud backup:
// Each phone makes up a random 128-bit sync id (32 hex chars) and keeps its latest
// progress here under that id. The id is the only key: anyone holding her journey
// link could read or overwrite her save, so it's only ever shared by her own backup
// link. The stored value is the same compressed backup code the share-link backup
// uses; the phone merges before it writes, so the server never has to understand it.
//
//   GET /v1/save/<id>   → { code, level, savedAt }   (204 if nothing saved yet)
//   PUT /v1/save/<id>   ← { code, level }            → { ok, savedAt }
//
// Deploy: cd worker && npx wrangler deploy   (bindings ASSETS + SAVES in wrangler.toml)

const HOME = "orangezebra.cloud";

const MAX_BODY = 256 * 1024; // a 10,000-level journey is ~10 KB; this is plenty
const ALLOWED_ORIGINS = [
  `https://${HOME}`,
  "https://zebra-burger.github.io",
  "http://localhost:8000",
  "http://localhost:8765",
];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

  const match = url.pathname.match(/^\/v1\/save\/([0-9a-f]{32})$/);
  if (!match) return json({ error: "not found" }, 404, cors);
  const key = `save:${match[1]}`;

  if (request.method === "GET") {
    const saved = await env.SAVES.get(key);
    if (!saved) return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
    return new Response(saved, {
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (request.method === "PUT") {
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
    const savedAt = Date.now();
    await env.SAVES.put(key, JSON.stringify({ code: data.code, level: data.level, savedAt }));
    return json({ ok: true, savedAt }, 200, cors);
  }

  return json({ error: "method not allowed" }, 405, cors);
}
