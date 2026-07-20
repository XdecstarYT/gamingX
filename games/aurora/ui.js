/* ============================================================================
   AURORA — shell: menu, HUD, input (keyboard + virtual joystick), the main
   loop, persistence, and renderer selection. Owns the game core and hands the
   current state to whichever renderer is active:
     • window.AuroraGPU  — the WebGPU + GPU-compute renderer (render.js), used
       when it finished loading from the CDN and initialised successfully.
     • window.Aurora2D   — the always-available 2D canvas fallback.
   ========================================================================== */
(() => {
'use strict';
const Core = window.AuroraCore;
const $ = id => document.getElementById(id);
const SAVE_KEY = 'gamingx.aurora.save';

function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') || { best: 0, bestCombo: 0, runs: 0 }; } catch (e) { return { best: 0, bestCombo: 0, runs: 0 }; } }
function saveSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {} }
let save = loadSave();

let screen = 'menu';   // menu | playing | gameover
let game = null;
let renderer = null;
let rendererKind = 'pending';
let lastT = 0;
const keys = new Set();
let joyVec = { x: 0, y: 0 };
let boosting = false;

const canvas = $('stage');

/* ---- pick a renderer: prefer WebGPU, fall back to 2D after a short wait ---- */
function chooseRenderer() {
  if (window.AuroraGPU && window.__auroraGpuReady) {
    try { renderer = window.AuroraGPU(canvas); rendererKind = renderer.kind || 'webgpu'; }
    catch (e) { renderer = null; }
  }
  if (!renderer) { renderer = window.Aurora2D(canvas); rendererKind = '2d'; }
  renderer.resize();
  updateRendererBadge();
}
function updateRendererBadge() {
  const b = $('renderer-badge');
  if (!b) return;
  if (rendererKind === 'webgpu') b.textContent = '⚡ WebGPU + GPU compute';
  else if (rendererKind === 'webgl') b.textContent = '▲ WebGL (GPU)';
  else b.textContent = '● 2D mode';
}
window.addEventListener('resize', () => { if (renderer) renderer.resize(); });

/* ---- menu ---- */
function renderMenu() {
  screen = 'menu';
  $('overlay').classList.remove('hidden');
  $('endpanel').classList.add('hidden');
  $('menu-best').textContent = save.best;
  $('menu-combo').textContent = save.bestCombo;
}
$('btn-start').addEventListener('click', startGame);

function startGame() {
  game = new Core.Game();
  screen = 'playing';
  boosting = false; joyVec = { x: 0, y: 0 };
  $('overlay').classList.add('hidden');
  $('endpanel').classList.add('hidden');
  if (!renderer) chooseRenderer(); else renderer.resize();
  lastT = performance.now();
}

/* ---- HUD ---- */
function renderHUD() {
  if (!game) return;
  $('hud-energy-fill').style.width = Math.max(0, game.energy / game.maxEnergy * 100) + '%';
  $('hud-score').textContent = game.score.toLocaleString();
  $('hud-combo').textContent = game.combo > 1 ? '×' + game.combo : '';
  $('hud-time').textContent = fmtTime(game.time);
}
function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); }

/* ---- end screen ---- */
function showEnd() {
  screen = 'gameover';
  save.runs++;
  const isBest = game.score > save.best;
  save.best = Math.max(save.best, game.score);
  save.bestCombo = Math.max(save.bestCombo, game.bestCombo);
  saveSave(save);
  $('endpanel').classList.remove('hidden');
  $('end-title').textContent = isBest ? '🌟 NEW BEST' : '✦ RUN OVER';
  $('end-msg').innerHTML = `Score <b>${game.score.toLocaleString()}</b> · best combo ×${game.bestCombo} · survived ${fmtTime(game.time)}`
    + (isBest ? '<br>A new personal best!' : `<br>Best: ${save.best.toLocaleString()}`);
}
$('btn-retry').addEventListener('click', startGame);
$('btn-menu').addEventListener('click', renderMenu);

/* ---- input ---- */
window.addEventListener('keydown', e => { keys.add(e.key.toLowerCase()); if (e.key === ' ') boosting = true; });
window.addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); if (e.key === ' ') boosting = false; });
function keyboardVec() {
  let x = 0, y = 0;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  return { x, y };
}
/* virtual joystick */
const joyBase = $('joy-base'), joyKnob = $('joy-knob');
let joyId = null, joyCenter = { x: 0, y: 0 };
function joyRadius() { return joyBase.clientWidth / 2; }
function joyStart(x, y, id) { joyId = id; const r = joyBase.getBoundingClientRect(); joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; joyMove(x, y); }
function joyMove(x, y) {
  let dx = x - joyCenter.x, dy = y - joyCenter.y;
  const rad = joyRadius(), len = Math.hypot(dx, dy);
  if (len > rad) { dx = dx / len * rad; dy = dy / len * rad; }
  joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
  joyVec = { x: dx / rad, y: dy / rad };
}
function joyEnd() { joyId = null; joyVec = { x: 0, y: 0 }; joyKnob.style.transform = 'translate(0,0)'; }
joyBase.addEventListener('pointerdown', e => { joyBase.setPointerCapture(e.pointerId); joyStart(e.clientX, e.clientY, e.pointerId); });
joyBase.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e.clientX, e.clientY); });
joyBase.addEventListener('pointerup', joyEnd);
joyBase.addEventListener('pointercancel', joyEnd);
// tap the right half of the screen to boost (mobile)
const boostBtn = $('boost-btn');
if (boostBtn) {
  boostBtn.addEventListener('pointerdown', () => { boosting = true; });
  boostBtn.addEventListener('pointerup', () => { boosting = false; });
  boostBtn.addEventListener('pointercancel', () => { boosting = false; });
}

/* ---- main loop ---- */
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (screen === 'playing' && game) {
    const kv = keyboardVec();
    game.setInput(clamp(kv.x + joyVec.x, -1, 1), clamp(kv.y + joyVec.y, -1, 1), boosting);
    game.tick(dt);
    for (const ev of game.drainEvents()) if (ev.type === 'game_over') showEnd();
    if (renderer) renderer.draw(game, dt);
    renderHUD();
  }
  requestAnimationFrame(loop);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* ---- boot: give the WebGPU module a moment, then commit to a renderer ---- */
function boot() {
  renderMenu();
  // wait up to ~4s for the WebGPU module to signal readiness; otherwise 2D
  let waited = 0;
  (function pick() {
    if (window.__auroraGpuReady || window.__auroraGpuFailed || waited > 4000) { chooseRenderer(); return; }
    waited += 120; setTimeout(pick, 120);
  })();
  requestAnimationFrame(loop);
}
boot();

window.__aurora = {
  game: () => game, screen: () => screen, save: () => save, startGame,
  rendererKind: () => rendererKind,
};
})();
