/* ============================================================================
   PROJECT NEXUS — bootstrap: menus, save system, game loop.
   ========================================================================== */
(() => {
'use strict';
const D = window.NexusData;
const S = window.NexusSim;
const UI = window.NexusUI;
const $ = id => document.getElementById(id);

const SAVES_KEY = 'gamingx.nexus.saves';
const HI_KEY = 'gamingx.hi.nexus';

let state = null;
let tickTimer = null;
let rafId = 0;
let dirty = false;
let autosaveCounter = 0;

/* ------------------------------------------------------------------ */
/* screens                                                              */
/* ------------------------------------------------------------------ */
function showScreen(id) {
  document.querySelectorAll('.nx-screen').forEach(s => s.classList.remove('active'));
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
  const entry = { id: state.saveId, name: state.meta.nationName, updated: Date.now(), data: state };
  if (i >= 0) list[i] = entry; else list.push(entry);
  writeSaves(list);
  dirty = false;
  if (!silent) UI.toast('Nation saved.', 'build');
}
function deleteSave(id) { writeSaves(loadSaves().filter(s => s.id !== id)); }
function bestScore() { try { return parseInt(localStorage.getItem(HI_KEY), 10) || 0; } catch (e) { return 0; } }
function reportScore(score) {
  if (score > bestScore()) { try { localStorage.setItem(HI_KEY, String(Math.floor(score))); } catch (e) {} }
}

/* ------------------------------------------------------------------ */
/* game loop                                                            */
/* ------------------------------------------------------------------ */
const SPEED_MS = { 1: 900, 2: 420, 3: 160 };
function setSpeed(speed) {
  state.meta.speed = speed;
  document.querySelectorAll('.nx-speed-btn').forEach(b => b.classList.toggle('on', +b.dataset.speed === speed));
  clearInterval(tickTimer);
  if (speed > 0) tickTimer = setInterval(doTick, SPEED_MS[speed]);
}
function doTick() {
  if (!state || state.events.pending) return;
  S.tick(state);
  dirty = true;
  autosaveCounter++;
  if (autosaveCounter >= 8) { autosaveCounter = 0; saveGame(true); }
  reportScore(state.score);
  UI.refresh();
}
function renderLoop() {
  rafId = requestAnimationFrame(renderLoop);
  if (state) UI.renderMap();
}

function startGameWith(newState) {
  clearInterval(tickTimer);
  state = newState;
  if (!state.saveId) state.saveId = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  autosaveCounter = 0;
  showScreen('screen-game');
  UI.init(state, onChange);
  setSpeed(state.meta.speed || 1);
  if (!rafId) renderLoop();
}
function onChange(fromAction) {
  dirty = true;
  UI.refresh();
  if (fromAction) saveGame(true);
}

/* ------------------------------------------------------------------ */
/* main menu                                                            */
/* ------------------------------------------------------------------ */
$('btn-new-nation').addEventListener('click', () => { showScreen('screen-setup'); populateSetup(); });
$('btn-continue').addEventListener('click', () => { showScreen('screen-saves'); populateSaves(); });
$('btn-howto').addEventListener('click', () => showScreen('screen-howto'));
$('btn-howto-back').addEventListener('click', () => showScreen('screen-menu'));
$('btn-setup-back').addEventListener('click', () => showScreen('screen-menu'));
$('btn-saves-back').addEventListener('click', () => showScreen('screen-menu'));

/* ------------------------------------------------------------------ */
/* setup screen                                                         */
/* ------------------------------------------------------------------ */
let setupGov = 'democracy';
function populateSetup() {
  $('setup-name').value = '';
  $('setup-seed').value = '';
  const wrap = $('setup-governments');
  wrap.innerHTML = '';
  for (const g of D.GOVERNMENTS) {
    const el = document.createElement('div');
    el.className = 'nx-gov-card' + (g.id === setupGov ? ' on' : '');
    el.innerHTML = `<b>${g.name}</b><span>${g.desc}</span>`;
    el.addEventListener('click', () => { setupGov = g.id; wrap.querySelectorAll('.nx-gov-card').forEach(c => c.classList.remove('on')); el.classList.add('on'); });
    wrap.appendChild(el);
  }
}
$('btn-random-seed').addEventListener('click', () => { $('setup-seed').value = Math.random().toString(36).slice(2, 10); });
$('btn-found').addEventListener('click', () => {
  const name = $('setup-name').value.trim() || 'Valtoria';
  const seed = $('setup-seed').value.trim() || Math.random().toString(36).slice(2, 10);
  const newState = S.newGame({ nationName: name, seed, government: setupGov });
  startGameWith(newState);
});

/* ------------------------------------------------------------------ */
/* saves screen                                                        */
/* ------------------------------------------------------------------ */
function populateSaves() {
  const list = loadSaves().sort((a, b) => b.updated - a.updated);
  const wrap = $('saves-list');
  wrap.innerHTML = list.length ? '' : '<p style="color:var(--muted)">No saved nations yet — found one from the main menu!</p>';
  for (const save of list) {
    const d = save.data;
    const row = document.createElement('div'); row.className = 'nx-save-row';
    const week = d.meta.tick % 52, year = Math.floor(d.meta.tick / 52) + 1;
    row.innerHTML = `<div class="nm">${escapeHtml(save.name)}<span class="meta">Year ${year} · Pop ${Math.round(d.stats.population)} · Score ${d.score || 0}</span></div>
      <button class="nx-btn" data-act="load">LOAD</button>
      <button class="nx-btn" data-act="del">🗑</button>`;
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
document.querySelectorAll('.nx-speed-btn').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
$('btn-cancel-build').addEventListener('click', () => UI.cancelBuild());
$('btn-menu').addEventListener('click', () => {
  clearInterval(tickTimer);
  showPauseModal();
});
function showPauseModal() {
  const box = $('modal-box');
  box.innerHTML = `<h2>PAUSED</h2>
    <div class="nx-menu-buttons">
      <button class="nx-btn nx-btn-primary" data-act="resume">▶ RESUME</button>
      <button class="nx-btn" data-act="save">💾 SAVE NATION</button>
      <button class="nx-btn" data-act="exit">🚪 SAVE &amp; EXIT TO MENU</button>
    </div>`;
  box.querySelector('[data-act="resume"]').addEventListener('click', () => { $('modal').classList.add('hidden'); setSpeed(state.meta.speed || 1); });
  box.querySelector('[data-act="save"]').addEventListener('click', () => saveGame());
  box.querySelector('[data-act="exit"]').addEventListener('click', () => {
    saveGame(true);
    clearInterval(tickTimer);
    $('modal').classList.add('hidden');
    showScreen('screen-menu');
  });
  $('modal').classList.remove('hidden');
}
$('modal').addEventListener('click', e => { if (e.target === $('modal')) { $('modal').classList.add('hidden'); setSpeed(state.meta.speed || 1); } });

addEventListener('beforeunload', () => { if (state && dirty) saveGame(true); });

showScreen('screen-menu');
})();
