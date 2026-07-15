/* ============================================================================
   GX FORGE editor — paint levels, playtest them on GXEngine, save, publish.
   Storage:
     gamingx.forge.projects  — array of project objects
     gamingx.forge.draft     — autosaved working copy
   ========================================================================== */
(() => {
'use strict';
const E = GXEngine, T = E.T;
const $ = id => document.getElementById(id);
const CS = 26;                 // editor cell size in px
const PROJECTS_KEY = 'gamingx.forge.projects';
const DRAFT_KEY = 'gamingx.forge.draft';

const SIZES = {
  platformer: { S: [36, 14], M: [52, 14], L: [72, 16] },
  topdown:    { S: [24, 16], M: [34, 20], L: [44, 24] },
};

/* ------------------------- storage ------------------------- */
const loadProjects = () => {
  try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); } catch (e) { return []; }
};
const saveProjects = list => { try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(list)); } catch (e) {} };
const newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ------------------------- project state ------------------------- */
let P = null;             // current project
let tool = T.SOLID;
let dirty = false;
let undoStack = [];
let painting = false, paintButton = 0, strokeSnapshot = null;

function blankProject(mode, sizeKey) {
  const [w, h] = SIZES[mode][sizeKey];
  const tiles = Array.from({ length: h }, () => Array(w).fill(T.EMPTY));
  if (mode === 'platformer') {
    for (let c = 0; c < w; c++) tiles[h - 1][c] = T.SOLID;   // starter floor
  } else {
    for (let c = 0; c < w; c++) { tiles[0][c] = T.SOLID; tiles[h - 1][c] = T.SOLID; }
    for (let r = 0; r < h; r++) { tiles[r][0] = T.SOLID; tiles[r][w - 1] = T.SOLID; }
  }
  return {
    id: newId(), title: '', mode, w, h, theme: 'neon',
    requireCoins: false, tiles, published: false, updated: Date.now(),
  };
}

/* ------------------------- demo templates ------------------------- */
function demoPlatformer() {
  const p = blankProject('platformer', 'M');
  const g = p.tiles, w = p.w, h = p.h;
  const set = (c, r, id) => { if (c >= 0 && c < w && r >= 0 && r < h) g[r][c] = id; };
  // gaps in the floor
  for (const c of [12, 13, 26, 27, 28, 40, 41]) set(c, h - 1, T.EMPTY);
  set(27, h - 1, T.HAZARD); // spikes in the wide pit edge
  // platforms
  for (let c = 8; c <= 11; c++) set(c, h - 5, T.SOLID);
  for (let c = 16; c <= 19; c++) set(c, h - 7, T.SOLID);
  for (let c = 24; c <= 30; c++) set(c, h - 5, T.SOLID);
  for (let c = 34; c <= 37; c++) set(c, h - 6, T.SOLID);
  for (let c = 44; c <= 48; c++) set(c, h - 5, T.SOLID);
  // coins
  for (const [c, r] of [[9, h - 6], [10, h - 6], [17, h - 8], [18, h - 8], [26, h - 6], [28, h - 6], [35, h - 7], [45, h - 6], [47, h - 6], [21, h - 2], [22, h - 2]]) set(c, r, T.COIN);
  // hazards on ground
  for (const c of [31, 32]) set(c, h - 2, T.HAZARD);
  // enemies
  set(20, h - 2, T.WALKER);
  set(36, h - 2, T.WALKER);
  set(30, h - 9, T.FLYER);
  // bounce pad up to a bonus ledge
  set(42, h - 2, T.BOUNCE);
  for (let c = 41; c <= 43; c++) set(c, h - 9, T.SOLID);
  set(42, h - 10, T.COIN);
  set(2, h - 2, T.SPAWN);
  set(w - 3, h - 2, T.GOAL);
  p.title = 'Neon Canyon';
  p.requireCoins = false;
  return p;
}
function demoTopdown() {
  const p = blankProject('topdown', 'M');
  const g = p.tiles, w = p.w, h = p.h;
  const set = (c, r, id) => { if (c > 0 && c < w - 1 && r > 0 && r < h - 1) g[r][c] = id; };
  // inner walls
  for (let r = 4; r < h - 4; r++) set(10, r, T.SOLID);
  for (let c = 10; c < 22; c++) set(c, 4, T.SOLID);
  for (let r = 8; r < h - 2; r++) set(22, r, T.SOLID);
  for (let c = 14; c < 22; c++) set(c, 10, T.SOLID);
  set(10, 8, T.EMPTY); set(22, 12, T.EMPTY); set(17, 4, T.EMPTY); // doorways
  // hazards
  for (const [c, r] of [[6, 6], [6, 7], [26, 5], [27, 5], [13, 14], [14, 14]]) set(c, r, T.HAZARD);
  // coins
  for (const [c, r] of [[4, 3], [7, 12], [12, 7], [16, 2], [20, 8], [25, 15], [29, 3], [30, 12], [18, 13], [12, 16]]) set(c, r, T.COIN);
  // enemies
  set(15, 7, T.WALKER); set(26, 9, T.WALKER); set(18, 15, T.FLYER);
  set(2, 2, T.SPAWN);
  set(w - 3, h - 3, T.GOAL);
  p.title = 'Vault Dungeon';
  p.theme = 'candy';
  p.requireCoins = true;
  return p;
}

/* ------------------------- grid canvas ------------------------- */
const grid = $('grid');
const gctx = grid.getContext('2d');

function renderGrid() {
  grid.width = P.w * CS;
  grid.height = P.h * CS;
  // background checker
  for (let r = 0; r < P.h; r++) {
    for (let c = 0; c < P.w; c++) {
      gctx.fillStyle = (r + c) % 2 ? '#10152a' : '#0d1120';
      gctx.fillRect(c * CS, r * CS, CS, CS);
    }
  }
  // tiles
  for (let r = 0; r < P.h; r++) {
    for (let c = 0; c < P.w; c++) {
      const id = P.tiles[r][c];
      if (id) E.drawTile(gctx, id, c * CS, r * CS, CS, P.theme, 0);
    }
  }
  // grid lines
  gctx.strokeStyle = 'rgba(255,255,255,0.05)';
  gctx.lineWidth = 1;
  for (let c = 0; c <= P.w; c++) { gctx.beginPath(); gctx.moveTo(c * CS + 0.5, 0); gctx.lineTo(c * CS + 0.5, P.h * CS); gctx.stroke(); }
  for (let r = 0; r <= P.h; r++) { gctx.beginPath(); gctx.moveTo(0, r * CS + 0.5); gctx.lineTo(P.w * CS, r * CS + 0.5); gctx.stroke(); }
}

function cellFromEvent(e) {
  const rect = grid.getBoundingClientRect();
  const c = Math.floor((e.clientX - rect.left) / rect.width * P.w);
  const r = Math.floor((e.clientY - rect.top) / rect.height * P.h);
  if (c < 0 || c >= P.w || r < 0 || r >= P.h) return null;
  return { c, r };
}

function paintCell(c, r, erase) {
  const id = erase ? T.EMPTY : tool;
  if (P.tiles[r][c] === id) return;
  if (id === T.SPAWN) {
    // only one player start
    for (let rr = 0; rr < P.h; rr++) for (let cc = 0; cc < P.w; cc++) {
      if (P.tiles[rr][cc] === T.SPAWN) P.tiles[rr][cc] = T.EMPTY;
    }
  }
  P.tiles[r][c] = id;
  markDirty();
  renderGrid();
}

grid.addEventListener('contextmenu', e => e.preventDefault());
grid.addEventListener('pointerdown', e => {
  const cell = cellFromEvent(e);
  if (!cell) return;
  painting = true;
  paintButton = e.button;
  strokeSnapshot = JSON.stringify(P.tiles);
  paintCell(cell.c, cell.r, e.button === 2);
  e.preventDefault();
});
addEventListener('pointermove', e => {
  if (!painting) return;
  const cell = cellFromEvent(e);
  if (cell) paintCell(cell.c, cell.r, paintButton === 2);
});
addEventListener('pointerup', () => {
  if (painting && strokeSnapshot && strokeSnapshot !== JSON.stringify(P.tiles)) {
    undoStack.push(strokeSnapshot);
    if (undoStack.length > 40) undoStack.shift();
  }
  painting = false; strokeSnapshot = null;
});

function undo() {
  const prev = undoStack.pop();
  if (!prev) return status('Nothing to undo', true);
  P.tiles = JSON.parse(prev);
  markDirty();
  renderGrid();
  status('Undone');
}
addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { undo(); e.preventDefault(); }
});
$('btn-undo').addEventListener('click', undo);
$('btn-clear').addEventListener('click', () => {
  undoStack.push(JSON.stringify(P.tiles));
  const fresh = blankProject(P.mode, 'S');
  // keep dimensions, just reset tiles like a blank of same size
  P.tiles = Array.from({ length: P.h }, () => Array(P.w).fill(T.EMPTY));
  if (P.mode === 'platformer') for (let c = 0; c < P.w; c++) P.tiles[P.h - 1][c] = T.SOLID;
  else {
    for (let c = 0; c < P.w; c++) { P.tiles[0][c] = T.SOLID; P.tiles[P.h - 1][c] = T.SOLID; }
    for (let r = 0; r < P.h; r++) { P.tiles[r][0] = T.SOLID; P.tiles[r][P.w - 1] = T.SOLID; }
  }
  markDirty(); renderGrid();
  void fresh;
});

/* ------------------------- palette ------------------------- */
const TOOLS = [
  { id: -1, label: 'ERASER' },
  { id: T.SOLID }, { id: T.HAZARD }, { id: T.COIN }, { id: T.GOAL },
  { id: T.SPAWN }, { id: T.WALKER }, { id: T.FLYER }, { id: T.BOUNCE },
];
function buildPalette() {
  const pal = $('palette');
  pal.querySelectorAll('.fg-tool').forEach(n => n.remove());
  for (const tl of TOOLS) {
    const b = document.createElement('button');
    b.className = 'fg-tool' + ((tl.id === tool) ? ' on' : '');
    const cv = document.createElement('canvas');
    cv.width = cv.height = 34;
    const c2 = cv.getContext('2d');
    if (tl.id === -1) {
      c2.strokeStyle = '#8b93ad'; c2.lineWidth = 3;
      c2.beginPath(); c2.moveTo(8, 8); c2.lineTo(26, 26); c2.moveTo(26, 8); c2.lineTo(8, 26); c2.stroke();
    } else {
      E.drawTile(c2, tl.id, 1, 1, 32, P ? P.theme : 'neon', 0.4);
    }
    const sp = document.createElement('span');
    sp.textContent = tl.label || E.TILE_NAMES[tl.id].toUpperCase();
    b.append(cv, sp);
    b.addEventListener('click', () => {
      tool = tl.id === -1 ? T.EMPTY : tl.id;
      pal.querySelectorAll('.fg-tool').forEach(n => n.classList.remove('on'));
      b.classList.add('on');
    });
    // fix: eraser selects EMPTY, mark correct initial
    if ((tl.id === -1 && tool === T.EMPTY) || tl.id === tool) b.classList.add('on');
    else b.classList.remove('on');
    pal.appendChild(b);
  }
}

/* ------------------------- settings panel ------------------------- */
function buildSwatches() {
  const wrap = $('swatches');
  wrap.innerHTML = '';
  for (const key of Object.keys(E.THEMES)) {
    const th = E.THEMES[key];
    const b = document.createElement('button');
    b.className = 'fg-swatch' + (P.theme === key ? ' on' : '');
    b.title = key;
    b.style.background = `linear-gradient(135deg, ${th.bg2} 40%, ${th.tile})`;
    b.addEventListener('click', () => {
      P.theme = key;
      markDirty();
      buildSwatches(); buildPalette(); renderGrid();
    });
    wrap.appendChild(b);
  }
}
function syncPanel() {
  $('title-input').value = P.title;
  $('mode-label').textContent = P.mode === 'platformer' ? 'Platformer (gravity + jump)' : 'Top-down (free move)';
  $('size-label').textContent = P.w + ' × ' + P.h;
  $('require-coins').checked = !!P.requireCoins;
  buildSwatches();
  buildPalette();
}
$('title-input').addEventListener('input', e => { P.title = e.target.value; markDirty(); });
$('require-coins').addEventListener('change', e => { P.requireCoins = e.target.checked; markDirty(); });

/* ------------------------- status + autosave ------------------------- */
let statusTimer = 0;
function status(msg, err) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('err', !!err);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; }, 3500);
}
let autosaveTimer = 0;
function markDirty() {
  dirty = true;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(P)); } catch (e) {}
  }, 400);
}

/* ------------------------- save / publish ------------------------- */
function saveProject(silent) {
  P.updated = Date.now();
  const list = loadProjects();
  const i = list.findIndex(x => x.id === P.id);
  if (i >= 0) list[i] = P; else list.push(P);
  saveProjects(list);
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(P)); } catch (e) {}
  dirty = false;
  if (!silent) status('Saved ✓');
}
$('btn-save').addEventListener('click', () => saveProject());

$('btn-publish').addEventListener('click', () => {
  const issues = E.validate(P);
  if (issues.length) return modal(`<h2>NOT READY YET</h2><p>${issues.join('<br>')}</p>
    <div class="fg-modal-buttons"><button class="fg-btn" data-x>OK</button></div>`);
  if (!P.title.trim()) P.title = 'Untitled Game';
  P.published = true;
  saveProject(true);
  syncPanel();
  modal(`<h2>🚀 PUBLISHED!</h2>
    <p><b>${esc(P.title)}</b> is now live in <b>My Creations</b> on your GamingX hub. Anyone on this browser can play it.</p>
    <div class="fg-modal-buttons">
      <button class="fg-btn fg-btn-primary" data-act="play">▶ PLAY IT</button>
      <button class="fg-btn" data-act="hub">GO TO HUB</button>
      <button class="fg-btn" data-x>KEEP EDITING</button>
    </div>`, act => {
    if (act === 'play') location.href = 'play.html?id=' + P.id;
    if (act === 'hub') location.href = '../../index.html#creations';
  });
});

/* ------------------------- playtest ------------------------- */
const playOverlay = $('play-overlay');
const playCanvas = $('play-canvas');
let running = null;

function startTest() {
  const issues = E.validate(P);
  if (issues.length) return modal(`<h2>CAN'T PLAYTEST</h2><p>${issues.join('<br>')}</p>
    <div class="fg-modal-buttons"><button class="fg-btn" data-x>OK</button></div>`);
  saveProject(true);
  playOverlay.classList.remove('hidden');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  playCanvas.width = innerWidth * dpr;
  playCanvas.height = innerHeight * dpr;
  $('play-label').textContent = 'PLAYTEST — ' + (P.title || 'Untitled');
  running = E.run(playCanvas, P, {
    onEnd(res) {
      running = null;
      $('play-label').textContent = (res.won ? `CLEAR! Score ${res.score}` : 'GAME OVER') + ' — press Esc';
      setTimeout(stopTest, 1400);
    },
  });
}
function stopTest() {
  if (running) { running.stop(); running = null; }
  playOverlay.classList.add('hidden');
}
$('btn-test').addEventListener('click', startTest);
$('btn-stop-test').addEventListener('click', stopTest);
addEventListener('keydown', e => {
  if (e.code === 'Escape' && !playOverlay.classList.contains('hidden')) stopTest();
});

/* ------------------------- modal helper ------------------------- */
function modal(html, onAct) {
  const m = $('modal'), box = $('modal-box');
  box.innerHTML = html;
  m.classList.remove('hidden');
  box.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => m.classList.add('hidden')));
  box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    m.classList.add('hidden');
    onAct && onAct(b.dataset.act, b);
  }));
  return box;
}
$('modal').addEventListener('click', e => { if (e.target === $('modal')) $('modal').classList.add('hidden'); });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------- new game modal ------------------------- */
$('btn-new').addEventListener('click', () => showNewModal());
function showNewModal() {
  let mode = 'platformer', size = 'M', tpl = 'blank';
  const box = modal(`<h2>✚ NEW GAME</h2>
    <p>MODE</p>
    <div class="fg-opt-row" id="nm-mode">
      <button class="fg-opt on" data-v="platformer">PLATFORMER<small>gravity, jumping, stomping</small></button>
      <button class="fg-opt" data-v="topdown">TOP-DOWN<small>free movement, dungeons</small></button>
    </div>
    <p>SIZE</p>
    <div class="fg-opt-row" id="nm-size">
      <button class="fg-opt" data-v="S">SMALL</button>
      <button class="fg-opt on" data-v="M">MEDIUM</button>
      <button class="fg-opt" data-v="L">LARGE</button>
    </div>
    <p>START FROM</p>
    <div class="fg-opt-row" id="nm-tpl">
      <button class="fg-opt on" data-v="blank">BLANK<small>empty canvas</small></button>
      <button class="fg-opt" data-v="demo">DEMO LEVEL<small>learn by remixing</small></button>
    </div>
    <div class="fg-modal-buttons">
      <button class="fg-btn fg-btn-primary" data-act="create">CREATE</button>
      <button class="fg-btn" data-x>CANCEL</button>
    </div>`, act => {
    if (act !== 'create') return;
    if (tpl === 'demo') P = mode === 'platformer' ? demoPlatformer() : demoTopdown();
    else P = blankProject(mode, size);
    undoStack = [];
    syncPanel(); renderGrid();
    saveProject(true);
    status('New game created');
  });
  const wire = (id, fn) => box.querySelector(id).querySelectorAll('.fg-opt').forEach(b =>
    b.addEventListener('click', () => {
      b.parentElement.querySelectorAll('.fg-opt').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      fn(b.dataset.v);
    }));
  wire('#nm-mode', v => mode = v);
  wire('#nm-size', v => size = v);
  wire('#nm-tpl', v => tpl = v);
}

/* ------------------------- my games modal ------------------------- */
$('btn-mygames').addEventListener('click', () => {
  const list = loadProjects().sort((a, b) => b.updated - a.updated);
  const rows = list.length ? list.map(p => `
    <div class="fg-game-row">
      <div class="name">${esc(p.title || 'Untitled')} <span class="meta">· ${p.mode} · ${p.w}×${p.h}</span>
        ${p.published ? '<span class="meta pub"> · PUBLISHED</span>' : ''}</div>
      <button class="fg-btn" data-act="open" data-id="${p.id}">OPEN</button>
      <button class="fg-btn" data-act="del" data-id="${p.id}">🗑</button>
    </div>`).join('') : '<p>No saved games yet. Hit <b>New</b> and start building!</p>';
  modal(`<h2>📁 MY GAMES</h2>${rows}
    <div class="fg-modal-buttons"><button class="fg-btn" data-x>CLOSE</button></div>`, (act, btn) => {
    const id = btn.dataset.id;
    if (act === 'open') {
      const p = loadProjects().find(x => x.id === id);
      if (p) { P = p; undoStack = []; syncPanel(); renderGrid(); status('Loaded “' + (p.title || 'Untitled') + '”'); }
    } else if (act === 'del') {
      saveProjects(loadProjects().filter(x => x.id !== id));
      status('Deleted');
    }
  });
});

/* ------------------------- share (export / import) ------------------------- */
$('btn-share').addEventListener('click', () => {
  const json = JSON.stringify(P);
  const box = modal(`<h2>⇄ SHARE GAME</h2>
    <p>Copy this code to share your game, or paste a friend's code below and hit Import.</p>
    <textarea class="fg-textarea" id="share-ta">${esc(json)}</textarea>
    <div class="fg-modal-buttons">
      <button class="fg-btn fg-btn-primary" data-act="copy">COPY CODE</button>
      <button class="fg-btn fg-btn-accent" data-act="import">IMPORT FROM CODE</button>
      <button class="fg-btn" data-x>CLOSE</button>
    </div>`, act => {
    const ta = document.getElementById('share-ta');
    if (act === 'copy') {
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      navigator.clipboard && navigator.clipboard.writeText(ta.value).catch(() => {});
      status('Copied to clipboard');
    } else if (act === 'import') {
      try {
        const p = JSON.parse(ta.value);
        if (!p.tiles || !p.w || !p.h || !Array.isArray(p.tiles)) throw new Error('bad');
        p.id = newId();
        p.published = false;
        P = p;
        undoStack = [];
        syncPanel(); renderGrid(); saveProject(true);
        status('Imported ✓');
      } catch (e) {
        status('Invalid game code', true);
      }
    }
  });
  // keep modal open on copy: re-show quickly is complex; simpler: copy closes modal, acceptable
  void box;
});

/* ------------------------- boot ------------------------- */
function boot() {
  const params = new URLSearchParams(location.search);
  const loadId = params.get('load');
  const tpl = params.get('template');
  if (loadId) {
    P = loadProjects().find(x => x.id === loadId) || null;
  }
  if (!P && tpl === 'platformer') P = demoPlatformer();
  if (!P && tpl === 'topdown') P = demoTopdown();
  if (!P) {
    try { P = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { P = null; }
    if (P && (!P.tiles || !P.w)) P = null;
  }
  if (!P) P = demoPlatformer();   // first visit: open the demo so there's something to play with
  syncPanel();
  renderGrid();
}
boot();
})();
