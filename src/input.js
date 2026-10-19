// input.js — touch handling: swipe-to-swap and tap-tap-to-swap. Implemented in M1.
//
// Uses Pointer Events, so touch, mouse and pen all behave the same:
//   - press on a cat and drag ~a third of a tile in any direction → swap that way
//   - tap a cat, then tap a neighbour → swap; tap it again (or far away) → deselect/reselect
//
// attachInput(canvas, renderer, { onSwap(a, b), onSelect(cell | null), canInteract(), onTap?(cell) })
// onTap, when given, sees every press first; returning true swallows it (Paw Swipe aiming).

export function attachInput(canvas, renderer, handlers) {
  let press = null;     // { cell, x, y, id } while a pointer is down on a tile
  let selected = null;

  const select = (cell) => {
    selected = cell;
    handlers.onSelect(cell);
  };

  const trySwap = (a, b) => {
    select(null);
    if (renderer.board.exists(b.r, b.c)) handlers.onSwap(a, b);
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (!handlers.canInteract()) return;
    const cell = renderer.cellAt(e.clientX, e.clientY);
    if (!cell) { select(null); return; }
    if (handlers.onTap && handlers.onTap(cell)) { select(null); return; }
    press = { cell, x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    const threshold = renderer.ts * 0.35;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
    const from = press.cell;
    press = null;
    const to = Math.abs(dx) > Math.abs(dy)
      ? { r: from.r, c: from.c + Math.sign(dx) }
      : { r: from.r + Math.sign(dy), c: from.c };
    trySwap(from, to);
  });

  const release = (e) => {
    if (!press || e.pointerId !== press.id) return;
    const cell = press.cell;
    press = null;
    if (!handlers.canInteract()) return;
    if (!selected) select(cell);
    else if (selected.r === cell.r && selected.c === cell.c) select(null);
    else if (Math.abs(selected.r - cell.r) + Math.abs(selected.c - cell.c) === 1) trySwap(selected, cell);
    else select(cell);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", () => { press = null; });

  return {
    clearSelection() { if (selected) select(null); },
  };
}
