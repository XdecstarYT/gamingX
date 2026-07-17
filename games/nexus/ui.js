/* ============================================================================
   PROJECT NEXUS — UI layer: map renderer + dashboard panels.
   Pure rendering + DOM wiring. Reads/mutates `state` via NexusSim's action
   functions; never touches simulation internals directly.
   ========================================================================== */
window.NexusUI = (() => {
'use strict';
const D = window.NexusData;
const S = window.NexusSim;
const W = window.NexusWorld;
const L = window.NexusLegislature;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => {
  n = Math.round(n);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
};
const fmtMoney = n => '$' + fmt(n);

let state = null;
let onChange = () => {};       // called after any state-mutating UI action
let armedBuild = null;         // building id currently selected for placement
let selectedTile = null;

/* ------------------------------------------------------------------ */
/* map renderer                                                        */
/* ------------------------------------------------------------------ */
const TILE = 22;
let cam = { x: 0, y: 0, zoom: 1 };
let canvas, ctx;
let dragging = false, dragStart = null, camStart = null, dragMoved = 0;

function initMap(_state) {
  canvas = $('map-canvas');
  ctx = canvas.getContext('2d');
  cam.x = (state.cities[0].x) * TILE;
  cam.y = (state.cities[0].y) * TILE;
  cam.zoom = 1.4;

  canvas.addEventListener('pointerdown', e => {
    dragging = true; dragMoved = 0;
    dragStart = { x: e.clientX, y: e.clientY };
    camStart = { x: cam.x, y: cam.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) { updateTip(e); return; }
    const dx = (e.clientX - dragStart.x), dy = (e.clientY - dragStart.y);
    dragMoved = Math.max(dragMoved, Math.hypot(dx, dy));
    cam.x = camStart.x - dx / cam.zoom;
    cam.y = camStart.y - dy / cam.zoom;
  });
  canvas.addEventListener('pointerup', e => {
    dragging = false;
    if (dragMoved < 5) handleMapClick(e);
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.zoom = clampZoom(cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });
  addEventListener('resize', resizeCanvas);
  resizeCanvas();
}
function clampZoom(z) { return Math.max(0.5, Math.min(3, z)); }
function resizeCanvas() {
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
}

function screenToTile(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const scale = TILE * cam.zoom * dpr;
  const sx = (clientX - rect.left) * dpr, sy = (clientY - rect.top) * dpr;
  const originX = canvas.width / 2 - cam.x * cam.zoom * dpr;
  const originY = canvas.height / 2 - cam.y * cam.zoom * dpr;
  const tx = Math.floor((sx - originX) / scale);
  const ty = Math.floor((sy - originY) / scale);
  return { x: tx, y: ty };
}

function updateTip(e) {
  const { x, y } = screenToTile(e.clientX, e.clientY);
  const tile = W.tileAt(state.world, x, y);
  const tip = $('map-tip');
  if (!tile) { tip.classList.add('hidden'); return; }
  const b = state.buildings.find(bd => bd.x === x && bd.y === y);
  const owner = tile.owner === 0 ? 'Your territory' : tile.owner === -1 ? 'Unclaimed' : (state.nations.find(n => n.id === tile.owner) || {}).name || 'Foreign';
  let html = `<b>${cap(tile.terrain)}</b> · ${owner}`;
  if (tile.resource) html += ` · ${cap(tile.resource)} deposit`;
  if (b) { const def = D.BUILDINGS_BY_ID[b.type]; html += `<br>${def.icon} ${def.name}` + (b.built ? '' : ` (building… ${Math.round(b.progress * 100)}%)`); }
  tip.innerHTML = html;
  tip.classList.remove('hidden');
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function handleMapClick(e) {
  const { x, y } = screenToTile(e.clientX, e.clientY);
  const tile = W.tileAt(state.world, x, y);
  if (!tile) return;
  if (armedBuild) {
    const res = S.placeBuilding(state, armedBuild, x, y);
    if (res.ok) { toast(`Placed ${D.BUILDINGS_BY_ID[armedBuild].name}.`, 'build'); armedBuild = null; $('build-hint').classList.add('hidden'); onChange(); }
    else toast(res.reason || 'Cannot place there.', 'warn');
  } else {
    selectedTile = { x, y };
  }
}

function armBuild(type) {
  armedBuild = type;
  $('build-hint-name').textContent = D.BUILDINGS_BY_ID[type].name;
  $('build-hint').classList.remove('hidden');
}

function renderMap() {
  if (!canvas) return;
  const w = canvas.width, h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, w, h);

  const dpr = Math.min(devicePixelRatio || 1, 2);
  const scale = TILE * cam.zoom * dpr;
  ctx.setTransform(scale, 0, 0, scale, w / 2 - cam.x * cam.zoom * dpr, h / 2 - cam.y * cam.zoom * dpr);

  const world = state.world;
  const pad = 2;
  // cam.x/cam.y are stored in world-pixel units (tileIndex * TILE), matching
  // the transform's translation term — divide by TILE to get tile-index space.
  const camTileX = cam.x / TILE, camTileY = cam.y / TILE;
  const x0 = Math.max(0, Math.floor((camTileX - w / scale / 2) - pad));
  const x1 = Math.min(world.w - 1, Math.ceil((camTileX + w / scale / 2) + pad));
  const y0 = Math.max(0, Math.floor((camTileY - h / scale / 2) - pad));
  const y1 = Math.min(world.h - 1, Math.ceil((camTileY + h / scale / 2) + pad));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = world.tiles[y * world.w + x];
      ctx.fillStyle = D.TERRAIN[t.terrain].color;
      ctx.fillRect(x, y, 1.02, 1.02);
      if (t.owner === 0) { ctx.fillStyle = 'rgba(34,211,238,0.16)'; ctx.fillRect(x, y, 1.02, 1.02); }
      else if (t.owner > 0) { ctx.fillStyle = hexAlpha(state.nations.find(n => n.id === t.owner)?.color || '#888', 0.16); ctx.fillRect(x, y, 1.02, 1.02); }
      if (t.river) { ctx.fillStyle = 'rgba(80,160,230,0.85)'; ctx.fillRect(x + 0.35, y, 0.3, 1.02); }
      if (t.resource) {
        ctx.font = '0.6px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillText(RESOURCE_ICON[t.resource] || '?', x + 0.5, y + 0.5);
      }
    }
  }
  // territory outline for player — trace edges between an owned tile and any non-owned neighbor
  ctx.strokeStyle = 'rgba(34,211,238,0.65)'; ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = world.tiles[y * world.w + x];
      if (t.owner !== 0) continue;
      const right = W.tileAt(world, x + 1, y);
      if (!right || right.owner !== 0) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + 1); }
      const left = W.tileAt(world, x - 1, y);
      if (!left || left.owner !== 0) { ctx.moveTo(x, y); ctx.lineTo(x, y + 1); }
      const down = W.tileAt(world, x, y + 1);
      if (!down || down.owner !== 0) { ctx.moveTo(x, y + 1); ctx.lineTo(x + 1, y + 1); }
      const up = W.tileAt(world, x, y - 1);
      if (!up || up.owner !== 0) { ctx.moveTo(x, y); ctx.lineTo(x + 1, y); }
    }
  }
  ctx.stroke();

  // buildings
  for (const b of state.buildings) {
    const def = D.BUILDINGS_BY_ID[b.type];
    ctx.font = '0.8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (!b.built) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(b.x + 0.15, b.y + 0.15, 0.7, 0.7);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(b.x + 0.15, b.y + 0.78, 0.7 * b.progress, 0.08);
      ctx.globalAlpha = 0.5;
    }
    ctx.fillText(def.icon, b.x + 0.5, b.y + 0.48);
    ctx.globalAlpha = 1;
  }
  // AI + player capitals
  for (const c of state.cities) drawCapital(c.x, c.y, '#22d3ee');
  for (const n of state.nations) drawCapital(n.x, n.y, n.color);

  // selection highlight
  if (selectedTile) {
    ctx.strokeStyle = '#fde047'; ctx.lineWidth = 0.08;
    ctx.strokeRect(selectedTile.x + 0.03, selectedTile.y + 0.03, 0.94, 0.94);
  }
}
const RESOURCE_ICON = { iron: '⛓', coal: '⚫', oil: '🛢', gold: '★', fertile: '✚' };
function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function drawCapital(x, y, color) {
  ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.45, 0, 7);
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.06; ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* toasts / notifications                                              */
/* ------------------------------------------------------------------ */
let lastNotifShown = 0;
function drainToasts() {
  for (const n of state.notifications) {
    if (n.id <= lastNotifShown) continue;
    toast(n.text, n.kind);
    lastNotifShown = n.id;
  }
}
function toast(text, kind) {
  const el = document.createElement('div');
  el.className = 'nx-toast' + (kind ? ' ' + kind : '');
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

/* ------------------------------------------------------------------ */
/* top bar                                                              */
/* ------------------------------------------------------------------ */
function renderTopbar() {
  $('hud-nation-name').textContent = state.meta.nationName;
  const week = state.meta.tick % 52, year = Math.floor(state.meta.tick / 52) + 1;
  $('hud-date').textContent = `Year ${year}, Week ${week + 1}`;
  const s = state.stats;
  $('hud-stats').innerHTML = `
    <div class="chip"><small>TREASURY</small>${fmtMoney(state.treasury)}</div>
    <div class="chip ${state.debt > 5000 ? 'warn' : ''}"><small>DEBT</small>${fmtMoney(state.debt)}</div>
    <div class="chip"><small>POP</small>${fmt(s.population)}</div>
    <div class="chip"><small>GDP</small>${fmtMoney(s.gdp)}</div>
    <div class="chip ${s.approval < 35 ? 'warn' : ''}"><small>APPROVAL</small>${Math.round(s.approval)}%</div>
    <div class="chip"><small>SCORE</small>${fmt(state.score)}</div>`;
  const govEl = $('hud-gov-status');
  const isGov = state.legislature.isPlayerGovernment;
  govEl.textContent = isGov ? 'GOVERNMENT' : 'OPPOSITION';
  govEl.classList.toggle('opposition', !isGov);
}

/* ------------------------------------------------------------------ */
/* dashboard: tab dispatch                                              */
/* ------------------------------------------------------------------ */
let currentTab = 'overview';
function renderDash() {
  const body = $('dash-body');
  const renderers = {
    overview: renderOverview, build: renderBuild, economy: renderEconomy, politics: renderPolitics,
    parliament: renderParliament, tech: renderTech, diplomacy: renderDiplomacy, territory: renderTerritory,
    events: renderEvents, archive: renderArchive,
  };
  body.innerHTML = '';
  (renderers[currentTab] || renderOverview)(body);
}
function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nx-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  renderDash();
}

function sparkline(values, color) {
  const c = document.createElement('canvas');
  c.className = 'nx-sparkline'; c.width = 300; c.height = 88;
  const cx = c.getContext('2d');
  if (!values || values.length < 2) return c;
  const min = Math.min(...values), max = Math.max(...values), range = (max - min) || 1;
  cx.strokeStyle = color; cx.lineWidth = 3; cx.beginPath();
  values.forEach((v, i) => {
    const x = i / (values.length - 1) * c.width;
    const y = c.height - ((v - min) / range) * (c.height - 8) - 4;
    i === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y);
  });
  cx.stroke();
  cx.lineTo(c.width, c.height); cx.lineTo(0, c.height); cx.closePath();
  cx.fillStyle = hexAlpha(color, 0.12); cx.fill();
  return c;
}

function renderOverview(body) {
  const s = state.stats;
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  g1.innerHTML = `<b class="hd">NATION SNAPSHOT</b>
    <div class="nx-stat-grid">
      <div class="nx-stat-card"><div class="v">${fmt(s.population)}</div><div class="l">POPULATION</div></div>
      <div class="nx-stat-card"><div class="v">${Math.round(s.happiness)}</div><div class="l">HAPPINESS</div></div>
      <div class="nx-stat-card"><div class="v">${Math.round(s.corruption)}</div><div class="l">CORRUPTION</div></div>
      <div class="nx-stat-card"><div class="v">${s.inflation.toFixed(1)}%</div><div class="l">INFLATION</div></div>
      <div class="nx-stat-card"><div class="v">${s.unemployed}</div><div class="l">UNEMPLOYED</div></div>
      <div class="nx-stat-card"><div class="v">${state.tech.unlocked.length}</div><div class="l">TECHS</div></div>
    </div>`;
  body.appendChild(g1);

  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">GDP OVER TIME</b>`;
  g2.appendChild(sparkline(s.gdpHistory, '#22d3ee'));
  body.appendChild(g2);

  const g3 = document.createElement('div'); g3.className = 'nx-group';
  g3.innerHTML = `<b class="hd">APPROVAL OVER TIME</b>`;
  g3.appendChild(sparkline(s.approvalHistory, '#a855f7'));
  body.appendChild(g3);

  const g4 = document.createElement('div'); g4.className = 'nx-group';
  g4.innerHTML = `<b class="hd">RECENT NEWS</b><div class="nx-feed">` +
    state.notifications.slice(-8).reverse().map(n => `<div class="nx-feed-item">${esc(n.text)}</div>`).join('') +
    `</div>`;
  body.appendChild(g4);
}

function renderBuild(body) {
  const isGov = state.legislature.isPlayerGovernment;
  if (!isGov) {
    const note = document.createElement('div'); note.className = 'nx-locked-note';
    note.textContent = 'You are in Opposition — only the Government can spend treasury on new construction. Win the next election to take power.';
    body.appendChild(note);
  }
  const cats = [['residential', 'HOUSING'], ['commercial', 'COMMERCIAL'], ['industrial', 'INDUSTRY'],
    ['agriculture', 'AGRICULTURE'], ['energy', 'ENERGY'], ['infra', 'INFRASTRUCTURE'], ['civic', 'CIVIC'],
    ['research', 'RESEARCH'], ['government', 'GOVERNMENT'], ['military', 'MILITARY']];
  for (const [cat, label] of cats) {
    const items = D.BUILDINGS.filter(b => b.cat === cat);
    if (!items.length) continue;
    const catEl = document.createElement('div'); catEl.className = 'nx-build-cat'; catEl.textContent = label;
    body.appendChild(catEl);
    for (const def of items) {
      const locked = def.needsTech && !S.techUnlocked(state, def.needsTech);
      const el = document.createElement('button');
      el.className = 'nx-build-item' + (locked || !isGov ? ' disabled' : '');
      el.innerHTML = `<span class="ic">${def.icon}</span><span class="info"><span class="nm">${def.name}</span><span class="ds">${def.desc}${locked ? ' 🔒 ' + D.TECHS_BY_ID[def.needsTech].name : ''}</span></span><span class="cost">${fmtMoney(def.cost)}</span>`;
      if (!locked && isGov) el.addEventListener('click', () => armBuild(def.id));
      body.appendChild(el);
    }
  }
}

function renderEconomy(body) {
  const isGov = state.legislature.isPlayerGovernment;
  if (!isGov) {
    const note = document.createElement('div'); note.className = 'nx-locked-note';
    note.textContent = 'You are in Opposition — tax rates and funding levels are set by the Government.';
    body.appendChild(note);
  }
  const s = state.stats;
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  g1.innerHTML = `<b class="hd">TAX RATES</b>`;
  for (const [k, label] of [['income', 'Income Tax'], ['corporate', 'Corporate Tax'], ['sales', 'Sales Tax']]) {
    const row = document.createElement('div'); row.className = 'nx-slider-row';
    row.innerHTML = `<label>${label} <span>${Math.round(state.taxRate[k] * 100)}%</span></label><input type="range" min="0" max="50" value="${state.taxRate[k] * 100}" ${isGov ? '' : 'disabled'}>`;
    if (isGov) row.querySelector('input').addEventListener('input', e => { S.setTaxRate(state, k, e.target.value / 100); row.querySelector('span').textContent = e.target.value + '%'; onChange(true); });
    g1.appendChild(row);
  }
  body.appendChild(g1);

  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">FUNDING LEVELS</b>`;
  for (const [k, label] of [['health', 'Healthcare'], ['education', 'Education'], ['environment', 'Environment'], ['military', 'Military']]) {
    const row = document.createElement('div'); row.className = 'nx-slider-row';
    const pct = Math.round(state.funding[k] * 100);
    row.innerHTML = `<label>${label} <span>${pct}%</span></label><input type="range" min="0" max="150" value="${pct}" ${isGov ? '' : 'disabled'}>`;
    if (isGov) row.querySelector('input').addEventListener('input', e => { S.setFunding(state, k, e.target.value / 100); row.querySelector('span').textContent = e.target.value + '%'; onChange(true); });
    g2.appendChild(row);
  }
  body.appendChild(g2);

  const g3 = document.createElement('div'); g3.className = 'nx-group';
  g3.innerHTML = `<b class="hd">BUDGET (per week)</b>
    <div class="nx-budget-row"><span>Tax revenue</span><span>+${fmtMoney(s.lastTaxRevenue || 0)}</span></div>
    <div class="nx-budget-row"><span>Upkeep &amp; interest</span><span>−${fmtMoney(s.lastUpkeep || 0)}</span></div>
    <div class="nx-budget-row total"><span>Net</span><span>${(s.netIncome || 0) >= 0 ? '+' : ''}${fmtMoney(s.netIncome || 0)}</span></div>`;
  body.appendChild(g3);

  const g4 = document.createElement('div'); g4.className = 'nx-group';
  g4.innerHTML = `<b class="hd">INFLATION</b>`;
  g4.appendChild(sparkline(s.inflationHistory, '#f2b03d'));
  body.appendChild(g4);
}

function partyName(id) { const p = D.PARTIES.find(x => x.id === id); return p ? p.name : id; }

function renderPolitics(body) {
  const s = state.stats;
  const gov = D.GOVERNMENTS_BY_ID[state.meta.government];
  const leg = state.legislature;
  const isGov = leg.isPlayerGovernment;
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  const nextElectionWeeks = gov.elections ? Math.max(0, state.nextElectionTick - state.meta.tick) : null;
  g1.innerHTML = `<b class="hd">GOVERNMENT</b>
    <div class="nx-stat-grid">
      <div class="nx-stat-card"><div class="v">${gov.name}</div><div class="l">TYPE</div></div>
      <div class="nx-stat-card"><div class="v">${Math.round(s.approval)}%</div><div class="l">APPROVAL</div></div>
    </div>
    <p style="color:var(--muted);font-size:.74rem;margin-top:10px">
      You are in <b style="color:${isGov ? 'var(--green)' : '#f87171'}">${isGov ? 'GOVERNMENT' : 'OPPOSITION'}</b> — ${esc(partyName(leg.leadParty))} leads, headed by ${esc(leg.headOfGovernment)}.
      ${gov.elections ? ` Next election in ${nextElectionWeeks} weeks.` : ' This government does not hold elections.'}
    </p>`;
  body.appendChild(g1);

  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">PARTY SUPPORT</b>`;
  const bar = document.createElement('div'); bar.className = 'nx-party-bar';
  const legend = document.createElement('div'); legend.className = 'nx-party-legend';
  for (const p of state.parties) {
    const def = D.PARTIES.find(x => x.id === p.id);
    const seg = document.createElement('div'); seg.className = 'nx-party-seg'; seg.style.width = p.support + '%'; seg.style.background = def.color;
    bar.appendChild(seg);
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<span class="dot" style="background:${def.color}"></span>${def.name} — ${p.support}%`;
    legend.appendChild(row);
  }
  g2.appendChild(bar); g2.appendChild(legend);
  body.appendChild(g2);

  const g3 = document.createElement('div'); g3.className = 'nx-group';
  const activeLaws = leg.activeLawIds.map(id => D.BILLS_BY_ID[id]).filter(Boolean);
  g3.innerHTML = `<b class="hd">ACTIVE LAWS (${activeLaws.length})</b>` +
    (activeLaws.length
      ? activeLaws.map(l => `<div class="nx-law-item"><span class="info"><span class="nm">${esc(l.name)}</span><span class="ds">${esc(l.desc)}</span></span></div>`).join('')
      : '<p style="color:var(--muted);font-size:.74rem">No laws in effect yet.</p>') +
    `<p style="color:var(--muted);font-size:.68rem;margin-top:8px">Propose, debate and vote on new legislation in the <b>Parliament</b> tab.</p>`;
  body.appendChild(g3);
}

function renderTech(body) {
  for (const cat of D.TECH_CATEGORIES) {
    const wrap = document.createElement('div'); wrap.className = 'nx-tech-cat';
    wrap.innerHTML = `<div class="hd">${cat.toUpperCase()}</div>`;
    for (const t of D.TECHS.filter(x => x.cat === cat)) {
      const unlocked = S.techUnlocked(state, t.id);
      const researching = state.tech.researching === t.id;
      const available = S.techAvailable(state, t.id);
      const card = document.createElement('div');
      card.className = 'nx-tech-card ' + (unlocked ? 'unlocked' : researching ? 'researching' : available ? '' : 'locked');
      let html = `<div class="top"><span>${t.name}</span><span>${unlocked ? '✓' : t.cost + ' RP'}</span></div><div class="ds">${t.desc}</div>`;
      if (researching) html += `<div class="prog"><i style="width:${Math.min(100, state.tech.progress / t.cost * 100)}%"></i></div>`;
      card.innerHTML = html;
      if (available && !state.tech.researching) {
        const btn = document.createElement('button'); btn.textContent = 'RESEARCH ▸';
        btn.addEventListener('click', () => { S.startResearch(state, t.id); onChange(true); });
        card.appendChild(btn);
      }
      wrap.appendChild(card);
    }
    body.appendChild(wrap);
  }
  const rp = document.createElement('div'); rp.className = 'nx-group';
  rp.innerHTML = `<b class="hd">RESEARCH POINTS</b><div class="nx-stat-grid"><div class="nx-stat-card"><div class="v">${fmt(state.stats.researchPoints)}</div><div class="l">STORED</div></div><div class="nx-stat-card"><div class="v">+${state.stats.researchPerTick}</div><div class="l">PER WEEK</div></div></div>`;
  body.insertBefore(rp, body.firstChild);
}

function renderDiplomacy(body) {
  const isGov = state.legislature.isPlayerGovernment;
  if (!isGov) {
    const note = document.createElement('div'); note.className = 'nx-locked-note';
    note.textContent = 'You are in Opposition — the Government conducts foreign policy. You can still observe relations.';
    body.appendChild(note);
  }
  for (const n of state.nations) {
    const card = document.createElement('div'); card.className = 'nx-nation-card';
    card.innerHTML = `
      <div class="top"><span class="dot" style="background:${n.color}"></span><span class="nm">${esc(n.name)}</span><span class="rel">${D.GOVERNMENTS_BY_ID[n.government].name}</span></div>
      <div class="stats"><span>Pop ${fmt(n.population)}</span><span>GDP ${fmtMoney(n.gdp)}</span><span>Approval ${Math.round(n.approval)}%</span></div>
      <div class="relbar"><i style="width:${n.relation}%"></i></div>`;
    const actions = document.createElement('div'); actions.className = 'nx-nation-actions';
    const acts = [
      ['trade', 'Trade Deal', n.tradeAgreement], ['alliance', 'Alliance', n.alliance],
      ['nonaggression', 'Non-Aggression', n.nonAggression], ['aid', 'Send Aid ($1000)', false],
    ];
    for (const [key, label, active] of acts) {
      const btn = document.createElement('button');
      btn.textContent = label; if (active) btn.classList.add('active');
      if (!isGov) btn.disabled = true;
      else btn.addEventListener('click', () => {
        const r = S.diplomacyAction(state, n.id, key);
        if (!r.ok) toast(r.reason || 'Action failed.', 'warn');
        onChange(true);
      });
      actions.appendChild(btn);
    }
    card.appendChild(actions);
    body.appendChild(card);
  }
}

/* ------------------------------------------------------------------ */
/* parliament tab                                                       */
/* ------------------------------------------------------------------ */
function renderParliament(body) {
  const leg = state.legislature;
  const isGov = leg.isPlayerGovernment;
  const gov = D.GOVERNMENTS_BY_ID[state.meta.government];
  const nextElectionWeeks = gov.elections ? Math.max(0, state.nextElectionTick - state.meta.tick) : null;

  const banner = document.createElement('div'); banner.className = 'nx-gov-banner' + (isGov ? '' : ' opposition');
  banner.innerHTML = `<b>${isGov ? 'YOU ARE IN GOVERNMENT' : 'YOU ARE IN OPPOSITION'}</b>
    <div style="font-size:.72rem;color:var(--muted);margin-top:4px">
      Head of Government: <b style="color:var(--text)">${esc(leg.headOfGovernment)}</b> (${esc(partyName(leg.leadParty))})
      ${gov.elections ? ` · Next election in ${nextElectionWeeks} weeks` : ''}
      ${leg.noConfidence ? ' · <span style="color:#f87171">No-confidence motion pending!</span>' : ''}
    </div>`;
  body.appendChild(banner);

  // seat composition
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  g1.innerHTML = `<b class="hd">PARLIAMENT — ${L.SEATS} SEATS</b>`;
  const seatCounts = {};
  for (const l of leg.legislators) seatCounts[l.party] = (seatCounts[l.party] || 0) + 1;
  const chart = document.createElement('div'); chart.className = 'nx-seat-chart';
  const legend = document.createElement('div'); legend.className = 'nx-party-legend';
  for (const p of D.PARTIES) {
    const count = seatCounts[p.id] || 0;
    if (!count) continue;
    const seg = document.createElement('div'); seg.className = 'nx-seat-seg';
    seg.style.width = (count / L.SEATS * 100) + '%'; seg.style.background = p.color;
    chart.appendChild(seg);
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<span class="dot" style="background:${p.color}"></span>${esc(p.name)} — ${count} seat${count === 1 ? '' : 's'}${leg.governingParties.includes(p.id) ? ' (Gov)' : ''}`;
    legend.appendChild(row);
  }
  g1.appendChild(chart); g1.appendChild(legend);
  body.appendChild(g1);

  // cabinet
  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">CABINET</b>`;
  if (!isGov) {
    const note = document.createElement('div'); note.className = 'nx-locked-note';
    note.textContent = 'Cabinet appointments are made by the governing party. Win an election to form Government.';
    g2.appendChild(note);
  }
  for (const pf of D.PORTFOLIOS) {
    const legId = leg.cabinet[pf.id];
    const minister = legId && leg.legislators.find(l => l.id === legId);
    const card = document.createElement('div'); card.className = 'nx-cabinet-card';
    card.innerHTML = `<span class="role"><b>${pf.icon} ${esc(pf.name)}</b><span>${minister ? esc(minister.name) + ' — competence ' + minister.competence : 'VACANT'}</span></span>`;
    if (isGov) {
      const btn = document.createElement('button');
      btn.textContent = minister ? 'DISMISS' : 'APPOINT';
      btn.addEventListener('click', () => {
        if (minister) { L.dismissMinister(state, pf.id); onChange(true); }
        else showAppointModal(pf.id);
      });
      card.appendChild(btn);
    }
    g2.appendChild(card);
  }
  body.appendChild(g2);

  // bills before parliament
  const g3 = document.createElement('div'); g3.className = 'nx-group';
  g3.innerHTML = `<b class="hd">BEFORE PARLIAMENT (${leg.bills.length})</b>`;
  if (!leg.bills.length) {
    const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.74rem';
    p.textContent = 'No bills currently before Parliament.';
    g3.appendChild(p);
  }
  for (const bill of leg.bills) {
    const def = D.BILLS_BY_ID[bill.billDefId];
    const pct = Math.min(100, Math.round(bill.turnsInStage / 3 * 100));
    const card = document.createElement('div'); card.className = 'nx-bill-card';
    card.innerHTML = `<div class="top"><b>${esc(def.name)}</b><span class="stage">IN COMMITTEE</span></div>
      <div class="ds">${esc(def.desc)}</div>
      <div class="prog"><i style="width:${pct}%"></i></div>
      <div class="meta"><span>Sponsor: ${esc(partyName(bill.sponsorParty))}</span><span>${esc(def.cat)}</span></div>`;
    g3.appendChild(card);
  }
  body.appendChild(g3);

  // propose legislation
  const g4 = document.createElement('div'); g4.className = 'nx-group';
  g4.innerHTML = `<b class="hd">PROPOSE LEGISLATION</b>`;
  const candidates = D.BILLS.filter(b => !leg.activeLawIds.includes(b.id) && !leg.bills.some(x => x.billDefId === b.id));
  if (!candidates.length) {
    const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.74rem';
    p.textContent = 'No further bills are currently available to propose.';
    g4.appendChild(p);
  }
  for (const cat of D.BILL_CATEGORIES) {
    const items = candidates.filter(b => b.cat === cat);
    if (!items.length) continue;
    const catEl = document.createElement('div'); catEl.className = 'nx-build-cat'; catEl.textContent = cat.toUpperCase();
    g4.appendChild(catEl);
    for (const def of items) {
      const card = document.createElement('div'); card.className = 'nx-cabinet-card';
      card.innerHTML = `<span class="role"><b>${esc(def.name)}</b><span>${esc(def.desc)}</span></span>`;
      const btn = document.createElement('button'); btn.textContent = 'INTRODUCE';
      btn.addEventListener('click', () => {
        const r = L.introduceBill(state, def.id, leg.playerParty);
        if (!r.ok) toast(r.reason, 'warn');
        onChange(true);
      });
      card.appendChild(btn);
      g4.appendChild(card);
    }
  }
  body.appendChild(g4);

  // executive orders + repeal — government only
  if (isGov) {
    const g5 = document.createElement('div'); g5.className = 'nx-group';
    const cd = Math.max(0, leg.nextExecutiveOrderTurn - state.meta.tick);
    g5.innerHTML = `<b class="hd">EXECUTIVE ORDERS</b>
      <p style="color:var(--muted);font-size:.7rem;margin-bottom:8px">Enact a law instantly, bypassing a floor vote — at a higher risk of being struck down by the courts. ${cd > 0 ? `On cooldown for ${cd} more weeks.` : ''}</p>`;
    if (cd <= 0 && candidates.length) {
      for (const def of candidates) {
        const card = document.createElement('div'); card.className = 'nx-cabinet-card';
        card.innerHTML = `<span class="role"><b>${esc(def.name)}</b><span>${esc(def.cat)}</span></span>`;
        const btn = document.createElement('button'); btn.textContent = 'ENACT NOW';
        btn.addEventListener('click', () => {
          const r = L.issueExecutiveOrder(state, def.id);
          if (!r.ok) toast(r.reason, 'warn');
          onChange(true);
        });
        card.appendChild(btn);
        g5.appendChild(card);
      }
    }
    body.appendChild(g5);

    const g6 = document.createElement('div'); g6.className = 'nx-group';
    const activeLaws = leg.activeLawIds.map(id => D.BILLS_BY_ID[id]).filter(Boolean);
    g6.innerHTML = `<b class="hd">REPEAL A LAW</b>`;
    if (!activeLaws.length) {
      const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.74rem';
      p.textContent = 'No active laws to repeal.';
      g6.appendChild(p);
    }
    for (const def of activeLaws) {
      const card = document.createElement('div'); card.className = 'nx-cabinet-card';
      card.innerHTML = `<span class="role"><b>${esc(def.name)}</b><span>${esc(def.desc)}</span></span>`;
      const btn = document.createElement('button'); btn.textContent = 'REPEAL'; btn.style.color = '#f87171';
      btn.addEventListener('click', () => {
        const r = L.repealLaw(state, def.id);
        if (!r.ok) toast(r.reason, 'warn');
        onChange(true);
      });
      card.appendChild(btn);
      g6.appendChild(card);
    }
    body.appendChild(g6);
  }

  // legislator roster
  const g7 = document.createElement('div'); g7.className = 'nx-group';
  g7.innerHTML = `<b class="hd">LEGISLATORS (${leg.legislators.length})</b>`;
  const roster = leg.legislators.slice().sort((a, b) =>
    D.PARTIES.findIndex(p => p.id === a.party) - D.PARTIES.findIndex(p => p.id === b.party) || b.popularity - a.popularity);
  for (const l of roster) {
    const pd = D.PARTIES.find(p => p.id === l.party);
    const row = document.createElement('div'); row.className = 'nx-legislator-row';
    row.innerHTML = `<span class="dot" style="background:${pd.color}"></span><span class="nm">${esc(l.name)} <span style="color:var(--muted)">— ${esc(l.constituency)}</span></span><span style="color:var(--muted);font-size:.64rem">Loyalty ${l.loyalty} · Pop ${l.popularity}</span>`;
    g7.appendChild(row);
  }
  body.appendChild(g7);
}

function showAppointModal(portfolioId) {
  const pf = D.PORTFOLIOS_BY_ID[portfolioId];
  const takenIds = new Set(Object.values(state.legislature.cabinet));
  const eligible = state.legislature.legislators
    .filter(l => state.legislature.governingParties.includes(l.party) && !takenIds.has(l.id))
    .sort((a, b) => b.competence - a.competence);
  const box = $('modal-box');
  box.innerHTML = `<h2>Appoint ${esc(pf.name)}</h2>
    <div class="nx-feed" style="max-height:360px;overflow-y:auto;margin:12px 0">` +
    (eligible.length
      ? eligible.map(l => `<div class="nx-feed-item" data-id="${l.id}" style="cursor:pointer"><b>${esc(l.name)}</b> (${esc(partyName(l.party))}) — competence ${l.competence}, experience ${l.experience}</div>`).join('')
      : '<div class="nx-feed-item">No eligible legislators from the governing party.</div>') +
    `</div><div class="nx-menu-buttons"><button class="nx-btn" data-act="cancel">CANCEL</button></div>`;
  box.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => {
    L.appointMinister(state, portfolioId, el.dataset.id);
    $('modal').classList.add('hidden');
    onChange(true);
  }));
  box.querySelector('[data-act="cancel"]').addEventListener('click', () => $('modal').classList.add('hidden'));
  $('modal').classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* archive tab                                                          */
/* ------------------------------------------------------------------ */
let archiveSubTab = 'elections';
function renderArchive(body) {
  const tabs = document.createElement('div'); tabs.className = 'nx-archive-tabs';
  for (const [key, label] of [['elections', 'Elections'], ['governments', 'Governments'], ['lawcode', 'Law Code'], ['budgets', 'Budgets']]) {
    const btn = document.createElement('button'); btn.textContent = label;
    btn.classList.toggle('on', archiveSubTab === key);
    btn.addEventListener('click', () => { archiveSubTab = key; renderDash(); });
    tabs.appendChild(btn);
  }
  body.appendChild(tabs);

  const g = document.createElement('div'); g.className = 'nx-group';
  const h = state.history;
  if (archiveSubTab === 'elections') {
    g.innerHTML = `<b class="hd">ELECTION HISTORY (${h.elections.length})</b>` +
      (h.elections.slice().reverse().map(e => {
        const year = Math.floor(e.turn / 52) + 1;
        const results = e.results.slice().sort((a, b) => b.seats - a.seats).map(r => `${esc(partyName(r.party))} ${r.seats}`).join(', ');
        return `<div class="nx-archive-row"><b>Year ${year}</b> — ${results}${e.isPlayerGovernment ? ' · <span style="color:var(--green)">You formed Government</span>' : ''}</div>`;
      }).join('') || '<div class="nx-archive-row">No elections recorded yet.</div>');
  } else if (archiveSubTab === 'governments') {
    g.innerHTML = `<b class="hd">GOVERNMENTS (${h.governments.length})</b>` +
      (h.governments.slice().reverse().map(gv => {
        const startY = Math.floor(gv.startTurn / 52) + 1;
        const endY = gv.endTurn != null ? Math.floor(gv.endTurn / 52) + 1 : null;
        return `<div class="nx-archive-row"><b>${esc(gv.headOfGovernment)}</b> (${esc(partyName(gv.leadParty))}) — Year ${startY}${endY ? ` to Year ${endY}` : ' – present'}</div>`;
      }).join('') || '<div class="nx-archive-row">No governments recorded yet.</div>');
  } else if (archiveSubTab === 'lawcode') {
    g.innerHTML = `<b class="hd">NATIONAL LAW CODE (${state.legislature.lawCode.length})</b>`;
    const list = state.legislature.lawCode.slice().reverse();
    if (!list.length) {
      const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.74rem';
      p.textContent = 'No bills have been introduced yet.';
      g.appendChild(p);
    }
    const statusClassOf = st => st === 'passed' ? 'passed' : st === 'failed' ? 'failed' : (st === 'struck_down' || st === 'repealed') ? 'struck' : '';
    const statusLabelOf = st => ({ in_committee: 'IN COMMITTEE', passed: 'LAW', failed: 'FAILED', struck_down: 'STRUCK DOWN', repealed: 'REPEALED' }[st] || st.toUpperCase());
    for (const bill of list) {
      const def = D.BILLS_BY_ID[bill.billDefId];
      const card = document.createElement('div'); card.className = 'nx-bill-card ' + statusClassOf(bill.status);
      card.innerHTML = `<div class="top"><b>${esc(def.name)}</b><span class="stage">${statusLabelOf(bill.status)}</span></div>
        <div class="ds">${esc(def.desc)}</div>
        <div class="meta"><span>${bill.origin === 'executive' ? 'Executive Order' : 'Sponsor: ' + esc(partyName(bill.sponsorParty))}</span><span>${esc(def.cat)} · Year ${Math.floor(bill.introducedTurn / 52) + 1}</span></div>
        ${bill.votesFor != null ? `<div class="meta"><span>Vote: ${bill.votesFor}-${bill.votesAgainst} (${bill.abstentions} abstain)</span></div>` : ''}`;
      g.appendChild(card);
    }
  } else if (archiveSubTab === 'budgets') {
    g.innerHTML = `<b class="hd">YEARLY BUDGET HISTORY (${h.budgets.length})</b>` +
      (h.budgets.slice().reverse().map(b =>
        `<div class="nx-archive-row"><b>Year ${b.year}</b> — Revenue ${fmtMoney(b.revenue)}, Spending ${fmtMoney(b.spending)}, Debt ${fmtMoney(b.debt)}, GDP ${fmtMoney(b.gdp)}, Pop ${fmt(b.population)}</div>`
      ).join('') || '<div class="nx-archive-row">No budget snapshots recorded yet (recorded once per in-game year).</div>');
  }
  body.appendChild(g);
}

function renderTerritory(body) {
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  g1.innerHTML = `<b class="hd">CITIES</b>` + state.cities.map(c => `<div class="nx-feed-item"><b>${esc(c.name)}</b> — capital</div>`).join('');
  body.appendChild(g1);

  let owned = 0, resources = {};
  for (const t of state.world.tiles) {
    if (t.owner === 0) { owned++; if (t.resource) resources[t.resource] = (resources[t.resource] || 0) + 1; }
  }
  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">TERRITORY</b><div class="nx-stat-grid">
    <div class="nx-stat-card"><div class="v">${owned}</div><div class="l">TILES OWNED</div></div>
    <div class="nx-stat-card"><div class="v">${Object.values(resources).reduce((a, b) => a + b, 0)}</div><div class="l">RESOURCE DEPOSITS</div></div>
  </div>`;
  body.appendChild(g2);

  const g3 = document.createElement('div'); g3.className = 'nx-group';
  const hasBase = state.buildings.some(b => b.built && b.type === 'military_base');
  g3.innerHTML = `<b class="hd">MILITARY</b>
    <div class="nx-stat-grid"><div class="nx-stat-card"><div class="v">${state.stats.defense}</div><div class="l">DEFENSE RATING</div></div></div>
    <div class="nx-military-row">
      <div class="nx-military-card"><div class="v">${state.militaryUnits.army}</div><div class="l">ARMY</div><button data-u="army">TRAIN $800</button></div>
      <div class="nx-military-card"><div class="v">${state.militaryUnits.navy}</div><div class="l">NAVY</div><button data-u="navy">TRAIN $2200</button></div>
      <div class="nx-military-card"><div class="v">${state.militaryUnits.airforce}</div><div class="l">AIR FORCE</div><button data-u="airforce">TRAIN $2600</button></div>
    </div>
    ${hasBase ? '' : '<p style="color:var(--muted);font-size:.7rem;margin-top:8px">Build a Military Base to train units.</p>'}`;
  g3.querySelectorAll('button[data-u]').forEach(btn => btn.addEventListener('click', () => {
    const r = S.trainUnit(state, btn.dataset.u);
    if (!r.ok) toast(r.reason || 'Cannot train unit.', 'warn');
    onChange(true);
  }));
  body.appendChild(g3);
}

function renderEvents(body) {
  const g = document.createElement('div'); g.className = 'nx-group';
  g.innerHTML = `<b class="hd">EVENT HISTORY</b><div class="nx-feed">` +
    (state.events.log.slice().reverse().map(e => `<div class="nx-feed-item"><b>${esc(e.title)}</b><br>${esc(e.choice)}</div>`).join('') || '<div class="nx-feed-item">No events yet.</div>') +
    `</div>`;
  body.appendChild(g);
}

/* ------------------------------------------------------------------ */
/* event modal                                                          */
/* ------------------------------------------------------------------ */
function showEventModal() {
  if (!state.events.pending) { $('event-modal').classList.add('hidden'); return; }
  const ev = D.EVENTS.find(e => e.id === state.events.pending.id);
  const box = $('event-box');
  box.innerHTML = `<div class="icon">${ev.icon}</div><h2>${esc(ev.title)}</h2><p>${esc(ev.desc)}</p><div class="nx-event-choices"></div>`;
  const wrap = box.querySelector('.nx-event-choices');
  ev.choices.forEach((c, i) => {
    const btn = document.createElement('button'); btn.textContent = c.label;
    btn.addEventListener('click', () => { S.resolveEvent(state, i); $('event-modal').classList.add('hidden'); onChange(true); });
    wrap.appendChild(btn);
  });
  $('event-modal').classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* full refresh                                                         */
/* ------------------------------------------------------------------ */
function refresh() {
  renderTopbar();
  renderDash();
  drainToasts();
  showEventModal();
}

function init(_state, changeCb) {
  state = _state;
  onChange = changeCb || (() => {});
  armedBuild = null; selectedTile = null; lastNotifShown = 0;
  initMap(state);
  document.querySelectorAll('.nx-tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  refresh();
}
function setState(_state) { state = _state; lastNotifShown = state.notifications.length ? state.notifications[state.notifications.length - 1].id : 0; }
function cancelBuild() { armedBuild = null; $('build-hint').classList.add('hidden'); }

return { init, setState, refresh, renderMap, cancelBuild, toast, get armedBuild() { return armedBuild; } };
})();
