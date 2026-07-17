/* ============================================================================
   IMPERIUM: WORLD CONQUEST — static game data.
   Nations, units, tech, terrain, improvements, name pools.
   Pure data + pure functions only — nothing here is saved directly; save
   files reference these by id and re-attach definitions on load.
   ========================================================================== */
window.ImpData = (() => {
'use strict';

/* ------------------------------------------------------------------ */
/* Nations — player picks one, the rest are played by the AI.          */
/* trait keys are read directly by the simulation as multipliers.      */
/* ------------------------------------------------------------------ */
const NATIONS = [
  { id: 'kalden', name: 'Kaldenreich', color: '#ef4444', motto: 'Militarist', desc: '+15% attack power.',
    trait: { atk: 1.15 } },
  { id: 'solvane', name: 'Solvane Republic', color: '#38bdf8', motto: 'Industrious', desc: '+20% gold income.',
    trait: { gold: 1.2 } },
  { id: 'ostrovia', name: 'Ostrovia', color: '#4ade80', motto: 'Fortified', desc: '+25% defense power.',
    trait: { def: 1.25 } },
  { id: 'draventh', name: 'Draventh Empire', color: '#a855f7', motto: 'Expansionist', desc: '+20% manpower income.',
    trait: { manpower: 1.2 } },
  { id: 'ferrowatch', name: 'Ferrowatch Union', color: '#f2b03d', motto: 'Innovators', desc: '+25% research.',
    trait: { research: 1.25 } },
  { id: 'nordholt', name: 'Nordholt Alliance', color: '#22d3ee', motto: 'Swift', desc: '-20% unit training time.',
    trait: { trainTime: 0.8 } },
  { id: 'meridian', name: 'Meridian Concord', color: '#fde047', motto: 'Balanced', desc: '+10% to everything.',
    trait: { atk: 1.1, def: 1.1, gold: 1.1, manpower: 1.1, research: 1.1 } },
  { id: 'vaskar', name: 'Vaskar Horde', color: '#be123c', motto: 'Raiders', desc: '+20% attack, -10% defense.',
    trait: { atk: 1.2, def: 0.9 } },
];
const NATIONS_BY_ID = Object.fromEntries(NATIONS.map(n => [n.id, n]));

/* ------------------------------------------------------------------ */
/* Units — instant-resolution combat: attack/defense are summed across */
/* a garrison, modified by nation traits + terrain + improvements.      */
/* ------------------------------------------------------------------ */
const UNITS = [
  { id: 'militia', name: 'Militia', icon: '🔪', cost: { gold: 60, manpower: 40 }, upkeep: 0.4,
    attack: 3, defense: 4, trainTicks: 4, desc: 'Cheap levy troops. Weak but available from turn one.' },
  { id: 'infantry', name: 'Infantry', icon: '🪖', cost: { gold: 140, manpower: 80 }, upkeep: 0.9,
    attack: 7, defense: 8, trainTicks: 7, needsTech: 'standing_army', desc: 'Well-drilled regulars — the backbone of any army.' },
  { id: 'cavalry', name: 'Cavalry', icon: '🐎', cost: { gold: 180, manpower: 70 }, upkeep: 1.1,
    attack: 11, defense: 6, trainTicks: 8, needsTech: 'horsemanship', desc: 'Fast strikers — high attack, fragile on defense.' },
  { id: 'artillery', name: 'Artillery', icon: '💣', cost: { gold: 260, manpower: 60 }, upkeep: 1.4,
    attack: 16, defense: 5, trainTicks: 10, needsTech: 'gunpowder', desc: 'Heavy guns. Devastating offense, poor defense.' },
  { id: 'armor', name: 'Armor', icon: '🛡️', cost: { gold: 380, manpower: 90 }, upkeep: 2.0,
    attack: 20, defense: 18, trainTicks: 13, needsTech: 'motorization', desc: 'Armored columns — strong on both sides of the line.' },
  { id: 'aircraft', name: 'Aircraft', icon: '✈️', cost: { gold: 460, manpower: 50 }, upkeep: 2.4,
    attack: 26, defense: 10, trainTicks: 15, needsTech: 'aviation', desc: 'Elite air power — the strongest attack in the game.' },
];
const UNITS_BY_ID = Object.fromEntries(UNITS.map(u => [u.id, u]));

/* ------------------------------------------------------------------ */
/* Tech tree — flat list, unlocked with accumulated research points.   */
/* ------------------------------------------------------------------ */
const TECHS = [
  { id: 'standing_army', name: 'Standing Army', cost: 90, cat: 'military', desc: 'Unlocks Infantry.' },
  { id: 'horsemanship', name: 'Horsemanship', cost: 120, cat: 'military', desc: 'Unlocks Cavalry.' },
  { id: 'gunpowder', name: 'Gunpowder', cost: 220, cat: 'military', prereq: ['standing_army'], desc: 'Unlocks Artillery.' },
  { id: 'motorization', name: 'Motorization', cost: 340, cat: 'military', prereq: ['gunpowder'], desc: 'Unlocks Armor.' },
  { id: 'aviation', name: 'Aviation', cost: 480, cat: 'military', prereq: ['motorization'], desc: 'Unlocks Aircraft.' },
  { id: 'trade_routes', name: 'Trade Routes', cost: 100, cat: 'economy', desc: '+15% gold income nationwide.', bonus: { goldMult: 1.15 } },
  { id: 'agriculture', name: 'Agriculture', cost: 100, cat: 'economy', desc: '+15% manpower income nationwide.', bonus: { manpowerMult: 1.15 } },
  { id: 'fortification', name: 'Fortification', cost: 160, cat: 'military', desc: '+15% defense power nationwide.', bonus: { defMult: 1.15 } },
  { id: 'rapid_deployment', name: 'Rapid Deployment', cost: 200, cat: 'military', desc: '-20% unit training time nationwide.', bonus: { trainTimeMult: 0.8 } },
  { id: 'banking', name: 'Banking', cost: 260, cat: 'economy', prereq: ['trade_routes'], desc: '+20% gold income nationwide.', bonus: { goldMult: 1.2 } },
  { id: 'conscription', name: 'Conscription', cost: 260, cat: 'economy', prereq: ['agriculture'], desc: '+20% manpower income nationwide.', bonus: { manpowerMult: 1.2 } },
  { id: 'logistics', name: 'Logistics', cost: 300, cat: 'military', desc: '-15% unit upkeep nationwide.', bonus: { upkeepMult: 0.85 } },
];
const TECHS_BY_ID = Object.fromEntries(TECHS.map(t => [t.id, t]));

/* ------------------------------------------------------------------ */
/* Province terrain — flavors base yields and defense.                 */
/* ------------------------------------------------------------------ */
const TERRAIN = {
  plains: { name: 'Plains', color: '#5c9c4a', gold: 1.0, manpower: 1.0, defMult: 1.0 },
  hills: { name: 'Hills', color: '#8a7b4e', gold: 0.9, manpower: 0.9, defMult: 1.2 },
  mountains: { name: 'Mountains', color: '#6b6b73', gold: 0.7, manpower: 0.6, defMult: 1.5 },
  coast: { name: 'Coast', color: '#2f7ba6', gold: 1.3, manpower: 0.9, defMult: 0.9 },
  forest: { name: 'Forest', color: '#356b34', gold: 0.85, manpower: 1.2, defMult: 1.1 },
  desert: { name: 'Desert', color: '#d2b163', gold: 1.1, manpower: 0.6, defMult: 0.85 },
};
const TERRAIN_IDS = Object.keys(TERRAIN);

/* ------------------------------------------------------------------ */
/* Province improvements — one active slot per province.               */
/* ------------------------------------------------------------------ */
const IMPROVEMENTS = [
  { id: 'farm', name: 'Farm', icon: '🌾', cost: 300, desc: '+40% manpower from this province.', bonus: { manpowerMult: 1.4 } },
  { id: 'market', name: 'Market', icon: '🏛️', cost: 300, desc: '+40% gold from this province.', bonus: { goldMult: 1.4 } },
  { id: 'fort', name: 'Fort', icon: '🏯', cost: 380, desc: '+60% defense in this province.', bonus: { defMult: 1.6 } },
  { id: 'barracks', name: 'Barracks', icon: '⚔️', cost: 340, desc: '-30% unit training time when built here.', bonus: { trainTimeMult: 0.7 } },
  { id: 'lab', name: 'Research Lab', icon: '🔬', cost: 320, desc: '+5 research per tick from this province.', bonus: { researchFlat: 5 } },
];
const IMPROVEMENTS_BY_ID = Object.fromEntries(IMPROVEMENTS.map(i => [i.id, i]));

/* ------------------------------------------------------------------ */
/* Name pools for procedurally generated provinces                     */
/* ------------------------------------------------------------------ */
const PROVINCE_NAMES = [
  'Ardenmoor', 'Blackfen', 'Cresthollow', 'Duskvale', 'Emberfield', 'Frosthaven', 'Greywatch', 'Hollowmere',
  'Ironspire', 'Junewood', 'Kestrel Reach', 'Lowmarch', 'Millbrook', 'Norwick', 'Oakenshire', 'Pinehold',
  'Quarrymont', 'Ravensford', 'Stonegate', 'Thornfield', 'Underholt', 'Vaultridge', 'Westmere', 'Yewbrook',
  'Zaltoria', 'Aldergrove', 'Brackenfell', 'Coldharbor', 'Drakemoor', 'Elmswatch', 'Fairhaven', 'Glasswick',
  'Hartcliff', 'Ivywood', 'Kingsmere', 'Larkspur', 'Moorgate', 'Nightfell', 'Osprey Bay', 'Proudmoor',
  'Redmarsh', 'Silverpine', 'Timberholt', 'Umberfall', 'Vinemoor', 'Wolfmere', 'Ashgrove', 'Briarwick',
  'Cragmoor', 'Dunwatch',
];

/* ------------------------------------------------------------------ */
/* Flavor log events — surfaced as notifications, no mechanical weight  */
/* ------------------------------------------------------------------ */
const FLAVOR_EVENTS = [
  'Border skirmishes reported near {province}.',
  'A trade caravan reaches {province}, boosting local morale.',
  'Scouts spot enemy movement near {province}.',
  'Refugees flee to {province} amid rising tensions.',
  'A festival is held in {province} to celebrate the harvest.',
];

return {
  NATIONS, NATIONS_BY_ID, UNITS, UNITS_BY_ID, TECHS, TECHS_BY_ID,
  TERRAIN, TERRAIN_IDS, IMPROVEMENTS, IMPROVEMENTS_BY_ID,
  PROVINCE_NAMES, FLAVOR_EVENTS,
};
})();
