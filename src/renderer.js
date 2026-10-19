// renderer.js — Canvas drawing: cat tiles (inline SVG rasterized once), animations,
// particles, screen shake. Implemented in M1 (tiles) and M2 (juice).
//
// M1: the six cats are drawn with Canvas paths in a 100×100 design space and
// rasterized once per tile size into offscreen canvases. Sprites live in cell
// coordinates (x = column, y = row) so a resize never disturbs an animation.

const OUTLINE = "#3a2e2a";
const PINK = "#ff9fb4";

export const CATS = ["Ginger", "Tuxedo", "Siamese", "Grey Tabby", "Calico", "Black Cat"];

// --- Easing --------------------------------------------------------------------

export const ease = {
  linear: (t) => t,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  outBack: (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
  outBounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

// --- Cat faces (100×100 design space, face roughly centered at 50,55) ------------

function shape(ctx, fill, stroke = OUTLINE, width = 3) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

function tri(ctx, x1, y1, x2, y2, x3, y3) {
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
}

function ellipse(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

// A pair of mirrored ears; `pts` describes the left ear, `inner` its pink lining.
function ears(ctx, pts, inner, fill, innerFill = PINK, rightFill = fill) {
  tri(ctx, ...pts); shape(ctx, fill);
  tri(ctx, ...mirror(pts)); shape(ctx, rightFill);
  if (inner) {
    tri(ctx, ...inner); shape(ctx, innerFill, null);
    tri(ctx, ...mirror(inner)); shape(ctx, innerFill, null);
  }
}

function mirror(pts) {
  return pts.map((v, i) => (i % 2 === 0 ? 100 - v : v));
}

function eyes(ctx, y, dx, iris, { rx = 7, ry = 8, slit = false, tilt = 0 } = {}) {
  for (const side of [-1, 1]) {
    const x = 50 + side * dx;
    ellipse(ctx, x, y, rx, ry, side * tilt); shape(ctx, iris, OUTLINE, 2);
    if (slit) { ellipse(ctx, x, y, rx * 0.25, ry * 0.75); shape(ctx, "#1d1a22", null); }
    else { ellipse(ctx, x, y + 1, rx * 0.55, ry * 0.65); shape(ctx, "#1d1a22", null); }
    ellipse(ctx, x - rx * 0.3, y - ry * 0.35, rx * 0.28, rx * 0.28); shape(ctx, "#fff", null);
  }
}

function nose(ctx, y, color = PINK) {
  tri(ctx, 45, y, 55, y, 50, y + 5);
  ctx.lineJoin = "round";
  shape(ctx, color, OUTLINE, 2);
}

function mouth(ctx, y, color = OUTLINE) {
  ctx.beginPath();
  ctx.moveTo(50, y); ctx.lineTo(50, y + 4);
  ctx.moveTo(43, y + 5); ctx.quadraticCurveTo(46.5, y + 8, 50, y + 4);
  ctx.quadraticCurveTo(53.5, y + 8, 57, y + 5);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.stroke();
}

function whiskers(ctx, y, color = OUTLINE) {
  ctx.beginPath();
  for (const side of [-1, 1]) {
    for (const k of [-1, 0, 1]) {
      ctx.moveTo(50 + side * 14, y + k * 3);
      ctx.lineTo(50 + side * 36, y + k * 6 - 2);
    }
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.lineCap = "round"; ctx.stroke();
}

function stripes(ctx, lines, color, width = 4) {
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of lines) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.stroke();
}

const DRAW_CAT = [
  // 0 — Ginger: round head, tall pointy ears, forehead + cheek stripes, green eyes.
  (ctx) => {
    ears(ctx, [16, 42, 20, 6, 46, 26], [23, 34, 24, 16, 38, 27], "#ff9d42");
    ellipse(ctx, 50, 57, 37, 33); shape(ctx, "#ff9d42");
    stripes(ctx, [[50, 26, 50, 36], [40, 28, 42, 36], [60, 28, 58, 36],
      [14, 56, 25, 58], [15, 64, 25, 64], [86, 56, 75, 58], [85, 64, 75, 64]], "#d9661c");
    ellipse(ctx, 43, 70, 9, 7); shape(ctx, "#ffe2c2", null);
    ellipse(ctx, 57, 70, 9, 7); shape(ctx, "#ffe2c2", null);
    eyes(ctx, 52, 14, "#7cc84d");
    nose(ctx, 63); mouth(ctx, 66); whiskers(ctx, 70);
  },
  // 1 — Tuxedo: wide black head, white blaze + muzzle, red bow tie below the chin.
  (ctx) => {
    ears(ctx, [14, 46, 20, 14, 42, 28], [21, 38, 23, 22, 36, 30], "#2b2b35", "#d47b93");
    ellipse(ctx, 50, 55, 39, 31); shape(ctx, "#2b2b35");
    tri(ctx, 50, 30, 41, 62, 59, 62); shape(ctx, "#fff", null);
    ellipse(ctx, 50, 69, 18, 13); shape(ctx, "#fff", null);
    eyes(ctx, 51, 16, "#c9e34b");
    nose(ctx, 63); mouth(ctx, 66); whiskers(ctx, 70, "#8a8a99");
    tri(ctx, 34, 81, 34, 97, 50, 89); shape(ctx, "#e8394d");
    tri(ctx, 66, 81, 66, 97, 50, 89); shape(ctx, "#e8394d");
    ellipse(ctx, 50, 89, 4.5, 4.5); shape(ctx, "#c4213a", OUTLINE, 2);
  },
  // 2 — Siamese: wedge head, huge dark ears, chocolate mask, blue almond eyes.
  (ctx) => {
    ears(ctx, [10, 50, 8, 4, 44, 26], [17, 40, 15, 16, 35, 29], "#6b4a3a", "#c99a85");
    ctx.beginPath();
    ctx.moveTo(50, 92);
    ctx.bezierCurveTo(30, 90, 14, 72, 15, 52);
    ctx.bezierCurveTo(16, 32, 32, 22, 50, 22);
    ctx.bezierCurveTo(68, 22, 84, 32, 85, 52);
    ctx.bezierCurveTo(86, 72, 70, 90, 50, 92);
    shape(ctx, "#f4e6cc");
    ellipse(ctx, 50, 68, 17, 19); shape(ctx, "#8a6450", null);
    eyes(ctx, 50, 16, "#4fa8ff", { rx: 8, ry: 5.5, tilt: 0.25 });
    nose(ctx, 62, "#3a2620"); mouth(ctx, 66, "#2a1a14"); whiskers(ctx, 72, "#f4e6cc");
  },
  // 3 — Grey Tabby: wide squarish head, small round ears, "M" brow, amber eyes.
  (ctx) => {
    ears(ctx, [12, 40, 20, 16, 38, 28], [19, 35, 22, 22, 32, 30], "#a3adb8");
    ctx.beginPath(); ctx.roundRect(7, 26, 86, 62, 28); shape(ctx, "#a3adb8");
    ctx.beginPath();
    ctx.moveTo(36, 39); ctx.lineTo(41, 30); ctx.lineTo(50, 38); ctx.lineTo(59, 30); ctx.lineTo(64, 39);
    ctx.strokeStyle = "#66717e"; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.stroke();
    stripes(ctx, [[9, 52, 21, 54], [9, 61, 21, 61], [91, 52, 79, 54], [91, 61, 79, 61]], "#66717e");
    ellipse(ctx, 42, 70, 10, 8); shape(ctx, "#f2f4f7", null);
    ellipse(ctx, 58, 70, 10, 8); shape(ctx, "#f2f4f7", null);
    eyes(ctx, 52, 17, "#ffb12e");
    nose(ctx, 63); mouth(ctx, 66); whiskers(ctx, 71);
  },
  // 4 — Calico: white round head, orange + black patches, one folded ear.
  (ctx) => {
    tri(ctx, 15, 44, 19, 8, 44, 26); shape(ctx, "#f29a4a");
    tri(ctx, 22, 36, 23, 18, 37, 28); shape(ctx, PINK, null);
    tri(ctx, 58, 26, 92, 20, 84, 46); shape(ctx, "#3b3536");   // folded ear tips outward
    ctx.save();
    ellipse(ctx, 50, 57, 36, 34);
    shape(ctx, "#fffaf2", null);
    ctx.clip();
    ellipse(ctx, 30, 40, 22, 19); shape(ctx, "#f29a4a", null);
    ellipse(ctx, 74, 38, 19, 16); shape(ctx, "#3b3536", null);
    ellipse(ctx, 68, 86, 14, 9); shape(ctx, "#f29a4a", null);
    ctx.restore();
    ellipse(ctx, 50, 57, 36, 34); shape(ctx, "transparent");
    eyes(ctx, 52, 15, "#5cb85c");
    nose(ctx, 63); mouth(ctx, 66); whiskers(ctx, 71);
  },
  // 5 — Black Cat: curled tail, tall tufted ears, big yellow slit eyes.
  (ctx) => {
    ctx.beginPath();
    ctx.moveTo(70, 88); ctx.bezierCurveTo(96, 92, 100, 62, 88, 50);
    ctx.bezierCurveTo(82, 44, 92, 36, 96, 42);
    ctx.lineCap = "round";
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 13; ctx.stroke();
    ctx.strokeStyle = "#34304a"; ctx.lineWidth = 8; ctx.stroke();
    ears(ctx, [18, 44, 14, 2, 44, 26], [24, 36, 21, 14, 37, 29], "#34304a", "#a46a8d");
    stripes(ctx, [[17, 6, 13, 0], [83, 6, 87, 0]], "#34304a", 3);
    ellipse(ctx, 50, 58, 35, 32); shape(ctx, "#34304a");
    eyes(ctx, 54, 15, "#ffd23f", { rx: 10, ry: 11, slit: true });
    nose(ctx, 66, "#ff8fb0"); mouth(ctx, 69, "#a99cc7"); whiskers(ctx, 72, "#a99cc7");
  },
];

// Draws one cat at (x, y) center, `size` px wide, onto any context (handy for UI too).
export function drawCat(ctx, color, x, y, size) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 100, size / 100);
  ctx.lineJoin = "round";
  DRAW_CAT[color](ctx);
  ctx.restore();
}

// --- Renderer -------------------------------------------------------------------

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.board = null;
    this.sprites = new Map(); // tile id -> { tile, x, y, scale, alpha }
    this.anims = [];
    this.selected = null;
    this.hint = null;
    this.topInset = 0;
    this.catCache = [];
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // Binds a fresh board (new level or retry) and places every tile in its cell.
  setBoard(board) {
    this.board = board;
    this.sprites.clear();
    this.anims = [];
    this.selected = null;
    this.hint = null;
    for (let r = 0; r < board.rows; r++)
      for (let c = 0; c < board.cols; c++) {
        const tile = board.grid[r][c];
        if (tile) this.addSprite(tile, r, c);
      }
    this.layout();
  }

  addSprite(tile, y, x) {
    const s = { tile, x, y, scale: 1, alpha: 1 };
    this.sprites.set(tile.id, s);
    return s;
  }

  // Portrait-first: the board takes the full width (minus gutters) below the HUD,
  // capped so it also fits the height on landscape/desktop.
  layout(topInset = this.topInset) {
    this.topInset = topInset;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.w = w; this.h = h;
    if (!this.board) return;
    const pad = 12;
    const { rows, cols } = this.board;
    const availH = h - topInset - pad * 2;
    this.ts = Math.floor(Math.min((w - pad * 2) / cols, availH / rows, 72));
    this.ox = Math.round((w - this.ts * cols) / 2);
    this.oy = Math.round(topInset + pad + Math.max(0, (availH - this.ts * rows) / 2));
    this.buildCaches();
  }

  buildCaches() {
    const px = Math.round(this.ts * this.dpr);
    this.catCache = DRAW_CAT.map((_, color) => {
      const c = document.createElement("canvas");
      c.width = c.height = px;
      const g = c.getContext("2d");
      g.shadowColor = "rgba(58, 46, 42, 0.28)";
      g.shadowBlur = px * 0.05;
      g.shadowOffsetY = px * 0.03;
      drawCat(g, color, px / 2, px / 2, px * 0.86);
      return c;
    });

    // Board panel + cell checkerboard, and the clip path that hides tiles above the board.
    const { rows, cols, mask } = this.board;
    const ts = this.ts;
    this.cellClip = new Path2D();
    const bg = document.createElement("canvas");
    bg.width = this.canvas.width; bg.height = this.canvas.height;
    const g = bg.getContext("2d");
    g.scale(this.dpr, this.dpr);
    g.shadowColor = "rgba(180, 90, 50, 0.25)";
    g.shadowBlur = 14;
    g.fillStyle = "rgba(255, 255, 255, 0.55)";
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (!mask[r][c]) continue;
        g.beginPath();
        g.roundRect(this.ox + c * ts - 3, this.oy + r * ts - 3, ts + 6, ts + 6, ts * 0.22);
        g.fill();
      }
    g.shadowColor = "transparent";
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (!mask[r][c]) continue;
        const x = this.ox + c * ts, y = this.oy + r * ts;
        g.fillStyle = (r + c) % 2 ? "#ffe9d9" : "#fff6ee";
        g.beginPath(); g.roundRect(x + 1, y + 1, ts - 2, ts - 2, ts * 0.16); g.fill();
        this.cellClip.rect(x, y, ts, ts);
      }
    this.bgCache = bg;
  }

  // Screen point -> board cell, or null when outside an existing cell.
  cellAt(clientX, clientY) {
    if (!this.board) return null;
    const rect = this.canvas.getBoundingClientRect();
    const c = Math.floor((clientX - rect.left - this.ox) / this.ts);
    const r = Math.floor((clientY - rect.top - this.oy) / this.ts);
    return this.board.exists(r, c) ? { r, c } : null;
  }

  // --- Animation primitives ---

  // Runs `step(easedT)` every frame for `ms`, after `delay`; resolves when done.
  animate(ms, step, easing = ease.linear, delay = 0) {
    return new Promise((resolve) => {
      this.anims.push({ start: performance.now() + delay, ms, step, easing, resolve });
    });
  }

  slide(sprite, toX, toY, ms, easing, delay = 0) {
    const fx = sprite.x, fy = sprite.y;
    return this.animate(ms, (t) => {
      sprite.x = fx + (toX - fx) * t;
      sprite.y = fy + (toY - fy) * t;
    }, easing, delay);
  }

  animateSwap(a, b) {
    const sa = this.sprites.get(this.board.grid[a.r][a.c].id);
    const sb = this.sprites.get(this.board.grid[b.r][b.c].id);
    // Called after board.swap: each sprite slides to where its tile now lives.
    return Promise.all([
      this.slide(sa, a.c, a.r, 170, ease.inOutQuad),
      this.slide(sb, b.c, b.r, 170, ease.inOutQuad),
    ]);
  }

  animateClear(removed) {
    return Promise.all(removed.map(({ tile }) => {
      const s = this.sprites.get(tile.id);
      if (!s) return null;
      return this.animate(230, (t) => {
        s.scale = t < 0.3 ? 1 + 0.25 * (t / 0.3) : 1.25 * (1 - (t - 0.3) / 0.7);
        s.alpha = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
      }).then(() => this.sprites.delete(tile.id));
    }));
  }

  animateCollapse({ falls, spawns }) {
    const jobs = [];
    for (const f of falls) {
      const s = this.sprites.get(f.tile.id);
      jobs.push(this.slide(s, f.c, f.toR, this.fallMs(f.toR - f.fromR), ease.outBounce));
    }
    for (const sp of spawns) {
      const s = this.addSprite(sp.tile, sp.fromR, sp.c);
      jobs.push(this.slide(s, sp.c, sp.toR, this.fallMs(sp.toR - sp.fromR), ease.outBounce));
    }
    return Promise.all(jobs);
  }

  fallMs(rows) {
    return 160 + 70 * Math.sqrt(Math.max(1, rows));
  }

  // After board.shuffle(): every sprite glides to its tile's new cell.
  animateShuffle() {
    const jobs = [];
    for (let r = 0; r < this.board.rows; r++)
      for (let c = 0; c < this.board.cols; c++) {
        const tile = this.board.grid[r][c];
        if (tile) jobs.push(this.slide(this.sprites.get(tile.id), c, r, 450, ease.inOutQuad));
      }
    return Promise.all(jobs);
  }

  // --- Frame ---

  loop(now) {
    requestAnimationFrame(this.loop);
    const still = [];
    for (const a of this.anims) {
      if (now < a.start) { still.push(a); continue; }
      const t = Math.min(1, (now - a.start) / a.ms);
      a.step(a.easing(t));
      if (t >= 1) a.resolve(); else still.push(a);
    }
    this.anims = still;
    this.draw(now);
  }

  draw(now) {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.board || !this.ts) return;
    ctx.drawImage(this.bgCache, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const ts = this.ts;

    if (this.selected) {
      const { r, c } = this.selected;
      const x = this.ox + c * ts, y = this.oy + r * ts;
      const glow = 0.55 + 0.25 * Math.sin(now / 160);
      ctx.fillStyle = `rgba(255, 138, 92, ${glow})`;
      ctx.beginPath(); ctx.roundRect(x + 1, y + 1, ts - 2, ts - 2, ts * 0.16); ctx.fill();
    }

    ctx.save();
    ctx.clip(this.cellClip);
    for (const s of this.sprites.values()) {
      let scale = s.scale;
      let rot = 0;
      const atRest = Number.isInteger(s.x) && Number.isInteger(s.y);
      if (atRest && this.selected && this.selected.r === s.y && this.selected.c === s.x) {
        scale *= 1.08 + 0.04 * Math.sin(now / 120);
      }
      if (atRest && this.hint && this.hint.some((p) => p.r === s.y && p.c === s.x)) {
        rot = 0.12 * Math.sin(now / 70) * Math.max(0, Math.sin(now / 400));
      }
      const img = this.catCache[s.tile.color];
      const cx = this.ox + (s.x + 0.5) * ts, cy = this.oy + (s.y + 0.5) * ts;
      ctx.globalAlpha = s.alpha;
      ctx.translate(cx, cy);
      if (rot) ctx.rotate(rot);
      ctx.drawImage(img, (-ts / 2) * scale, (-ts / 2) * scale, ts * scale, ts * scale);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
