// rng.js — deterministic seeded RNG (mulberry32).
// Level number = seed, so level N is the same board for every player, every retry.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random int in [min, max] inclusive.
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Pick one element from an array.
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
