// board.js — grid state, match detection, cascades, gravity, special-tile creation.
// Pure logic, no rendering. Implemented in M1; special cats added in M2.
//
// A board is a rows×cols grid. `mask[r][c]` says whether a cell exists (board shapes
// like diamonds and donuts are rectangles with cells masked out). Each existing cell
// holds a tile `{ id, color, special }` or null while a cascade is resolving.
// Tile ids are stable across moves so the renderer can animate the same tile around.
//
// Match kinds, used for scoring and special-cat creation:
//   "three" — a line of 3
//   "four"  — a line of 4            → Zoomie Cat (striped; clears its row or column)
//   "lt"    — an L or T of 5+ cells  → Boom Cat (clears the 3×3 around it)
//   "five"  — a line of 5+           → Disco Cat (colorless; swap it with any cat to
//                                       clear every cat of that color)
//
// A special is a tile with `special` set ("zoomie" | "boom" | "disco"); a Zoomie also
// carries `dir` ("row" | "col"). Disco Cats have color null so they never match.
// resolveStep() runs one clear: matches, special creation, special effects (chaining
// through any specials they hit), and the swap combos.
//
// Level goals (M3) live on the board too:
//   yarn[r][c]   tangles (0–2 layers) under a cat; clearing that cat unpicks a layer
//   boxes[r][c]  cardboard boxes (0–2 layers) that fill a cell; a match next to one,
//                or a blast over it, knocks a layer off; at 0 the cell opens up
//   fish treats  tiles with special "fish" and no color: they never match and blasts
//                skip them; they fall like cats and are collected at the bottom.
//                A fish can also be swiped down one cell (costs a move) so a treat
//                stuck near the bottom is never hopeless
// Tiles fall through boxes the same way they fall through holes.

let nextTileId = 1;

export function makeTile(color, special = null, dir = null) {
  const tile = { id: nextTileId++, color, special };
  if (dir) tile.dir = dir;
  return tile;
}

export const MATCH_POINTS = { three: 60, four: 120, lt: 180, five: 250 };
export const SPECIAL_OF = { four: "zoomie", lt: "boom", five: "disco" };
// Each tile a special clears beyond the match itself.
export const BLAST_POINTS = 30;
export const YARN_POINTS = 40;
export const BOX_POINTS = 60;
export const FISH_POINTS = 500;

// Swap-firing specials (fish treats are tiles with a `special`, but they're cargo).
const isPower = (t) => Boolean(t && t.special && t.special !== "fish");
const zeros = (mask) => mask.map((row) => row.map(() => 0));

export class Board {
  // colors: 2D array of color indices (null where the mask has no cell).
  // colorCount: how many cat colors refills draw from. rng: () => [0, 1) for refills.
  // blockers (optional): { yarn, boxes: 2D layer counts, fish: [{r, c}], fishTotal }.
  constructor(mask, colors, colorCount, rng, blockers = null) {
    this.rows = mask.length;
    this.cols = mask[0].length;
    this.mask = mask.map((row) => row.slice());
    this.colorCount = colorCount;
    this.rng = rng;
    this.yarn = blockers?.yarn ? blockers.yarn.map((row) => row.slice()) : zeros(mask);
    this.boxes = blockers?.boxes ? blockers.boxes.map((row) => row.slice()) : zeros(mask);
    this.grid = mask.map((row, r) =>
      row.map((exists, c) => (exists && !this.boxes[r][c] && colors[r][c] != null ? makeTile(colors[r][c]) : null))
    );
    const fish = blockers?.fish || [];
    for (const { r, c } of fish) this.grid[r][c] = makeTile(null, "fish");
    this.fishToSpawn = Math.max(0, (blockers?.fishTotal || 0) - fish.length);
    this.fishCollected = 0;
  }

  // Independent copy for look-ahead (tiles are copied too; refills draw from `rng`).
  clone(rng = this.rng) {
    const b = Object.create(Board.prototype);
    Object.assign(b, this, {
      rng,
      mask: this.mask,
      grid: this.grid.map((row) => row.map((t) => t && { ...t })),
      yarn: this.yarn.map((row) => row.slice()),
      boxes: this.boxes.map((row) => row.slice()),
    });
    return b;
  }

  // A cell tiles can sit in: on the board and not boxed up.
  open(r, c) {
    return this.exists(r, c) && !this.boxes[r][c];
  }

  yarnLeft() {
    let n = 0;
    for (const row of this.yarn) for (const v of row) n += v;
    return n;
  }

  boxesLeft() {
    let n = 0;
    for (const row of this.boxes) for (const v of row) n += v;
    return n;
  }

  fishOnBoard() {
    let n = 0;
    for (const row of this.grid) for (const t of row) if (t && t.special === "fish") n++;
    return n;
  }

  // Fish treats sitting on the lowest open cell of their column are collected.
  // Returns [{ r, c, tile }] (cells are left empty: call collapse() next).
  collectFish() {
    const got = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = this.rows - 1; r >= 0; r--) {
        if (!this.open(r, c)) continue;
        const t = this.grid[r][c];
        if (t && t.special === "fish") {
          got.push({ r, c, tile: t });
          this.grid[r][c] = null;
          this.fishCollected++;
        }
        break;
      }
    }
    return got;
  }

  exists(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols && this.mask[r][c];
  }

  get(r, c) {
    return this.exists(r, c) ? this.grid[r][c] : null;
  }

  isAdjacent(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  // Swaps two cells' tiles. Validity (adjacency, both tiles present) is the caller's job.
  swap(a, b) {
    const t = this.grid[a.r][a.c];
    this.grid[a.r][a.c] = this.grid[b.r][b.c];
    this.grid[b.r][b.c] = t;
  }

  // All current matches, grouped so that an L/T shape is one group.
  // Returns [{ color, kind, cells: [{r, c}] }].
  findMatches() {
    const runs = [];
    const scan = (outer, inner, at, dir) => {
      for (let i = 0; i < outer; i++) {
        let j = 0;
        while (j < inner) {
          const tile = at(i, j);
          if (!tile || tile.color == null) { j++; continue; }
          let end = j + 1;
          while (end < inner && at(i, end) && at(i, end).color === tile.color) end++;
          if (end - j >= 3) {
            const cells = [];
            for (let k = j; k < end; k++) cells.push(dir === "h" ? { r: i, c: k } : { r: k, c: i });
            runs.push({ dir, cells, color: tile.color });
          }
          j = end;
        }
      }
    };
    scan(this.rows, this.cols, (r, c) => this.get(r, c), "h");
    scan(this.cols, this.rows, (c, r) => this.get(r, c), "v");

    // Union runs that share a cell (only possible for same-colored runs).
    const parent = runs.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Map();
    runs.forEach((run, i) => {
      for (const { r, c } of run.cells) {
        const key = r * this.cols + c;
        if (owner.has(key)) parent[find(i)] = find(owner.get(key));
        else owner.set(key, i);
      }
    });

    const groups = new Map();
    runs.forEach((run, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(run);
    });

    return [...groups.values()].map((group) => {
      const seen = new Set();
      const cells = [];
      for (const run of group) {
        for (const cell of run.cells) {
          const key = cell.r * this.cols + cell.c;
          if (!seen.has(key)) { seen.add(key); cells.push(cell); }
        }
      }
      const longest = Math.max(...group.map((run) => run.cells.length));
      const crossed = group.some((run) => run.dir === "h") && group.some((run) => run.dir === "v");
      let kind = "three";
      if (longest >= 5) kind = "five";
      else if (crossed) kind = "lt";
      else if (longest === 4) kind = "four";
      return { color: group[0].color, kind, cells };
    });
  }

  // One resolution step: everything that clears right now, with the board updated
  // (cleared cells are null, new specials are in place; call collapse() next).
  // Pass the swapped pair on the step right after a move, so new specials land where
  // she swiped and special swaps (Disco + anything, special + special) fire.
  // Pass `poke` ({ r, c }) instead for a Paw Swipe: that one tile is cleared (a special
  // goes off as if blasted) and the rest of the step plays out as usual.
  // Returns null when nothing clears, else {
  //   groups:  the match groups (empty for a swap combo),
  //   removed: [{ r, c, tile }],
  //   created: [{ r, c, tile }]  tiles that just became specials (they stay on the board),
  //   blasts:  [{ special, r, c, dir?, radius?, color?, targets? }] for the renderer,
  //   points:  before the cascade multiplier,
  // }
  resolveStep(swap = null, poke = null) {
    const key = (r, c) => r * this.cols + c;
    const clear = new Map();
    const protect = new Set();
    const consumed = new Set(); // tile ids whose effect is already accounted for
    const queue = [];
    const blasts = [];
    const created = [];
    const boxHit = new Map();
    let groups = [];

    const mark = (r, c) => {
      if (this.exists(r, c) && this.boxes[r][c]) { boxHit.set(key(r, c), { r, c }); return; }
      const t = this.get(r, c), k = key(r, c);
      if (!t || t.special === "fish" || protect.has(k) || clear.has(k)) return;
      clear.set(k, { r, c });
      if (isPower(t) && !consumed.has(t.id)) queue.push({ r, c, tile: t });
    };
    const markRow = (r) => { for (let c = 0; c < this.cols; c++) mark(r, c); };
    const markCol = (c) => { for (let r = 0; r < this.rows; r++) mark(r, c); };
    const markArea = (r0, c0, rad) => {
      for (let r = r0 - rad; r <= r0 + rad; r++) for (let c = c0 - rad; c <= c0 + rad; c++) mark(r, c);
    };
    const cellsWhere = (fn) => {
      const out = [];
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++) { const t = this.get(r, c); if (t && fn(t)) out.push({ r, c }); }
      return out;
    };

    if (swap && this.isSpecialSwap(swap[0], swap[1])) {
      // The dragged tile now sits at swap[1]; combos go off there.
      const [a, b] = swap;
      const ta = this.get(a.r, a.c), tb = this.get(b.r, b.c);
      if (ta.special === "disco" || tb.special === "disco") {
        const [disco, dp, other, op] = tb.special === "disco" ? [tb, b, ta, a] : [ta, a, tb, b];
        consumed.add(disco.id);
        if (other.special === "disco") {
          // Disco + Disco: the whole board.
          consumed.add(other.id);
          blasts.push({ special: "disco", r: dp.r, c: dp.c, targets: cellsWhere(() => true) });
          cellsWhere(() => true).forEach(({ r, c }) => mark(r, c));
        } else {
          // Disco + cat: every cat of that color. Disco + Zoomie/Boom: they all turn
          // into that special first, then go off.
          const targets = cellsWhere((t) => t.color === other.color);
          if (other.special) {
            targets.forEach(({ r, c }, i) => {
              const t = this.grid[r][c];
              if (t.special) return;
              t.special = other.special;
              if (other.special === "zoomie") t.dir = i % 2 ? "row" : "col";
            });
          }
          blasts.push({ special: "disco", r: dp.r, c: dp.c, color: other.color, targets });
          mark(dp.r, dp.c);
          mark(op.r, op.c);
          targets.forEach(({ r, c }) => mark(r, c));
        }
      } else {
        consumed.add(ta.id).add(tb.id);
        mark(a.r, a.c); mark(b.r, b.c);
        const kinds = [ta.special, tb.special].sort().join("+");
        if (kinds === "zoomie+zoomie") {
          blasts.push({ special: "zoomie", r: b.r, c: b.c, dir: "row" }, { special: "zoomie", r: b.r, c: b.c, dir: "col" });
          markRow(b.r); markCol(b.c);
        } else if (kinds === "boom+zoomie") {
          for (let d = -1; d <= 1; d++) {
            blasts.push({ special: "zoomie", r: b.r + d, c: b.c, dir: "row" }, { special: "zoomie", r: b.r, c: b.c + d, dir: "col" });
            markRow(b.r + d); markCol(b.c + d);
          }
        } else {
          blasts.push({ special: "boom", r: b.r, c: b.c, radius: 2 });
          markArea(b.r, b.c, 2);
        }
      }
    } else if (poke) {
      mark(poke.r, poke.c);
      if (!clear.size) return null;
    } else {
      groups = this.findMatches();
      if (!groups.length) return null;
      for (const g of groups) {
        const special = SPECIAL_OF[g.kind];
        if (!special) continue;
        const at = this.specialCellFor(g, swap);
        if (!at) continue;
        let dir;
        if (special === "zoomie") {
          if (swap) dir = swap[0].r === swap[1].r ? "row" : "col";
          else dir = g.cells.every((cell) => cell.r === g.cells[0].r) ? "row" : "col";
        }
        protect.add(key(at.r, at.c));
        created.push({ r: at.r, c: at.c, tile: this.grid[at.r][at.c], special, dir });
      }
      for (const g of groups) for (const { r, c } of g.cells) mark(r, c);
      // A match knocks a layer off every box right next to it.
      for (const g of groups)
        for (const { r, c } of g.cells)
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
            if (this.exists(r + dr, c + dc) && this.boxes[r + dr][c + dc]) boxHit.set(key(r + dr, c + dc), { r: r + dr, c: c + dc });
    }
    const matched = clear.size;

    while (queue.length) {
      const { r, c, tile } = queue.shift();
      consumed.add(tile.id);
      if (tile.special === "zoomie") {
        blasts.push({ special: "zoomie", r, c, dir: tile.dir });
        if (tile.dir === "row") markRow(r); else markCol(c);
      } else if (tile.special === "boom") {
        blasts.push({ special: "boom", r, c, radius: 1 });
        markArea(r, c, 1);
      } else if (tile.special === "disco") {
        // A Disco Cat caught in a blast takes out the most common color.
        const color = this.dominantColor();
        const targets = color == null ? [] : cellsWhere((t) => t.color === color);
        blasts.push({ special: "disco", r, c, color, targets });
        targets.forEach((p) => mark(p.r, p.c));
      }
    }

    const removed = [];
    const yarnHits = [];
    for (const { r, c } of clear.values()) {
      removed.push({ r, c, tile: this.grid[r][c] });
      this.grid[r][c] = null;
      if (this.yarn[r][c]) yarnHits.push({ r, c, left: --this.yarn[r][c] });
    }
    // Specials created this step stay put but still unpick the yarn under them.
    for (const { r, c } of created)
      if (this.yarn[r][c] && !clear.has(key(r, c))) yarnHits.push({ r, c, left: --this.yarn[r][c] });
    const boxHits = [...boxHit.values()].map(({ r, c }) => ({ r, c, left: --this.boxes[r][c] }));
    for (const cr of created) {
      cr.tile.special = cr.special;
      if (cr.dir) cr.tile.dir = cr.dir;
      if (cr.special === "disco") cr.tile.color = null;
    }

    const matchPoints = groups.reduce((sum, g) => sum + MATCH_POINTS[g.kind], 0);
    const extra = groups.length ? removed.length - matched : removed.length;
    return {
      groups,
      removed,
      created: created.map(({ r, c, tile }) => ({ r, c, tile })),
      blasts,
      yarnHits,
      boxHits,
      points: matchPoints + BLAST_POINTS * Math.max(0, extra) + YARN_POINTS * yarnHits.length + BOX_POINTS * boxHits.length,
    };
  }

  // Where a match's new special appears: the swapped cell if it's in the match,
  // else the corner of an L/T, else the middle of the line. Never on an existing special.
  specialCellFor(group, swap) {
    const free = (cell) => !this.grid[cell.r][cell.c].special;
    const inGroup = (p) => group.cells.some((cell) => cell.r === p.r && cell.c === p.c);
    if (swap) {
      const hit = [swap[1], swap[0]].find((p) => inGroup(p) && free(p));
      if (hit) return hit;
    }
    if (group.kind === "lt") {
      const corner = group.cells.find((cell) =>
        (inGroup({ r: cell.r, c: cell.c - 1 }) || inGroup({ r: cell.r, c: cell.c + 1 })) &&
        (inGroup({ r: cell.r - 1, c: cell.c }) || inGroup({ r: cell.r + 1, c: cell.c })));
      if (corner && free(corner)) return corner;
    }
    const mid = group.cells[Math.floor(group.cells.length / 2)];
    if (free(mid)) return mid;
    return group.cells.find(free) || null;
  }

  // The color with the most cats on the board (lowest index wins ties).
  dominantColor() {
    const counts = new Array(this.colorCount).fill(0);
    for (const row of this.grid) for (const t of row) if (t && t.color != null) counts[t.color]++;
    const best = Math.max(...counts);
    return best > 0 ? counts.indexOf(best) : null;
  }

  // Swaps that fire without needing a match: a Disco Cat with anything but a fish
  // treat, or two specials.
  isSpecialSwap(a, b) {
    const ta = this.get(a.r, a.c), tb = this.get(b.r, b.c);
    if (!isPower(ta) && !isPower(tb)) return false;
    if (!ta || !tb || ta.special === "fish" || tb.special === "fish") return false;
    return ta.special === "disco" || tb.special === "disco" || (isPower(ta) && isPower(tb));
  }

  // Can a Paw Swipe take this cell? Any cat or special; not a fish treat or an empty cell.
  canPaw(r, c) {
    const t = this.get(r, c);
    return Boolean(t && t.special !== "fish");
  }

  // Removes the tiles in the given match groups. Returns [{ r, c, tile }] removed.
  clear(groups) {
    const removed = [];
    for (const group of groups) {
      for (const { r, c } of group.cells) {
        const tile = this.grid[r][c];
        if (tile) { removed.push({ r, c, tile }); this.grid[r][c] = null; }
      }
    }
    return removed;
  }

  // Gravity + refill. Tiles fall straight down within their column, passing through
  // masked-out cells (holes) and boxes, then new tiles drop in from above. While a
  // level still owes fish treats, some of the new tiles are fish (never more than two
  // on the board at once).
  // Returns { falls: [{ tile, c, fromR, toR }], spawns: [{ tile, c, fromR, toR }] }.
  // Spawn `fromR` is negative-ish (above the column's top cell) for the renderer.
  collapse() {
    const falls = [];
    const spawns = [];
    let fishAround = this.fishOnBoard();
    for (let c = 0; c < this.cols; c++) {
      const cells = [];
      for (let r = 0; r < this.rows; r++) if (this.open(r, c)) cells.push(r);
      if (!cells.length) continue;
      let write = cells.length - 1;
      for (let i = cells.length - 1; i >= 0; i--) {
        const r = cells[i];
        const tile = this.grid[r][c];
        if (!tile) continue;
        const toR = cells[write];
        if (toR !== r) {
          this.grid[toR][c] = tile;
          this.grid[r][c] = null;
          falls.push({ tile, c, fromR: r, toR });
        }
        write--;
      }
      const empty = write + 1;
      for (let k = write; k >= 0; k--) {
        let tile;
        if (this.fishToSpawn > 0 && fishAround < 2 && this.rng() < 0.4) {
          tile = makeTile(null, "fish");
          this.fishToSpawn--;
          fishAround++;
        } else {
          tile = makeTile(Math.floor(this.rng() * this.colorCount));
        }
        const toR = cells[k];
        this.grid[toR][c] = tile;
        spawns.push({ tile, c, fromR: cells[0] - (empty - k), toR });
      }
    }
    return { falls, spawns };
  }

  // Length of the same-color line through (r, c) in each axis.
  lineAt(r, c) {
    const tile = this.get(r, c);
    if (!tile || tile.color == null) return { h: 0, v: 0 };
    const same = (rr, cc) => { const t = this.get(rr, cc); return t && t.color === tile.color; };
    let h = 1, v = 1;
    for (let k = c - 1; same(r, k); k--) h++;
    for (let k = c + 1; same(r, k); k++) h++;
    for (let k = r - 1; same(k, c); k--) v++;
    for (let k = r + 1; same(k, c); k++) v++;
    return { h, v };
  }

  makesMatchAt(r, c) {
    const { h, v } = this.lineAt(r, c);
    return h >= 3 || v >= 3;
  }

  // A fish treat swimming down into the cell right below it.
  isFishNudge(a, b) {
    const ta = this.get(a.r, a.c), tb = this.get(b.r, b.c);
    if (!ta || !tb || a.c !== b.c || Math.abs(a.r - b.r) !== 1) return false;
    const [up, down] = a.r < b.r ? [ta, tb] : [tb, ta];
    return up.special === "fish" && down.special !== "fish";
  }

  // Is swapping a and b a legal move: a match, a special swap, or a fish nudge?
  // Leaves the board unchanged.
  swapMakesMatch(a, b) {
    if (this.isSpecialSwap(a, b) || this.isFishNudge(a, b)) return true;
    const ta = this.get(a.r, a.c), tb = this.get(b.r, b.c);
    if (!ta || !tb || ta.color === tb.color) return false;
    this.swap(a, b);
    const ok = this.makesMatchAt(a.r, a.c) || this.makesMatchAt(b.r, b.c);
    this.swap(a, b);
    return ok;
  }

  // Every legal swap as [a, b] pairs.
  findMoves(limit = Infinity) {
    const moves = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const a = { r, c }, b = { r: r + dr, c: c + dc };
          if (this.swapMakesMatch(a, b)) {
            moves.push([a, b]);
            if (moves.length >= limit) return moves;
          }
        }
      }
    }
    return moves;
  }

  hasLegalMove() {
    return this.findMoves(1).length > 0;
  }

  // Rearranges existing tiles until there are no standing matches and at least one move.
  // Returns true on success (the tiles keep their ids, so the renderer can slide them).
  shuffle(rng = this.rng) {
    const cells = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (this.grid[r][c]) cells.push({ r, c });
    const tiles = cells.map(({ r, c }) => this.grid[r][c]);
    for (let attempt = 0; attempt < 200; attempt++) {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
      cells.forEach(({ r, c }, i) => { this.grid[r][c] = tiles[i]; });
      if (this.findMatches().length === 0 && this.hasLegalMove()) return true;
    }
    // Pathological color mix: recolor everything rather than leave a dead board.
    for (let attempt = 0; attempt < 200; attempt++) {
      for (const tile of tiles) if (tile.color != null) tile.color = Math.floor(rng() * this.colorCount);
      if (this.findMatches().length === 0 && this.hasLegalMove()) return true;
    }
    return false;
  }
}

// Has the level been won? `targets` is the generator's { score } or { yarn, boxes, fish }.
export function goalsMet(board, targets, score) {
  if (targets.score != null && score < targets.score) return false;
  if (targets.yarn != null && board.yarnLeft() > 0) return false;
  if (targets.boxes != null && board.boxesLeft() > 0) return false;
  if (targets.fish != null && board.fishCollected < targets.fish) return false;
  return true;
}

// What's still to do, for the HUD: [{ kind, left }] in a fixed order.
export function goalsLeft(board, targets) {
  const out = [];
  if (targets.yarn != null) out.push({ kind: "yarn", left: board.yarnLeft() });
  if (targets.boxes != null) out.push({ kind: "boxes", left: board.boxesLeft() });
  if (targets.fish != null) out.push({ kind: "fish", left: Math.max(0, targets.fish - board.fishCollected) });
  return out;
}

// Fills every existing cell with a color so that no match is standing at the start.
// Returns a 2D color array (null for holes). Used by the generator.
export function fillWithoutMatches(mask, colorCount, rng) {
  const rows = mask.length, cols = mask[0].length;
  const colors = mask.map((row) => row.map(() => null));
  const at = (r, c) => (r >= 0 && c >= 0 && mask[r][c] ? colors[r][c] : null);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      const banned = new Set();
      if (at(r, c - 1) != null && at(r, c - 1) === at(r, c - 2)) banned.add(at(r, c - 1));
      if (at(r - 1, c) != null && at(r - 1, c) === at(r - 2, c)) banned.add(at(r - 1, c));
      const options = [];
      for (let k = 0; k < colorCount; k++) if (!banned.has(k)) options.push(k);
      colors[r][c] = options[Math.floor(rng() * options.length)];
    }
  }
  return colors;
}
