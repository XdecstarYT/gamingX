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
let rafId = 0;
let dirty = false;

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
/* game loop — turn-based: the player advances the week explicitly     */
/* ------------------------------------------------------------------ */
function canEndTurn() { return state && !state.events.pending; }
function updateEndTurnButton() {
  const btn = $('btn-end-turn');
  const pending = state && state.events.pending;
  btn.disabled = !canEndTurn();
  btn.textContent = pending ? 'RESOLVE EVENT FIRST' : 'END TURN ▸';
}
function endTurn() {
  if (!canEndTurn()) return;
  S.tick(state);
  dirty = true;
  saveGame(true); // turn-based play autosaves every turn — no data lost on close
  reportScore(state.score);
  UI.refresh();
  updateEndTurnButton();
}
function renderLoop() {
  rafId = requestAnimationFrame(renderLoop);
  if (state) UI.renderMap();
}

/* ------------------------------------------------------------------ */
/* auto-turn — optionally auto-click End Turn so pacing isn't tedious  */
/* ------------------------------------------------------------------ */
let autoTurn = false;
let autoTimer = 0;
function setAutoTurn(on) {
  autoTurn = on;
  if (autoTurn) {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(() => {
      if (!canEndTurn()) { setAutoTurn(false); return; }
      endTurn();
      if (!canEndTurn()) setAutoTurn(false); // that turn raised an event — hand control back immediately
    }, 1100);
  } else if (autoTimer) {
    clearInterval(autoTimer); autoTimer = 0;
  }
  updateAutoTurnButton();
}
function updateAutoTurnButton() {
  const btn = $('btn-auto-turn');
  btn.classList.toggle('on', autoTurn);
  btn.textContent = autoTurn ? 'AUTO ❚❚' : 'AUTO ▶';
}
$('btn-auto-turn').addEventListener('click', () => setAutoTurn(!autoTurn));

function startGameWith(newState) {
  state = newState;
  if (!state.saveId) state.saveId = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  showScreen('screen-game');
  UI.init(state, onChange);
  setAutoTurn(false);
  updateEndTurnButton();
  if (!rafId) renderLoop();
}
function onChange(fromAction) {
  dirty = true;
  UI.refresh();
  updateEndTurnButton();
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
let setupParty = 'unity';
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
  const pwrap = $('setup-parties');
  pwrap.innerHTML = '';
  for (const p of D.PARTIES) {
    const el = document.createElement('div');
    el.className = 'nx-gov-card' + (p.id === setupParty ? ' on' : '');
    el.innerHTML = `<b style="color:${p.color}">${p.name}</b><span>${p.ideology.replace('-', ' / ')}</span>`;
    el.addEventListener('click', () => { setupParty = p.id; pwrap.querySelectorAll('.nx-gov-card').forEach(c => c.classList.remove('on')); el.classList.add('on'); });
    pwrap.appendChild(el);
  }
}
$('btn-random-seed').addEventListener('click', () => { $('setup-seed').value = Math.random().toString(36).slice(2, 10); });
$('btn-found').addEventListener('click', () => {
  const name = $('setup-name').value.trim() || 'Valtoria';
  const seed = $('setup-seed').value.trim() || Math.random().toString(36).slice(2, 10);
  const newState = S.newGame({ nationName: name, seed, government: setupGov, playerParty: setupParty });
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
$('btn-end-turn').addEventListener('click', endTurn);
$('btn-cancel-build').addEventListener('click', () => UI.cancelBuild());
$('btn-menu').addEventListener('click', () => { setAutoTurn(false); showPauseModal(); });
function showPauseModal() {
  const box = $('modal-box');
  box.innerHTML = `<h2>PAUSED</h2>
    <div class="nx-menu-buttons">
      <button class="nx-btn nx-btn-primary" data-act="resume">▶ RESUME</button>
      <button class="nx-btn" data-act="save">💾 SAVE NATION</button>
      <button class="nx-btn" data-act="exit">🚪 SAVE &amp; EXIT TO MENU</button>
    </div>`;
  box.querySelector('[data-act="resume"]').addEventListener('click', () => { $('modal').classList.add('hidden'); });
  box.querySelector('[data-act="save"]').addEventListener('click', () => saveGame());
  box.querySelector('[data-act="exit"]').addEventListener('click', () => {
    saveGame(true);
    $('modal').classList.add('hidden');
    showScreen('screen-menu');
  });
  $('modal').classList.remove('hidden');
}
$('modal').addEventListener('click', e => { if (e.target === $('modal')) $('modal').classList.add('hidden'); });

addEventListener('beforeunload', () => { if (state && dirty) saveGame(true); });

showScreen('screen-menu');
})();
