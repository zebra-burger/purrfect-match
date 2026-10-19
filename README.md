# 🐱 Purrfect Match

A cat-themed match-3 game with **limitless levels**. Built with love for one player
who finished every level Candy Crush could throw at her.

No ads. No lives. No in-app purchases. Just cats, forever.

## Play

The game lives at **https://orangezebra.cloud**, served entirely from Cloudflare (one Worker:
the game files plus the cloud-backup API). The old GitHub Pages address forwards there.

### Install on an Android phone (one time)

1. Open **orangezebra.cloud** in **Chrome**
2. Tap the **⋮** menu → **Add to Home Screen** (or tap the install banner)
3. It now launches fullscreen from its own icon and works fully offline (levels are generated on
   the phone, so there's nothing to download)

### Saving and backups — nothing to press

- Every level saves on the phone the moment it ends, online or offline.
- On the journey map, tap ☁️ → **Sign in with Google** once. From then on, whenever the phone is
  online, progress backs up to the cloud by itself, tied to that Google account.
- **New phone:** sign in with the same Google account and the whole journey comes back.

### Google sign-in setup

The Google OAuth client id (a public value) goes in two places: `GOOGLE_CLIENT_ID` in
`src/cloud.js` and in `worker/wrangler.toml` under `[vars]`. Its authorized JavaScript origins are
`https://orangezebra.cloud` and `http://localhost:8765`. `ALLOWED_EMAILS` in `wrangler.toml` limits
which Google accounts can back up. The client secret is not used.

## Development

No build step. Serve the folder and open it:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. Add `?level=N` to jump straight to level N.
The service worker is skipped on localhost; add `?sw` to test offline mode locally.

### Publishing

Pushing to `main` does **not** update the site. After pushing, publish from this Mac:

```bash
sh worker/deploy.sh
```

It deploys a clean export of `main` (never uncommitted edits), only if `main` matches GitHub and
the tests pass. Wrangler must be logged in to the Cloudflare account that owns orangezebra.cloud.

Tests and difficulty calibration use plain Node (no install):

```bash
node --test tests/*.test.mjs
node tests/sim.mjs 1 1000   # greedy-bot win rate across a level range
```

## Project docs

- [PLAN.md](PLAN.md) — full design & technical plan
- `src/` — game modules (each file's header comment describes its job)

## Status

🐾 **Playable and live** — endless seeded levels; special cats (Zoomie, Boom, Disco); goals
(score, yarn, boxes, fish treats, sleeping cats, mixed); earned boosters; Wifey's journey map with
stars, worlds and stats; offline play; automatic cloud backup. See [PLAN.md](PLAN.md).
