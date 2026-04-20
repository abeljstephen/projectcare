// Ported from system-google-sheets-addon/core/helpers/rng.js
// File: helpers/rng.gs
// Lightweight deterministic RNG helpers for reproducibility (pure Apps Script - global)
// Force sync - Jan 16 2026 - Node.js removed

function toUint32(x) {
  return (x >>> 0);
}

function normalizeSeed(seed) {
  if (seed == null) return 0x9E3779B9; // default constant
  if (typeof seed === 'number' && Number.isFinite(seed)) return toUint32(Math.floor(seed));
  // strings / objects → hash
  return hashSeed(seed);
}

function hashSeed(obj) {
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    let h = 2166136261 >>> 0; // FNV-1a base
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return toUint32(h);
  } catch {
    return 0xA5A5A5A5;
  }
}

/** Mulberry32 core */
function mulberry32(seed) {
  let t = toUint32(seed || 0);
  return function next() {
    t = toUint32(t + 0x6D2B79F5);
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296; // [0,1)
  };
}

function makeRng(seed) {
  const s = normalizeSeed(seed);
  const core = mulberry32(s);
  return {
    seed: s,
    next: core, // float in [0,1)
    float() { return core(); },
    int(maxExclusive) {
      const m = Math.max(1, Math.floor(maxExclusive));
      return Math.floor(core() * m);
    },
    range(min, max) {
      const a = Number(min), b = Number(max);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
      if (a === b) return a;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      return lo + core() * (hi - lo);
    },
    pick(arr) {
      if (!Array.isArray(arr) || !arr.length) return undefined;
      return arr[this.int(arr.length)];
    }
  };
}
