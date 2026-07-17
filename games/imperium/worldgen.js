/* ============================================================================
   IMPERIUM: WORLD CONQUEST — procedural world generation.
   Provinces are nodes on a map (not a tile grid): scattered positions,
   a connected neighbor graph, terrain flavor, and a fair starting-territory
   draft among the player + AI nations. Every seed produces a unique map.
   ========================================================================== */
window.ImpWorld = (() => {
'use strict';
const D = window.ImpData;

/* ---------------- seeded RNG (mulberry32) — same scheme as Project Nexus */
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
function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/* ---------------- province placement (rejection-sampled scatter) ---------------- */
function placeProvinces(count, w, h, rng) {
  const points = [];
  let minDist = Math.sqrt((w * h) / count) * 0.75;
  let attempts = 0;
  while (points.length < count && attempts < count * 400) {
    attempts++;
    const p = { x: 40 + rng() * (w - 80), y: 40 + rng() * (h - 80) };
    if (points.every(q => dist(p, q) >= minDist)) points.push(p);
    if (attempts % (count * 40) === 0) minDist *= 0.85; // relax spacing if we're struggling to fit
  }
  while (points.length < count) points.push({ x: 40 + rng() * (w - 80), y: 40 + rng() * (h - 80) }); // pad out any shortfall
  return points;
}

/* ---------------- adjacency: k-nearest neighbors, then force full connectivity */
function buildAdjacency(points, k) {
  const n = points.length;
  const neighborSets = points.map(() => new Set());
  for (let i = 0; i < n; i++) {
    const ranked = [];
    for (let j = 0; j < n; j++) { if (i !== j) ranked.push([dist(points[i], points[j]), j]); }
    ranked.sort((a, b) => a[0] - b[0]);
    for (let m = 0; m < Math.min(k, ranked.length); m++) {
      neighborSets[i].add(ranked[m][1]);
      neighborSets[ranked[m][1]].add(i);
    }
  }
  // BFS connectivity check; stitch together any isolated components
  const seen = new Array(n).fill(false);
  function bfsFrom(start) {
    const stack = [start]; seen[start] = true; const comp = [start];
    while (stack.length) {
      const cur = stack.pop();
      for (const nb of neighborSets[cur]) if (!seen[nb]) { seen[nb] = true; stack.push(nb); comp.push(nb); }
    }
    return comp;
  }
  let mainComp = bfsFrom(0);
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const comp = bfsFrom(i);
    // connect the closest pair between mainComp and this new component
    let best = null, bestD = Infinity;
    for (const a of mainComp) for (const b of comp) {
      const d = dist(points[a], points[b]);
      if (d < bestD) { bestD = d; best = [a, b]; }
    }
    if (best) { neighborSets[best[0]].add(best[1]); neighborSets[best[1]].add(best[0]); }
    mainComp = mainComp.concat(comp);
  }
  return neighborSets.map(s => Array.from(s));
}

/* ---------------- starting territory draft ---------------- */
function draftStartingTerritory(provinces, nationIds, startSize, rng) {
  const n = provinces.length;
  const claimed = new Array(n).fill(null);
  const capitals = [];
  // farthest-point sampling for well-spread capitals
  let firstIdx = Math.floor(rng() * n);
  capitals.push(firstIdx);
  while (capitals.length < nationIds.length) {
    let best = -1, bestD = -1;
    for (let i = 0; i < n; i++) {
      if (capitals.includes(i)) continue;
      const d = Math.min(...capitals.map(c => dist(provinces[i], provinces[c])));
      if (d > bestD) { bestD = d; best = i; }
    }
    capitals.push(best);
  }
  nationIds.forEach((nid, i) => { claimed[capitals[i]] = nid; provinces[capitals[i]].isCapital = true; });

  // round-robin BFS claim so no nation's cluster grows unfairly ahead of the others
  const frontiers = capitals.map(c => [c]);
  let totalClaimed = nationIds.length;
  const targetTotal = Math.min(n, nationIds.length * startSize);
  let guard = 0;
  while (totalClaimed < targetTotal && guard++ < n * 10) {
    for (let ni = 0; ni < nationIds.length && totalClaimed < targetTotal; ni++) {
      const frontier = frontiers[ni];
      shuffle(frontier, rng);
      let grew = false;
      for (const idx of frontier) {
        for (const nb of provinces[idx].neighbors) {
          if (claimed[nb] === null) {
            claimed[nb] = nationIds[ni];
            frontiers[ni].push(nb);
            totalClaimed++;
            grew = true;
            break;
          }
        }
        if (grew) break;
      }
    }
  }
  return claimed;
}

function generate(seedStr, opts) {
  const seed = hashSeed(seedStr || String(Date.now()));
  const rng = makeRng(seed);
  const count = opts.provinceCount;
  const w = opts.mapW, h = opts.mapH;

  const points = placeProvinces(count, w, h, rng);
  const neighborLists = buildAdjacency(points, opts.k || 3);

  const namePool = D.PROVINCE_NAMES.slice();
  shuffle(namePool, rng);
  const terrainIds = D.TERRAIN_IDS;

  const provinces = points.map((p, i) => ({
    id: i,
    name: namePool[i % namePool.length] + (i >= namePool.length ? ' ' + (Math.floor(i / namePool.length) + 1) : ''),
    x: Math.round(p.x), y: Math.round(p.y),
    terrain: terrainIds[Math.floor(rng() * terrainIds.length)],
    neighbors: neighborLists[i],
    isCapital: false,
  }));

  const owners = draftStartingTerritory(provinces, opts.nationIds, opts.startSize || 4, rng);

  return { seed, w, h, provinces, owners };
}

function provinceAt(world, id) { return world.provinces[id] || null; }

return { generate, provinceAt, makeRng, hashSeed };
})();
