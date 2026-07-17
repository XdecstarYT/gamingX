/* ============================================================================
   IMPERIUM: WORLD CONQUEST — UI layer: map renderer + dashboard panels.
   Pure rendering + DOM wiring. Reads/mutates `state` via ImpSim's action
   functions; never touches simulation internals directly.
   ========================================================================== */
window.ImpUI = (() => {
'use strict';
const D = window.ImpData;
const S = window.ImpSim;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => {
  n = Math.round(n);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
};

let state = null;
let onChange = () => {};
let selectedProvince = null;
let attackFraction = 0.5;

/* ------------------------------------------------------------------ */
/* map renderer — a 2D "risk board" graph: provinces as nodes, borders  */
/* as edges. Pan/zoom/click mirror the rest of the platform's feel.     */
/* ------------------------------------------------------------------ */
const NODE_R = 20;
let cam = { x: 0, y: 0, zoom: 1 };
let canvas, ctx;
let dragging = false, dragStart = null, camStart = null, dragMoved = 0;

function initMap() {
  canvas = $('map-canvas');
  ctx = canvas.getContext('2d');
  cam.x = S.MAP_W / 2; cam.y = S.MAP_H / 2;
  const fitW = (canvas.clientWidth || 800) / (S.MAP_W + 140);
  const fitH = (canvas.clientHeight || 600) / (S.MAP_H + 140);
  cam.zoom = Math.max(0.5, Math.min(1.6, Math.min(fitW, fitH)));

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
    cam.zoom = Math.max(0.4, Math.min(3, cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
  }, { passive: false });
  addEventListener('resize', resizeCanvas);
  resizeCanvas();
}
function resizeCanvas() {
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
}
function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const scale = cam.zoom * dpr;
  const sx = (clientX - rect.left) * dpr, sy = (clientY - rect.top) * dpr;
  const originX = canvas.width / 2 - cam.x * cam.zoom * dpr;
  const originY = canvas.height / 2 - cam.y * cam.zoom * dpr;
  return { x: (sx - originX) / scale, y: (sy - originY) / scale };
}
function provinceAtWorld(pt) {
  let best = null, bestD = Infinity;
  for (const p of state.world.provinces) {
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return (best && bestD <= NODE_R * 1.5) ? best.id : null;
}
function updateTip(e) {
  const id = provinceAtWorld(screenToWorld(e.clientX, e.clientY));
  const tip = $('map-tip');
  if (id === null) { tip.classList.add('hidden'); return; }
  const prov = state.world.provinces[id];
  const ps = state.provinces[id];
  const ownerName = ps.owner ? D.NATIONS_BY_ID[ps.owner].name : 'Unclaimed';
  const total = Object.values(ps.garrison).reduce((a, b) => a + b, 0);
  tip.innerHTML = `<b>${esc(prov.name)}</b>${prov.isCapital ? ' 👑' : ''} · ${D.TERRAIN[prov.terrain].name}<br>${esc(ownerName)} · ${total} unit${total === 1 ? '' : 's'} garrisoned`;
  tip.classList.remove('hidden');
}
function handleMapClick(e) {
  const id = provinceAtWorld(screenToWorld(e.clientX, e.clientY));
  selectedProvince = id;
  if (id !== null) setTab('province');
  renderDash();
}

function renderMap() {
  if (!canvas) return;
  const w = canvas.width, h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0c0708';
  ctx.fillRect(0, 0, w, h);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const scale = cam.zoom * dpr;
  ctx.setTransform(scale, 0, 0, scale, w / 2 - cam.x * cam.zoom * dpr, h / 2 - cam.y * cam.zoom * dpr);

  const world = state.world;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.4 / cam.zoom;
  ctx.beginPath();
  for (const p of world.provinces) for (const nb of p.neighbors) if (nb > p.id) { ctx.moveTo(p.x, p.y); ctx.lineTo(world.provinces[nb].x, world.provinces[nb].y); }
  ctx.stroke();

  for (const p of world.provinces) {
    const ps = state.provinces[p.id];
    const color = ps.owner ? D.NATIONS_BY_ID[ps.owner].color : '#4b3a3d';
    ctx.beginPath(); ctx.arc(p.x, p.y, NODE_R, 0, 7);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2 / cam.zoom; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.stroke();
    if (p.isCapital) { ctx.beginPath(); ctx.arc(p.x, p.y, NODE_R + 5, 0, 7); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2 / cam.zoom; ctx.stroke(); }
    if (selectedProvince === p.id) { ctx.beginPath(); ctx.arc(p.x, p.y, NODE_R + 8, 0, 7); ctx.strokeStyle = '#f2b03d'; ctx.lineWidth = 3 / cam.zoom; ctx.stroke(); }
    const total = Object.values(ps.garrison).reduce((a, b) => a + b, 0);
    if (total > 0) {
      ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(String(total), p.x, p.y + 1);
    }
    if (ps.improvementBuild || ps.buildQueue.length) {
      ctx.beginPath(); ctx.arc(p.x + NODE_R * 0.65, p.y - NODE_R * 0.65, 5, 0, 7);
      ctx.fillStyle = '#fde047'; ctx.fill();
    }
  }
}

/* ------------------------------------------------------------------ */
/* toasts                                                               */
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
  el.className = 'im-toast' + (kind ? ' ' + kind : '');
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

/* ------------------------------------------------------------------ */
/* top bar                                                              */
/* ------------------------------------------------------------------ */
function renderTopbar() {
  const nation = state.nations[state.playerNation];
  $('hud-nation-name').textContent = D.NATIONS_BY_ID[state.playerNation].name;
  $('hud-date').textContent = `Tick ${state.meta.tick}`;
  const provCount = S.ownedProvinceIds(state, state.playerNation).length;
  $('hud-stats').innerHTML = `
    <div class="chip"><small>GOLD</small>${fmt(nation.gold)}</div>
    <div class="chip"><small>MANPOWER</small>${fmt(nation.manpower)}</div>
    <div class="chip"><small>RESEARCH</small>${fmt(nation.researchProgress)}</div>
    <div class="chip ${provCount <= 1 ? 'warn' : ''}"><small>PROVINCES</small>${provCount}</div>
    <div class="chip"><small>SCORE</small>${fmt(state.score)}</div>`;
  document.querySelectorAll('.im-speed-btn').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === state.meta.speed));
}

/* ------------------------------------------------------------------ */
/* dashboard: tab dispatch                                              */
/* ------------------------------------------------------------------ */
let currentTab = 'overview';
function renderDash() {
  const body = $('dash-body');
  const renderers = { overview: renderOverview, province: renderProvince, tech: renderTech, rivals: renderRivals, log: renderLog };
  body.innerHTML = '';
  (renderers[currentTab] || renderOverview)(body);
}
function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.im-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  renderDash();
}

function group(title) {
  const g = document.createElement('div'); g.className = 'im-group';
  g.innerHTML = `<b class="hd">${title}</b>`;
  return g;
}

function renderOverview(body) {
  const nation = state.nations[state.playerNation];
  const inc = S.computeIncome(state, state.playerNation);
  const upkeep = S.computeUpkeep(state, state.playerNation);
  const provIds = S.ownedProvinceIds(state, state.playerNation);
  let unitTotal = 0;
  for (const pid of provIds) unitTotal += Object.values(state.provinces[pid].garrison).reduce((a, b) => a + b, 0);

  const g1 = group('NATION');
  g1.innerHTML += `<div class="im-stat-grid">
    <div class="im-stat-card"><div class="v">${provIds.length}</div><div class="l">PROVINCES</div></div>
    <div class="im-stat-card"><div class="v">${unitTotal}</div><div class="l">TOTAL UNITS</div></div>
    <div class="im-stat-card"><div class="v">+${fmt(inc.gold)}</div><div class="l">GOLD / TICK</div></div>
    <div class="im-stat-card"><div class="v">-${fmt(upkeep)}</div><div class="l">UPKEEP / TICK</div></div>
    <div class="im-stat-card"><div class="v">+${fmt(inc.manpower)}</div><div class="l">MANPOWER / TICK</div></div>
    <div class="im-stat-card"><div class="v">+${fmt(inc.research)}</div><div class="l">RESEARCH / TICK</div></div>
  </div>`;
  body.appendChild(g1);

  const g2 = group('YOUR TRAIT');
  const def = D.NATIONS_BY_ID[state.playerNation];
  g2.innerHTML += `<p style="color:var(--muted);font-size:.8rem"><b style="color:var(--text)">${esc(def.motto)}</b> — ${esc(def.desc)}</p>`;
  body.appendChild(g2);

  if (nation.milestonesClaimed.length) {
    const gm = group(`MILESTONES (${nation.milestonesClaimed.length}/${D.MILESTONES.length})`);
    gm.innerHTML += nation.milestonesClaimed.map(name => {
      const ms = D.MILESTONES.find(x => x.name === name);
      return `<div style="font-size:.78rem;padding:5px 0"><b style="color:var(--accent)">${esc(ms.name)}</b><br><span style="color:var(--muted);font-size:.7rem">${esc(ms.desc)}</span></div>`;
    }).join('');
    body.appendChild(gm);
  } else {
    const gm = group('MILESTONES');
    gm.innerHTML += `<p style="color:var(--muted);font-size:.76rem">Reach ${D.MILESTONES[0].provinces} provinces to become a ${D.MILESTONES[0].name} and earn your first permanent bonus.</p>`;
    body.appendChild(gm);
  }

  const g3 = group('RECENT NEWS');
  const feed = document.createElement('div'); feed.className = 'im-feed';
  feed.innerHTML = state.notifications.slice(-8).reverse().map(n => `<div class="im-feed-item ${n.kind}">${esc(n.text)}</div>`).join('') || '<div class="im-feed-item">All quiet for now.</div>';
  g3.appendChild(feed);
  body.appendChild(g3);

  if (!provIds.length) {
    const note = document.createElement('div'); note.className = 'im-locked-note';
    note.textContent = 'Your nation has fallen. This campaign is over.';
    body.insertBefore(note, body.firstChild);
  }
}

function renderProvince(body) {
  if (selectedProvince === null) {
    const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.82rem;text-align:center;padding:30px 10px';
    p.textContent = 'Click a province on the map to inspect it.';
    body.appendChild(p);
    return;
  }
  const prov = state.world.provinces[selectedProvince];
  const ps = state.provinces[selectedProvince];
  const isMine = ps.owner === state.playerNation;

  const g1 = group(prov.name.toUpperCase() + (prov.isCapital ? ' 👑' : ''));
  const ownerName = ps.owner ? D.NATIONS_BY_ID[ps.owner].name : 'Unclaimed territory';
  const ownerColor = ps.owner ? D.NATIONS_BY_ID[ps.owner].color : '#4b3a3d';
  g1.innerHTML += `<p style="font-size:.78rem;color:var(--muted);margin-bottom:8px">
      <span style="color:${ownerColor};font-weight:800">${esc(ownerName)}</span> · ${D.TERRAIN[prov.terrain].name} terrain
    </p>`;
  const garrisonRows = Object.entries(ps.garrison);
  g1.innerHTML += garrisonRows.length
    ? garrisonRows.map(([uid, c]) => `<div style="display:flex;justify-content:space-between;font-size:.76rem;padding:4px 0"><span>${D.UNITS_BY_ID[uid].icon} ${D.UNITS_BY_ID[uid].name}</span><b>${c}</b></div>`).join('')
    : '<p style="color:var(--muted);font-size:.76rem">No garrison.</p>';
  if (ps.improvement) g1.innerHTML += `<p style="font-size:.74rem;color:var(--accent);margin-top:8px">${D.IMPROVEMENTS_BY_ID[ps.improvement].icon} ${D.IMPROVEMENTS_BY_ID[ps.improvement].name} built here</p>`;
  if (ps.owner) {
    const unrestColor = ps.unrest >= 70 ? '#f87171' : ps.unrest >= 40 ? '#f2b03d' : '#22c55e';
    g1.innerHTML += `<div style="margin-top:9px">
      <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted);margin-bottom:3px"><span>UNREST</span><span style="color:${unrestColor};font-weight:800">${Math.round(ps.unrest)}${ps.unrest >= 70 ? ' ⚠ revolt risk' : ''}</span></div>
      <div style="height:5px;border-radius:3px;background:#0c0708;overflow:hidden"><i style="display:block;height:100%;width:${ps.unrest}%;background:${unrestColor}"></i></div>
    </div>`;
  }
  body.appendChild(g1);

  if (isMine) {
    if (ps.improvementBuild) {
      const g = group('IMPROVEMENT UNDER CONSTRUCTION');
      const item = ps.improvementBuild;
      const pct = Math.round((1 - item.ticksLeft / item.totalTicks) * 100);
      g.innerHTML += `<div class="im-queue-item"><span>${D.IMPROVEMENTS_BY_ID[item.id].icon} ${D.IMPROVEMENTS_BY_ID[item.id].name}</span><div class="prog"><i style="width:${pct}%"></i></div><span>${item.ticksLeft}t</span></div>`;
      body.appendChild(g);
    } else if (!ps.improvement) {
      const g = group('BUILD IMPROVEMENT');
      for (const imp of D.IMPROVEMENTS) {
        const nation = state.nations[state.playerNation];
        const locked = nation.gold < imp.cost;
        const el = document.createElement('button');
        el.className = 'im-build-item' + (locked ? ' disabled' : '');
        el.innerHTML = `<span class="ic">${imp.icon}</span><span class="info"><span class="nm">${imp.name}</span><span class="ds">${imp.desc}</span></span><span class="cost">$${imp.cost}</span>`;
        if (!locked) el.addEventListener('click', () => { const r = S.queueImprovement(state, selectedProvince, imp.id); if (!r.ok) toast(r.reason, 'battle'); onChange(); });
        g.appendChild(el);
      }
      body.appendChild(g);
    }

    const gq = group(`PRODUCTION QUEUE (${ps.buildQueue.length}/${S.MAX_QUEUE})`);
    if (ps.buildQueue.length) {
      gq.innerHTML += ps.buildQueue.map(item => {
        const pct = Math.round((1 - item.ticksLeft / item.totalTicks) * 100);
        return `<div class="im-queue-item"><span>${D.UNITS_BY_ID[item.unitId].icon}</span><div class="prog"><i style="width:${pct}%"></i></div><span>${item.ticksLeft}t</span></div>`;
      }).join('');
    } else {
      gq.innerHTML += '<p style="color:var(--muted);font-size:.76rem">Nothing training.</p>';
    }
    body.appendChild(gq);

    const g2 = group('TRAIN UNITS');
    const nation = state.nations[state.playerNation];
    for (const u of D.UNITS) {
      const locked = (u.needsTech && !nation.techUnlocked.includes(u.needsTech)) || ps.buildQueue.length >= S.MAX_QUEUE || nation.gold < u.cost.gold || nation.manpower < u.cost.manpower;
      const el = document.createElement('button');
      el.className = 'im-build-item' + (locked ? ' disabled' : '');
      const lockReason = u.needsTech && !nation.techUnlocked.includes(u.needsTech) ? ` 🔒 ${D.TECHS_BY_ID[u.needsTech].name}` : '';
      el.innerHTML = `<span class="ic">${u.icon}</span><span class="info"><span class="nm">${u.name}</span><span class="ds">${u.desc}${lockReason}</span></span><span class="cost">$${u.cost.gold} · ${u.cost.manpower}mp</span>`;
      if (!locked) el.addEventListener('click', () => { const r = S.queueUnit(state, selectedProvince, u.id); if (!r.ok) toast(r.reason, 'battle'); onChange(); });
      g2.appendChild(el);
    }
    body.appendChild(g2);

    const attackable = prov.neighbors.filter(nb => state.provinces[nb].owner !== state.playerNation);
    if (attackable.length) {
      const g3 = group('ADJACENT TERRITORY');
      for (const nb of attackable) {
        const row = document.createElement('div'); row.className = 'im-province-card'; row.style.cursor = 'pointer';
        const nbProv = state.world.provinces[nb], nbState = state.provinces[nb];
        const nbOwner = nbState.owner ? D.NATIONS_BY_ID[nbState.owner].name : 'Unclaimed';
        row.innerHTML = `<div class="top"><b>${esc(nbProv.name)}</b><span class="ds">${D.TERRAIN[nbProv.terrain].name}</span></div><div class="ds">${esc(nbOwner)}</div>`;
        row.addEventListener('click', () => { selectedProvince = nb; renderDash(); });
        g3.appendChild(row);
      }
      body.appendChild(g3);
    }
  } else {
    const myAdjacent = prov.neighbors.filter(nb => state.provinces[nb].owner === state.playerNation);
    if (myAdjacent.length && !state.gameOver) {
      for (const sourceId of myAdjacent) {
        const g = group(`ATTACK FROM ${state.world.provinces[sourceId].name.toUpperCase()}`);
        const srcGarrison = state.provinces[sourceId].garrison;
        const srcTotal = Object.values(srcGarrison).reduce((a, b) => a + b, 0);
        if (!srcTotal) { g.innerHTML += '<p style="color:var(--muted);font-size:.76rem">No garrison available to send.</p>'; body.appendChild(g); continue; }
        const panel = document.createElement('div'); panel.className = 'im-attack-panel';
        const atkPow = Math.round(sumStatPreview(srcGarrison, 'attack', Math.round(srcTotal * attackFraction) / Math.max(1, srcTotal)) * (D.NATIONS_BY_ID[state.playerNation].trait.atk || 1));
        const defPow = Math.round(previewDefensePower(selectedProvince));
        panel.innerHTML = `<div class="vs"><span class="atk">Your strength: ${atkPow}</span><span class="def">Their defense: ${defPow}</span></div>`;
        const fracRow = document.createElement('div'); fracRow.className = 'im-frac-row';
        for (const f of [0.25, 0.5, 0.75, 1]) {
          const b = document.createElement('button'); b.className = 'im-frac-btn' + (attackFraction === f ? ' on' : ''); b.textContent = Math.round(f * 100) + '%';
          b.addEventListener('click', () => { attackFraction = f; renderDash(); });
          fracRow.appendChild(b);
        }
        panel.appendChild(fracRow);
        const launch = document.createElement('button'); launch.className = 'im-attack-launch'; launch.textContent = '⚔️ LAUNCH ATTACK';
        launch.addEventListener('click', () => {
          const r = S.attack(state, sourceId, selectedProvince, attackFraction);
          if (!r.ok) toast(r.reason, 'battle');
          onChange();
        });
        panel.appendChild(launch);
        g.appendChild(panel);
        body.appendChild(g);
      }
    } else if (!state.gameOver) {
      const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.78rem;text-align:center;padding:10px';
      p.textContent = 'None of your provinces border this one.';
      body.appendChild(p);
    }
  }
}
function sumStatPreview(garrison, statKey, fraction) {
  let s = 0;
  for (const [id, count] of Object.entries(garrison)) s += D.UNITS_BY_ID[id][statKey] * Math.floor(count * fraction);
  return s;
}
function previewDefensePower(provinceId) {
  const prov = state.world.provinces[provinceId];
  const ps = state.provinces[provinceId];
  let m = D.TERRAIN[prov.terrain].defMult;
  if (ps.improvement) { const imp = D.IMPROVEMENTS_BY_ID[ps.improvement]; if (imp.bonus.defMult) m *= imp.bonus.defMult; }
  if (ps.owner) { const n = D.NATIONS_BY_ID[ps.owner]; m *= (n.trait.def || 1); }
  let base = 0;
  for (const [id, count] of Object.entries(ps.garrison)) base += D.UNITS_BY_ID[id].defense * count;
  return base * m;
}

function renderTech(body) {
  const nation = state.nations[state.playerNation];
  const cats = { military: 'MILITARY', economy: 'ECONOMY' };
  for (const [cat, label] of Object.entries(cats)) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<b class="hd" style="display:block;margin:12px 0 8px;color:var(--accent);font-size:.68rem;letter-spacing:1.5px">${label}</b>`;
    for (const t of D.TECHS.filter(x => x.cat === cat)) {
      const unlocked = nation.techUnlocked.includes(t.id);
      const researching = nation.researching === t.id;
      const available = !unlocked && (!t.prereq || t.prereq.every(p => nation.techUnlocked.includes(p)));
      const card = document.createElement('div');
      card.className = 'im-tech-card ' + (unlocked ? 'unlocked' : researching ? 'researching' : available ? '' : 'locked');
      let html = `<div class="top"><span>${t.name}</span><span>${unlocked ? '✓' : t.cost + ' RP'}</span></div><div class="ds">${t.desc}</div>`;
      if (researching) html += `<div class="prog"><i style="width:${Math.min(100, nation.researchProgress / t.cost * 100)}%"></i></div>`;
      card.innerHTML = html;
      if (available && !nation.researching) {
        const btn = document.createElement('button'); btn.textContent = 'RESEARCH ▸';
        btn.addEventListener('click', () => { const r = S.setResearch(state, state.playerNation, t.id); if (!r.ok) toast(r.reason, 'battle'); onChange(); });
        card.appendChild(btn);
      }
      wrap.appendChild(card);
    }
    body.appendChild(wrap);
  }
}

function renderRivals(body) {
  for (const nid of state.nationOrder) {
    if (nid === state.playerNation) continue;
    const def = D.NATIONS_BY_ID[nid];
    const nation = state.nations[nid];
    const provCount = S.ownedProvinceIds(state, nid).length;
    let units = 0;
    for (const pid of S.ownedProvinceIds(state, nid)) units += Object.values(state.provinces[pid].garrison).reduce((a, b) => a + b, 0);
    const card = document.createElement('div'); card.className = 'im-rival-card' + (nation.alive ? '' : ' dead');
    card.innerHTML = `
      <div class="top"><span class="dot" style="background:${def.color}"></span><span class="nm">${esc(def.name)}</span><span class="ds" style="color:var(--muted);font-size:.68rem">${nation.alive ? esc(nation.personality) : 'ELIMINATED'}</span></div>
      <div class="stats"><span>${provCount} provinces</span><span>${units} units</span><span>${nation.techUnlocked.length} techs</span></div>`;
    body.appendChild(card);
  }
}

function renderLog(body) {
  const g = document.createElement('div'); g.className = 'im-group';
  g.innerHTML = '<b class="hd">CAMPAIGN LOG</b>';
  const feed = document.createElement('div'); feed.className = 'im-feed';
  feed.style.maxHeight = 'none';
  feed.innerHTML = state.log.slice().reverse().map(l => `<div class="im-feed-item ${l.kind}">${esc(l.text)}</div>`).join('') || '<div class="im-feed-item">No events yet.</div>';
  g.appendChild(feed);
  body.appendChild(g);
}

/* ------------------------------------------------------------------ */
/* game-over modal                                                      */
/* ------------------------------------------------------------------ */
function showGameOver() {
  const modal = $('gameover-modal');
  if (!state.gameOver) { modal.classList.add('hidden'); return; }
  const box = $('gameover-box');
  const win = state.gameOver === 'win';
  box.innerHTML = `<h2>${win ? '🏆 TOTAL VICTORY' : '💀 DEFEAT'}</h2>
    <p>${win ? 'Every rival nation has fallen. The world is yours.' : 'Your last province has fallen. The campaign is over.'}<br>Final score: <b style="color:var(--accent)">${fmt(state.score)}</b></p>
    <div class="im-menu-buttons"><button class="im-btn im-btn-primary" data-act="menu">🏠 MAIN MENU</button></div>`;
  box.querySelector('[data-act="menu"]').addEventListener('click', () => onChange('gameover-exit'));
  modal.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* full refresh                                                         */
/* ------------------------------------------------------------------ */
function refresh() {
  renderTopbar();
  renderDash();
  drainToasts();
  showGameOver();
}
function init(_state, changeCb) {
  state = _state;
  onChange = changeCb || (() => {});
  selectedProvince = null; lastNotifShown = 0;
  initMap();
  document.querySelectorAll('.im-tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  refresh();
}
function setState(_state) { state = _state; lastNotifShown = state.notifications.length ? state.notifications[state.notifications.length - 1].id : 0; }

return { init, setState, refresh, renderMap, toast };
})();
