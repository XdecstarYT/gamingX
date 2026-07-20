/* ============================================================================
   OVERRUN — data layer: weapons (5 levels each), enemy types, characters,
   meta-progression shop, and the survival spawn director.
   ========================================================================== */
window.OVERRUN_DATA = (() => {
'use strict';

/* ---------------------------------------------------------------------- */
/* weapons — auto-fire at the nearest enemy in range. Levels 1-5 scale via  */
/* LEVEL_MUL (damage/pellets) and LEVEL_RATE (cooldown multiplier).        */
/* ---------------------------------------------------------------------- */
const LEVEL_MUL = [1, 1.25, 1.55, 1.9, 2.3];
const LEVEL_RATE = [1, 0.92, 0.85, 0.78, 0.7];

const WEAPONS = {
  pistol: { name: 'Pistol', icon: '🔫', dmg: 9, rate: 0.34, range: 6.5, speed: 13, pellets: 1, spread: 0.06, pierce: 0 },
  smg:    { name: 'SMG',    icon: '🔫', dmg: 5, rate: 0.12, range: 5.5, speed: 14, pellets: 1, spread: 0.18, pierce: 0 },
  shotgun:{ name: 'Shotgun',icon: '💥', dmg: 7, rate: 0.85, range: 4.2, speed: 11, pellets: 5, spread: 0.55, pierce: 0 },
  rifle:  { name: 'Rifle',  icon: '🎯', dmg: 18, rate: 0.48, range: 8.5, speed: 17, pellets: 1, spread: 0.02, pierce: 2 },
  rocket: { name: 'Rocket',  icon: '🚀', dmg: 32, rate: 1.25, range: 7, speed: 8, pellets: 1, spread: 0.04, pierce: 0, splash: 1.6 },
  laser:  { name: 'Laser',   icon: '⚡', dmg: 4, rate: 0.045, range: 9, speed: 22, pellets: 1, spread: 0, pierce: 99 },
};
const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'rocket', 'laser'];

/* ---------------------------------------------------------------------- */
/* enemies — hp/speed/dmg at wave-scale 1; spawnDirector scales hp with    */
/* survival time. contact = melee touch damage; ranged = fires a projectile*/
/* ---------------------------------------------------------------------- */
const ENEMIES = {
  grunt:     { name: 'Grunt',     hp: 22,  speed: 1.7, dmg: 8,  xp: 3,  scrap: 1, introAt: 0 },
  shooter:   { name: 'Shooter',   hp: 16,  speed: 1.1, dmg: 6,  xp: 4,  scrap: 2, introAt: 18, ranged: true, range: 6, fireRate: 1.7, projSpeed: 7 },
  swarmling: { name: 'Swarmling', hp: 8,   speed: 2.5, dmg: 5,  xp: 2,  scrap: 1, introAt: 34, group: 6 },
  tank:      { name: 'Tank',      hp: 110, speed: 0.85, dmg: 16, xp: 9, scrap: 4, introAt: 65 },
  bomber:    { name: 'Bomber',    hp: 15,  speed: 1.4, dmg: 0,  xp: 5,  scrap: 3, introAt: 90, explodeDmg: 26, blastRadius: 1.6 },
  boss:      { name: 'Warbeast',  hp: 700, speed: 0.7, dmg: 24, xp: 60, scrap: 40, introAt: 0, boss: true, ranged: true, range: 7, fireRate: 1.1, projSpeed: 6 },
};

/* ---------------------------------------------------------------------- */
/* in-run upgrade pool — offered 3-at-a-time on level-up.                  */
/* ---------------------------------------------------------------------- */
const STAT_UPGRADES = [
  { key: 'maxhp', name: '+Max HP', icon: '❤️', desc: '+20 max HP (heals to match)' },
  { key: 'speed', name: '+Move Speed', icon: '👟', desc: '+8% move speed' },
  { key: 'armor', name: '+Armor', icon: '🛡️', desc: '+3 flat damage reduction' },
  { key: 'regen', name: '+Regen', icon: '💚', desc: '+0.5 HP/sec regeneration' },
  { key: 'magnet', name: '+Pickup Radius', icon: '🧲', desc: 'Collect XP/scrap from further away' },
  { key: 'crit', name: '+Crit Chance', icon: '✨', desc: '+5% chance to deal double damage' },
];

/* ---------------------------------------------------------------------- */
/* characters — unlockable with scrap; different base stats + starting    */
/* weapon.                                                                 */
/* ---------------------------------------------------------------------- */
const CHARACTERS = {
  scout:  { name: 'Scout',  icon: '🏃', cost: 0,   hp: 100, speed: 1.0, armor: 0, weapon: 'pistol', desc: 'Balanced all-rounder.' },
  brawler:{ name: 'Brawler',icon: '💪', cost: 150, hp: 150, speed: 0.85, armor: 2, weapon: 'shotgun', desc: 'Tanky, close-range.' },
  ranger: { name: 'Ranger', icon: '🏹', cost: 220, hp: 85,  speed: 1.1, armor: 0, weapon: 'rifle', desc: 'Fragile but hits hard at range.' },
  striker:{ name: 'Striker',icon: '⚡', cost: 300, hp: 90,  speed: 1.2, armor: 0, weapon: 'smg', desc: 'Fast and relentless.' },
};
const CHARACTER_ORDER = ['scout', 'brawler', 'ranger', 'striker'];

/* ---------------------------------------------------------------------- */
/* meta-progression shop — permanent, persists between runs.              */
/* ---------------------------------------------------------------------- */
const META_UPGRADES = {
  maxhp:  { name: 'Vitality',  icon: '❤️', perLevel: 10, baseCost: 40, maxLevel: 10, desc: '+10 max HP per level' },
  damage: { name: 'Firepower', icon: '💢', perLevel: 0.06, baseCost: 50, maxLevel: 10, desc: '+6% weapon damage per level' },
  speed:  { name: 'Agility',   icon: '👟', perLevel: 0.03, baseCost: 45, maxLevel: 8, desc: '+3% move speed per level' },
  armor:  { name: 'Plating',   icon: '🛡️', perLevel: 1, baseCost: 55, maxLevel: 8, desc: '+1 flat armor per level' },
};
function metaUpgradeCost(key, currentLevel) {
  const def = META_UPGRADES[key];
  return Math.round(def.baseCost * Math.pow(1.35, currentLevel));
}

/* xp needed to reach level L (from L-1) */
function xpForLevel(level) { return 10 + level * 8; }

/* ---------------------------------------------------------------------- */
/* spawn director — survival-time based ramp.                              */
/* ---------------------------------------------------------------------- */
function activeEnemyPool(t) {
  return Object.keys(ENEMIES).filter(k => k !== 'boss' && ENEMIES[k].introAt <= t);
}
function spawnIntervalAt(t) { return Math.max(0.22, 1.1 - t * 0.004); }
function hpScaleAt(t) { return 1 + t * 0.012; }
function isBossTime(t, lastBossAt) { return t - lastBossAt >= 90; }

return {
  WEAPONS, WEAPON_ORDER, LEVEL_MUL, LEVEL_RATE, ENEMIES, STAT_UPGRADES,
  CHARACTERS, CHARACTER_ORDER, META_UPGRADES, metaUpgradeCost, xpForLevel,
  activeEnemyPool, spawnIntervalAt, hpScaleAt, isBossTime,
};
})();
