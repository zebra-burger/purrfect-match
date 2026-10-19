# 🐱 Purrfect Match

A cat-themed match-3 game with **limitless levels**. Built with love for one player
who finished every level Candy Crush could throw at her.

No ads. No lives. No in-app purchases. Just cats, forever.

## Play

Once deployed, the game lives at **https://zebra-burger.github.io/purrfect-match/**

### Install on an Android phone (one time)

1. Open the link above in **Chrome**
2. Tap the **⋮** menu → **Add to Home Screen** (or tap the install banner)
3. It now launches fullscreen from its own icon, works offline, and saves progress on the phone

## Development

No build step. Serve the folder and open it:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. Add `?level=N` to jump straight to level N.

Tests and difficulty calibration use plain Node (no install):

```bash
node --test tests/*.test.mjs
node tests/sim.mjs 1 1000   # greedy-bot win rate across a level range
```

## Project docs

- [PLAN.md](PLAN.md) — full design & technical plan
- `src/` — game modules (each file's header comment describes its job)

## Status

🐾 **M1 playable core** — endless seeded levels, swipe/tap swapping, cascades, score targets,
win/fail and saved level. Next up: M2 juice (sounds, particles, combos). See [PLAN.md](PLAN.md).
