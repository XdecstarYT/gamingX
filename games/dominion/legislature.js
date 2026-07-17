/* ============================================================================
   DOMINION — legislature: Parliament, bills, cabinet, courts, elections.

   Design (per the hybrid government module):
     - The engine never legislates, taxes, or builds on its own — every
       lasting national action is either an enacted bill (passed a floor
       vote) or a time-boxed, revertible Executive Order.
     - Parliament is ~100 individually-modeled legislators (party, ideology,
       loyalty, popularity, ambition, integrity, competence, experience).
       Bills are tallied seat-by-seat, not by party bloc.
     - Winning an election makes the player's party (or its coalition) the
       Government; losing makes it the Opposition. The world — economy,
       AI nations, the legislature itself — keeps moving either way.
     - Every bill, election, and government is kept in a permanent archive.
   ========================================================================== */
window.DomLegislature = (() => {
'use strict';
const D = window.DomData;

const SEATS = 101;
const COMMITTEE_TURNS = 3;
const MAX_PENDING_BILLS = 4;
const EXECUTIVE_ORDER_COOLDOWN = 12;

const uid = () => 'l' + Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

/* ------------------------------------------------------------------ */
/* seat allocation + legislator generation                             */
/* ------------------------------------------------------------------ */
function allocateSeats(parties) {
  const total = parties.reduce((s, p) => s + p.support, 0) || 1;
  const raw = parties.map(p => (p.support / total) * SEATS);
  const seats = raw.map(Math.floor);
  let remaining = SEATS - seats.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let i = 0; i < remaining; i++) seats[order[i % order.length][1]]++;
  return parties.map((p, i) => ({ partyId: p.id, seats: seats[i] }));
}

function makeLegislator(partyDef) {
  const first = D.LEGISLATOR_FIRST[Math.floor(Math.random() * D.LEGISLATOR_FIRST.length)];
  const last = D.LEGISLATOR_LAST[Math.floor(Math.random() * D.LEGISLATOR_LAST.length)];
  const noise = (Math.random() - 0.5) * 0.6;
  return {
    id: uid(), name: `${first} ${last}`, party: partyDef.id,
    constituency: D.CONSTITUENCIES[Math.floor(Math.random() * D.CONSTITUENCIES.length)],
    ideology: clamp((partyDef.econ || 0) + noise, -1, 1),
    loyalty: Math.round(rnd(35, 90)), popularity: Math.round(rnd(25, 80)),
    ambition: Math.round(rnd(15, 85)), integrity: Math.round(rnd(25, 90)),
    competence: Math.round(rnd(25, 90)), experience: Math.round(rnd(0, 20)),
  };
}

function swearInParliament(state) {
  const allocations = allocateSeats(state.parties);
  const legislators = [];
  for (const alloc of allocations) {
    const partyDef = D.PARTIES.find(p => p.id === alloc.partyId);
    for (let i = 0; i < alloc.seats; i++) legislators.push(makeLegislator(partyDef));
  }
  state.legislature.legislators = legislators;
  state.legislature.cabinet = {};
  determineGovernment(state);
}

function determineGovernment(state) {
  const seatCounts = {};
  for (const leg of state.legislature.legislators) seatCounts[leg.party] = (seatCounts[leg.party] || 0) + 1;
  const ranked = Object.entries(seatCounts).sort((a, b) => b[1] - a[1]);
  const majority = Math.floor(SEATS / 2) + 1;
  const governing = [];
  let seatTotal = 0;
  for (const [partyId, count] of ranked) {
    governing.push(partyId);
    seatTotal += count;
    if (seatTotal >= majority) break;
  }
  state.legislature.governingParties = governing;
  state.legislature.isPlayerGovernment = governing.includes(state.legislature.playerParty);
  const leadParty = ranked[0][0];
  const leadLegislators = state.legislature.legislators.filter(l => l.party === leadParty);
  const headOf = leadLegislators.sort((a, b) => b.popularity - a.popularity)[0];
  state.legislature.headOfGovernment = headOf ? headOf.name : 'Unknown';
  state.legislature.leadParty = leadParty;
}

/* ------------------------------------------------------------------ */
/* init (called once from simulation.newGame)                          */
/* ------------------------------------------------------------------ */
function init(state, playerPartyId) {
  state.legislature = {
    playerParty: playerPartyId, governingParties: [], isPlayerGovernment: false,
    headOfGovernment: '', leadParty: null,
    legislators: [], cabinet: {}, bills: [], lawCode: [], activeLawIds: [],
    noConfidence: null, nextExecutiveOrderTurn: 0,
  };
  state.history = { elections: [], governments: [], budgets: [] };
  swearInParliament(state);
  state.history.elections.push(snapshotElection(state));
  state.history.governments.push({ startTurn: 0, endTurn: null, leadParty: state.legislature.leadParty, headOfGovernment: state.legislature.headOfGovernment });
}
function snapshotElection(state) {
  const seatCounts = {};
  for (const leg of state.legislature.legislators) seatCounts[leg.party] = (seatCounts[leg.party] || 0) + 1;
  return {
    turn: state.meta.tick, results: Object.entries(seatCounts).map(([party, seats]) => ({ party, seats })),
    governingParties: state.legislature.governingParties.slice(), isPlayerGovernment: state.legislature.isPlayerGovernment,
  };
}

/* ------------------------------------------------------------------ */
/* vote tallying                                                        */
/* ------------------------------------------------------------------ */
function yesProbability(leg, ideologyTarget, sponsorParty, state) {
  const alignment = 1 - Math.min(1, Math.abs(leg.ideology - ideologyTarget) / 2); // 0..1
  const sameParty = leg.party === sponsorParty;
  const governing = state.legislature.governingParties.includes(leg.party);
  let base;
  if (sameParty) base = 0.5 + 0.4 * (leg.loyalty / 100) + 0.2 * alignment;
  else if (governing) base = 0.3 + 0.3 * (leg.loyalty / 100) + 0.35 * alignment;
  else base = 0.12 + 0.55 * alignment;
  const rebelPull = (1 - leg.loyalty / 100) * (leg.ambition / 100);
  base += (Math.random() - 0.5) * rebelPull * 0.4;
  return clamp(base, 0.02, 0.97);
}
function tallyVote(state, ideologyTarget, sponsorParty) {
  let yes = 0, no = 0, abstain = 0;
  const roster = [];
  for (const leg of state.legislature.legislators) {
    const p = yesProbability(leg, ideologyTarget, sponsorParty, state);
    const roll = Math.random();
    let v;
    if (roll < p) v = 'yes';
    else if (roll < p + 0.08) v = 'abstain';
    else v = 'no';
    if (v === 'yes') yes++; else if (v === 'no') no++; else abstain++;
    roster.push({ id: leg.id, name: leg.name, party: leg.party, vote: v });
  }
  return { yes, no, abstain, passed: yes > no, roster };
}

/* ------------------------------------------------------------------ */
/* bills                                                                */
/* ------------------------------------------------------------------ */
function introduceBill(state, billDefId, sponsorParty) {
  if (state.legislature.bills.length >= MAX_PENDING_BILLS) return { ok: false, reason: 'Parliament’s agenda is full — wait for a pending bill to resolve.' };
  if (state.legislature.activeLawIds.includes(billDefId)) return { ok: false, reason: 'That law is already in effect.' };
  if (state.legislature.bills.some(b => b.billDefId === billDefId)) return { ok: false, reason: 'That bill is already before Parliament.' };
  const def = D.BILLS_BY_ID[billDefId];
  if (!def) return { ok: false, reason: 'Unknown bill.' };
  const bill = { uid: uid(), billDefId, sponsorParty, stage: 'committee', turnsInStage: 0, introducedTurn: state.meta.tick, status: 'in_committee' };
  state.legislature.bills.push(bill);
  syncLawCode(state, bill);
  notify(state, `${def.name} introduced to committee by ${partyName(sponsorParty)}.`, 'law');
  return { ok: true };
}
function partyName(id) { return (D.PARTIES.find(p => p.id === id) || {}).name || id; }
// The law code is the permanent archive; `bills` is just the pending queue.
// A save/load round-trip clones objects, breaking reference-sharing between
// the two arrays, so every mutation is synced back into lawCode by uid
// rather than relied upon via shared identity.
function syncLawCode(state, bill) {
  const idx = state.legislature.lawCode.findIndex(b => b.uid === bill.uid);
  if (idx !== -1) state.legislature.lawCode[idx] = bill;
  else state.legislature.lawCode.push(bill);
}

function resolveVote(state, bill) {
  const def = D.BILLS_BY_ID[bill.billDefId];
  const result = tallyVote(state, def.ideology, bill.sponsorParty);
  bill.votesFor = result.yes; bill.votesAgainst = result.no; bill.abstentions = result.abstain;
  bill.votedTurn = state.meta.tick;
  if (result.passed) {
    bill.stage = 'enacted'; bill.status = 'passed'; bill.enactedTurn = state.meta.tick; bill.reviewed = false;
    state.legislature.activeLawIds.push(bill.billDefId);
    notify(state, `${def.name} PASSED (${result.yes}-${result.no}) and is now law.`, 'law');
  } else {
    bill.stage = 'failed'; bill.status = 'failed';
    notify(state, `${def.name} FAILED (${result.yes}-${result.no}) in Parliament.`, 'law');
  }
  state.legislature.bills = state.legislature.bills.filter(b => b.uid !== bill.uid);
  syncLawCode(state, bill);
}

function issueExecutiveOrder(state, billDefId) {
  if (!state.legislature.isPlayerGovernment) return { ok: false, reason: 'Only the Government may issue executive orders.' };
  if (state.meta.tick < state.legislature.nextExecutiveOrderTurn) return { ok: false, reason: `On cooldown for ${state.legislature.nextExecutiveOrderTurn - state.meta.tick} more weeks.` };
  if (state.legislature.activeLawIds.includes(billDefId)) return { ok: false, reason: 'That law is already in effect.' };
  const def = D.BILLS_BY_ID[billDefId];
  if (!def) return { ok: false, reason: 'Unknown order.' };
  const bill = {
    uid: uid(), billDefId, sponsorParty: state.legislature.playerParty, stage: 'enacted', status: 'passed',
    origin: 'executive', introducedTurn: state.meta.tick, enactedTurn: state.meta.tick, reviewed: false,
    votesFor: null, votesAgainst: null, abstentions: null,
  };
  state.legislature.lawCode.push(bill);
  state.legislature.activeLawIds.push(billDefId);
  state.legislature.nextExecutiveOrderTurn = state.meta.tick + EXECUTIVE_ORDER_COOLDOWN;
  notify(state, `Executive Order: ${def.name} takes effect immediately — no vote held.`, 'law');
  return { ok: true };
}

function repealLaw(state, billDefId) {
  if (!state.legislature.isPlayerGovernment) return { ok: false, reason: 'Only the Government may repeal a law.' };
  const idx = state.legislature.activeLawIds.indexOf(billDefId);
  if (idx === -1) return { ok: false, reason: 'That law is not currently active.' };
  state.legislature.activeLawIds.splice(idx, 1);
  const entry = state.legislature.lawCode.slice().reverse().find(b => b.billDefId === billDefId && b.status === 'passed');
  if (entry) entry.status = 'repealed';
  notify(state, `${D.BILLS_BY_ID[billDefId].name} has been repealed.`, 'law');
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* judicial review — a small ongoing chance an active law is struck    */
/* ------------------------------------------------------------------ */
function judicialReview(state) {
  for (const entry of state.legislature.lawCode) {
    if (entry.status !== 'passed' || entry.reviewed) continue;
    if (!state.legislature.activeLawIds.includes(entry.billDefId)) continue;
    const def = D.BILLS_BY_ID[entry.billDefId];
    const extremity = Math.abs(def.ideology);
    const originMult = entry.origin === 'executive' ? 3 : 1;
    const chance = (0.012 + extremity * 0.02) * originMult;
    if (Math.random() < chance) {
      entry.reviewed = true;
      if (Math.random() < 0.5) {
        entry.status = 'struck_down';
        const i = state.legislature.activeLawIds.indexOf(entry.billDefId);
        if (i !== -1) state.legislature.activeLawIds.splice(i, 1);
        notify(state, `The courts have struck down ${def.name} as unconstitutional.`, 'law');
      }
    } else if (state.meta.tick - entry.enactedTurn > 30) {
      entry.reviewed = true; // stops being newsworthy after ~half a year unchallenged
    }
  }
}

/* ------------------------------------------------------------------ */
/* opposition AI                                                        */
/* ------------------------------------------------------------------ */
function oppositionTurn(state) {
  const oppositionParties = state.parties.map(p => p.id).filter(id => !state.legislature.governingParties.includes(id));
  if (!oppositionParties.length) return;

  if (state.legislature.bills.length < MAX_PENDING_BILLS && Math.random() < 0.035) {
    const party = oppositionParties[Math.floor(Math.random() * oppositionParties.length)];
    const partyDef = D.PARTIES.find(p => p.id === party);
    const candidates = D.BILLS.filter(b => !state.legislature.activeLawIds.includes(b.id) && !state.legislature.bills.some(x => x.billDefId === b.id));
    if (candidates.length) {
      candidates.sort((a, b) => Math.abs(a.ideology - partyDef.econ) - Math.abs(b.ideology - partyDef.econ));
      const pick = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
      introduceBill(state, pick.id, party);
    }
  }

  const gov = D.GOVERNMENTS_BY_ID[state.meta.government];
  if (gov.elections && !state.legislature.noConfidence && state.stats.approval < 22 && Math.random() < 0.06) {
    state.legislature.noConfidence = { filedTurn: state.meta.tick, byParty: oppositionParties[Math.floor(Math.random() * oppositionParties.length)] };
    notify(state, `${partyName(state.legislature.noConfidence.byParty)} has filed a motion of no confidence in the Government!`, 'election');
  }
}

function resolveNoConfidence(state) {
  const nc = state.legislature.noConfidence;
  if (!nc) return;
  let yes = 0, no = 0;
  for (const leg of state.legislature.legislators) {
    const governing = state.legislature.governingParties.includes(leg.party);
    const p = governing ? (1 - leg.loyalty / 100) * 0.5 : 0.55 + (leg.ambition / 100) * 0.25;
    if (Math.random() < p) yes++; else no++;
  }
  state.legislature.noConfidence = null;
  if (yes > no) {
    notify(state, `The no-confidence motion PASSED (${yes}-${no}). A snap election has been called!`, 'election');
    holdElection(state, true);
  } else {
    notify(state, `The no-confidence motion FAILED (${yes}-${no}). The Government survives.`, 'election');
  }
}

/* ------------------------------------------------------------------ */
/* cabinet                                                              */
/* ------------------------------------------------------------------ */
function appointMinister(state, portfolioId, legislatorId) {
  if (!state.legislature.isPlayerGovernment) return { ok: false, reason: 'Only the Government appoints ministers.' };
  const leg = state.legislature.legislators.find(l => l.id === legislatorId);
  if (!leg) return { ok: false, reason: 'Legislator not found.' };
  if (!state.legislature.governingParties.includes(leg.party)) return { ok: false, reason: 'Ministers must come from a governing party.' };
  state.legislature.cabinet[portfolioId] = legislatorId;
  notify(state, `${leg.name} appointed ${D.PORTFOLIOS_BY_ID[portfolioId].name}.`, 'law');
  return { ok: true };
}
function dismissMinister(state, portfolioId) {
  if (!state.legislature.isPlayerGovernment) return { ok: false };
  delete state.legislature.cabinet[portfolioId];
  return { ok: true };
}
function cabinetMultiplier(state, portfolioId) {
  const legId = state.legislature.cabinet[portfolioId];
  const leg = legId && state.legislature.legislators.find(l => l.id === legId);
  if (!leg) return 1;
  return 0.85 + (leg.competence / 100) * 0.35;
}

/* ------------------------------------------------------------------ */
/* aggregate active-law effects (read by simulation.js every tick)      */
/* ------------------------------------------------------------------ */
function activeEffects(state) {
  const agg = {
    gdpMult: 1, pollutionMult: 1, upkeepMult: 1, happinessFlat: 0, popCapMult: 1, educationMult: 1,
    healthcareMult: 1, buildTimeMult: 1, growthMult: 1, corruptionGrowthMult: 1, crimeReductionFlat: 0,
    defenseFlat: 0, researchFlat: 0, treasuryPerTick: 0, taxHappinessRelief: 0, inflationDamp: 0,
  };
  for (const lawId of state.legislature.activeLawIds) {
    const def = D.BILLS_BY_ID[lawId]; if (!def) continue;
    for (const k in def.effects) {
      if (k.endsWith('Mult')) agg[k] = (agg[k] != null ? agg[k] : 1) * def.effects[k];
      else agg[k] = (agg[k] || 0) + def.effects[k];
    }
  }
  return agg;
}

/* ------------------------------------------------------------------ */
/* elections                                                            */
/* ------------------------------------------------------------------ */
function holdElection(state, isSnap) {
  const wasGovernment = state.legislature.isPlayerGovernment;
  const prevGov = state.history.governments[state.history.governments.length - 1];
  if (prevGov) prevGov.endTurn = state.meta.tick;

  swearInParliament(state);
  state.legislature.cabinet = {};
  state.history.elections.push(snapshotElection(state));
  state.history.governments.push({ startTurn: state.meta.tick, endTurn: null, leadParty: state.legislature.leadParty, headOfGovernment: state.legislature.headOfGovernment });

  const nowGovernment = state.legislature.isPlayerGovernment;
  if (nowGovernment && !wasGovernment) {
    state.stats.approval = 55;
    notify(state, `Election result: your party enters GOVERNMENT! ${state.legislature.headOfGovernment} becomes head of government.`, 'election');
  } else if (!nowGovernment && wasGovernment) {
    notify(state, `Election result: your party has lost power. You are now the OPPOSITION.`, 'election');
  } else if (nowGovernment) {
    state.stats.approval = clamp(state.stats.approval + 5, 0, 100);
    notify(state, `Election result: your Government has been returned to power.`, 'election');
  } else {
    notify(state, `Election result: you remain in Opposition.`, 'election');
  }
  return { wasGovernment, nowGovernment };
}

/* ------------------------------------------------------------------ */
/* per-turn driver                                                     */
/* ------------------------------------------------------------------ */
function notify(state, text, kind) {
  state.notifications.push({ id: (state.tickNotifId = (state.tickNotifId || 0) + 1), text, kind: kind || 'info', tick: state.meta.tick });
  if (state.notifications.length > 40) state.notifications.shift();
}

function tick(state) {
  for (const bill of state.legislature.bills.slice()) {
    bill.turnsInStage++;
    if (bill.stage === 'committee' && bill.turnsInStage >= COMMITTEE_TURNS) resolveVote(state, bill);
  }
  judicialReview(state);
  if (state.legislature.noConfidence) resolveNoConfidence(state);
  else oppositionTurn(state);

  const gov = D.GOVERNMENTS_BY_ID[state.meta.government];
  if (gov.elections && state.meta.tick >= state.nextElectionTick) {
    state.nextElectionTick = state.meta.tick + 208;
    holdElection(state, false);
  }

  if (state.meta.tick % 52 === 0) {
    state.history.budgets.push({
      year: Math.floor(state.meta.tick / 52), revenue: state.stats.lastTaxRevenue || 0,
      spending: state.stats.lastUpkeep || 0, debt: Math.round(state.debt), gdp: Math.round(state.stats.gdp),
      population: Math.round(state.stats.population),
    });
    if (state.history.budgets.length > 200) state.history.budgets.shift();
  }
}

return {
  SEATS, PORTFOLIOS: D.PORTFOLIOS, init, tick, introduceBill, issueExecutiveOrder, repealLaw,
  appointMinister, dismissMinister, cabinetMultiplier, activeEffects, holdElection,
};
})();
