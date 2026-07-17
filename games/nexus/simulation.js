/* ============================================================================
   PROJECT NEXUS — core simulation.
   One tick = one in-game week. Every system reads/writes a single plain-JSON
   `state` object so the whole game can be saved/loaded/serialized trivially.
   Economy -> taxes -> happiness -> approval -> elections -> policy -> economy:
   every tick closes that loop.
   ========================================================================== */
window.NexusSim = (() => {
'use strict';
const D = window.NexusData;
const W = window.NexusWorld;
const L = window.NexusLegislature;

const MAP_W = 48, MAP_H = 32, AI_COUNT = 4, CITY_RADIUS = 6;
const ELECTION_INTERVAL = 208; // ~4 years at 1 tick/week

/* ------------------------------------------------------------------ */
/* new game                                                             */
/* ------------------------------------------------------------------ */
function newGame(opts) {
  const world = W.generate(opts.seed, MAP_W, MAP_H, AI_COUNT);
  const rng = W.makeRng(world.seed ^ 0x1234);

  // claim starting territory around the capital + AI capitals
  claimTerritory(world, world.playerStart.x, world.playerStart.y, 0, CITY_RADIUS);
  world.aiStarts.forEach((s, i) => claimTerritory(world, s.x, s.y, i + 1, CITY_RADIUS - 1));

  const names = D.NATION_NAMES.slice();
  shuffle(names, rng);
  const nations = world.aiStarts.map((s, i) => ({
    id: i + 1, name: names[i] || ('Nation ' + (i + 1)), color: D.NATION_COLORS[i % D.NATION_COLORS.length],
    x: s.x, y: s.y, gdp: 4000 + rng() * 3000, population: 400 + rng() * 300, approval: 45 + rng() * 20,
    government: D.GOVERNMENTS[Math.floor(rng() * D.GOVERNMENTS.length)].id,
    relation: 50, tradeAgreement: false, alliance: false, nonAggression: false, relationLog: [],
  }));

  const state = {
    version: 1,
    meta: { nationName: opts.nationName || 'Valtoria', seed: world.seed, government: opts.government || 'democracy', tick: 0, speed: 1, paused: false },
    world: { w: world.w, h: world.h, tiles: world.tiles },
    treasury: 25000, debt: 0,
    taxRate: { income: 0.20, corporate: 0.20, sales: 0.08 },
    funding: { health: 1, education: 1, environment: 1, military: 1 },
    stats: {
      population: 150, employed: 0, unemployed: 0, workforce: 0,
      gdp: 0, gdpHistory: [], inflation: 2.5, inflationHistory: [],
      approval: 55, approvalHistory: [], happiness: 58, happinessHistory: [],
      corruption: 12, corruptionHistory: [], researchPoints: 0, researchPerTick: 0,
      powerRatio: 1, waterRatio: 1, healthcareRatio: 1, educationRatio: 1, housingRatio: 1,
      popCap: 0, jobs: 0, power: 0, water: 0, healthcare: 0, education: 0, pollution: 0, defense: 0,
    },
    cities: [{ id: 1, name: opts.nationName ? opts.nationName + ' City' : 'Capital City', x: world.playerStart.x, y: world.playerStart.y }],
    buildings: [],
    tech: { unlocked: [], researching: null, progress: 0 },
    parties: D.PARTIES.map(p => ({ id: p.id, support: Math.round(10 + rng() * 25) })),
    nextElectionTick: ELECTION_INTERVAL,
    nations,
    militaryUnits: { army: 0, navy: 0, airforce: 0 },
    events: { log: [], pending: null },
    notifications: [],
    score: 0,
  };
  normalizePartySupport(state);
  L.init(state, opts.playerParty || 'unity');
  // seed starter buildings so the capital isn't completely empty
  for (const [type, dx, dy] of [['townhall', 0, 0], ['house', 1, 0], ['road', 0, 1]]) {
    placeBuilding(state, type, world.playerStart.x + dx, world.playerStart.y + dy, true);
  }
  recompute(state);
  return state;
}

function claimTerritory(world, cx, cy, ownerId, radius) {
  for (const { x, y, tile } of W.tilesInRadius(world, cx, cy, radius)) {
    if (tile.terrain === 'ocean' || tile.terrain === 'mountains') continue;
    if (tile.owner === -1) tile.owner = ownerId;
  }
}
function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
function normalizePartySupport(state) {
  const total = state.parties.reduce((s, p) => s + p.support, 0) || 1;
  state.parties.forEach(p => p.support = Math.round(p.support / total * 100));
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function notify(state, text, kind) {
  state.notifications.push({ id: state.tickNotifId = (state.tickNotifId || 0) + 1, text, kind: kind || 'info', tick: state.meta.tick });
  if (state.notifications.length > 40) state.notifications.shift();
}

/* ------------------------------------------------------------------ */
/* tech helpers                                                         */
/* ------------------------------------------------------------------ */
function techBonus(state, key, mode) {
  // mode 'mult' multiplies (starts at 1), 'flat' adds (starts at 0)
  let v = mode === 'flat' ? 0 : 1;
  for (const id of state.tech.unlocked) {
    const t = D.TECHS_BY_ID[id];
    if (!t || !t.bonus) continue;
    if (mode === 'flat' && t.bonus[key] != null) v += t.bonus[key];
    if (mode === 'mult' && t.bonus[key] != null) v *= t.bonus[key];
  }
  return v;
}
function techUnlocked(state, id) { return state.tech.unlocked.includes(id); }
function techAvailable(state, id) {
  const t = D.TECHS_BY_ID[id];
  if (!t || techUnlocked(state, id) || state.tech.researching === id) return false;
  return t.prereq.every(p => techUnlocked(state, p));
}

/* ------------------------------------------------------------------ */
/* buildings                                                             */
/* ------------------------------------------------------------------ */
function buildingCost(state, def) {
  return Math.round(def.cost * techBonus(state, 'buildCostMult', 'mult'));
}
function canPlaceBuilding(state, type, x, y) {
  const def = D.BUILDINGS_BY_ID[type];
  if (!def) return { ok: false, reason: 'Unknown building.' };
  const tile = W.tileAt(state.world, x, y);
  if (!tile) return { ok: false, reason: 'Off the map.' };
  if (tile.owner !== 0) return { ok: false, reason: 'You do not own this tile.' };
  if (D.TERRAIN[tile.terrain].movable === false) return { ok: false, reason: 'Cannot build here.' };
  if (state.buildings.some(b => b.x === x && b.y === y)) return { ok: false, reason: 'Something is already built here.' };
  if (def.needsTech && !techUnlocked(state, def.needsTech)) {
    return { ok: false, reason: `Requires ${D.TECHS_BY_ID[def.needsTech].name}.` };
  }
  if (def.needsTerrain && !def.needsTerrain.includes(tile.terrain)) return { ok: false, reason: `Needs ${def.needsTerrain.join(' or ')} terrain.` };
  const cost = buildingCost(state, def);
  if (state.treasury < cost) return { ok: false, reason: 'Not enough treasury.' };
  return { ok: true, cost };
}
function placeBuilding(state, type, x, y, free) {
  const def = D.BUILDINGS_BY_ID[type];
  const check = free ? { ok: true, cost: 0 } : canPlaceBuilding(state, type, x, y);
  if (!check.ok) return check;
  if (!free) state.treasury -= check.cost;
  const buildTicks = Math.max(1, Math.round(def.buildTicks * techBonus(state, 'buildTimeMult', 'mult')));
  state.buildings.push({ id: 'b' + Math.random().toString(36).slice(2, 9), type, x, y, progress: free ? 1 : 0, buildTicks, built: !!free });
  return { ok: true };
}
function bulldozeBuilding(state, buildingId) {
  const i = state.buildings.findIndex(b => b.id === buildingId);
  if (i === -1) return;
  state.buildings.splice(i, 1);
}

/* ------------------------------------------------------------------ */
/* main tick                                                             */
/* ------------------------------------------------------------------ */
function tick(state) {
  if (state.events.pending) return; // simulation pauses while an event awaits a decision
  state.meta.tick++;

  advanceConstruction(state);
  recompute(state);
  simulateEconomy(state);
  simulatePolitics(state);
  simulateResearch(state);
  simulateNations(state);
  L.tick(state);   // parliament: bill stages, votes, cabinet, courts, opposition, elections
  maybeEvent(state);
  pushHistory(state);
  state.score = computeScore(state);
}

function advanceConstruction(state) {
  for (const b of state.buildings) {
    if (b.built) continue;
    b.progress += 1 / b.buildTicks;
    if (b.progress >= 1) { b.progress = 1; b.built = true; notify(state, `${D.BUILDINGS_BY_ID[b.type].name} completed.`, 'build'); }
  }
}

/* recompute capacities from currently built buildings (cheap, called every tick) */
function recompute(state) {
  const s = state.stats;
  const law = L.activeEffects(state);
  let popCap = 0, jobs = 0, power = 0, water = 0, healthcare = 0, education = 0, research = 0, pollution = 0, defense = 0, crimeReduction = 0, gdpBase = 0, happinessFlat = 0;
  const farmMult = techBonus(state, 'farmMult', 'mult') * L.cabinetMultiplier(state, 'agriculture');
  const industrialMult = techBonus(state, 'industrialMult', 'mult') * L.cabinetMultiplier(state, 'industry');
  const healthcareMult = techBonus(state, 'healthcareMult', 'mult') * (0.5 + state.funding.health * 0.5) * law.healthcareMult * L.cabinetMultiplier(state, 'health');
  const powerMult = techBonus(state, 'powerMult', 'mult') * L.cabinetMultiplier(state, 'energy');
  const eduMult = (0.5 + state.funding.education * 0.5) * law.educationMult * L.cabinetMultiplier(state, 'education');
  const envMult = (0.6 + state.funding.environment * 0.4) * (2 - L.cabinetMultiplier(state, 'environment'));

  for (const b of state.buildings) {
    if (!b.built) continue;
    const def = D.BUILDINGS_BY_ID[b.type];
    const e = def.effects;
    if (e.popCap) popCap += e.popCap;
    if (e.jobs) jobs += e.jobs;
    if (e.power) power += e.power * powerMult;
    if (e.water) water += e.water;
    if (e.healthcare) healthcare += e.healthcare * healthcareMult;
    if (e.education) education += e.education * eduMult;
    if (e.research) research += e.research;
    if (e.defense) defense += e.defense;
    if (e.crimeReduction) crimeReduction += e.crimeReduction;
    if (e.happiness) happinessFlat += e.happiness;
    let pol = e.pollution || 0;
    if (def.cat === 'industrial') pol *= (2 - envMult);
    pollution += pol;
    let gdp = e.gdp || 0;
    if (def.cat === 'agriculture') gdp *= farmMult;
    if (def.cat === 'industrial') gdp *= industrialMult;
    gdpBase += gdp;
  }
  popCap *= law.popCapMult * L.cabinetMultiplier(state, 'housing');
  pollution *= law.pollutionMult;
  defense = (defense + law.defenseFlat) * L.cabinetMultiplier(state, 'defence');
  crimeReduction += law.crimeReductionFlat + L.cabinetMultiplier(state, 'justice') * 3 - 3;
  research += law.researchFlat + L.cabinetMultiplier(state, 'science') * 3 - 3;
  gdpBase *= law.gdpMult;

  s.popCap = Math.round(popCap); s.jobs = jobs; s.power = power; s.water = water;
  s.healthcare = healthcare; s.education = education; s.pollution = pollution; s.defense = Math.round(defense);
  s.crimeReduction = crimeReduction; s.buildingHappiness = happinessFlat + law.happinessFlat; s.gdpBase = gdpBase;
  s.lawUpkeepMult = law.upkeepMult; s.lawTreasuryPerTick = law.treasuryPerTick;
  s.lawTaxHappinessRelief = law.taxHappinessRelief; s.lawInflationDamp = law.inflationDamp;
  s.lawGrowthMult = law.growthMult; s.lawCorruptionGrowthMult = law.corruptionGrowthMult;

  s.housingRatio = popCap > 0 ? clamp(popCap / Math.max(1, s.population), 0, 2) : (s.population > 0 ? 0 : 1);
  s.powerRatio = s.population > 0 ? clamp(power / Math.max(1, s.population * 0.7), 0, 2) : 1;
  s.waterRatio = s.population > 0 ? clamp(water / Math.max(1, s.population * 0.7), 0, 2) : 1;
  s.healthcareRatio = s.population > 0 ? clamp(healthcare / Math.max(1, s.population * 0.7), 0, 2) : 1;
  s.educationRatio = s.population > 0 ? clamp(education / Math.max(1, s.population * 0.5), 0, 2) : 1;
}

function simulateEconomy(state) {
  const s = state.stats;
  const gov = D.GOVERNMENTS_BY_ID[state.meta.government];

  // population growth toward capacity, modulated by happiness & healthcare
  const growthMult = techBonus(state, 'growthMult', 'mult') * (s.lawGrowthMult || 1);
  const capRoom = s.popCap - s.population;
  const growthRate = clamp((s.happiness - 40) / 400, -0.01, 0.02) + (capRoom > 0 ? 0.006 : -0.01);
  s.population = Math.max(50, Math.round(s.population * (1 + growthRate * growthMult)));

  // employment
  s.workforce = Math.round(s.population * 0.55);
  s.employed = Math.min(s.workforce, s.jobs);
  s.unemployed = Math.max(0, s.workforce - s.employed);
  const employmentRatio = s.workforce > 0 ? s.employed / s.workforce : 1;

  // GDP: building output scaled by how well-staffed jobs are, corruption drag, global tech multiplier
  const corruptionDrag = clamp(1 - state.stats.corruption / 220, 0.75, 1);
  const gdpMult = techBonus(state, 'gdpMult', 'mult');
  s.gdp = Math.round(s.gdpBase * (0.4 + 0.6 * employmentRatio) * corruptionDrag * gdpMult);

  // taxes -> treasury
  const blendedRate = state.taxRate.income * 0.45 + state.taxRate.corporate * 0.4 + state.taxRate.sales * 0.15;
  const taxRevenue = s.gdp * blendedRate;
  let upkeep = 0;
  for (const b of state.buildings) {
    if (!b.built) continue;
    const def = D.BUILDINGS_BY_ID[b.type];
    let u = def.upkeep;
    if (def.cat === 'civic' && (b.type === 'hospital')) u *= state.funding.health;
    if (b.type === 'school' || b.type === 'university') u *= state.funding.education;
    if (b.type === 'military_base') u *= state.funding.military;
    upkeep += u;
  }
  upkeep *= (s.lawUpkeepMult || 1);
  const militaryUpkeep = (state.militaryUnits.army + state.militaryUnits.navy * 2 + state.militaryUnits.airforce * 2) * 12 * state.funding.military;
  const treasurerMult = L.cabinetMultiplier(state, 'treasurer'); // competent treasurer = cheaper debt service
  const debtInterest = state.debt * 0.0006 * (2 - treasurerMult); // ~3.2% annualized at 52 ticks/year, baseline
  const lawIncome = s.lawTreasuryPerTick || 0;
  const net = taxRevenue - upkeep - militaryUpkeep - debtInterest + lawIncome;
  state.treasury += net;
  if (state.treasury < 0) { state.debt += -state.treasury; state.treasury = 0; }
  else if (state.debt > 0) { const pay = Math.min(state.debt, state.treasury * 0.1); state.debt -= pay; state.treasury -= pay; }
  s.lastTaxRevenue = Math.round(taxRevenue + lawIncome); s.lastUpkeep = Math.round(upkeep + militaryUpkeep + debtInterest); s.netIncome = Math.round(net);

  // inflation: drifts based on deficit spending & debt load relative to GDP
  const debtPressure = s.gdp > 0 ? state.debt / (s.gdp * 10) : 0;
  const inflationTarget = Math.max(0, 2 + clamp(debtPressure * 6, 0, 20) + clamp(-net / Math.max(1, s.gdp) * 20, -2, 8) - (s.lawInflationDamp || 0) - (treasurerMult - 1) * 4);
  s.inflation = clamp(lerp(s.inflation, inflationTarget, 0.08), 0, 30);

  // happiness baseline from services, tax burden, pollution, corruption, government type
  const taxBurden = blendedRate * 100 * (gov.taxTolerance ? 1 / gov.taxTolerance : 1);
  const baseline = 50
    + (employmentRatio - 0.9) * 40
    + (s.housingRatio - 1) * 12
    + (s.powerRatio - 1) * 6 + (s.waterRatio - 1) * 6
    + (s.healthcareRatio - 1) * 10 + (s.educationRatio - 1) * 6
    - s.pollution * 0.4
    - s.corruption * 0.25
    - Math.max(0, taxBurden - 25 - (s.lawTaxHappinessRelief || 0)) * 0.5
    + s.buildingHappiness
    + gov.happinessBaseline;
  s.happiness = clamp(lerp(s.happiness, baseline, 0.15), 0, 100);

  // corruption drifts up slowly, resisted by police, the Justice minister + big_data tech
  const corruptionResist = s.crimeReduction * 0.15 + (techUnlocked(state, 'big_data') ? 3 : 0);
  const corruptionGrowth = gov.corruptionGrowth * (s.lawCorruptionGrowthMult || 1);
  s.corruption = clamp(s.corruption + corruptionGrowth * 0.12 - corruptionResist * 0.05, 0, 100);
}

function simulatePolitics(state) {
  const s = state.stats;
  const approvalTarget = clamp(s.happiness * 0.7 + (s.gdp > (s.prevGdp || s.gdp) ? 5 : -3) - s.corruption * 0.15, 0, 100);
  s.approval = clamp(lerp(s.approval, approvalTarget, 0.12), 0, 100);
  s.prevGdp = s.gdp;

  // party support drifts toward a function of approval + a little randomness-free drift toward ideology fit
  const greenLawActive = state.legislature.activeLawIds.includes('environmental_regulations') || state.legislature.activeLawIds.includes('carbon_pricing');
  for (const p of state.parties) {
    const drift = (greenLawActive && p.id === 'green') ? 1 : 0;
    p.support = clamp(p.support + (Math.random() < 0.5 ? -1 : 1) * 0.3 + drift * 0.4, 2, 60);
  }
  normalizePartySupport(state);
}

function simulateResearch(state) {
  const s = state.stats;
  const gov = D.GOVERNMENTS_BY_ID[state.meta.government];
  const flatBonus = techBonus(state, 'researchFlat', 'flat');
  s.researchPerTick = Math.round((state.buildings.filter(b => b.built).reduce((sum, b) => sum + (D.BUILDINGS_BY_ID[b.type].effects.research || 0), 0) + flatBonus) * gov.researchMult);
  s.researchPoints += s.researchPerTick;
  if (state.tech.researching) {
    const t = D.TECHS_BY_ID[state.tech.researching];
    state.tech.progress += s.researchPerTick;
    if (state.tech.progress >= t.cost) {
      state.tech.unlocked.push(t.id);
      notify(state, `Research complete: ${t.name}!`, 'tech');
      state.tech.researching = null;
      state.tech.progress = 0;
    }
  }
}

function simulateNations(state) {
  const foreignMult = L.cabinetMultiplier(state, 'foreign_affairs'); // competent minister: relations improve faster
  for (const n of state.nations) {
    const drift = (Math.random() - 0.47) * 0.03;
    n.gdp = Math.max(500, n.gdp * (1 + drift));
    n.population = Math.max(100, Math.round(n.population * (1 + (Math.random() - 0.48) * 0.01)));
    n.approval = clamp(n.approval + (Math.random() - 0.5) * 3, 10, 95);
    // relations slowly decay toward neutral unless treaties are active
    const pull = n.tradeAgreement || n.alliance ? 52 : 50;
    n.relation = clamp(lerp(n.relation, pull, 0.03 * foreignMult), 0, 100);
    if (n.tradeAgreement) state.stats.gdp += Math.round(n.gdp * 0.002); // small mutual trade bonus, applied post-hoc
  }
}

function eventWeight(state, ev) {
  let w = ev.weight;
  if (ev.condition) w *= ev.condition(state);
  return Math.max(0, w);
}
function maybeEvent(state) {
  if (state.events.pending) return;
  if (Math.random() > 0.14) return; // ~14% chance per tick that *something* happens
  const pool = D.EVENTS.map(ev => ({ ev, w: eventWeight(state, ev) })).filter(x => x.w > 0);
  const total = pool.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return;
  let roll = Math.random() * total;
  for (const x of pool) { roll -= x.w; if (roll <= 0) { state.events.pending = { id: x.ev.id, tick: state.meta.tick }; return; } }
}
function resolveEvent(state, choiceIndex) {
  if (!state.events.pending) return;
  const ev = D.EVENTS.find(e => e.id === state.events.pending.id);
  const choice = ev.choices[choiceIndex];
  if (!choice) return;
  const delta = choice.apply(state) || {};
  if (delta.treasury) state.treasury = Math.max(0, state.treasury + delta.treasury);
  if (delta.debt) state.debt = Math.max(0, state.debt + delta.debt);
  if (delta.happiness) state.stats.happiness = clamp(state.stats.happiness + delta.happiness, 0, 100);
  if (delta.corruption) state.stats.corruption = clamp(state.stats.corruption + delta.corruption, 0, 100);
  if (delta.gdp) state.stats.gdp = Math.max(0, state.stats.gdp + delta.gdp);
  if (delta.research) state.stats.researchPoints += delta.research;
  if (delta.population) state.stats.population = Math.max(50, state.stats.population + delta.population);
  if (delta.relationsAll) for (const n of state.nations) n.relation = clamp(n.relation + delta.relationsAll, 0, 100);
  if (delta.forceElection) state.nextElectionTick = state.meta.tick;
  state.events.log.push({ tick: state.meta.tick, title: ev.title, choice: choice.label });
  if (state.events.log.length > 60) state.events.log.shift();
  state.events.pending = null;
}

function diplomacyAction(state, nationId, action) {
  const n = state.nations.find(x => x.id === nationId);
  if (!n) return { ok: false };
  if (action === 'trade') { n.tradeAgreement = true; n.relation = clamp(n.relation + 8, 0, 100); notify(state, `Trade agreement signed with ${n.name}.`, 'diplomacy'); }
  else if (action === 'alliance') { if (n.relation < 60) return { ok: false, reason: 'Relations too low for an alliance.' }; n.alliance = true; n.relation = clamp(n.relation + 10, 0, 100); notify(state, `Alliance formed with ${n.name}.`, 'diplomacy'); }
  else if (action === 'nonaggression') { n.nonAggression = true; n.relation = clamp(n.relation + 5, 0, 100); notify(state, `Non-aggression pact signed with ${n.name}.`, 'diplomacy'); }
  else if (action === 'aid') { if (state.treasury < 1000) return { ok: false, reason: 'Not enough treasury.' }; state.treasury -= 1000; n.relation = clamp(n.relation + 12, 0, 100); notify(state, `Sent foreign aid to ${n.name}.`, 'diplomacy'); }
  n.relationLog.push({ tick: state.meta.tick, action });
  if (n.relationLog.length > 20) n.relationLog.shift();
  return { ok: true };
}

function startResearch(state, techId) {
  if (!techAvailable(state, techId)) return { ok: false };
  state.tech.researching = techId; state.tech.progress = 0;
  return { ok: true };
}
function setTaxRate(state, kind, value) { state.taxRate[kind] = clamp(value, 0, 0.5); }
function setFunding(state, kind, value) { state.funding[kind] = clamp(value, 0, 1.5); }
function trainUnit(state, kind) {
  const hasBase = state.buildings.some(b => b.built && b.type === 'military_base');
  if (!hasBase) return { ok: false, reason: 'Build a Military Base first.' };
  const costs = { army: 800, navy: 2200, airforce: 2600 };
  if (state.treasury < costs[kind]) return { ok: false, reason: 'Not enough treasury.' };
  state.treasury -= costs[kind];
  state.militaryUnits[kind]++;
  return { ok: true };
}

function pushHistory(state) {
  const s = state.stats;
  const push = (arr, v) => { arr.push(Math.round(v * 10) / 10); if (arr.length > 120) arr.shift(); };
  push(s.gdpHistory, s.gdp); push(s.inflationHistory, s.inflation);
  push(s.approvalHistory, s.approval); push(s.happinessHistory, s.happiness); push(s.corruptionHistory, s.corruption);
}
function computeScore(state) {
  const s = state.stats;
  return Math.round(s.population / 20 + s.gdp / 30 + s.happiness * 6 + s.approval * 3 + state.tech.unlocked.length * 45 + (state.treasury > 0 ? 20 : 0));
}

/* ------------------------------------------------------------------ */
/* save / load                                                          */
/* ------------------------------------------------------------------ */
function migrate(saved) {
  // v1 is current; future migrations add `if (saved.version < 2) { ...upgrade...; saved.version = 2; }`
  if (!saved.version) saved.version = 1;
  return saved;
}

return {
  MAP_W, MAP_H, AI_COUNT, ELECTION_INTERVAL,
  newGame, tick, canPlaceBuilding, placeBuilding, bulldozeBuilding,
  techAvailable, techUnlocked, startResearch, setTaxRate, setFunding,
  trainUnit, resolveEvent, diplomacyAction, migrate, computeScore,
};
})();
