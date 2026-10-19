// board.js — grid state, match detection, cascades, gravity, special-tile creation.
// Pure logic, no rendering. Implemented in M1.
//
// A board is a rows×cols grid. `mask[r][c]` says whether a cell exists (board shapes
// like diamonds and donuts are rectangles with cells masked out). Each existing cell
// holds a tile `{ id, color, special }` or null while a cascade is resolving.
// Tile ids are stable across moves so the renderer can animate the same tile around.
//
// Match kinds, used for scoring now and special-tile creation in M3:
//   "three" — a line of 3
//   "four"  — a line of 4            (M3: Zoomie Cat)
//   "lt"    — an L or T of 5+ cells  (M3: Boom Cat)
//   "five"  — a line of 5+           (M3: Disco Cat)

let nextTileId = 1;

export function makeTile(color) {
  return { id: nextTileId++, color, special: null };
}

export const MATCH_POINTS = { three: 60, four: 120, lt: 180, five: 250 };

export class Board {
  // colors: 2D array of color indices (null where the mask has no cell).
  // colorCount: how many cat colors refills draw from. rng: () => [0, 1) for refills.
  constructor(mask, colors, colorCount, rng) {
    this.rows = mask.length;
    this.cols = mask[0].length;
    this.mask = mask.map((row) => row.slice());
    this.colorCount = colorCount;
    this.rng = rng;
    this.grid = mask.map((row, r) =>
      row.map((exists, c) => (exists && colors[r][c] != null ? makeTile(colors[r][c]) : null))
    );
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
          if (!tile) { j++; continue; }
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
  // masked-out cells (holes), then new tiles drop in from above.
  // Returns { falls: [{ tile, c, fromR, toR }], spawns: [{ tile, c, fromR, toR }] }.
  // Spawn `fromR` is negative-ish (above the column's top cell) for the renderer.
  collapse() {
    const falls = [];
    const spawns = [];
    for (let c = 0; c < this.cols; c++) {
      const cells = [];
      for (let r = 0; r < this.rows; r++) if (this.mask[r][c]) cells.push(r);
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
        const tile = makeTile(Math.floor(this.rng() * this.colorCount));
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
    if (!tile) return { h: 0, v: 0 };
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

  // Would swapping a and b produce a match? Leaves the board unchanged.
  swapMakesMatch(a, b) {
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
      for (const tile of tiles) tile.color = Math.floor(rng() * this.colorCount);
      if (this.findMatches().length === 0 && this.hasLegalMove()) return true;
    }
    return false;
  }
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
