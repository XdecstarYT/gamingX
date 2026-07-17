/* ============================================================================
   IMPERIUM: WORLD CONQUEST — core simulation.
   Real-time tick loop: economy -> production -> AI decisions -> combat ->
   win/lose. Every system reads/writes a single plain-JSON `state` object so
   the whole game can be saved/loaded trivially.
   ========================================================================== */
window.ImpSim = (() => {
'use strict';
const D = window.ImpData;
const W = window.ImpWorld;

const MAP_W = 1000, MAP_H = 700;
const MAX_QUEUE = 3;
const IMPROVEMENT_TICKS = 6;
const PERSONALITIES = ['aggressive', 'economic', 'balanced'];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
function notify(state, text, kind) {
  state.notifications.push({ id: (state.tickNotifId = (state.tickNotifId || 0) + 1), text, kind: kind || 'info', tick: state.meta.tick });
  if (state.notifications.length > 40) state.notifications.shift();
  state.log.push({ tick: state.meta.tick, text, kind: kind || 'info' });
  if (state.log.length > 150) state.log.shift();
}

/* ------------------------------------------------------------------ */
/* new game                                                             */
/* ------------------------------------------------------------------ */
function newGame(opts) {
  const playerNation = opts.playerNation || 'kalden';
  const otherIds = D.NATIONS.map(n => n.id).filter(id => id !== playerNation);
  const seed = opts.seed || String(Date.now());
  shuffle(otherIds, W.makeRng(W.hashSeed(seed + '-nations')));
  const aiCount = Math.min(opts.aiCount || 5, otherIds.length);
  const aiIds = otherIds.slice(0, aiCount);
  const nationIds = [playerNation, ...aiIds];

  const provinceCount = opts.provinceCount || Math.max(24, nationIds.length * 7);
  const world = W.generate(seed, { provinceCount, mapW: MAP_W, mapH: MAP_H, k: 3, nationIds, startSize: 4 });

  const provinces = world.provinces.map((p, i) => ({
    owner: world.owners[i],
    garrison: world.owners[i] ? { militia: 6 } : {},
    improvement: null, improvementBuild: null, buildQueue: [],
  }));

  const nations = {};
  const personalityRng = W.makeRng(W.hashSeed(seed + '-personality'));
  for (const nid of nationIds) {
    nations[nid] = {
      id: nid, isPlayer: nid === playerNation, alive: true,
      gold: 800, manpower: 500, researchProgress: 0,
      techUnlocked: [], researching: null,
      personality: nid === playerNation ? null : PERSONALITIES[Math.floor(personalityRng() * PERSONALITIES.length)],
    };
  }

  const state = {
    version: 1,
    meta: { seed: world.seed, tick: 0, speed: 1, paused: false },
    playerNation, nationOrder: nationIds,
    world: { w: world.w, h: world.h, provinces: world.provinces },
    provinces,
    nations,
    notifications: [], log: [],
    score: 0, gameOver: null,
  };
  notify(state, `${D.NATIONS_BY_ID[playerNation].name} takes the stage. ${aiIds.length} rival nation${aiIds.length === 1 ? '' : 's'} stand against you.`, 'info');
  return state;
}

/* ------------------------------------------------------------------ */
/* queries                                                              */
/* ------------------------------------------------------------------ */
function ownedProvinceIds(state, nationId) {
  const out = [];
  for (let i = 0; i < state.provinces.length; i++) if (state.provinces[i].owner === nationId) out.push(i);
  return out;
}
function techMult(nation, key) {
  let m = 1;
  for (const tid of nation.techUnlocked) { const t = D.TECHS_BY_ID[tid]; if (t.bonus && t.bonus[key] != null) m *= t.bonus[key]; }
  return m;
}
function trainTimeMult(state, nationId, provinceId) {
  const nation = state.nations[nationId];
  const n = D.NATIONS_BY_ID[nationId];
  let m = (n.trait.trainTime || 1) * techMult(nation, 'trainTimeMult');
  const ps = state.provinces[provinceId];
  if (ps.improvement === 'barracks') m *= D.IMPROVEMENTS_BY_ID.barracks.bonus.trainTimeMult;
  return m;
}
function attackPowerMult(nationId) {
  return D.NATIONS_BY_ID[nationId].trait.atk || 1;
}
function defensePowerMult(state, nationId, provinceId) {
  const prov = state.world.provinces[provinceId];
  let m = D.TERRAIN[prov.terrain].defMult;
  const ps = state.provinces[provinceId];
  if (ps.improvement) { const imp = D.IMPROVEMENTS_BY_ID[ps.improvement]; if (imp.bonus.defMult) m *= imp.bonus.defMult; }
  if (nationId) { const n = D.NATIONS_BY_ID[nationId]; m *= (n.trait.def || 1) * techMult(state.nations[nationId], 'defMult'); }
  return m;
}
function sumStat(units, statKey) {
  let s = 0;
  for (const [id, count] of Object.entries(units)) s += D.UNITS_BY_ID[id][statKey] * count;
  return s;
}
function computeIncome(state, nationId) {
  const nation = state.nations[nationId];
  const nationDef = D.NATIONS_BY_ID[nationId];
  let gold = 0, manpower = 0, research = 0;
  for (const pid of ownedProvinceIds(state, nationId)) {
    const prov = state.world.provinces[pid];
    const ps = state.provinces[pid];
    const terr = D.TERRAIN[prov.terrain];
    let g = 10 * terr.gold, m = 6 * terr.manpower, r = 2;
    if (ps.improvement) {
      const imp = D.IMPROVEMENTS_BY_ID[ps.improvement];
      if (imp.bonus.goldMult) g *= imp.bonus.goldMult;
      if (imp.bonus.manpowerMult) m *= imp.bonus.manpowerMult;
      if (imp.bonus.researchFlat) r += imp.bonus.researchFlat;
    }
    gold += g; manpower += m; research += r;
  }
  gold *= (nationDef.trait.gold || 1) * techMult(nation, 'goldMult');
  manpower *= (nationDef.trait.manpower || 1) * techMult(nation, 'manpowerMult');
  research *= (nationDef.trait.research || 1);
  return { gold, manpower, research };
}
function computeUpkeep(state, nationId) {
  let upkeep = 0;
  for (const pid of ownedProvinceIds(state, nationId)) {
    const g = state.provinces[pid].garrison;
    for (const [uid, count] of Object.entries(g)) upkeep += D.UNITS_BY_ID[uid].upkeep * count;
  }
  return upkeep * techMult(state.nations[nationId], 'upkeepMult');
}

/* ------------------------------------------------------------------ */
/* player + AI actions                                                  */
/* ------------------------------------------------------------------ */
function queueUnit(state, provinceId, unitId) {
  const ps = state.provinces[provinceId];
  if (!ps.owner) return { ok: false, reason: 'You do not own this province.' };
  const nation = state.nations[ps.owner];
  const def = D.UNITS_BY_ID[unitId];
  if (def.needsTech && !nation.techUnlocked.includes(def.needsTech)) return { ok: false, reason: 'Technology required.' };
  if (ps.buildQueue.length >= MAX_QUEUE) return { ok: false, reason: 'Production queue is full.' };
  if (nation.gold < def.cost.gold || nation.manpower < def.cost.manpower) return { ok: false, reason: 'Not enough resources.' };
  nation.gold -= def.cost.gold; nation.manpower -= def.cost.manpower;
  const ticks = Math.max(1, Math.round(def.trainTicks * trainTimeMult(state, ps.owner, provinceId)));
  ps.buildQueue.push({ unitId, ticksLeft: ticks, totalTicks: ticks });
  return { ok: true };
}
function queueImprovement(state, provinceId, improvementId) {
  const ps = state.provinces[provinceId];
  if (!ps.owner) return { ok: false, reason: 'You do not own this province.' };
  if (ps.improvement || ps.improvementBuild) return { ok: false, reason: 'This province already has an improvement underway.' };
  const nation = state.nations[ps.owner];
  const def = D.IMPROVEMENTS_BY_ID[improvementId];
  if (nation.gold < def.cost) return { ok: false, reason: 'Not enough gold.' };
  nation.gold -= def.cost;
  ps.improvementBuild = { id: improvementId, ticksLeft: IMPROVEMENT_TICKS, totalTicks: IMPROVEMENT_TICKS };
  return { ok: true };
}
function setResearch(state, nationId, techId) {
  const nation = state.nations[nationId];
  const t = D.TECHS_BY_ID[techId];
  if (!t) return { ok: false, reason: 'Unknown technology.' };
  if (nation.techUnlocked.includes(techId)) return { ok: false, reason: 'Already researched.' };
  if (t.prereq && !t.prereq.every(p => nation.techUnlocked.includes(p))) return { ok: false, reason: 'Missing prerequisite technology.' };
  nation.researching = techId; nation.researchProgress = 0;
  return { ok: true };
}
function resolveBattle(atkUnits, defUnits, atkMult, defMult) {
  const atkBase = sumStat(atkUnits, 'attack');
  const defBase = sumStat(defUnits, 'defense');
  const atkPower = atkBase * atkMult * (0.85 + Math.random() * 0.3);
  const defPower = defBase * defMult * (0.85 + Math.random() * 0.3);
  const attackerWins = defBase === 0 || atkPower > defPower;
  const total = atkPower + defPower || 1;
  const survivors = {}, defenderRemaining = {};
  if (attackerWins) {
    const lossFrac = clamp(defPower / total, 0.05, 0.85);
    for (const [id, count] of Object.entries(atkUnits)) { const keep = Math.round(count * (1 - lossFrac)); if (keep > 0) survivors[id] = keep; }
    if (!Object.keys(survivors).length) { const firstId = Object.keys(atkUnits)[0]; if (firstId) survivors[firstId] = 1; }
  } else {
    const lossFrac = clamp(atkPower / total, 0.05, 0.85);
    for (const [id, count] of Object.entries(defUnits)) { const keep = Math.round(count * (1 - lossFrac)); if (keep > 0) defenderRemaining[id] = keep; }
  }
  return { attackerWins, survivors, defenderRemaining };
}
function attack(state, sourceId, targetId, fraction) {
  const src = state.provinces[sourceId];
  const srcStatic = state.world.provinces[sourceId];
  if (!src.owner) return { ok: false, reason: 'You do not own the source province.' };
  if (!srcStatic.neighbors.includes(targetId)) return { ok: false, reason: 'That province is not adjacent.' };
  const tgt = state.provinces[targetId];
  if (tgt.owner === src.owner) return { ok: false, reason: 'You already own that province.' };
  const sent = {};
  for (const [uid, count] of Object.entries(src.garrison)) {
    const n = Math.floor(count * fraction);
    if (n > 0) sent[uid] = n;
  }
  if (!Object.keys(sent).length) return { ok: false, reason: 'No units available to send.' };
  for (const [uid, n] of Object.entries(sent)) { src.garrison[uid] -= n; if (src.garrison[uid] <= 0) delete src.garrison[uid]; }
  const atkMult = attackPowerMult(src.owner);
  const defMult = defensePowerMult(state, tgt.owner, targetId);
  const result = resolveBattle(sent, tgt.garrison, atkMult, defMult);
  const attackerName = D.NATIONS_BY_ID[src.owner].name;
  const defenderName = tgt.owner ? D.NATIONS_BY_ID[tgt.owner].name : 'unclaimed territory';
  const targetName = state.world.provinces[targetId].name;
  if (result.attackerWins) {
    tgt.owner = src.owner;
    tgt.garrison = result.survivors;
    tgt.improvement = null; tgt.improvementBuild = null; tgt.buildQueue = [];
    notify(state, `${attackerName} captured ${targetName} from ${defenderName}!`, 'battle');
  } else {
    tgt.garrison = result.defenderRemaining;
    notify(state, `${attackerName}'s assault on ${targetName} was repelled by ${defenderName}.`, 'battle');
  }
  return { ok: true, attackerWins: result.attackerWins };
}

/* ------------------------------------------------------------------ */
/* AI                                                                   */
/* ------------------------------------------------------------------ */
function aiTurn(state, nationId) {
  const nation = state.nations[nationId];
  if (!nation.alive) return;
  const myProvinces = ownedProvinceIds(state, nationId);
  if (!myProvinces.length) return;
  const personality = nation.personality;

  if (!nation.researching) {
    const options = D.TECHS.filter(t => !nation.techUnlocked.includes(t.id) && (!t.prereq || t.prereq.every(p => nation.techUnlocked.includes(p))));
    if (options.length) {
      const preferred = options.filter(t => personality === 'economic' ? t.cat === 'economy' : personality === 'aggressive' ? t.cat === 'military' : true);
      const pool = preferred.length ? preferred : options;
      setResearch(state, nationId, pool[Math.floor(Math.random() * pool.length)].id);
    }
  }

  const buildChance = personality === 'economic' ? 0.35 : personality === 'aggressive' ? 0.12 : 0.2;
  if (Math.random() < buildChance) {
    const candidates = myProvinces.filter(id => !state.provinces[id].improvement && !state.provinces[id].improvementBuild);
    if (candidates.length) {
      const pid = candidates[Math.floor(Math.random() * candidates.length)];
      const pool = personality === 'economic' ? ['market', 'farm', 'lab'] : personality === 'aggressive' ? ['fort', 'barracks'] : D.IMPROVEMENTS.map(i => i.id);
      queueImprovement(state, pid, pool[Math.floor(Math.random() * pool.length)]);
    }
  }

  const trainChance = personality === 'aggressive' ? 0.45 : personality === 'economic' ? 0.15 : 0.3;
  if (Math.random() < trainChance) {
    const pid = myProvinces[Math.floor(Math.random() * myProvinces.length)];
    if (state.provinces[pid].buildQueue.length < MAX_QUEUE) {
      const avail = D.UNITS.filter(u => !u.needsTech || nation.techUnlocked.includes(u.needsTech));
      queueUnit(state, pid, avail[Math.floor(Math.random() * avail.length)].id);
    }
  }

  const riskThreshold = personality === 'aggressive' ? 0.75 : personality === 'economic' ? 1.4 : 1.05;
  const attackChance = personality === 'aggressive' ? 0.5 : personality === 'economic' ? 0.15 : 0.3;
  if (Math.random() < attackChance) {
    const candidates = [];
    for (const pid of myProvinces) {
      const src = state.provinces[pid];
      if (!Object.keys(src.garrison).length) continue;
      for (const nb of state.world.provinces[pid].neighbors) {
        if (state.provinces[nb].owner !== nationId) candidates.push([pid, nb]);
      }
    }
    if (candidates.length) {
      const [sid, tid] = candidates[Math.floor(Math.random() * candidates.length)];
      const atkPow = sumStat(state.provinces[sid].garrison, 'attack') * attackPowerMult(nationId);
      const defPow = sumStat(state.provinces[tid].garrison, 'defense') * defensePowerMult(state, state.provinces[tid].owner, tid);
      if (defPow === 0 || atkPow > defPow * riskThreshold) attack(state, sid, tid, personality === 'aggressive' ? 0.9 : 0.6);
    }
  }
}

/* ------------------------------------------------------------------ */
/* win/lose + flavor                                                    */
/* ------------------------------------------------------------------ */
function updateAliveFlags(state) {
  for (const nid of state.nationOrder) {
    const nation = state.nations[nid];
    if (nation.alive && ownedProvinceIds(state, nid).length === 0) {
      nation.alive = false;
      if (nid !== state.playerNation) notify(state, `${D.NATIONS_BY_ID[nid].name} has been eliminated!`, 'battle');
    }
  }
}
function checkGameOver(state) {
  if (state.gameOver) return;
  if (ownedProvinceIds(state, state.playerNation).length === 0) { state.gameOver = 'lose'; notify(state, 'Your nation has fallen. Game over.', 'battle'); return; }
  const others = state.nationOrder.filter(id => id !== state.playerNation);
  if (!others.some(id => state.nations[id].alive)) { state.gameOver = 'win'; notify(state, 'Total victory! You have conquered the world.', 'battle'); }
}
function maybeFlavorEvent(state) {
  if (Math.random() > 0.05) return;
  const owned = [];
  for (let i = 0; i < state.provinces.length; i++) if (state.provinces[i].owner) owned.push(i);
  if (!owned.length) return;
  const pid = owned[Math.floor(Math.random() * owned.length)];
  const template = D.FLAVOR_EVENTS[Math.floor(Math.random() * D.FLAVOR_EVENTS.length)];
  notify(state, template.replace('{province}', state.world.provinces[pid].name), 'flavor');
}
function computeScore(state) {
  const nation = state.nations[state.playerNation];
  return Math.round(ownedProvinceIds(state, state.playerNation).length * 100 + nation.gold / 10 + nation.techUnlocked.length * 50);
}

/* ------------------------------------------------------------------ */
/* main tick                                                            */
/* ------------------------------------------------------------------ */
function tick(state) {
  if (state.gameOver) return;
  state.meta.tick++;

  for (const ps of state.provinces) {
    if (!ps.owner) continue;
    if (ps.improvementBuild) {
      ps.improvementBuild.ticksLeft--;
      if (ps.improvementBuild.ticksLeft <= 0) { ps.improvement = ps.improvementBuild.id; ps.improvementBuild = null; }
    }
    if (ps.buildQueue.length) {
      const item = ps.buildQueue[0];
      item.ticksLeft--;
      if (item.ticksLeft <= 0) { ps.garrison[item.unitId] = (ps.garrison[item.unitId] || 0) + 1; ps.buildQueue.shift(); }
    }
  }

  for (const nid of state.nationOrder) {
    const nation = state.nations[nid];
    if (!nation.alive) continue;
    const inc = computeIncome(state, nid);
    nation.gold += inc.gold; nation.manpower += inc.manpower;
    nation.gold = Math.max(0, nation.gold - computeUpkeep(state, nid));
    if (nation.researching) {
      nation.researchProgress += inc.research;
      const t = D.TECHS_BY_ID[nation.researching];
      if (nation.researchProgress >= t.cost) {
        nation.techUnlocked.push(nation.researching);
        if (nation.isPlayer) notify(state, `Research complete: ${t.name}!`, 'tech');
        nation.researching = null; nation.researchProgress = 0;
      }
    }
  }

  for (const nid of state.nationOrder) { if (nid !== state.playerNation) aiTurn(state, nid); }

  updateAliveFlags(state);
  checkGameOver(state);
  maybeFlavorEvent(state);
  state.score = computeScore(state);
}

/* ------------------------------------------------------------------ */
/* save / load                                                          */
/* ------------------------------------------------------------------ */
function migrate(saved) {
  if (!saved.version) saved.version = 1;
  return saved;
}

return {
  MAP_W, MAP_H, MAX_QUEUE,
  newGame, tick, attack, queueUnit, queueImprovement, setResearch,
  ownedProvinceIds, computeIncome, computeUpkeep, migrate, computeScore,
};
})();
