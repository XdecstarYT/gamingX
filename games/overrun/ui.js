/* ============================================================================
   OVERRUN — canvas rendering, input (keyboard + virtual joystick), menus,
   shop and persistence. Drives OverrunEngine.Game; no simulation truth here.
   ========================================================================== */
(() => {
'use strict';
const D = window.OVERRUN_DATA;
const { Game, ARENA } = window.OverrunEngine;
const $ = id => document.getElementById(id);
const SAVE_KEY = 'gamingx.overrun.save';

/* ---------------- persistence ---------------- */
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s) return s;
  } catch (e) {}
  return { scrap: 0, meta: { maxhp: 0, damage: 0, speed: 0, armor: 0 }, unlocked: ['scout'], bestTime: 0, bestKills: 0 };
}
function saveSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {} }
let save = loadSave();

/* ---------------- state ---------------- */
let screen = 'menu'; // menu | shop | playing | levelup | gameover
let game = null;
let selectedChar = save.unlocked[0] || 'scout';
let lastT = 0;
const keys = new Set();
let joyVec = { x: 0, y: 0 };

const canvas = $('stage');
const ctx = canvas.getContext('2d');
let dpr = 1, cw = 0, ch = 0, pxPerUnit = 28;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wrap = $('stage-wrap');
  cw = wrap.clientWidth; ch = wrap.clientHeight;
  canvas.width = cw * dpr; canvas.height = ch * dpr;
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  pxPerUnit = Math.max(18, Math.min(cw, ch) / 16);
}
window.addEventListener('resize', resize);

/* ---------------- menu ---------------- */
function renderMenu() {
  screen = 'menu';
  $('overlay').classList.remove('hidden');
  $('shop-view').classList.add('hidden');
  $('menu-view').classList.remove('hidden');
  $('endpanel').classList.add('hidden');
  $('or-scrap').textContent = '⚙️ ' + save.scrap;
  const html = D.CHARACTER_ORDER.map(key => {
    const c = D.CHARACTERS[key];
    const owned = save.unlocked.includes(key);
    return `<div class="or-charcard${selectedChar === key ? ' on' : ''}${owned ? '' : ' locked'}" data-char="${key}">
      <div class="or-charicon">${c.icon}</div>
      <div class="or-charname">${c.name}</div>
      <div class="or-chardesc">${c.desc}</div>
      ${owned ? '' : `<div class="or-charcost">⚙️ ${c.cost} to unlock</div>`}
    </div>`;
  }).join('');
  $('menu-chars').innerHTML = html;
  $('menu-chars').querySelectorAll('.or-charcard').forEach(el => el.addEventListener('click', () => {
    const key = el.dataset.char;
    if (save.unlocked.includes(key)) { selectedChar = key; renderMenu(); return; }
    const c = D.CHARACTERS[key];
    if (save.scrap >= c.cost) { save.scrap -= c.cost; save.unlocked.push(key); selectedChar = key; saveSave(save); renderMenu(); }
  }));
}
$('btn-start-run').addEventListener('click', () => startGame());
$('btn-shop').addEventListener('click', renderShop);
$('btn-shop-back').addEventListener('click', renderMenu);

function renderShop() {
  screen = 'shop';
  $('menu-view').classList.add('hidden');
  $('shop-view').classList.remove('hidden');
  $('shop-scrap').textContent = '⚙️ ' + save.scrap;
  const html = Object.keys(D.META_UPGRADES).map(key => {
    const def = D.META_UPGRADES[key];
    const level = save.meta[key] || 0;
    const maxed = level >= def.maxLevel;
    const cost = maxed ? 0 : D.metaUpgradeCost(key, level);
    return `<div class="or-shoprow">
      <div class="ic">${def.icon}</div>
      <div class="info"><b>${def.name}</b><span>${def.desc} · Lv ${level}/${def.maxLevel}</span></div>
      <button data-meta="${key}" ${maxed || save.scrap < cost ? 'disabled' : ''}>${maxed ? 'MAX' : '⚙️ ' + cost}</button>
    </div>`;
  }).join('');
  $('shop-list').innerHTML = html;
  $('shop-list').querySelectorAll('[data-meta]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.meta, def = D.META_UPGRADES[key], level = save.meta[key] || 0;
    if (level >= def.maxLevel) return;
    const cost = D.metaUpgradeCost(key, level);
    if (save.scrap < cost) return;
    save.scrap -= cost; save.meta[key] = level + 1; saveSave(save);
    renderShop();
  }));
}

function startGame() {
  game = new Game(selectedChar, save.meta);
  screen = 'playing';
  $('overlay').classList.add('hidden');
  $('endpanel').classList.add('hidden');
  $('levelup').classList.add('hidden');
  resize();
  lastT = performance.now();
  requestAnimationFrame(loop);
}

/* ---------------- HUD ---------------- */
function renderTopHUD() {
  if (!game) return;
  const p = game.player;
  $('or-hp-fill').style.width = Math.max(0, p.hp / p.maxHp * 100) + '%';
  $('or-hp-text').textContent = Math.max(0, Math.ceil(p.hp)) + '/' + p.maxHp;
  const need = D.xpForLevel(p.level + 1);
  $('or-xp-fill').style.width = Math.min(100, p.xp / need * 100) + '%';
  $('or-level').textContent = 'Lv ' + p.level;
  $('or-time').textContent = fmtTime(game.time);
  $('or-kills').textContent = '☠ ' + game.kills;
  $('or-score').textContent = '⚙️ ' + game.score;
}
function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); }

let weaponsRebuildAcc = 0;
function renderWeapons() {
  const html = game.player.weapons.map(w => {
    const def = D.WEAPONS[w.key];
    return `<div class="or-wchip"><span class="ic">${def.icon}</span><span class="nm">${def.name}</span><span class="lv">Lv${w.level}</span></div>`;
  }).join('');
  $('or-weapons').innerHTML = html;
}

/* ---------------- level-up modal ---------------- */
function renderLevelUp() {
  if (!game.pendingUpgrade) { $('levelup').classList.add('hidden'); return; }
  $('levelup').classList.remove('hidden');
  const html = game.pendingUpgrade.map((opt, i) => {
    let icon = '⭐', desc = '';
    if (opt.type === 'weapon') { icon = D.WEAPONS[opt.key].icon; desc = opt.label; }
    else { const s = D.STAT_UPGRADES.find(x => x.key === opt.key); icon = s.icon; desc = s.desc; }
    return `<button class="or-upcard" data-idx="${i}"><div class="ic">${icon}</div><div class="lbl">${opt.label}</div><div class="desc">${desc}</div></button>`;
  }).join('');
  $('levelup-choices').innerHTML = html;
  $('levelup-choices').querySelectorAll('[data-idx]').forEach(b => b.addEventListener('click', () => {
    game.chooseUpgrade(parseInt(b.dataset.idx, 10));
    renderLevelUp();
    renderWeapons();
  }));
}

/* ---------------- end screen ---------------- */
function showEnd() {
  screen = 'gameover';
  save.scrap += game.scrapEarned;
  save.bestTime = Math.max(save.bestTime, game.time);
  save.bestKills = Math.max(save.bestKills, game.kills);
  saveSave(save);
  $('endpanel').classList.remove('hidden');
  $('end-title').textContent = '💀 RUN OVER';
  $('end-msg').innerHTML = `Survived <b>${fmtTime(game.time)}</b> · <b>${game.kills}</b> kills · Lv ${game.player.level}<br>+${game.scrapEarned} ⚙️ scrap earned (total: ${save.scrap})`;
}
$('btn-end-retry').addEventListener('click', startGame);
$('btn-end-menu').addEventListener('click', () => { screen = 'menu'; renderMenu(); });

/* ---------------- input ---------------- */
window.addEventListener('keydown', e => { keys.add(e.key.toLowerCase()); });
window.addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); });
function keyboardVec() {
  let x = 0, y = 0;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  return { x, y };
}

/* virtual joystick (touch + mouse) */
const joyBase = $('joy-base'), joyKnob = $('joy-knob');
let joyActive = false, joyId = null, joyCenter = { x: 0, y: 0 };
function joyRadius() { return joyBase.clientWidth / 2; }
function joyStart(clientX, clientY, id) {
  joyActive = true; joyId = id;
  const r = joyBase.getBoundingClientRect();
  joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  joyMove(clientX, clientY);
}
function joyMove(clientX, clientY) {
  if (!joyActive) return;
  let dx = clientX - joyCenter.x, dy = clientY - joyCenter.y;
  const rad = joyRadius();
  const len = Math.hypot(dx, dy);
  if (len > rad) { dx = dx / len * rad; dy = dy / len * rad; }
  joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  joyVec = { x: dx / rad, y: dy / rad };
}
function joyEnd() { joyActive = false; joyId = null; joyVec = { x: 0, y: 0 }; joyKnob.style.transform = 'translate(0,0)'; }
joyBase.addEventListener('pointerdown', e => { joyBase.setPointerCapture(e.pointerId); joyStart(e.clientX, e.clientY, e.pointerId); });
joyBase.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e.clientX, e.clientY); });
joyBase.addEventListener('pointerup', joyEnd);
joyBase.addEventListener('pointercancel', joyEnd);

/* ---------------- render ---------------- */
const TYPE_COLOR = { grunt: '#e8b04a', shooter: '#ff7a7a', swarmling: '#facc15', tank: '#a855f7', bomber: '#ff5470', boss: '#ff3b57' };
function worldToScreen(x, y) {
  const p = game.player;
  return { x: cw / 2 + (x - p.x) * pxPerUnit, y: ch / 2 + (y - p.y) * pxPerUnit };
}
function drawGame() {
  ctx.save(); ctx.scale(dpr, dpr);
  ctx.fillStyle = '#0a0d16'; ctx.fillRect(0, 0, cw, ch);
  const p = game.player;

  // arena floor grid (world-anchored so it visibly scrolls with the player)
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
  const gridStep = 2;
  const startX = Math.floor((p.x - 16) / gridStep) * gridStep, startY = Math.floor((p.y - 16) / gridStep) * gridStep;
  for (let gx = startX; gx <= p.x + 16; gx += gridStep) { const s = worldToScreen(gx, 0); ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, ch); ctx.stroke(); }
  for (let gy = startY; gy <= p.y + 16; gy += gridStep) { const s = worldToScreen(0, gy); ctx.beginPath(); ctx.moveTo(0, s.y); ctx.lineTo(cw, s.y); ctx.stroke(); }

  // arena bounds
  const tl = worldToScreen(-ARENA, -ARENA), br = worldToScreen(ARENA, ARENA);
  ctx.strokeStyle = 'rgba(255,90,90,.4)'; ctx.lineWidth = 3;
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

  // pickups
  for (const pk of game.pickups) {
    const s = worldToScreen(pk.x, pk.y);
    ctx.fillStyle = pk.kind === 'xp' ? '#4ade80' : '#facc15';
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
  }

  // enemy projectiles
  ctx.fillStyle = '#ff7a7a';
  for (const ep of game.enemyProjectiles) { const s = worldToScreen(ep.x, ep.y); ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill(); }
  // player projectiles
  ctx.fillStyle = '#8fd0ff';
  for (const pr of game.projectiles) { const s = worldToScreen(pr.x, pr.y); ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill(); }

  // enemies
  for (const e of game.enemies) {
    const s = worldToScreen(e.x, e.y);
    const r = (e.boss ? 22 : 11);
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = TYPE_COLOR[e.type] || '#ccc'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    const hpFrac = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(s.x - r, s.y - r - 8, r * 2, 4);
    ctx.fillStyle = '#f87171'; ctx.fillRect(s.x - r, s.y - r - 8, r * 2 * hpFrac, 4);
  }

  // player
  const ps = worldToScreen(p.x, p.y);
  ctx.beginPath(); ctx.arc(ps.x, ps.y, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#4ade80'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(D.CHARACTERS[game.character].icon, ps.x, ps.y);

  ctx.restore();
}

let hudRebuildAcc = 0;
const HUD_REBUILD_INTERVAL = 0.3;
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (screen === 'playing' && game) {
    const kv = keyboardVec();
    const ix = clamp(kv.x + joyVec.x, -1, 1), iy = clamp(kv.y + joyVec.y, -1, 1);
    game.setInput(ix, iy);
    game.tick(dt);
    const evs = game.drainEvents();
    for (const ev of evs) { if (ev.type === 'death') showEnd(); if (ev.type === 'level_up') renderLevelUp(); }
    drawGame();
    renderTopHUD();
    hudRebuildAcc += dt;
    if (hudRebuildAcc >= HUD_REBUILD_INTERVAL) { hudRebuildAcc = 0; renderWeapons(); }
  }
  requestAnimationFrame(loop);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* ---------------- boot ---------------- */
renderMenu();
resize();
requestAnimationFrame(loop);

window.__overrun = {
  game: () => game,
  screen: () => screen,
  save: () => save,
  startGame,
  setSelectedChar: k => { selectedChar = k; },
  setJoy: (x, y) => { joyVec = { x, y }; },
};
})();
