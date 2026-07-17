/* ============================================================================
   IMPERIUM: WORLD CONQUEST — bootstrap: menus, save system, real-time loop.
   ========================================================================== */
(() => {
'use strict';
const D = window.ImpData;
const S = window.ImpSim;
const UI = window.ImpUI;
const $ = id => document.getElementById(id);

const SAVES_KEY = 'gamingx.imperium.saves';
const HI_KEY = 'gamingx.hi.imperium';
const BASE_INTERVAL = 900; // ms per tick at 1x speed

let state = null;
let rafId = 0;
let tickTimer = 0;
let dirty = false;

/* ------------------------------------------------------------------ */
/* screens                                                              */
/* ------------------------------------------------------------------ */
function showScreen(id) {
  document.querySelectorAll('.im-screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

/* ------------------------------------------------------------------ */
/* save storage                                                        */
/* ------------------------------------------------------------------ */
function loadSaves() { try { return JSON.parse(localStorage.getItem(SAVES_KEY) || '[]'); } catch (e) { return []; } }
function writeSaves(list) { try { localStorage.setItem(SAVES_KEY, JSON.stringify(list)); } catch (e) {} }
function saveGame(silent) {
  if (!state) return;
  const list = loadSaves();
  const i = list.findIndex(s => s.id === state.saveId);
  const entry = { id: state.saveId, name: D.NATIONS_BY_ID[state.playerNation].name, updated: Date.now(), data: state };
  if (i >= 0) list[i] = entry; else list.push(entry);
  writeSaves(list);
  dirty = false;
  if (!silent) UI.toast('Campaign saved.', 'info');
}
function deleteSave(id) { writeSaves(loadSaves().filter(s => s.id !== id)); }
function bestScore() { try { return parseInt(localStorage.getItem(HI_KEY), 10) || 0; } catch (e) { return 0; } }
function reportScore(score) {
  if (score > bestScore()) { try { localStorage.setItem(HI_KEY, String(Math.floor(score))); } catch (e) {} }
}

/* ------------------------------------------------------------------ */
/* game loop — real-time with a pause/1x/2x/3x speed control            */
/* ------------------------------------------------------------------ */
function stopTicking() { if (tickTimer) { clearInterval(tickTimer); tickTimer = 0; } }
function startTicking() {
  stopTicking();
  if (!state || state.gameOver || state.meta.speed === 0) return;
  tickTimer = setInterval(() => {
    S.tick(state);
    dirty = true;
    reportScore(state.score);
    UI.refresh();
    if (state.gameOver) { stopTicking(); saveGame(true); }
    else saveGame(true);
  }, BASE_INTERVAL / state.meta.speed);
}
function setSpeed(speed) {
  if (!state) return;
  state.meta.speed = speed;
  startTicking();
  UI.refresh();
}
function renderLoop() {
  rafId = requestAnimationFrame(renderLoop);
  if (state) UI.renderMap();
}

function startGameWith(newState) {
  state = newState;
  if (!state.saveId) state.saveId = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  showScreen('screen-game');
  UI.init(state, onChange);
  startTicking();
  if (!rafId) renderLoop();
}
function onChange(reason) {
  if (reason === 'gameover-exit') {
    stopTicking();
    showScreen('screen-menu');
    return;
  }
  dirty = true;
  UI.refresh();
  saveGame(true);
}

/* ------------------------------------------------------------------ */
/* main menu                                                            */
/* ------------------------------------------------------------------ */
$('btn-new-game').addEventListener('click', () => { showScreen('screen-setup'); populateSetup(); });
$('btn-continue').addEventListener('click', () => { showScreen('screen-saves'); populateSaves(); });
$('btn-howto').addEventListener('click', () => showScreen('screen-howto'));
$('btn-howto-back').addEventListener('click', () => showScreen('screen-menu'));
$('btn-setup-back').addEventListener('click', () => showScreen('screen-menu'));
$('btn-saves-back').addEventListener('click', () => showScreen('screen-menu'));

/* ------------------------------------------------------------------ */
/* setup screen                                                         */
/* ------------------------------------------------------------------ */
let setupNation = 'kalden';
let setupRivals = 5;
function populateSetup() {
  $('setup-seed').value = '';
  const rwrap = $('setup-rivals');
  rwrap.innerHTML = '';
  for (let n = 2; n <= 7; n++) {
    const btn = document.createElement('button');
    btn.className = 'im-rival-btn' + (n === setupRivals ? ' on' : '');
    btn.textContent = n;
    btn.addEventListener('click', () => { setupRivals = n; rwrap.querySelectorAll('.im-rival-btn').forEach(b => b.classList.remove('on')); btn.classList.add('on'); });
    rwrap.appendChild(btn);
  }
  const wrap = $('setup-nations');
  wrap.innerHTML = '';
  for (const n of D.NATIONS) {
    const el = document.createElement('div');
    el.className = 'im-nation-card' + (n.id === setupNation ? ' on' : '');
    el.innerHTML = `<b style="color:${n.color}">${n.name}</b><span class="motto" style="color:${n.color}">${n.motto}</span><span class="ds">${n.desc}</span>`;
    el.addEventListener('click', () => { setupNation = n.id; wrap.querySelectorAll('.im-nation-card').forEach(c => c.classList.remove('on')); el.classList.add('on'); });
    wrap.appendChild(el);
  }
}
$('btn-random-seed').addEventListener('click', () => { $('setup-seed').value = Math.random().toString(36).slice(2, 10); });
$('btn-found').addEventListener('click', () => {
  const seed = $('setup-seed').value.trim() || Math.random().toString(36).slice(2, 10);
  const newState = S.newGame({ seed, playerNation: setupNation, aiCount: setupRivals });
  startGameWith(newState);
});

/* ------------------------------------------------------------------ */
/* saves screen                                                        */
/* ------------------------------------------------------------------ */
function populateSaves() {
  const list = loadSaves().sort((a, b) => b.updated - a.updated);
  const wrap = $('saves-list');
  wrap.innerHTML = list.length ? '' : '<p style="color:var(--muted)">No saved campaigns yet — start one from the main menu!</p>';
  for (const save of list) {
    const d = save.data;
    const provCount = d.provinces.filter(p => p.owner === d.playerNation).length;
    const row = document.createElement('div'); row.className = 'im-save-row';
    row.innerHTML = `<div class="nm">${escapeHtml(save.name)}<span class="meta">Tick ${d.meta.tick} · ${provCount} provinces · Score ${d.score || 0}${d.gameOver ? ' · ' + (d.gameOver === 'win' ? 'WON' : 'LOST') : ''}</span></div>
      <button class="im-btn" data-act="load">LOAD</button>
      <button class="im-btn" data-act="del">🗑</button>`;
    row.querySelector('[data-act="load"]').addEventListener('click', () => {
      const loaded = S.migrate(JSON.parse(JSON.stringify(save.data)));
      startGameWith(loaded);
    });
    row.querySelector('[data-act="del"]').addEventListener('click', () => { deleteSave(save.id); populateSaves(); });
    wrap.appendChild(row);
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ------------------------------------------------------------------ */
/* in-game top bar controls                                             */
/* ------------------------------------------------------------------ */
document.querySelectorAll('.im-speed-btn').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));
$('btn-menu').addEventListener('click', () => showPauseModal());
function showPauseModal() {
  const box = $('modal-box');
  box.innerHTML = `<h2>PAUSED</h2>
    <div class="im-menu-buttons">
      <button class="im-btn im-btn-primary" data-act="resume">▶ RESUME</button>
      <button class="im-btn" data-act="save">💾 SAVE CAMPAIGN</button>
      <button class="im-btn" data-act="exit">🚪 SAVE &amp; EXIT TO MENU</button>
    </div>`;
  box.querySelector('[data-act="resume"]').addEventListener('click', () => { $('modal').classList.add('hidden'); });
  box.querySelector('[data-act="save"]').addEventListener('click', () => saveGame());
  box.querySelector('[data-act="exit"]').addEventListener('click', () => {
    saveGame(true);
    stopTicking();
    $('modal').classList.add('hidden');
    showScreen('screen-menu');
  });
  $('modal').classList.remove('hidden');
}
$('modal').addEventListener('click', e => { if (e.target === $('modal')) $('modal').classList.add('hidden'); });

addEventListener('beforeunload', () => { if (state && dirty) saveGame(true); });

showScreen('screen-menu');
})();
