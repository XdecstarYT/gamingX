/* ============================================================================
   TURBO CIRCUIT — data layer: vehicle roster + tuning, tracks (closed
   waypoint loops), cups (career structure), and AI difficulty presets.
   ========================================================================== */
window.CIRCUIT_DATA = (() => {
'use strict';

/* ---------------------------------------------------------------------- */
/* vehicles — base stats before tuning. topSpeed in units/sec, accel in    */
/* units/sec^2, handling is a turn-rate multiplier, boostPower multiplies  */
/* the speed bonus while boosting.                                        */
/* ---------------------------------------------------------------------- */
const VEHICLES = {
  scamp:  { name: 'Scamp',   icon: '🟢', cost: 0,   color: '#4ade80', topSpeed: 15, accel: 11, handling: 3.4, boostPower: 1.35, desc: 'Balanced starter kart.' },
  bruiser:{ name: 'Bruiser', icon: '🟥', cost: 400, color: '#f87171', topSpeed: 13.5, accel: 9,  handling: 2.6, boostPower: 1.55, desc: 'Slow to turn, hits hard on straights.' },
  wasp:   { name: 'Wasp',    icon: '🟡', cost: 650, color: '#facc15', topSpeed: 16.5, accel: 13, handling: 4.2, boostPower: 1.25, desc: 'Nimble and quick off the line.' },
  phantom:{ name: 'Phantom', icon: '🟣', cost: 950, color: '#c084fc', topSpeed: 17.5, accel: 10, handling: 3.0, boostPower: 1.7, desc: 'Elite all-rounder for veteran racers.' },
};
const VEHICLE_ORDER = ['scamp', 'bruiser', 'wasp', 'phantom'];

/* ---------------------------------------------------------------------- */
/* tuning — 3 categories, 5 levels each, per-vehicle persistent upgrades.  */
/* ---------------------------------------------------------------------- */
const TUNING = {
  engine:   { name: 'Engine',   icon: '🔧', perLevel: 0.7,  maxLevel: 5, baseCost: 120, stat: 'topSpeed', desc: '+top speed per level' },
  handling: { name: 'Handling', icon: '🛞', perLevel: 0.28, maxLevel: 5, baseCost: 100, stat: 'handling', desc: '+cornering per level' },
  boost:    { name: 'Boost',    icon: '🔥', perLevel: 0.09, maxLevel: 5, baseCost: 130, stat: 'boostPower', desc: '+boost strength per level' },
};
function tuningCost(category, currentLevel) {
  return Math.round(TUNING[category].baseCost * Math.pow(1.3, currentLevel));
}

/* ---------------------------------------------------------------------- */
/* tracks — closed loops. `loop` is the centerline waypoints (world units); */
/* the last point connects back to the first. `width` is the drivable      */
/* corridor half-width used for off-track detection.                       */
/* ---------------------------------------------------------------------- */
const TRACKS = {
  meadow: {
    name: 'Meadow Oval', icon: '🌾', width: 4.2, laps: 3,
    loop: [[0, -20], [24, -20], [30, -14], [30, 14], [24, 20], [0, 20], [-24, 20], [-30, 14], [-30, -14], [-24, -20]],
  },
  docks: {
    name: 'Dockside Sprint', icon: '⚓', width: 3.8, laps: 3,
    loop: [[-28, -16], [-4, -16], [6, -24], [26, -18], [30, 0], [22, 14], [0, 10], [-10, 20], [-28, 16], [-34, 0]],
  },
  canyon: {
    name: 'Canyon Switchback', icon: '⛰️', width: 3.4, laps: 3,
    loop: [[0, -26], [14, -22], [10, -8], [22, -4], [26, 10], [12, 16], [4, 6], [-8, 14], [-22, 6], [-18, -10], [-8, -18]],
  },
  neon: {
    name: 'Neon Grand Prix', icon: '🌃', width: 4.0, laps: 4,
    loop: [[-30, -22], [0, -28], [30, -22], [34, 0], [30, 22], [8, 16], [0, 24], [-30, 22], [-36, 0]],
  },
};
const TRACK_ORDER = ['meadow', 'docks', 'canyon', 'neon'];

/* ---------------------------------------------------------------------- */
/* cups — campaign structure. Each cup groups tracks; finishing top-3      */
/* overall (by cup points) unlocks the next cup.                          */
/* ---------------------------------------------------------------------- */
const CUPS = [
  { id: 'rookie', name: 'Rookie Cup', icon: '🥉', tracks: ['meadow', 'docks'] },
  { id: 'pro', name: 'Pro Cup', icon: '🥈', tracks: ['canyon', 'neon'] },
];
const POINTS_TABLE = [10, 8, 6, 4, 2]; // 1st..5th

/* ---------------------------------------------------------------------- */
/* AI difficulty                                                          */
/* ---------------------------------------------------------------------- */
const AI_NAMES = ['Rex', 'Blaze', 'Nova', 'Turbo', 'Ghost'];
const DIFFICULTY = {
  easy:   { speedMul: 0.86, noise: 0.35, rubberBand: 0.10, label: 'CADET' },
  normal: { speedMul: 0.97, noise: 0.22, rubberBand: 0.18, label: 'RACER' },
  hard:   { speedMul: 1.06, noise: 0.12, rubberBand: 0.26, label: 'CHAMPION' },
};

function trackLength(loop) {
  let len = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

return { VEHICLES, VEHICLE_ORDER, TUNING, tuningCost, TRACKS, TRACK_ORDER, CUPS, POINTS_TABLE, AI_NAMES, DIFFICULTY, trackLength };
})();
