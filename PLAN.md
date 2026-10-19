# Purrfect Match — Project Plan

A cat-themed match-3 game with **limitless levels**, built as a Progressive Web App (PWA)
for one very specific player: a Candy Crush veteran currently sitting at level 6,800+.

---

## 1. The player

- Plays Candy Crush and similar casual match-3 games daily on an Android phone
- Burns through content faster than studios can make it — the core problem to solve is **never running out of levels**
- Loves cats
- Expects polish: juicy animations, satisfying sounds, clear goals, a sense of progression

## 2. Why a PWA (and not a Play Store app)

| | PWA | Native Android |
|---|---|---|
| Cost | Free | $25 Play Console fee |
| Distribution | Send her a link once; "Add to Home Screen" | Store listing, review process |
| Updates | Instant on every git push | Build, sign, upload, wait |
| Offline play | Yes (service worker) | Yes |
| Feels like an app | Yes (fullscreen, own icon, no browser UI) | Yes |

A PWA on Chrome for Android is indistinguishable from an installed game for this use case.
If she ever wants it in her app drawer "properly", the same codebase can be wrapped with
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) into a Play Store app later — zero rewrite.

## 3. Game design

### Core loop
Classic match-3: swap two adjacent tiles to make a line of 3+ identical tiles. Matches clear,
tiles fall, new ones drop in. Cascades chain for bonus points.

### Theme: cats
- The six base tiles are six cat faces (distinct silhouette + color so they read instantly):
  **Ginger, Tuxedo, Siamese, Grey Tabby, Calico, Black Cat**
- Match 4 → **Zoomie Cat** (striped; clears a row or column)
- Match 5 in a line → **Disco Cat** (clears every tile of one color)
- Match in L/T shape → **Boom Cat** (clears a 3×3 area)
- Blockers: **yarn balls** (clear by matching next to them), **cardboard boxes** (two-layer),
  **sleeping cats** (wake with an adjacent match, then join the board)
- Collectibles: **fish treats** that must be dropped to the bottom of the board

### Limitless levels — the heart of the project
Levels are **procedurally generated from a seeded RNG** (level number = seed), so:
- Level N is identical every time anyone plays it (fair retries, consistent difficulty)
- There is no last level — level 50,000 already exists
- No level data to author or ship

Each level is assembled from a **recipe** chosen by seed:
1. **Objective** (rotates): reach score / clear all yarn / collect N fish / break all boxes / mixed
2. **Board shape**: rectangle, diamond, donut, cat-head silhouette, random-holes (9×9 max grid)
3. **Move budget**: tuned from a difficulty curve
4. **Blocker density**: scales with difficulty

**Difficulty curve**: a slow sawtooth — gradually harder over ~20 levels, then a breather, with
a gentle "hard level" spike every 10th level (this chop-and-change rhythm is exactly how Candy
Crush keeps it fresh). A solvability pass rejects generated boards with no opening moves.

### Progression & retention (the fun parts, none of the dark patterns)
- **No lives / no energy system** — she can play as long as she wants; it's a gift, not a monetization funnel
- Map-style level trail with her position, stars (1–3 per level based on score)
- Streak counter and personal bests
- Earned boosters (not bought): Paw Swipe (remove one tile), Catnip Shuffle, +5 Moves
- Progress saved in `localStorage`, with export/import so a new phone doesn't lose level 6,800 all over again

### Juice (what makes it feel premium)
- Tile swap/fall animations with easing and squash-and-stretch
- Particle bursts on matches, screen shake on big cascades
- Combo escalation: "Purrfect!" → "Meow-velous!" → "CATASTROPHIC!"
- Satisfying pop sounds, purring on level complete
- Haptic feedback via the Vibration API on matches

## 4. Tech stack — deliberately boring

- **Vanilla JavaScript + HTML5 Canvas.** No framework, no bundler, no build step, no npm install.
  A match-3 is a grid and a game loop; the whole engine is a few small modules.
- **PWA layer**: `manifest.webmanifest` (name, icons, fullscreen portrait) + a service worker
  that caches everything for offline play.
- **Hosting**: GitHub Pages straight from `main`. Push = deployed.
- **Zero backend.** No accounts, no servers, no costs, nothing to maintain.

## 5. Architecture

```
purrfect-match/
├── index.html              # Single page; loads everything
├── manifest.webmanifest    # PWA install metadata
├── sw.js                   # Service worker (offline cache)
├── styles/
│   └── main.css            # UI chrome, menus, HUD
├── src/
│   ├── main.js             # Boot, game loop, screen routing
│   ├── board.js            # Grid state, match detection, cascades, gravity
│   ├── generator.js        # Seeded level generation (the "limitless" engine)
│   ├── rng.js              # Deterministic seeded RNG (mulberry32)
│   ├── renderer.js         # Canvas drawing, animations, particles
│   ├── input.js            # Touch (swipe/tap) handling
│   ├── audio.js            # Sound effects (Web Audio)
│   ├── storage.js          # Progress save/load/export
│   └── ui.js               # Menus, level map, HUD, dialogs
├── assets/
│   ├── sprites/            # Cat tiles, blockers, boosters
│   ├── audio/              # Pops, purrs, fanfares
│   └── icons/              # App icons (192px, 512px, maskable)
├── docs/                   # Design notes
├── PLAN.md                 # This file
└── README.md               # Setup + "install on her phone" instructions
```

## 6. Resources needed

| Resource | Plan | Cost |
|---|---|---|
| Cat tile art | Start with high-quality inline SVG cats drawn in code (crisp at any size, zero downloads); optionally replace with commissioned/AI art later | Free |
| Sounds | [Kenney.nl](https://kenney.nl/assets) CC0 game audio packs + Web Audio-synthesized pops | Free |
| Font | One rounded display font (e.g. Baloo 2 or Fredoka), self-hosted | Free |
| App icon | Cat face icon, 192/512px + maskable variant | Free (generated) |
| Hosting | GitHub Pages | Free |
| Domain (optional) | Could live at a mcr.ae subdomain later, e.g. `cats.mcr.ae` | Already owned |
| Her phone | Chrome on Android → visit link → "Add to Home Screen" | — |

## 7. Milestones

1. **M1 — Playable core** *(the big one)*: board, swapping, matching, cascades, touch input,
   seeded generator, score + moves, level complete/fail. Playable in a browser.
2. **M2 — Feels good**: animations, particles, sounds, combo text, haptics.
3. **M3 — It's a game**: level map, stars, objectives (yarn/fish/boxes), specials
   (Zoomie/Disco/Boom cats), boosters, saved progress.
4. **M4 — It's HER game**: PWA install flow, offline play, app icon, polish pass,
   personal touches (her name on the title screen, milestone messages at level 100, 500, 1000…).
5. **M5 — Ship**: deploy to GitHub Pages, install on her phone, watch her pass level 6,800 again.

## 8. Risks & decisions

- **Repo visibility**: GitHub Pages on a free account requires a **public** repo. A casual game
  is fine public. If it must stay private, deploy the same folder to Netlify instead (also free).
- **Generated levels can be duds**: mitigated by the solvability check + recipe constraints;
  the seed is deterministic, so any reported "bad level N" is reproducible and fixable for everyone at once.
- **Performance on an older phone**: Canvas with a capped particle count comfortably handles a
  9×9 grid at 60fps; no framework overhead by design.
