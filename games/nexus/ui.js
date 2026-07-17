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
}

/* ------------------------------------------------------------------ */
/* dashboard: tab dispatch                                              */
/* ------------------------------------------------------------------ */
let currentTab = 'overview';
function renderDash() {
  const body = $('dash-body');
  const renderers = {
    overview: renderOverview, build: renderBuild, economy: renderEconomy, politics: renderPolitics,
    tech: renderTech, diplomacy: renderDiplomacy, territory: renderTerritory, events: renderEvents,
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
      el.className = 'nx-build-item' + (locked ? ' disabled' : '');
      el.innerHTML = `<span class="ic">${def.icon}</span><span class="info"><span class="nm">${def.name}</span><span class="ds">${def.desc}${locked ? ' 🔒 ' + D.TECHS_BY_ID[def.needsTech].name : ''}</span></span><span class="cost">${fmtMoney(def.cost)}</span>`;
      if (!locked) el.addEventListener('click', () => armBuild(def.id));
      body.appendChild(el);
    }
  }
}

function renderEconomy(body) {
  const s = state.stats;
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  g1.innerHTML = `<b class="hd">TAX RATES</b>`;
  for (const [k, label] of [['income', 'Income Tax'], ['corporate', 'Corporate Tax'], ['sales', 'Sales Tax']]) {
    const row = document.createElement('div'); row.className = 'nx-slider-row';
    row.innerHTML = `<label>${label} <span>${Math.round(state.taxRate[k] * 100)}%</span></label><input type="range" min="0" max="50" value="${state.taxRate[k] * 100}">`;
    row.querySelector('input').addEventListener('input', e => { S.setTaxRate(state, k, e.target.value / 100); row.querySelector('span').textContent = e.target.value + '%'; onChange(true); });
    g1.appendChild(row);
  }
  body.appendChild(g1);

  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">FUNDING LEVELS</b>`;
  for (const [k, label] of [['health', 'Healthcare'], ['education', 'Education'], ['environment', 'Environment'], ['military', 'Military']]) {
    const row = document.createElement('div'); row.className = 'nx-slider-row';
    const pct = Math.round(state.funding[k] * 100);
    row.innerHTML = `<label>${label} <span>${pct}%</span></label><input type="range" min="0" max="150" value="${pct}">`;
    row.querySelector('input').addEventListener('input', e => { S.setFunding(state, k, e.target.value / 100); row.querySelector('span').textContent = e.target.value + '%'; onChange(true); });
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

const LAWS = [
  { id: 'minWage', name: 'Minimum Wage Law', desc: '+happiness, small hit to GDP.' },
  { id: 'environmentalRegs', name: 'Environmental Regulations', desc: 'Less pollution from industry, slightly lower output.' },
  { id: 'freeHealthcare', name: 'Universal Healthcare', desc: '+happiness, +healthcare, higher upkeep.' },
  { id: 'progressiveTax', name: 'Progressive Taxation', desc: 'Eases the happiness hit from high tax rates.' },
  { id: 'immigrationOpen', name: 'Open Immigration', desc: 'Faster population growth.' },
  { id: 'censorship', name: 'Press Censorship', desc: 'Slows corruption scandals from surfacing, but hurts happiness.' },
];
function renderPolitics(body) {
  const s = state.stats;
  const gov = D.GOVERNMENTS_BY_ID[state.meta.government];
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  const nextElectionWeeks = gov.elections ? Math.max(0, state.nextElectionTick - state.meta.tick) : null;
  g1.innerHTML = `<b class="hd">GOVERNMENT</b>
    <div class="nx-stat-grid">
      <div class="nx-stat-card"><div class="v">${gov.name}</div><div class="l">TYPE</div></div>
      <div class="nx-stat-card"><div class="v">${Math.round(s.approval)}%</div><div class="l">APPROVAL</div></div>
    </div>
    <p style="color:var(--muted);font-size:.74rem;margin-top:10px">${gov.elections ? `Next election in ${nextElectionWeeks} weeks.` : 'This government does not hold elections.'}</p>`;
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
  g3.innerHTML = `<b class="hd">LAWS &amp; POLICY</b>`;
  for (const law of LAWS) {
    const row = document.createElement('div'); row.className = 'nx-law-item';
    const on = !!state.laws[law.id];
    row.innerHTML = `<span class="info"><span class="nm">${law.name}</span><span class="ds">${law.desc}</span></span><span class="nx-switch ${on ? 'on' : ''}"></span>`;
    row.addEventListener('click', () => { S.toggleLaw(state, law.id); onChange(true); });
    g3.appendChild(row);
  }
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
      btn.addEventListener('click', () => {
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
