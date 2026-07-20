/* ============================================================================
   BASTION — canvas rendering, input, menus and persistence. Drives
   BastionEngine.Game; nothing here holds simulation truth.
   ========================================================================== */
(() => {
'use strict';
const D = window.BASTION_DATA;
const { Game } = window.BastionEngine;
const $ = id => document.getElementById(id);
const SAVE_KEY = 'gamingx.bastion.save';

/* ---------------- persistence ---------------- */
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') || { stars: {}, endlessBest: {} }; }
  catch (e) { return { stars: {}, endlessBest: {} }; }
}
function saveSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {} }
let save = loadSave();

/* ---------------- state ---------------- */
let screen = 'menu';        // menu | playing | paused | gameover | victory
let game = null;
let selectedMapId = D.MAPS[0].id;
let buildType = null;       // tower type currently armed for placement
let selectedTowerId = null;
let speedMul = 1;
let lastT = 0;
let hoverCell = null;

const canvas = $('stage');
const ctx = canvas.getContext('2d');
let dpr = 1, cw = 0, ch = 0, scale = 1, offX = 0, offY = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wrap = $('stage-wrap');
  cw = wrap.clientWidth; ch = wrap.clientHeight;
  canvas.width = cw * dpr; canvas.height = ch * dpr;
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  if (game) {
    const gw = game.map.cols * D.CELL, gh = game.map.rows * D.CELL;
    scale = Math.min(cw / gw, ch / gh) * 0.94;
    offX = (cw - gw * scale) / 2; offY = (ch - gh * scale) / 2;
  }
}
window.addEventListener('resize', resize);

function toGrid(px, py) {
  const gx = (px - offX) / scale / D.CELL, gy = (py - offY) / scale / D.CELL;
  return { col: Math.floor(gx), row: Math.floor(gy) };
}

/* ---------------- menu screen ---------------- */
function renderMenu() {
  screen = 'menu';
  $('overlay').classList.remove('hidden');
  $('endpanel').classList.add('hidden');
  const html = D.MAPS.map(m => {
    const stars = save.stars[m.id] || 0;
    const best = save.endlessBest[m.id] || 0;
    const starStr = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    return `<div class="bs-mapcard${selectedMapId === m.id ? ' on' : ''}" data-map="${m.id}">
      <div class="bs-mapicon">${m.icon}</div>
      <div class="bs-mapname">${m.name}</div>
      <div class="bs-mapstars">${starStr}</div>
      <div class="bs-mapbest">Endless best: wave ${best}</div>
    </div>`;
  }).join('');
  $('menu-maps').innerHTML = html;
  $('menu-maps').querySelectorAll('.bs-mapcard').forEach(el => el.addEventListener('click', () => { selectedMapId = el.dataset.map; renderMenu(); }));
  $('overlay-title').textContent = '🏰 BASTION';
  $('overlay-sub').textContent = 'Defend the path. Build towers, hold the line.';
}

function startGame(mode) {
  game = new Game(selectedMapId, { mode, maxWave: 20 });
  screen = 'playing';
  buildType = null; selectedTowerId = null; speedMul = 1;
  $('overlay').classList.add('hidden');
  $('endpanel').classList.add('hidden');
  resize();
  lastT = performance.now();
  requestAnimationFrame(loop);
}
$('btn-campaign').addEventListener('click', () => startGame('campaign'));
$('btn-endless').addEventListener('click', () => startGame('endless'));

/* ---------------- HUD ---------------- */
/* Cheap, per-frame-safe: only ever sets textContent, never replaces DOM
   nodes, so it can run every animation frame without disturbing whatever
   the player is mid-tapping on (see renderHUD below for why that matters). */
function renderTopHUD() {
  if (!game) return;
  $('hud-gold').textContent = '💰 ' + game.gold;
  $('hud-lives').textContent = '❤️ ' + game.lives + '/' + game.maxLives;
  const waveLabel = game.mode === 'campaign' ? `${game.wave}/${game.maxWave}` : String(game.wave);
  $('hud-wave').textContent = '🌊 ' + waveLabel;
  $('hud-score').textContent = '⭐ ' + game.score;
  const startBtn = $('btn-start-wave');
  startBtn.textContent = game.waveState === 'spawning' ? 'Spawning…'
    : game.waveState === 'active' ? 'Enemies active — start next (rush)'
    : '▶ Start Wave ' + (game.wave + 1);
}
/* Full rebuild: replaces the build-panel/info-panel DOM (innerHTML), so it
   must NOT run every frame — rebuilding 60x/sec would destroy and recreate
   the very button the player is trying to tap, dropping real taps/clicks.
   Called on discrete actions (place/upgrade/sell/select) and throttled from
   the main loop for things that drift over time (gold affordability, kill
   counts). */
function renderHUD() {
  renderTopHUD();
  renderBuildPanel();
  renderSelectedPanel();
}

function renderBuildPanel() {
  const html = D.TOWER_ORDER.map(key => {
    const def = D.TOWERS[key];
    const affordable = game.gold >= def.cost;
    return `<button class="bs-towerbtn${buildType === key ? ' on' : ''}${affordable ? '' : ' bs-poor'}" data-tower="${key}" title="${def.desc}">
      <span class="ic">${def.icon}</span><span class="nm">${def.name}</span><span class="cost">💰${def.cost}</span>
    </button>`;
  }).join('');
  $('build-panel').innerHTML = html;
  $('build-panel').querySelectorAll('[data-tower]').forEach(b => b.addEventListener('click', () => {
    buildType = buildType === b.dataset.tower ? null : b.dataset.tower;
    selectedTowerId = null;
    renderHUD();
  }));
}

function renderSelectedPanel() {
  const panel = $('info-panel');
  const t = selectedTowerId ? game.towers.find(x => x.id === selectedTowerId) : null;
  if (!t) { panel.innerHTML = '<div class="bs-hint">Tap a build item then a tile to build — or tap a placed tower to inspect it.</div>'; return; }
  const def = D.TOWERS[t.type];
  const tier = def.tiers[t.tier];
  const nextTier = def.tiers[t.tier + 1];
  panel.innerHTML = `
    <div class="bs-infohead"><span class="ic">${def.icon}</span><b>${def.name}</b><span class="tier">Tier ${t.tier + 1}${tier.label ? ' · ' + tier.label : ''}</span></div>
    <div class="bs-stats">
      <div>DMG <b>${tier.damage}</b></div><div>RATE <b>${tier.fireRate.toFixed(2)}s</b></div><div>RANGE <b>${tier.range.toFixed(1)}</b></div>
      <div>KILLS <b>${t.kills}</b></div>
    </div>
    <div class="bs-infoactions">
      ${nextTier ? `<button id="btn-upgrade">⬆ Upgrade ⁠(💰${nextTier.cost})</button>` : '<button disabled>MAX TIER</button>'}
      <button id="btn-sell">✕ Sell (💰${Math.floor(t.spent * 0.7)})</button>
    </div>`;
  const upBtn = $('btn-upgrade');
  if (upBtn) upBtn.addEventListener('click', () => { game.upgradeTower(t.id); renderHUD(); });
  $('btn-sell').addEventListener('click', () => { game.sellTower(t.id); selectedTowerId = null; renderHUD(); });
}

/* mobile: the build/inspect side panel becomes a slide-in drawer (same
   pattern as GX Studio/GX Blocks) so it's reachable without pinch-zooming. */
const drawerToggle = $('btn-drawer-toggle'), scrim = $('bs-scrim'), side = document.querySelector('.bs-side');
function setDrawer(open) { side.classList.toggle('open', open); scrim.classList.toggle('show', open); }
if (drawerToggle) drawerToggle.addEventListener('click', () => setDrawer(!side.classList.contains('open')));
if (scrim) scrim.addEventListener('click', () => setDrawer(false));

$('btn-start-wave').addEventListener('click', () => { if (game) { game.startNextWave(); renderHUD(); } });
$('btn-speed').addEventListener('click', () => { speedMul = speedMul === 1 ? 2 : 1; $('btn-speed').textContent = speedMul + 'x'; });
$('btn-pause').addEventListener('click', () => { screen = screen === 'paused' ? 'playing' : 'paused'; $('btn-pause').textContent = screen === 'paused' ? '▶' : '⏸'; });
$('btn-menu').addEventListener('click', () => { screen = 'menu'; renderMenu(); });

/* ---------------- input ---------------- */
function pointerAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return toGrid(clientX - r.left, clientY - r.top);
}
function isMobileLayout() { return window.innerWidth <= 760; }
canvas.addEventListener('pointerdown', e => {
  if (screen !== 'playing' || !game) return;
  const { col, row } = pointerAt(e.clientX, e.clientY);
  if (buildType) {
    const res = game.placeTower(col, row, buildType);
    if (res.ok) { selectedTowerId = res.tower.id; buildType = null; if (isMobileLayout()) setDrawer(true); }
    renderHUD();
    return;
  }
  const hit = game.towers.find(t => t.col === col && t.row === row);
  selectedTowerId = hit ? hit.id : null;
  if (hit && isMobileLayout()) setDrawer(true);
  renderHUD();
});
canvas.addEventListener('pointermove', e => {
  if (screen !== 'playing') return;
  const r = canvas.getBoundingClientRect();
  hoverCell = toGrid(e.clientX - r.left, e.clientY - r.top);
});
window.addEventListener('keydown', e => {
  if (screen !== 'playing') return;
  const idx = parseInt(e.key, 10) - 1;
  if (idx >= 0 && idx < D.TOWER_ORDER.length) { buildType = D.TOWER_ORDER[idx]; renderHUD(); }
  if (e.key === ' ') { e.preventDefault(); game.startNextWave(); renderHUD(); }
  if (e.key === 'Escape') { buildType = null; selectedTowerId = null; renderHUD(); }
});

/* ---------------- end screens ---------------- */
function showEnd(victory) {
  screen = victory ? 'victory' : 'gameover';
  if (victory) {
    const cur = save.stars[game.map.id] || 0;
    save.stars[game.map.id] = Math.max(cur, game.stars);
  }
  if (game.mode === 'endless') {
    const cur = save.endlessBest[game.map.id] || 0;
    save.endlessBest[game.map.id] = Math.max(cur, game.wave);
  }
  saveSave(save);
  $('endpanel').classList.remove('hidden');
  $('end-title').textContent = victory ? '🏆 VICTORY' : '💀 THE BASTION HAS FALLEN';
  $('end-msg').innerHTML = victory
    ? `Cleared all ${game.maxWave} waves on <b>${game.map.name}</b> with ${game.lives}/${game.maxLives} lives.<br>${'★'.repeat(game.stars)}${'☆'.repeat(3 - game.stars)}`
    : `You reached <b>wave ${game.wave}</b> on <b>${game.map.name}</b>. Score: ${game.score}.`;
}
$('btn-end-retry').addEventListener('click', () => startGame(game.mode));
$('btn-end-menu').addEventListener('click', () => { screen = 'menu'; renderMenu(); });

/* ---------------- render loop ---------------- */
const COL_PATH = '#3a3624', COL_GRASS1 = '#1c2b1a', COL_GRASS2 = '#1a2818';
function drawGame() {
  ctx.save(); ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0a0d16'; ctx.fillRect(0, 0, cw, ch);
  ctx.translate(offX, offY); ctx.scale(scale, scale);
  const C = D.CELL;

  // grid
  for (let c = 0; c < game.map.cols; c++) {
    for (let r = 0; r < game.map.rows; r++) {
      const onPath = game.pathSet.has(c + ',' + r);
      ctx.fillStyle = onPath ? COL_PATH : ((c + r) % 2 === 0 ? COL_GRASS1 : COL_GRASS2);
      ctx.fillRect(c * C, r * C, C, C);
    }
  }
  // buildable hover highlight
  if (buildType && hoverCell && game.isBuildable(hoverCell.col, hoverCell.row)) {
    ctx.fillStyle = 'rgba(120,220,150,.28)';
    ctx.fillRect(hoverCell.col * C, hoverCell.row * C, C, C);
  }

  // towers
  for (const t of game.towers) {
    const def = D.TOWERS[t.type];
    const cx = t.col * C + C / 2, cy = t.row * C + C / 2;
    if (t.id === selectedTowerId || (buildType === null && hoverCell && hoverCell.col === t.col && hoverCell.row === t.row)) {
      const range = def.tiers[t.tier].range * C;
      ctx.beginPath(); ctx.arc(cx, cy, range, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, C * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = def.color; ctx.fill();
    ctx.strokeStyle = t.id === selectedTowerId ? '#fff' : 'rgba(0,0,0,.4)'; ctx.lineWidth = t.id === selectedTowerId ? 3 : 1.5; ctx.stroke();
    ctx.font = (C * 0.42) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, cx, cy);
    if (t.tier > 0) { ctx.font = 'bold ' + (C * 0.2) + 'px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('T' + (t.tier + 1), cx, cy + C * 0.36); }
  }

  // enemies
  for (const e of game.enemies) {
    const p = game.posAtDist(e.dist);
    const x = p.x * C, y = p.y * C;
    const r = e.boss ? C * 0.4 : C * 0.24;
    const edef = D.ENEMIES[e.type];
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = e.boss ? '#ff3b57' : e.flying ? '#9ad1ff' : '#e8b04a';
    ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    // hp bar
    const hpFrac = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - r, y - r - 8, r * 2, 4);
    ctx.fillStyle = hpFrac > 0.5 ? '#4ade80' : hpFrac > 0.25 ? '#facc15' : '#f87171';
    ctx.fillRect(x - r, y - r - 8, r * 2 * hpFrac, 4);
    if (e.shieldMax) { ctx.strokeStyle = 'rgba(140,220,255,.8)'; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
    if (e.slowUntil > game._time) { ctx.fillStyle = 'rgba(140,220,255,.5)'; ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

let hudRebuildAcc = 0;
const HUD_REBUILD_INTERVAL = 0.25; // seconds — see renderHUD's comment
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000) * speedMul;
  lastT = t;
  if (screen === 'playing' && game) {
    game.tick(dt);
    const evs = game.drainEvents();
    for (const ev of evs) { if (ev.type === 'game_over') showEnd(false); if (ev.type === 'victory') showEnd(true); }
    drawGame();
    renderTopHUD();
    hudRebuildAcc += dt;
    if (hudRebuildAcc >= HUD_REBUILD_INTERVAL) { hudRebuildAcc = 0; renderBuildPanel(); renderSelectedPanel(); }
  } else if (screen === 'paused' && game) {
    drawGame();
  }
  requestAnimationFrame(loop);
}

/* ---------------- boot ---------------- */
renderMenu();
resize();
requestAnimationFrame(loop);

window.__bastion = {
  game: () => game,
  screen: () => screen,
  startGame,
  placeTower: (c, r, type) => game && game.placeTower(c, r, type),
  selectMap: id => { selectedMapId = id; renderMenu(); },
  save: () => save,
};
})();
