/* ============================================================================
   DOMINION — procedural world generation.
   Seeded value-noise elevation/moisture -> biomes, resource deposits,
   simple downhill rivers, and starting territory claims for the player
   and a handful of AI nations. Every seed produces a unique map.
   ========================================================================== */
window.DomWorld = (() => {
'use strict';
const D = window.DomData;

/* ---------------- seeded RNG (mulberry32) ---------------- */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0);
}

/* ---------------- value noise (smoothed random grid) ---------------- */
function makeNoise(rng, gridW, gridH) {
  const grid = new Float32Array(gridW * gridH);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  return function sample(x, y) { // x,y in grid space (float)
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(gridW - 1, x0 + 1), y1 = Math.min(gridH - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const g = (gx, gy) => grid[Math.min(gridH - 1, gy) * gridW + Math.min(gridW - 1, gx)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const top = g(x0, y0) * (1 - sx) + g(x1, y0) * sx;
    const bot = g(x0, y1) * (1 - sx) + g(x1, y1) * sx;
    return top * (1 - sy) + bot * sy;
  };
}
function fbm(sample, x, y, octaves, scale) {
  let total = 0, amp = 0.5, freq = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    total += sample(x * freq / scale, y * freq / scale) * amp;
    sum += amp;
    amp *= 0.5; freq *= 2;
  }
  return total / sum;
}

const RESOURCES = ['iron', 'coal', 'oil', 'gold', 'fertile'];

function biomeFor(elevation, moisture) {
  if (elevation < 0.32) return 'ocean';
  if (elevation < 0.36) return 'coast';
  if (elevation > 0.82) return 'mountains';
  if (elevation > 0.66) return 'hills';
  if (moisture < 0.22) return 'desert';
  if (elevation > 0.35 && moisture < 0.35 && elevation < 0.5) return 'tundra';
  if (moisture > 0.68) return 'wetland';
  if (moisture > 0.48) return 'forest';
  return 'plains';
}

function generate(seedStr, w, h, nationCount) {
  const seed = hashSeed(seedStr || String(Date.now()));
  const rng = makeRng(seed);
  const elevNoise1 = makeNoise(rng, 9, 7);
  const elevNoise2 = makeNoise(makeRng(seed ^ 0x9e3779b9), 17, 13);
  const moistNoise = makeNoise(makeRng(seed ^ 0x85ebca6b), 11, 9);

  // pass 1: raw noise. fbm's weighted average of [0,1] samples clusters near
  // the middle, so we track min/max here and normalize to the full [0,1]
  // range in pass 2 — otherwise elevation never reaches the mountain/desert
  // thresholds and rivers never find a source.
  const rawE = new Float32Array(w * h), rawM = new Float32Array(w * h);
  let eMin = Infinity, eMax = -Infinity, mMin = Infinity, mMax = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = fbm(elevNoise1, x, y, 3, w * 0.5) * 0.7 + fbm(elevNoise2, x, y, 2, w * 0.18) * 0.3;
      const m = fbm(moistNoise, x, y, 3, w * 0.35);
      rawE[y * w + x] = e; rawM[y * w + x] = m;
      if (e < eMin) eMin = e; if (e > eMax) eMax = e;
      if (m < mMin) mMin = m; if (m > mMax) mMax = m;
    }
  }

  const tiles = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let e = (rawE[y * w + x] - eMin) / (eMax - eMin || 1);
      const m = (rawM[y * w + x] - mMin) / (mMax - mMin || 1);
      // push only the outer rim toward ocean (subtractive, not multiplicative,
      // so interior peaks keep their full height and still become mountains)
      const dx = (x / w) - 0.5, dy = (y / h) - 0.5;
      const distFromCenter = Math.hypot(dx, dy) / 0.707;
      const edge = Math.max(0, (distFromCenter - 0.55) / 0.45);
      e = Math.max(0, Math.min(1, e - edge * 0.6));
      const terrain = biomeFor(e, m);
      tiles[y * w + x] = { terrain, elevation: e, moisture: m, resource: null, river: false, owner: -1 };
    }
  }

  // resources: scattered based on biome suitability
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[y * w + x];
      const roll = rng();
      if (t.terrain === 'mountains' && roll < 0.22) t.resource = rng() < 0.5 ? 'iron' : 'gold';
      else if (t.terrain === 'hills' && roll < 0.16) t.resource = rng() < 0.6 ? 'coal' : 'iron';
      else if (t.terrain === 'desert' && roll < 0.1) t.resource = 'oil';
      else if ((t.terrain === 'plains' || t.terrain === 'wetland') && roll < 0.14) t.resource = 'fertile';
      else if (t.terrain === 'coast' && roll < 0.06) t.resource = 'oil';
    }
  }

  // simple rivers: from a handful of actual high-elevation tiles, flow to the lowest neighbor until ocean
  const highTiles = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tiles[y * w + x].elevation > 0.6) highTiles.push({ x, y });
  shuffle(highTiles, rng);
  const riverSources = highTiles.slice(0, Math.max(3, Math.round(w * h / 350)));
  for (const src of riverSources) {
    let { x, y } = src;
    for (let step = 0; step < 60; step++) {
      const t = tiles[y * w + x];
      t.river = true;
      if (t.terrain === 'ocean' || t.terrain === 'coast') break;
      let best = null, bestE = t.elevation;
      for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ddx, ny = y + ddy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nt = tiles[ny * w + nx];
        if (nt.elevation < bestE) { bestE = nt.elevation; best = { x: nx, y: ny }; }
      }
      if (!best) break;
      x = best.x; y = best.y;
    }
  }

  // pick starting spots: land tiles, well spaced apart
  const candidates = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const t = tiles[y * w + x];
      if ((t.terrain === 'plains' || t.terrain === 'coast' || t.terrain === 'forest') ) candidates.push({ x, y });
    }
  }
  shuffle(candidates, rng);
  const minDist = Math.max(6, Math.floor(Math.min(w, h) / (nationCount + 2)));
  const spots = [];
  for (const c of candidates) {
    if (spots.length >= nationCount + 1) break;
    if (spots.every(s => Math.hypot(s.x - c.x, s.y - c.y) >= minDist)) spots.push(c);
  }
  while (spots.length < nationCount + 1 && candidates.length) spots.push(candidates.pop());

  const playerStart = spots[0];
  const aiStarts = spots.slice(1, 1 + nationCount);

  return { seed, w, h, tiles, playerStart, aiStarts };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function tileAt(world, x, y) {
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return null;
  return world.tiles[y * world.w + x];
}
function tilesInRadius(world, cx, cy, r) {
  const out = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(world.h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(world.w - 1, cx + r); x++) {
      if (Math.hypot(x - cx, y - cy) <= r) out.push({ x, y, tile: world.tiles[y * world.w + x] });
    }
  }
  return out;
}

return { generate, tileAt, tilesInRadius, makeRng, hashSeed };
})();
