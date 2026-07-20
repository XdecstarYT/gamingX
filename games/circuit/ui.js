/* ============================================================================
   TURBO CIRCUIT — canvas rendering, input (keyboard + touch pedals/steer),
   career/quick-race menus, garage/tuning shop, and persistence.
   ========================================================================== */
(() => {
'use strict';
const D = window.CIRCUIT_DATA;
const { Game } = window.CircuitEngine;
const $ = id => document.getElementById(id);
const SAVE_KEY = 'gamingx.circuit.save';

/* ---------------- persistence ---------------- */
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s) return s;
  } catch (e) {}
  return {
    coins: 200, unlockedVehicles: ['scamp'], unlockedCups: ['rookie'],
    tuning: { scamp: { engine: 0, handling: 0, boost: 0 } },
    cupPoints: {}, bestLap: {},
  };
}
function saveSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {} }
let save = loadSave();
function vehicleTuning(key) { if (!save.tuning[key]) save.tuning[key] = { engine: 0, handling: 0, boost: 0 }; return save.tuning[key]; }

/* ---------------- state ---------------- */
let screen = 'menu'; // menu | garage | career | playing | gameover
let game = null;
let selectedVehicle = save.unlockedVehicles[0] || 'scamp';
let raceMode = 'quick'; // 'quick' | 'career'
let raceTrackKey = D.TRACK_ORDER[0];
let raceCupCtx = null; // { cupId, trackIdx, totalPoints }
let lastT = 0;
const keys = new Set();
let touchSteer = 0, touchAccel = 0, touchBrake = false, touchDrift = false;

const canvas = $('stage');
const ctx = canvas.getContext('2d');
let dpr = 1, cw = 0, ch = 0, pxPerUnit = 12;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wrap = $('stage-wrap');
  cw = wrap.clientWidth; ch = wrap.clientHeight;
  canvas.width = cw * dpr; canvas.height = ch * dpr;
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  pxPerUnit = Math.max(8, Math.min(cw, ch) / 44);
}
window.addEventListener('resize', resize);

/* ---------------- main menu ---------------- */
function renderMenu() {
  screen = 'menu';
  $('overlay').classList.remove('hidden');
  $('menu-view').classList.remove('hidden');
  $('garage-view').classList.add('hidden');
  $('career-view').classList.add('hidden');
  $('endpanel').classList.add('hidden');
  $('cc-coins').textContent = '🪙 ' + save.coins;
  const html = D.TRACK_ORDER.map(key => {
    const t = D.TRACKS[key];
    const best = save.bestLap[key];
    return `<div class="cc-trackcard${raceTrackKey === key ? ' on' : ''}" data-track="${key}">
      <div class="cc-trackicon">${t.icon}</div>
      <div class="cc-trackname">${t.name}</div>
      <div class="cc-trackmeta">${t.laps} laps</div>
      ${best ? `<div class="cc-trackbest">Best: ${fmtTime(best)}</div>` : ''}
    </div>`;
  }).join('');
  $('menu-tracks').innerHTML = html;
  $('menu-tracks').querySelectorAll('[data-track]').forEach(el => el.addEventListener('click', () => { raceTrackKey = el.dataset.track; renderMenu(); }));
}
$('btn-quick-race').addEventListener('click', () => { raceMode = 'quick'; startRace(raceTrackKey); });
$('btn-garage').addEventListener('click', renderGarage);
$('btn-career').addEventListener('click', renderCareer);
$('btn-garage-back').addEventListener('click', renderMenu);
$('btn-career-back').addEventListener('click', renderMenu);

/* ---------------- garage (vehicle select + tuning) ---------------- */
function renderGarage() {
  screen = 'garage';
  $('menu-view').classList.add('hidden');
  $('garage-view').classList.remove('hidden');
  $('gg-coins').textContent = '🪙 ' + save.coins;
  const html = D.VEHICLE_ORDER.map(key => {
    const v = D.VEHICLES[key];
    const owned = save.unlockedVehicles.includes(key);
    return `<div class="cc-vcard${selectedVehicle === key ? ' on' : ''}${owned ? '' : ' locked'}" data-veh="${key}">
      <div class="cc-vicon" style="background:${v.color}">${v.icon}</div>
      <div class="cc-vname">${v.name}</div>
      <div class="cc-vdesc">${v.desc}</div>
      ${owned ? '' : `<div class="cc-vcost">🪙 ${v.cost}</div>`}
    </div>`;
  }).join('');
  $('garage-vehicles').innerHTML = html;
  $('garage-vehicles').querySelectorAll('[data-veh]').forEach(el => el.addEventListener('click', () => {
    const key = el.dataset.veh;
    if (save.unlockedVehicles.includes(key)) { selectedVehicle = key; renderGarage(); return; }
    const v = D.VEHICLES[key];
    if (save.coins >= v.cost) { save.coins -= v.cost; save.unlockedVehicles.push(key); selectedVehicle = key; saveSave(save); renderGarage(); }
  }));

  const tuning = vehicleTuning(selectedVehicle);
  const tuneHtml = Object.keys(D.TUNING).map(cat => {
    const def = D.TUNING[cat], level = tuning[cat] || 0, maxed = level >= def.maxLevel;
    const cost = maxed ? 0 : D.tuningCost(cat, level);
    return `<div class="cc-tunerow">
      <div class="ic">${def.icon}</div>
      <div class="info"><b>${def.name}</b><span>${def.desc} · Lv ${level}/${def.maxLevel}</span></div>
      <button data-tune="${cat}" ${maxed || save.coins < cost ? 'disabled' : ''}>${maxed ? 'MAX' : '🪙 ' + cost}</button>
    </div>`;
  }).join('');
  $('garage-tuning').innerHTML = tuneHtml;
  $('garage-tuning').querySelectorAll('[data-tune]').forEach(b => b.addEventListener('click', () => {
    const cat = b.dataset.tune, t = vehicleTuning(selectedVehicle), level = t[cat] || 0;
    if (level >= D.TUNING[cat].maxLevel) return;
    const cost = D.tuningCost(cat, level);
    if (save.coins < cost) return;
    save.coins -= cost; t[cat] = level + 1; saveSave(save);
    renderGarage();
  }));
}

/* ---------------- career ---------------- */
function renderCareer() {
  screen = 'career';
  $('menu-view').classList.add('hidden');
  $('career-view').classList.remove('hidden');
  const html = D.CUPS.map(cup => {
    const unlocked = save.unlockedCups.includes(cup.id);
    const pts = save.cupPoints[cup.id] || {};
    const totalYou = pts.player || 0;
    return `<div class="cc-cupcard${unlocked ? '' : ' locked'}">
      <div class="cc-cupicon">${cup.icon}</div>
      <div class="cc-cupname">${cup.name}</div>
      <div class="cc-cuptracks">${cup.tracks.map(tk => `<button class="cc-cuptrack" data-cup="${cup.id}" data-track="${tk}" ${unlocked ? '' : 'disabled'}>${D.TRACKS[tk].icon} ${D.TRACKS[tk].name}</button>`).join('')}</div>
      <div class="cc-cuppts">Your points: ${totalYou}</div>
    </div>`;
  }).join('');
  $('career-cups').innerHTML = html;
  $('career-cups').querySelectorAll('.cc-cuptrack').forEach(b => b.addEventListener('click', () => {
    raceMode = 'career';
    raceCupCtx = { cupId: b.dataset.cup };
    startRace(b.dataset.track);
  }));
}

function startRace(trackKey) {
  game = new Game(trackKey, { mode: raceMode, vehicle: selectedVehicle, tuning: vehicleTuning(selectedVehicle), aiCount: 4 });
  screen = 'playing';
  $('overlay').classList.add('hidden');
  $('endpanel').classList.add('hidden');
  resize();
  lastT = performance.now();
  requestAnimationFrame(loop);
}

/* ---------------- HUD ---------------- */
function fmtTime(t) { const m = Math.floor(t / 60), s = (t % 60).toFixed(2); return m + ':' + String(s).padStart(5, '0'); }
function renderHUD() {
  if (!game) return;
  $('cc-lap').textContent = 'LAP ' + Math.min(game.laps, game.player.lap + 1) + '/' + game.laps;
  const standings = game.standings();
  const pos = standings.findIndex(k => k.isPlayer) + 1;
  $('cc-pos').textContent = ordinal(pos) + ' / ' + standings.length;
  $('cc-speed').textContent = Math.max(0, Math.round(game.player.speed * 8)) + ' km/h';
  $('cc-boost-fill').style.width = (game.player.driftCharge * 100) + '%';
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

/* ---------------- end screen ---------------- */
function showEnd() {
  screen = 'gameover';
  const r = game.playerResult;
  save.coins += r.coins;
  if (!save.bestLap[game.trackKey] || game.time < save.bestLap[game.trackKey]) save.bestLap[game.trackKey] = game.time;
  let cupAdvance = null;
  if (game.mode === 'career' && raceCupCtx) {
    const cupId = raceCupCtx.cupId;
    save.cupPoints[cupId] = save.cupPoints[cupId] || { player: 0 };
    save.cupPoints[cupId].player += r.points;
    const cupIdx = D.CUPS.findIndex(c => c.id === cupId);
    const nextCup = D.CUPS[cupIdx + 1];
    if (nextCup && r.position <= 3 && !save.unlockedCups.includes(nextCup.id)) {
      save.unlockedCups.push(nextCup.id);
      cupAdvance = nextCup;
    }
  }
  saveSave(save);
  $('endpanel').classList.remove('hidden');
  $('end-title').textContent = r.position === 1 ? '🏆 1ST PLACE!' : ordinal(r.position).toUpperCase() + ' PLACE';
  $('end-msg').innerHTML = `Finished in ${fmtTime(game.time)} · +${r.coins} 🪙`
    + (game.mode === 'career' ? ` · +${r.points} cup points` : '')
    + (cupAdvance ? `<br>🎉 Unlocked ${cupAdvance.name}!` : '');
}
$('btn-end-retry').addEventListener('click', () => startRace(game.trackKey));
$('btn-end-menu').addEventListener('click', () => { screen = 'menu'; renderMenu(); });

/* ---------------- input ---------------- */
window.addEventListener('keydown', e => { keys.add(e.key.toLowerCase()); });
window.addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); });
function keyboardControls() {
  let steer = 0, accel = 0, drift = false;
  if (keys.has('a') || keys.has('arrowleft')) steer -= 1;
  if (keys.has('d') || keys.has('arrowright')) steer += 1;
  if (keys.has('w') || keys.has('arrowup')) accel += 1;
  if (keys.has('s') || keys.has('arrowdown')) accel -= 1;
  if (keys.has(' ') || keys.has('shift')) drift = true;
  return { steer, accel, drift };
}
/* touch controls: steer wheel + accel/brake pedals + drift button */
function bindHold(el, onDown, onUp) {
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); onDown(e); });
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}
bindHold($('btn-accel'), () => { touchAccel = 1; }, () => { touchAccel = touchBrake ? -1 : 0; });
bindHold($('btn-brake'), () => { touchBrake = true; touchAccel = -1; }, () => { touchBrake = false; touchAccel = 0; });
bindHold($('btn-drift'), () => { touchDrift = true; }, () => { touchDrift = false; });
const steerWheel = $('steer-wheel');
let steerActive = false, steerId = null;
function steerFromEvent(clientX) {
  const r = steerWheel.getBoundingClientRect();
  const rel = (clientX - r.left) / r.width * 2 - 1;
  touchSteer = Math.max(-1, Math.min(1, rel));
}
steerWheel.addEventListener('pointerdown', e => { steerWheel.setPointerCapture(e.pointerId); steerActive = true; steerId = e.pointerId; steerFromEvent(e.clientX); });
steerWheel.addEventListener('pointermove', e => { if (steerActive && e.pointerId === steerId) steerFromEvent(e.clientX); });
steerWheel.addEventListener('pointerup', () => { steerActive = false; touchSteer = 0; });
steerWheel.addEventListener('pointercancel', () => { steerActive = false; touchSteer = 0; });

/* ---------------- render ---------------- */
function worldToScreen(x, y, camX, camY) { return { x: cw / 2 + (x - camX) * pxPerUnit, y: ch / 2 + (y - camY) * pxPerUnit }; }
function drawGame() {
  ctx.save(); ctx.scale(dpr, dpr);
  ctx.fillStyle = '#1a2e1a'; ctx.fillRect(0, 0, cw, ch);
  const p = game.player;
  const camX = p.x, camY = p.y;

  // track surface (thick line following the loop) + centerline
  const loop = game.loop;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = '#3a3f4a'; ctx.lineWidth = game.track.width * 2 * pxPerUnit;
  ctx.beginPath();
  loop.forEach((wp, i) => { const s = worldToScreen(wp[0], wp[1], camX, camY); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
  const s0 = worldToScreen(loop[0][0], loop[0][1], camX, camY); ctx.lineTo(s0.x, s0.y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2; ctx.setLineDash([8, 10]);
  ctx.beginPath();
  loop.forEach((wp, i) => { const s = worldToScreen(wp[0], wp[1], camX, camY); if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); });
  ctx.lineTo(s0.x, s0.y); ctx.stroke(); ctx.setLineDash([]);

  // start/finish line
  const sf = worldToScreen(loop[0][0], loop[0][1], camX, camY);
  ctx.fillStyle = '#fff'; ctx.fillRect(sf.x - 3, sf.y - game.track.width * pxPerUnit, 6, game.track.width * 2 * pxPerUnit);

  // karts
  for (const k of game.karts) {
    const s = worldToScreen(k.x, k.y, camX, camY);
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(k.angle);
    ctx.fillStyle = D.VEHICLES[k.vehicleKey].color;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-7, 6); ctx.lineTo(-7, -6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = k.isPlayer ? '#fff' : 'rgba(0,0,0,.4)'; ctx.lineWidth = k.isPlayer ? 2 : 1; ctx.stroke();
    ctx.restore();
    if (k.boostTimer > 0) { ctx.fillStyle = 'rgba(255,180,60,.6)'; ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

let hudAcc = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (screen === 'playing' && game) {
    const kb = keyboardControls();
    const steer = clamp(kb.steer + touchSteer, -1, 1);
    const accel = kb.accel !== 0 ? kb.accel : touchAccel;
    const drift = kb.drift || touchDrift;
    game.setPlayerInput(steer, accel, drift);
    game.tick(dt);
    const evs = game.drainEvents();
    for (const ev of evs) if (ev.type === 'race_over') showEnd();
    drawGame();
    hudAcc += dt;
    if (hudAcc >= 0.05) { hudAcc = 0; renderHUD(); }
  }
  requestAnimationFrame(loop);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* ---------------- boot ---------------- */
renderMenu();
resize();
requestAnimationFrame(loop);

window.__circuit = {
  game: () => game,
  screen: () => screen,
  save: () => save,
  startRace,
  setSelectedVehicle: k => { selectedVehicle = k; },
  setSteer: v => { touchSteer = v; },
  setAccel: v => { touchAccel = v; },
};
})();
