// renderer.js — Canvas drawing: cat tiles (inline SVG rasterized once), animations,
// particles, screen shake. Implemented in M1 (tiles) and M2 (juice).
//
// M1: the six cats are drawn with Canvas paths in a 100×100 design space and
// rasterized once per tile size into offscreen canvases. Sprites live in cell
// coordinates (x = column, y = row) so a resize never disturbs an animation.
// M2: special cats (striped Zoomie, gift-wrapped Boom, Disco ball), blast effects,
// heart/sparkle particles (capped), combo callouts and screen shake.

const OUTLINE = "#3a2e2a";
const PINK = "#ff9fb4";
const BLUSH = "rgba(255, 105, 170, 0.42)";

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

// Rosy cheeks — every cat gets them.
function blush(ctx, y, dx = 24) {
  ellipse(ctx, 50 - dx, y, 6.5, 4); shape(ctx, BLUSH, null);
  ellipse(ctx, 50 + dx, y, 6.5, 4); shape(ctx, BLUSH, null);
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
    blush(ctx, 64);
    nose(ctx, 63); mouth(ctx, 66); whiskers(ctx, 70);
  },
  // 1 — Tuxedo: wide black head, white blaze + muzzle, red bow tie below the chin.
  (ctx) => {
    ears(ctx, [14, 46, 20, 14, 42, 28], [21, 38, 23, 22, 36, 30], "#2b2b35", "#d47b93");
    ellipse(ctx, 50, 55, 39, 31); shape(ctx, "#2b2b35");
    tri(ctx, 50, 30, 41, 62, 59, 62); shape(ctx, "#fff", null);
    ellipse(ctx, 50, 69, 18, 13); shape(ctx, "#fff", null);
    eyes(ctx, 51, 16, "#c9e34b");
    blush(ctx, 66, 20);
    nose(ctx, 63); mouth(ctx, 66); whiskers(ctx, 70, "#8a8a99");
    tri(ctx, 34, 81, 34, 97, 50, 89); shape(ctx, "#ff5fa2");
    tri(ctx, 66, 81, 66, 97, 50, 89); shape(ctx, "#ff5fa2");
    ellipse(ctx, 50, 89, 4.5, 4.5); shape(ctx, "#e0337f", OUTLINE, 2);
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
    blush(ctx, 62, 25);
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
    blush(ctx, 63, 28);
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
    blush(ctx, 64);
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
    blush(ctx, 68, 26);
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

// --- Special cats --------------------------------------------------------------------

// Zoomie Cat: the cat with bold white racing stripes (painted only onto the cat) and
// pink chevrons pointing the way it will zoom.
function drawZoomie(g, color, px, dir) {
  drawCat(g, color, px / 2, px / 2, px * 0.86);
  g.save();
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = "rgba(255, 255, 255, 0.62)";
  const band = px * 0.085;
  for (const k of [-1, 0, 1]) {
    const off = px / 2 + k * px * 0.2 - band / 2;
    if (dir === "row") g.fillRect(0, off, px, band); else g.fillRect(off, 0, band, px);
  }
  g.restore();
  g.save();
  g.translate(px / 2, px / 2);
  if (dir === "col") g.rotate(Math.PI / 2);
  g.strokeStyle = "#ff3d8b";
  g.lineWidth = px * 0.05;
  g.lineCap = g.lineJoin = "round";
  for (const side of [-1, 1]) {
    g.beginPath();
    const x = side * px * 0.44, w = side * px * 0.06;
    g.moveTo(x - w, -px * 0.08); g.lineTo(x, 0); g.lineTo(x - w, px * 0.08);
    g.stroke();
  }
  g.restore();
}

// Boom Cat: gift-wrapped in a pink ribbon with a bow on top.
function drawBoom(g, color, px) {
  drawCat(g, color, px / 2, px / 2, px * 0.82);
  g.save();
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = "rgba(255, 79, 154, 0.75)";
  g.fillRect(px * 0.455, 0, px * 0.09, px);
  g.fillRect(0, px * 0.6, px, px * 0.09);
  g.restore();
  g.save();
  g.translate(px / 2, px * 0.2);
  g.scale(px / 100, px / 100);
  g.lineJoin = "round";
  g.fillStyle = "#ff4f9a"; g.strokeStyle = OUTLINE; g.lineWidth = 2.5;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(side * 10, -16, side * 24, -10, side * 20, 0);
    g.bezierCurveTo(side * 24, 10, side * 10, 12, 0, 0);
    g.fill(); g.stroke();
  }
  g.beginPath(); g.arc(0, 0, 5, 0, Math.PI * 2);
  g.fillStyle = "#e0337f"; g.fill(); g.stroke();
  g.restore();
}

// Disco Cat: a mirror ball with cat ears, faceted in pastel rainbow, with a happy face.
function drawDisco(g, px) {
  g.save();
  g.scale(px / 100, px / 100);
  g.lineJoin = "round";
  ears(g, [22, 36, 22, 8, 44, 22], [27, 30, 27, 16, 38, 23], "#d9d2f5", "#ffb3d1");
  const R = 37, cx = 50, cy = 56;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
  const grad = g.createRadialGradient(cx - 12, cy - 14, 4, cx, cy, R);
  grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.5, "#e9e3ff"); grad.addColorStop(1, "#b9a8f0");
  g.fillStyle = grad; g.fill();
  g.save();
  g.clip();
  const facets = ["#ffc2dc", "#c8f0ff", "#fff3b0", "#d6c8ff", "#c9ffd9", "#ffd6c2"];
  const step = 9;
  for (let y = cy - R, i = 0; y < cy + R; y += step, i++)
    for (let x = cx - R, j = 0; x < cx + R; x += step, j++) {
      if ((i * 7 + j * 3) % 4 === 0) continue;
      g.fillStyle = facets[(i * 5 + j * 2) % facets.length];
      g.globalAlpha = 0.75;
      g.fillRect(x + 0.8, y + 0.8, step - 1.6, step - 1.6);
    }
  g.globalAlpha = 1;
  g.restore();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
  g.strokeStyle = OUTLINE; g.lineWidth = 3; g.stroke();
  // Happy closed eyes, nose, smile, cheeks.
  g.beginPath();
  g.moveTo(34, 54); g.quadraticCurveTo(39, 47, 44, 54);
  g.moveTo(56, 54); g.quadraticCurveTo(61, 47, 66, 54);
  g.strokeStyle = OUTLINE; g.lineWidth = 3; g.lineCap = "round"; g.stroke();
  blush(g, 62, 22);
  nose(g, 60, "#ff6fae"); mouth(g, 63);
  g.restore();
}

// --- Particles -------------------------------------------------------------------

const MAX_PARTICLES = 160;
const PARTICLE_COLORS = ["#ff5fa2", "#ff8fc0", "#ffb3d1", "#c8a2ff", "#ffd23f", "#ffffff"];
const HEART = new Path2D("M0 0.35C-0.15 0.2-0.5 0-0.5-0.25C-0.5-0.5-0.15-0.6 0-0.3C0.15-0.6 0.5-0.5 0.5-0.25C0.5 0-0.15 0.2 0 0.35Z");
const SPARK = new Path2D("M0-0.5L0.12-0.12L0.5 0L0.12 0.12L0 0.5L-0.12 0.12L-0.5 0L-0.12-0.12Z");

export const COMBO_WORDS = ["Purrfect!", "Meow-velous!", "CATASTROPHIC!"];

// --- Renderer -------------------------------------------------------------------

const horiz = (b) => b.dir === "row";

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
    this.specialCache = new Map();
    this.particles = [];
    this.fx = [];          // short-lived blast effects: { start, ms, draw(ctx, t) }
    this.banner = null;    // combo callout
    this.shakeUntil = 0;
    this.shakeMag = 0;
    this.lastNow = 0;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // Binds a fresh board (new level or retry) and places every tile in its cell.
  setBoard(board) {
    this.board = board;
    this.sprites.clear();
    this.anims = [];
    this.particles = [];
    this.fx = [];
    this.banner = null;
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
      g.shadowColor = "rgba(122, 58, 98, 0.28)";
      g.shadowBlur = px * 0.05;
      g.shadowOffsetY = px * 0.03;
      drawCat(g, color, px / 2, px / 2, px * 0.86);
      return c;
    });
    this.specialCache.clear();

    // Board panel + cell checkerboard, and the clip path that hides tiles above the board.
    const { rows, cols, mask } = this.board;
    const ts = this.ts;
    this.cellClip = new Path2D();
    const bg = document.createElement("canvas");
    bg.width = this.canvas.width; bg.height = this.canvas.height;
    const g = bg.getContext("2d");
    g.scale(this.dpr, this.dpr);
    g.shadowColor = "rgba(240, 71, 143, 0.3)";
    g.shadowBlur = 16;
    g.fillStyle = "rgba(255, 255, 255, 0.7)";
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
        g.fillStyle = (r + c) % 2 ? "#ffe0ee" : "#fff4f9";
        g.beginPath(); g.roundRect(x + 1, y + 1, ts - 2, ts - 2, ts * 0.16); g.fill();
        this.cellClip.rect(x, y, ts, ts);
      }
    this.bgCache = bg;
  }

  // Rasterized special cat (built lazily: most boards only ever see a few).
  specialImage(tile) {
    const key = tile.special === "disco" ? "disco" : `${tile.special}:${tile.color}:${tile.dir || ""}`;
    let img = this.specialCache.get(key);
    if (!img) {
      const px = Math.round(this.ts * this.dpr);
      img = document.createElement("canvas");
      img.width = img.height = px;
      const g = img.getContext("2d");
      g.shadowColor = "rgba(122, 58, 98, 0.28)";
      g.shadowBlur = px * 0.05;
      g.shadowOffsetY = px * 0.03;
      if (tile.special === "zoomie") drawZoomie(g, tile.color, px, tile.dir);
      else if (tile.special === "boom") drawBoom(g, tile.color, px);
      else drawDisco(g, px);
      this.specialCache.set(key, img);
    }
    return img;
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

  // `removed` entries may carry a `delay` (ms) so blasts ripple outward.
  animateClear(removed) {
    const perTile = Math.max(1, Math.min(4, Math.floor(110 / Math.max(1, removed.length))));
    return Promise.all(removed.map(({ tile, r, c, delay = 0 }) => {
      const s = this.sprites.get(tile.id);
      if (!s) return null;
      let burst = false;
      return this.animate(230, (t) => {
        if (!burst && t > 0.25) { burst = true; this.burst(c, r, perTile, tile.special ? 2 : 1); }
        s.scale = t < 0.3 ? 1 + 0.25 * (t / 0.3) : 1.25 * (1 - (t - 0.3) / 0.7);
        s.alpha = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
      }, ease.linear, delay).then(() => this.sprites.delete(tile.id));
    }));
  }

  // One resolve step from board.resolveStep(): new specials pop into being, blasts
  // flash, and everything cleared bursts into hearts and sparkles.
  animateStep({ removed, created, blasts }) {
    for (const b of blasts) this.addBlast(b);
    // Tiles taken out by a blast pop a beat later, rippling out from the blast.
    const matched = new Set();
    if (!blasts.length) removed.forEach(({ r, c }) => matched.add(`${r},${c}`));
    const timed = removed.map((it) => {
      if (!blasts.length) return it;
      let d = Infinity;
      for (const b of blasts) d = Math.min(d, Math.abs(b.r - it.r) + Math.abs(b.c - it.c));
      return { ...it, delay: Math.min(320, 40 + d * 28) };
    });
    const pops = created.map(({ tile, r, c }) => {
      const s = this.sprites.get(tile.id);
      this.burst(c, r, 6, 2.2, true);
      if (!s) return null;
      return this.animate(320, (t) => { s.scale = 1 + 0.35 * Math.sin(Math.PI * t); }, ease.linear);
    });
    const big = removed.length >= 14 || blasts.some((b) => b.special === "disco" || b.radius === 2);
    if (big) this.shake(9, 420);
    else if (blasts.length) this.shake(4, 220);
    return Promise.all([this.animateClear(timed), ...pops]);
  }

  addBlast(b) {
    const start = performance.now();
    if (b.special === "zoomie") {
      this.fx.push({ start, ms: 380, draw: (ctx, t) => {
        const ts = this.ts;
        const thick = ts * (0.9 - 0.6 * t);
        const a = 1 - t;
        ctx.save();
        ctx.globalAlpha = a;
        const across = b.dir === "row";
        const x0 = this.ox, y0 = this.oy;
        const grad = across
          ? ctx.createLinearGradient(0, y0 + (b.r + 0.5) * ts - thick / 2, 0, y0 + (b.r + 0.5) * ts + thick / 2)
          : ctx.createLinearGradient(x0 + (b.c + 0.5) * ts - thick / 2, 0, x0 + (b.c + 0.5) * ts + thick / 2, 0);
        grad.addColorStop(0, "rgba(255, 95, 162, 0)");
        grad.addColorStop(0.5, "rgba(255, 255, 255, 0.95)");
        grad.addColorStop(1, "rgba(255, 95, 162, 0)");
        ctx.fillStyle = grad;
        if (across) ctx.fillRect(x0, y0 + (b.r + 0.5) * ts - thick / 2, ts * this.board.cols, thick);
        else ctx.fillRect(x0 + (b.c + 0.5) * ts - thick / 2, y0, thick, ts * this.board.rows);
        ctx.restore();
      } });
      // Sparkles streak along the line.
      const n = horiz(b) ? this.board.cols : this.board.rows;
      for (let i = 0; i < n; i += 2) {
        const [x, y] = horiz(b) ? [i, b.r] : [b.c, i];
        this.spawn(x + 0.5, y + 0.5, horiz(b) ? (i < b.c ? -1 : 1) * 4 : 0, horiz(b) ? 0 : (i < b.r ? -1 : 1) * 4, "spark");
      }
    } else if (b.special === "boom") {
      const reach = (b.radius || 1) + 0.6;
      this.fx.push({ start, ms: 450, draw: (ctx, t) => {
        const ts = this.ts;
        const cx = this.ox + (b.c + 0.5) * ts, cy = this.oy + (b.r + 0.5) * ts;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.fillStyle = "#ffd1e6";
        ctx.beginPath(); ctx.arc(cx, cy, ts * reach * ease.outBack(Math.min(1, t * 1.6)), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = "#ff5fa2";
        ctx.lineWidth = ts * 0.18 * (1 - t);
        ctx.beginPath(); ctx.arc(cx, cy, ts * reach * (0.3 + t), 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      } });
    } else if (b.special === "disco") {
      const targets = (b.targets || []).slice(0, 40);
      this.fx.push({ start, ms: 520, draw: (ctx, t) => {
        const ts = this.ts;
        const sx = this.ox + (b.c + 0.5) * ts, sy = this.oy + (b.r + 0.5) * ts;
        const reach = Math.min(1, t * 2.2);
        ctx.save();
        ctx.globalAlpha = t < 0.6 ? 1 : (1 - t) / 0.4;
        ctx.lineCap = "round";
        targets.forEach(({ r, c }, i) => {
          const tx = this.ox + (c + 0.5) * ts, ty = this.oy + (r + 0.5) * ts;
          ctx.strokeStyle = PARTICLE_COLORS[i % 5];
          ctx.lineWidth = ts * 0.07;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + (tx - sx) * reach, sy + (ty - sy) * reach); ctx.stroke();
        });
        ctx.restore();
      } });
    }
  }

  // --- Juice: particles, combo text, shake ---

  spawn(x, y, vx, vy, kind = Math.random() < 0.55 ? "heart" : "spark", big = 1) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      x, y, vx, vy, kind, life: 0, max: 0.55 + Math.random() * 0.45,
      size: (0.16 + Math.random() * 0.14) * big,
      color: PARTICLE_COLORS[(Math.random() * PARTICLE_COLORS.length) | 0],
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 8,
    });
  }

  // `n` particles flying out of cell (x, y); units are cells and cells/second.
  burst(x, y, n, speed = 1, sparkly = false) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (1.5 + Math.random() * 2.5) * speed;
      this.spawn(x + 0.5, y + 0.5, Math.cos(a) * v, Math.sin(a) * v - 1.5, sparkly ? "spark" : undefined);
    }
  }

  // Combo callout: level 1 → "Purrfect!", 2 → "Meow-velous!", 3+ → "CATASTROPHIC!".
  comboText(level) {
    level = Math.min(level, COMBO_WORDS.length);
    this.banner = { text: COMBO_WORDS[level - 1], level, start: performance.now(), ms: 1150 };
    if (level >= 2) this.shake(level >= 3 ? 10 : 5, 380);
  }

  shake(mag, ms) {
    const now = performance.now();
    this.shakeMag = Math.max(now < this.shakeUntil ? this.shakeMag : 0, mag);
    this.shakeUntil = Math.max(this.shakeUntil, now + ms);
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
    const dt = Math.min(0.05, (now - (this.lastNow || now)) / 1000);
    this.lastNow = now;
    for (const p of this.particles) {
      p.life += dt;
      p.vy += 9 * dt;           // gentle gravity
      p.vx *= 1 - 1.5 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
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
    let sx = 0, sy = 0;
    if (now < this.shakeUntil) {
      const m = this.shakeMag * Math.min(1, (this.shakeUntil - now) / 250);
      sx = (Math.random() * 2 - 1) * m; sy = (Math.random() * 2 - 1) * m;
    }
    const base = () => ctx.setTransform(this.dpr, 0, 0, this.dpr, sx * this.dpr, sy * this.dpr);
    ctx.drawImage(this.bgCache, sx * this.dpr, sy * this.dpr);
    base();
    const ts = this.ts;

    if (this.selected) {
      const { r, c } = this.selected;
      const x = this.ox + c * ts, y = this.oy + r * ts;
      const glow = 0.55 + 0.25 * Math.sin(now / 160);
      ctx.fillStyle = `rgba(255, 95, 162, ${glow})`;
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
      const special = s.tile.special;
      const img = special ? this.specialImage(s.tile) : this.catCache[s.tile.color];
      const cx = this.ox + (s.x + 0.5) * ts, cy = this.oy + (s.y + 0.5) * ts;
      if (special) {
        // Specials breathe and glow so they read at a glance.
        scale *= 1 + 0.04 * Math.sin(now / 180 + s.x + s.y);
        ctx.globalAlpha = s.alpha * (0.35 + 0.15 * Math.sin(now / 220));
        const glow = ctx.createRadialGradient(cx, cy, ts * 0.1, cx, cy, ts * 0.55);
        glow.addColorStop(0, special === "disco" ? "#fff6a8" : "#ffffff");
        glow.addColorStop(1, "rgba(255, 159, 207, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(cx - ts / 2, cy - ts / 2, ts, ts);
        if (special === "disco") rot += 0.08 * Math.sin(now / 260);
      }
      ctx.globalAlpha = s.alpha;
      ctx.translate(cx, cy);
      if (rot) ctx.rotate(rot);
      ctx.drawImage(img, (-ts / 2) * scale, (-ts / 2) * scale, ts * scale, ts * scale);
      if (special === "disco") this.drawGlint(ctx, now, ts * scale);
      base();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    this.fx = this.fx.filter((f) => {
      const t = (now - f.start) / f.ms;
      if (t >= 1) return false;
      if (t >= 0) f.draw(ctx, t);
      return true;
    });

    for (const p of this.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      ctx.fillStyle = p.color;
      const size = ts * p.size * (k < 0.15 ? k / 0.15 : 1);
      ctx.translate(this.ox + p.x * ts, this.oy + p.y * ts);
      ctx.rotate(p.kind === "heart" ? p.rot * 0.15 : p.rot);
      ctx.scale(size, size);
      ctx.fill(p.kind === "heart" ? HEART : SPARK);
      base();
    }
    ctx.globalAlpha = 1;

    if (this.banner) this.drawBanner(ctx, now);
  }

  // A twinkle orbiting the Disco Cat's mirror ball.
  drawGlint(ctx, now, size) {
    const a = now / 400;
    ctx.save();
    ctx.translate(Math.cos(a) * size * 0.22, Math.sin(a) * size * 0.2 + size * 0.06);
    ctx.rotate(a);
    ctx.scale(size * 0.22, size * 0.22);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fill(SPARK);
    ctx.restore();
  }

  drawBanner(ctx, now) {
    const b = this.banner;
    const t = (now - b.start) / b.ms;
    if (t >= 1) { this.banner = null; return; }
    const ts = this.ts;
    const cx = this.ox + (ts * this.board.cols) / 2;
    const cy = this.oy + (ts * this.board.rows) * 0.42;
    const pop = t < 0.25 ? ease.outBack(t / 0.25) : 1;
    const rise = t > 0.7 ? (t - 0.7) / 0.3 : 0;
    const width = ts * this.board.cols;
    const fontPx = Math.min(width / (b.text.length * 0.5), ts * (b.level >= 3 ? 1.0 : 0.85));
    ctx.save();
    ctx.globalAlpha = 1 - rise;
    ctx.translate(cx, cy - rise * ts * 0.8);
    ctx.scale(pop, pop);
    ctx.rotate(-0.06 + (b.level >= 3 ? 0.03 * Math.sin(now / 50) : 0));
    ctx.font = `700 ${fontPx}px Fredoka, "Baloo 2", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = fontPx * 0.22;
    ctx.strokeStyle = "#7a3a62";
    ctx.strokeText(b.text, 0, fontPx * 0.06);
    ctx.lineWidth = fontPx * 0.12;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText(b.text, 0, 0);
    const grad = ctx.createLinearGradient(0, -fontPx / 2, 0, fontPx / 2);
    const tops = ["#ff8fc0", "#c8a2ff", "#ffd23f"];
    grad.addColorStop(0, tops[b.level - 1]);
    grad.addColorStop(1, "#f0478f");
    ctx.fillStyle = grad;
    ctx.fillText(b.text, 0, 0);
    ctx.restore();
  }
}
