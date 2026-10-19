// audio.js — Web Audio sound effects (pops, purrs, fanfares) + mute toggle. M2.
//
// Every sound is synthesized on the fly (oscillators + filtered noise), so there are
// no audio files to download or cache. The AudioContext is created on the first tap
// (browsers only allow sound after a user gesture). Sound starts muted — she plays
// with it off, so the game leans on visuals and haptics — and the toggle is remembered.

const MUTE_KEY = "purrfect-match:muted";

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = true;
try { muted = localStorage.getItem(MUTE_KEY) !== "0"; } catch { /* storage blocked */ }

// Call from a user gesture (tap). Safe to call repeatedly.
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    // A gentle compressor keeps big cascades from clipping on phone speakers.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

export function isMuted() { return muted; }

export function setMuted(value) {
  muted = value;
  try { localStorage.setItem(MUTE_KEY, value ? "1" : "0"); } catch { /* session only */ }
  if (master) master.gain.setTargetAtTime(value ? 0 : 0.55, ctx.currentTime, 0.02);
}

// Phones pause the page in the background; let the audio clock sleep too.
document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else ctx.resume().catch(() => {});
});

const ready = () => ctx && !muted && ctx.state === "running";

// --- Building blocks -------------------------------------------------------------

function envelope(gain, t, attack, dur, vol) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone({ freq, to, type = "sine", dur = 0.15, vol = 0.3, at = 0, attack = 0.005 }) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  envelope(gain, t, attack, dur, vol);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise({ dur = 0.2, vol = 0.2, at = 0, filter = "bandpass", freq = 1000, to, q = 1, attack = 0.005 }) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = ctx.createGain();
  envelope(gain, t, attack, dur, vol);
  src.connect(f).connect(gain).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

const NOTE = (semitones) => 523.25 * 2 ** (semitones / 12); // C5 = 0

// --- Sound effects ---------------------------------------------------------------

export const sfx = {
  // Soft tick as two cats trade places.
  swap() {
    if (!ready()) return;
    tone({ freq: 880, to: 1200, type: "triangle", dur: 0.06, vol: 0.08 });
  },

  // A swap that doesn't match: a little "nope" boop.
  nope() {
    if (!ready()) return;
    tone({ freq: 300, to: 220, type: "triangle", dur: 0.14, vol: 0.12 });
  },

  // Bubbly pop, climbing a major scale as the cascade grows.
  pop(cascade = 1) {
    if (!ready()) return;
    const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
    const f = NOTE(scale[Math.min(cascade - 1, scale.length - 1)]);
    tone({ freq: f * 1.6, to: f, type: "sine", dur: 0.13, vol: 0.28 });
    tone({ freq: f * 2, to: f * 3, type: "sine", dur: 0.05, vol: 0.08, at: 0.02 });
    noise({ dur: 0.03, vol: 0.06, freq: 3000, q: 2 });
  },

  // Sparkly two-note chime when a special cat appears.
  sparkle() {
    if (!ready()) return;
    tone({ freq: NOTE(12), type: "triangle", dur: 0.18, vol: 0.12 });
    tone({ freq: NOTE(19), type: "triangle", dur: 0.25, vol: 0.1, at: 0.07 });
  },

  // Zoomie Cat: a whoosh sweeping up.
  zoomie() {
    if (!ready()) return;
    noise({ dur: 0.32, vol: 0.32, freq: 500, to: 5000, q: 1.5, attack: 0.03 });
    tone({ freq: 400, to: 1400, type: "sawtooth", dur: 0.18, vol: 0.04 });
  },

  // Boom Cat: a soft, round thump (cute, not scary).
  boom() {
    if (!ready()) return;
    tone({ freq: 160, to: 45, type: "sine", dur: 0.42, vol: 0.55 });
    noise({ dur: 0.3, vol: 0.25, filter: "lowpass", freq: 900, to: 120 });
  },

  // Disco Cat: a quick glittery arpeggio.
  disco() {
    if (!ready()) return;
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) =>
      tone({ freq: NOTE(s + 12), type: "triangle", dur: 0.14, vol: 0.1, at: i * 0.045 }));
    noise({ dur: 0.4, vol: 0.06, filter: "highpass", freq: 6000, at: 0.05 });
  },

  // Combo callout: a rising chord, brighter each step.
  combo(level) {
    if (!ready()) return;
    const root = [0, 5, 7][Math.min(level, 3) - 1] ?? 7;
    [0, 4, 7, 12].forEach((s, i) =>
      tone({ freq: NOTE(root + s), type: "triangle", dur: 0.22, vol: 0.12, at: i * 0.05 }));
  },

  // Level complete: fanfare, then a contented purr.
  win() {
    if (!ready()) return;
    const melody = [[0, 0], [4, 0.12], [7, 0.24], [12, 0.36]];
    for (const [s, at] of melody) tone({ freq: NOTE(s), type: "triangle", dur: 0.2, vol: 0.18, at });
    for (const s of [0, 4, 7, 12]) tone({ freq: NOTE(s), type: "sine", dur: 0.9, vol: 0.09, at: 0.5, attack: 0.02 });
    for (const s of [12, 16, 19]) tone({ freq: NOTE(s), type: "triangle", dur: 0.7, vol: 0.06, at: 0.5, attack: 0.02 });
    sfx.purr(1.1);
  },

  // Purr: low rumbly noise pulsing ~24 times a second, breathing in and out.
  purr(at = 0) {
    if (!ready()) return;
    const t = ctx.currentTime + at;
    const dur = 1.8;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 24;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(pulse.gain);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.7, t + 0.35);   // breathe in
    out.gain.exponentialRampToValueAtTime(0.25, t + 0.9);
    out.gain.exponentialRampToValueAtTime(0.6, t + 1.25);   // breathe out
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(pulse).connect(out).connect(master);
    src.start(t);
    lfo.start(t);
    src.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  },

  // Out of moves: a gentle descending "aww".
  lose() {
    if (!ready()) return;
    tone({ freq: NOTE(7), to: NOTE(5), type: "triangle", dur: 0.3, vol: 0.14 });
    tone({ freq: NOTE(3), to: NOTE(0), type: "triangle", dur: 0.45, vol: 0.14, at: 0.28 });
  },
};

// Haptics: short buzz on matches, a longer one for specials. Not every browser has it.
export function buzz(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
}
