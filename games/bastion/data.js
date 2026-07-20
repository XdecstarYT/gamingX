/* ============================================================================
   BASTION — data layer: tower types + upgrade tiers, enemy types, maps
   (grid + waypoint path), and the wave generator.
   ========================================================================== */
window.BASTION_DATA = (() => {
'use strict';

const CELL = 56;

/* ---------------------------------------------------------------------- */
/* towers                                                                  */
/* ---------------------------------------------------------------------- */
/* targets: which domains a tower can hit. 'ground' | 'air'.
   Each tower has 3 tiers; tier 0 is the base (build) stats. Upgrading pays
   tiers[n].cost and applies that tier's stats (they are absolute, not deltas). */
const TOWERS = {
  arrow: {
    name: 'Arrow Tower', icon: '🏹', color: '#8fd0ff', cost: 60, targets: ['ground'],
    desc: 'Cheap and fast. Good all-round early pick.',
    tiers: [
      { damage: 14, fireRate: 0.42, range: 2.4, splash: 0, pierce: 1 },
      { cost: 55, damage: 22, fireRate: 0.36, range: 2.6, pierce: 1, label: 'Reinforced Bow' },
      { cost: 130, damage: 34, fireRate: 0.28, range: 2.9, pierce: 2, label: 'Piercing Bolts' },
    ],
  },
  cannon: {
    name: 'Cannon', icon: '💣', color: '#ff9a5a', cost: 95, targets: ['ground'],
    desc: 'Splash damage — great against groups.',
    tiers: [
      { damage: 26, fireRate: 1.1, range: 2.3, splash: 1.1 },
      { cost: 90, damage: 40, fireRate: 1.0, range: 2.4, splash: 1.3, label: 'Heavy Shells' },
      { cost: 190, damage: 62, fireRate: 0.9, range: 2.6, splash: 1.6, stun: 0.4, label: 'Siege Mortar' },
    ],
  },
  frost: {
    name: 'Frost Tower', icon: '❄️', color: '#8be9ff', cost: 80, targets: ['ground', 'air'],
    desc: 'Slows enemies in range. No direct damage.',
    tiers: [
      { damage: 3, fireRate: 0.6, range: 2.2, slow: 0.35, slowDur: 1.2 },
      { cost: 70, damage: 4, fireRate: 0.55, range: 2.4, slow: 0.48, slowDur: 1.4, label: 'Deep Freeze' },
      { cost: 150, damage: 6, fireRate: 0.5, range: 2.7, slow: 0.62, slowDur: 1.8, freeze: 0.5, label: 'Glacier Core' },
    ],
  },
  poison: {
    name: 'Poison Tower', icon: '🧪', color: '#8cff6a', cost: 85, targets: ['ground'],
    desc: 'Damage-over-time that stacks. Shreds armor.',
    tiers: [
      { damage: 4, fireRate: 0.7, range: 2.3, dot: 6, dotDur: 3, armorShred: 0.1 },
      { cost: 75, damage: 6, fireRate: 0.65, range: 2.5, dot: 10, dotDur: 3.5, armorShred: 0.18, label: 'Toxic Spores' },
      { cost: 160, damage: 8, fireRate: 0.6, range: 2.8, dot: 16, dotDur: 4, armorShred: 0.3, spread: 1.4, label: 'Plague Cloud' },
    ],
  },
  sniper: {
    name: 'Sniper Nest', icon: '🎯', color: '#ffd166', cost: 110, targets: ['ground', 'air'],
    desc: 'Slow but devastating. Ignores armor.',
    tiers: [
      { damage: 60, fireRate: 2.2, range: 4.2, armorPierce: 0.6, critChance: 0.1 },
      { cost: 110, damage: 95, fireRate: 2.0, range: 4.6, armorPierce: 0.75, critChance: 0.16, label: 'Long Rifle' },
      { cost: 230, damage: 150, fireRate: 1.8, range: 5.2, armorPierce: 1, critChance: 0.25, execute: 0.12, label: 'Railgun' },
    ],
  },
  tesla: {
    name: 'Tesla Coil', icon: '⚡', color: '#c9a0ff', cost: 100, targets: ['ground', 'air'],
    desc: 'Chain lightning — excellent against swarms.',
    tiers: [
      { damage: 12, fireRate: 0.5, range: 2.4, chain: 3, chainRange: 1.6 },
      { cost: 95, damage: 18, fireRate: 0.42, range: 2.6, chain: 4, chainRange: 1.8, label: 'Arc Amplifier' },
      { cost: 200, damage: 26, fireRate: 0.34, range: 2.9, chain: 6, chainRange: 2.1, stun: 0.25, label: 'Storm Node' },
    ],
  },
};
const TOWER_ORDER = ['arrow', 'cannon', 'frost', 'poison', 'sniper', 'tesla'];

/* ---------------------------------------------------------------------- */
/* enemies                                                                 */
/* ---------------------------------------------------------------------- */
/* speed is in cells/second. armor is a flat 0-1 fraction reduced from
   incoming physical damage (arrow/cannon/tesla respect it; sniper/poison
   partially or fully ignore it per-tower). */
const ENEMIES = {
  grunt:  { name: 'Grunt',      hp: 46,  speed: 1.05, armor: 0,   value: 4,  flying: false },
  runner: { name: 'Runner',     hp: 26,  speed: 1.9,  armor: 0,   value: 5,  flying: false },
  tank:   { name: 'Tank',       hp: 220, speed: 0.65, armor: 0.4, value: 14, flying: false },
  swarm:  { name: 'Swarmling',  hp: 10,  speed: 1.5,  armor: 0,   value: 2,  flying: false, group: 5 },
  flyer:  { name: 'Flyer',      hp: 60,  speed: 1.4,  armor: 0.1, value: 8,  flying: true },
  shield: { name: 'Shielded',   hp: 90,  speed: 1.0,  armor: 0.15, value: 10, flying: false, shield: 55, shieldRegen: 4 },
  regen:  { name: 'Regenerator',hp: 130, speed: 0.9,  armor: 0.15, value: 11, flying: false, regen: 6, poisonImmune: false },
  boss:   { name: 'Warlord',    hp: 2600, speed: 0.55, armor: 0.35, value: 260, flying: false, boss: true, slowResist: 0.5 },
};

/* ---------------------------------------------------------------------- */
/* maps — waypoints are grid cells [col,row]; the path is the orthogonal   */
/* connect-the-dots between them. cols/rows define the buildable grid.     */
/* ---------------------------------------------------------------------- */
const MAPS = [
  {
    id: 'greenfields', name: 'Greenfields', icon: '🌾', cols: 15, rows: 9, startGold: 220, startLives: 20,
    waypoints: [[0, 4], [4, 4], [4, 1], [8, 1], [8, 7], [11, 7], [11, 3], [14, 3]],
  },
  {
    id: 'switchback', name: 'Switchback Pass', icon: '⛰️', cols: 15, rows: 9, startGold: 240, startLives: 18,
    waypoints: [[0, 1], [12, 1], [12, 4], [2, 4], [2, 7], [14, 7]],
  },
  {
    id: 'spiral', name: 'Spiral Keep', icon: '🌀', cols: 15, rows: 9, startGold: 260, startLives: 16,
    waypoints: [[0, 0], [13, 0], [13, 7], [2, 7], [2, 2], [10, 2], [10, 5], [5, 5]],
  },
  {
    id: 'crossfire', name: 'Crossfire Delta', icon: '🔥', cols: 15, rows: 9, startGold: 260, startLives: 16,
    waypoints: [[7, 0], [7, 3], [2, 3], [2, 6], [12, 6], [12, 8]],
  },
];

function pathCells(waypoints) {
  const cells = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    let [x1, y1] = waypoints[i]; const [x2, y2] = waypoints[i + 1];
    cells.push([x1, y1]);
    while (x1 !== x2 || y1 !== y2) {
      if (x1 !== x2) x1 += x1 < x2 ? 1 : -1; else y1 += y1 < y2 ? 1 : -1;
      cells.push([x1, y1]);
    }
  }
  return cells;
}

/* ---------------------------------------------------------------------- */
/* wave generator — progressively introduces enemy types, scales hp/count. */
/* ---------------------------------------------------------------------- */
function generateWave(waveNum) {
  const groups = [];
  const scale = 1 + waveNum * 0.14;
  const push = (type, count, gap, delay) => groups.push({ type, count, gap: gap || 0.6, delay: delay || 0, scale });

  if (waveNum % 10 === 0) {
    push('grunt', 6 + Math.floor(waveNum / 2), 0.5, 0);
    push('boss', 1, 0, 3);
    return { groups, isBoss: true };
  }

  push('grunt', 5 + waveNum, 0.55, 0);
  if (waveNum >= 3) push('runner', 3 + Math.floor(waveNum / 2), 0.35, 1.5);
  if (waveNum >= 5) push('tank', 1 + Math.floor(waveNum / 6), 1.2, 2.5);
  if (waveNum >= 6) { for (let i = 0; i < 2 + Math.floor(waveNum / 8); i++) push('swarm', 5, 0.18, 3 + i * 1.5); }
  if (waveNum >= 8) push('flyer', 2 + Math.floor(waveNum / 5), 0.7, 2);
  if (waveNum >= 12) push('shield', 1 + Math.floor(waveNum / 10), 1.0, 3);
  if (waveNum >= 15) push('regen', 1 + Math.floor(waveNum / 12), 1.0, 3.5);

  return { groups, isBoss: false };
}

return { CELL, TOWERS, TOWER_ORDER, ENEMIES, MAPS, pathCells, generateWave };
})();
