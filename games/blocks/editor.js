/* ============================================================================
   GX BLOCKS editor — sprites, the visual block script builder, stage and
   play/stop. Drives engine.js with the GamX Lite block model (blockdefs.js).
   ========================================================================== */
(() => {
'use strict';
const GB = window.GXBlocks, EN = window.GXBlocksEngine;
const $ = id => document.getElementById(id);
const PROJECTS_KEY = 'gamingx.blocks.projects', DRAFT_KEY = 'gamingx.blocks.draft';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let project = null, engine = null, selId = null, playing = false, hudTimer = 0;

/* ------------------------------------------------------------------ */
/* mobile drawers — see games/studio/studio.css for the same pattern +   */
/* rationale (side panels don't fit next to the stage on a phone).       */
/* ------------------------------------------------------------------ */
const MOBILE_BP = 760;
function isMobileLayout() { return window.innerWidth <= MOBILE_BP; }
function setDrawer(which, open) {
  const el = document.querySelector(which === 'left' ? '.bl-left' : '.bl-right');
  if (el) el.classList.toggle('open', open);
  const scrim = $('bl-scrim');
  if (scrim) scrim.classList.toggle('show', !!document.querySelector('.bl-left.open,.bl-right.open'));
}
(() => {
  const hBtn = $('btn-drawer-left'), rBtn = $('btn-drawer-right'), scrim = $('bl-scrim');
  if (hBtn) hBtn.addEventListener('click', () => setDrawer('left', !document.querySelector('.bl-left').classList.contains('open')));
  if (rBtn) rBtn.addEventListener('click', () => setDrawer('right', !document.querySelector('.bl-right').classList.contains('open')));
  if (scrim) scrim.addEventListener('click', () => { setDrawer('left', false); setDrawer('right', false); });
})();

/* ------------------------------------------------------------------ */
/* templates                                                          */
/* ------------------------------------------------------------------ */
function starterProject() {
  const p = EN.newProject('My First Game');
  const hero = EN.newSprite('Hero'); hero.color = '#4c97ff'; hero.x = -120; hero.y = 0;
  hero.scripts = [
    { id: sid(), hat: 'start', body: [mk('say', { text: 'Catch the coin!' }), mk('setColor', { color: '#4c97ff' })] },
    { id: sid(), hat: 'key', key: 'Right', body: [mk('changeX', { n: 5 })] },
    { id: sid(), hat: 'key', key: 'Left', body: [mk('changeX', { n: -5 })] },
    { id: sid(), hat: 'key', key: 'Up', body: [mk('changeY', { n: 5 })] },
    { id: sid(), hat: 'key', key: 'Down', body: [mk('changeY', { n: -5 })] },
  ];
  const coin = EN.newSprite('Coin'); coin.color = '#f5b301'; coin.size = 28; coin.x = 130; coin.y = 60;
  const ifTouch = mk('if'); ifTouch.inputs.cond = { kind: 'touching', target: 'Hero' };
  ifTouch.body = [mk('addScore', { n: 1 }), mk('say', { text: 'Nice!' }), mk('win')];
  coin.scripts = [{ id: sid(), hat: 'frame', body: [ifTouch] }];
  p.sprites = [hero, coin];
  return p;
}
const sid = () => 's' + Math.random().toString(36).slice(2, 7);
function mk(type, inputs) { const b = GB.newBlock(type); if (inputs) Object.assign(b.inputs, inputs); return b; }

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */
function boot() {
  const params = new URLSearchParams(location.search);
  const id = params.get('load');
  if (id) project = loadProjects().find(p => p.id === id) || null;
  if (!project) { try { project = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) {} if (project && !project.sprites) project = null; }
  if (!project) project = starterProject();
  $('title-input').value = project.title || '';
  engine = new EN.Engine(project, { canvas: $('stage'), onEnd: onEnd, onLog: () => {}, selectedId: null });
  selId = project.sprites[0] ? project.sprites[0].id : null;
  bindStage();
  renderAll();
  loop();
}
function loop() {
  requestAnimationFrame(loop);
  engine.opts.selectedId = selId;
  if (playing) engine.step();
  engine.render();
}
function renderAll() { renderSprites(); renderProps(); renderScripts(); }

/* ------------------------------------------------------------------ */
/* sprites panel                                                      */
/* ------------------------------------------------------------------ */
function selSprite() { return project.sprites.find(s => s.id === selId) || null; }
function renderSprites() {
  const root = $('sprite-list'); root.innerHTML = '';
  project.sprites.forEach(sp => {
    const el = document.createElement('div'); el.className = 'bl-sprite' + (sp.id === selId ? ' on' : '');
    el.innerHTML = `<span class="dot ${sp.shape}" style="background:${sp.color}"></span><span class="nm">${esc(sp.name)}</span><button class="del" title="Delete">✕</button>`;
    el.addEventListener('click', e => {
      if (e.target.classList.contains('del')) return;
      selId = sp.id; renderAll();
      // on a phone, picking a sprite in the (drawer) sprite list should jump
      // straight to its scripts instead of leaving you to hunt for a button
      if (isMobileLayout()) { setDrawer('left', false); setDrawer('right', true); }
    });
    el.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); if (project.sprites.length <= 1) return toast('Keep at least one sprite'); project.sprites = project.sprites.filter(x => x.id !== sp.id); if (selId === sp.id) selId = project.sprites[0].id; engine.reset(); renderAll(); markDirty(); });
    root.appendChild(el);
  });
}
$('btn-add-sprite').addEventListener('click', () => {
  const sp = EN.newSprite('Sprite ' + (project.sprites.length + 1));
  sp.color = ['#ff5470', '#46c46a', '#9966ff', '#f5b301', '#22d3ee'][project.sprites.length % 5];
  sp.x = (Math.random() * 200 - 100) | 0; sp.y = (Math.random() * 120 - 60) | 0;
  project.sprites.push(sp); selId = sp.id; engine.reset(); renderAll(); markDirty();
});

function renderProps() {
  const sp = selSprite(); const panel = $('sprite-props');
  if (!sp) { panel.innerHTML = ''; return; }
  panel.innerHTML = `
    <div class="row"><label>NAME</label><input id="p-name" value="${esc(sp.name)}" maxlength="16"></div>
    <div class="row"><label>SHAPE</label><select id="p-shape"><option value="circle"${sp.shape === 'circle' ? ' selected' : ''}>circle</option><option value="square"${sp.shape === 'square' ? ' selected' : ''}>square</option></select></div>
    <div class="row"><label>COLOUR</label><input type="color" id="p-color" value="${sp.color}"></div>
    <div class="row"><label>SIZE</label><input type="number" id="p-size" value="${sp.size}" min="4" max="400"></div>
    <div class="row"><label>START X / Y</label><div class="r2"><input type="number" id="p-x" value="${Math.round(sp.x)}"><input type="number" id="p-y" value="${Math.round(sp.y)}"></div></div>`;
  const bind = (id, fn) => { const el = $(id); el.addEventListener('input', () => { fn(el.value); engine.reset(); if (id === 'p-name') renderSprites(); markDirty(); }); };
  bind('p-name', v => { sp.name = v; });
  bind('p-shape', v => { sp.shape = v; });
  bind('p-color', v => { sp.color = v; renderSprites(); });
  bind('p-size', v => { sp.size = Math.max(4, Math.min(400, +v || 40)); });
  bind('p-x', v => { sp.x = +v || 0; });
  bind('p-y', v => { sp.y = +v || 0; });
}

/* ------------------------------------------------------------------ */
/* script builder                                                     */
/* ------------------------------------------------------------------ */
function renderScripts() {
  const sp = selSprite(); const root = $('scripts');
  $('scripts-label').textContent = sp ? 'SCRIPTS · ' + sp.name.toUpperCase() : 'SCRIPTS';
  root.innerHTML = '';
  if (!sp) return;
  sp.scripts.forEach((scr, i) => root.appendChild(renderScript(sp, scr, i)));
  const add = document.createElement('button'); add.className = 'bl-btn bl-wide bl-newscript'; add.textContent = '✚ New Script';
  add.addEventListener('click', () => showHatPicker(sp));
  root.appendChild(add);
  if (!sp.scripts.length) root.insertAdjacentHTML('afterbegin', '<div class="bl-empty-hint">No scripts yet.<br>Tap <b>✚ New Script</b>, pick an event (like <i>every frame</i>), then add blocks inside it.</div>');
}

function renderScript(sp, scr, idx) {
  const wrap = document.createElement('div'); wrap.className = 'bl-script';
  const head = document.createElement('div'); head.className = 'bl-script-head';
  const hat = document.createElement('div'); hat.className = 'bl-hat';
  if (scr.hat === 'start') hat.textContent = 'when ▶ clicked';
  else if (scr.hat === 'frame') hat.textContent = 'every frame';
  else {
    hat.innerHTML = 'when ';
    const sel = document.createElement('select'); GB.KEYS.forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; if ((scr.key || 'Space') === k) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', () => { scr.key = sel.value; markDirty(); });
    hat.appendChild(sel); hat.insertAdjacentText('beforeend', ' pressed');
  }
  const del = document.createElement('button'); del.className = 'bl-script-del'; del.textContent = '🗑'; del.title = 'Delete script';
  del.addEventListener('click', () => { sp.scripts.splice(idx, 1); renderScripts(); markDirty(); });
  head.appendChild(hat); head.appendChild(del);
  wrap.appendChild(head);
  wrap.appendChild(renderContainer(scr.body));
  return wrap;
}

function renderContainer(arr) {
  const cont = document.createElement('div'); cont.className = 'bl-container';
  arr.forEach((b, i) => cont.appendChild(renderBlock(b, arr, i)));
  const add = document.createElement('button'); add.className = 'bl-add'; add.textContent = '+ add block';
  add.addEventListener('click', () => showPalette(arr));
  cont.appendChild(add);
  return cont;
}

function renderBlock(b, arr, idx) {
  const def = GB.BLOCKS[b.type]; const cat = GB.CATS[def.cat];
  const el = document.createElement('div'); el.className = 'bl-block' + (def.c ? ' bl-cblock' : ''); el.style.background = cat.color;
  const topRow = def.c ? document.createElement('div') : el;
  if (def.c) { topRow.style.display = 'flex'; topRow.style.alignItems = 'center'; topRow.style.flexWrap = 'wrap'; topRow.style.gap = '6px'; }

  for (const tok of def.tokens) {
    if (typeof tok === 'string') { const s = document.createElement('span'); s.className = 'lit'; s.textContent = tok; topRow.appendChild(s); }
    else topRow.appendChild(renderInput(b, tok));
  }
  const bar = document.createElement('div'); bar.className = 'bar';
  bar.innerHTML = `<button data-a="up" title="Move up">▲</button><button data-a="dn" title="Move down">▼</button><button data-a="rm" title="Remove">✕</button>`;
  bar.querySelector('[data-a="up"]').addEventListener('click', () => { if (idx > 0) { [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]; renderScripts(); markDirty(); } });
  bar.querySelector('[data-a="dn"]').addEventListener('click', () => { if (idx < arr.length - 1) { [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]]; renderScripts(); markDirty(); } });
  bar.querySelector('[data-a="rm"]').addEventListener('click', () => { arr.splice(idx, 1); renderScripts(); markDirty(); });
  topRow.appendChild(bar);

  if (def.c) { el.appendChild(topRow); const body = renderContainer(b.body); body.className += ' bl-cbody'; el.appendChild(body); }
  return el;
}

function renderInput(b, tok) {
  const I = b.inputs;
  if (tok.k === 'num') { const i = document.createElement('input'); i.type = 'number'; i.value = I[tok.s]; i.addEventListener('input', () => { I[tok.s] = i.value; markDirty(); }); return i; }
  if (tok.k === 'text') { const i = document.createElement('input'); i.type = 'text'; i.value = I[tok.s]; i.addEventListener('input', () => { I[tok.s] = i.value; markDirty(); }); return i; }
  if (tok.k === 'color') { const i = document.createElement('input'); i.type = 'color'; i.value = I[tok.s]; i.addEventListener('input', () => { I[tok.s] = i.value; markDirty(); }); return i; }
  if (tok.k === 'key') { const sel = document.createElement('select'); GB.KEYS.forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; if (I[tok.s] === k) o.selected = true; sel.appendChild(o); }); sel.addEventListener('change', () => { I[tok.s] = sel.value; markDirty(); }); return sel; }
  if (tok.k === 'cond') return renderCond(b, tok.s);
  const span = document.createElement('span'); return span;
}

function renderCond(b, slot) {
  const wrap = document.createElement('span'); wrap.style.display = 'inline-flex'; wrap.style.gap = '4px'; wrap.style.alignItems = 'center';
  const c = b.inputs[slot];
  const kindSel = document.createElement('select');
  [['key', 'key pressed'], ['touching', 'touching'], ['score', 'score ≥']].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; if (c.kind === v) o.selected = true; kindSel.appendChild(o); });
  wrap.appendChild(kindSel);
  const paramHost = document.createElement('span'); wrap.appendChild(paramHost);
  const drawParam = () => {
    paramHost.innerHTML = '';
    if (c.kind === 'key') { const s = document.createElement('select'); GB.KEYS.forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; if ((c.key || 'Space') === k) o.selected = true; s.appendChild(o); }); s.addEventListener('change', () => { c.key = s.value; markDirty(); }); paramHost.appendChild(s); }
    else if (c.kind === 'touching') { const s = document.createElement('select'); const opts = ['edge'].concat(project.sprites.filter(sp => sp.id !== selId).map(sp => sp.name)); opts.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; if ((c.target || 'edge') === n) o.selected = true; s.appendChild(o); }); s.addEventListener('change', () => { c.target = s.value; markDirty(); }); paramHost.appendChild(s); }
    else { const i = document.createElement('input'); i.type = 'number'; i.value = c.n != null ? c.n : 10; i.addEventListener('input', () => { c.n = i.value; markDirty(); }); paramHost.appendChild(i); }
  };
  kindSel.addEventListener('change', () => { c.kind = kindSel.value; if (c.kind === 'key' && !c.key) c.key = 'Space'; if (c.kind === 'touching' && !c.target) c.target = 'edge'; if (c.kind === 'score' && c.n == null) c.n = 10; drawParam(); markDirty(); });
  drawParam();
  return wrap;
}

/* ------------------------------------------------------------------ */
/* pickers                                                            */
/* ------------------------------------------------------------------ */
function showHatPicker(sp) {
  showModal(`<h2>Pick an event</h2><div class="bl-pal" id="hatpal">
    ${['start', 'frame', 'key'].map(t => `<div class="bl-pal-item" data-t="${t}" style="background:${GB.CATS.events.color}">${t === 'start' ? 'when ▶ clicked' : t === 'frame' ? 'every frame' : 'when key pressed'}</div>`).join('')}
  </div><div class="bl-modal-buttons"><button class="bl-btn" data-x>Cancel</button></div>`);
  $('hatpal').querySelectorAll('.bl-pal-item').forEach(it => it.addEventListener('click', () => {
    const hat = it.dataset.t; const scr = { id: sid(), hat, body: [] }; if (hat === 'key') scr.key = 'Space';
    sp.scripts.push(scr); closeModal(); renderScripts(); markDirty();
  }));
}
function showPalette(targetArr) {
  let html = '<h2>Add a block</h2>';
  for (const cat in GB.PALETTE) {
    const items = GB.PALETTE[cat].filter(t => !GB.BLOCKS[t].hat);
    if (!items.length) continue;
    html += `<div class="bl-cat">${GB.CATS[cat].label.toUpperCase()}</div><div class="bl-pal">`;
    html += items.map(t => `<div class="bl-pal-item" data-t="${t}" style="background:${GB.CATS[cat].color}">${labelOf(t)}</div>`).join('');
    html += '</div>';
  }
  html += '<div class="bl-modal-buttons"><button class="bl-btn" data-x>Cancel</button></div>';
  showModal(html);
  $('modal-box').querySelectorAll('.bl-pal-item').forEach(it => it.addEventListener('click', () => {
    targetArr.push(GB.newBlock(it.dataset.t)); closeModal(); renderScripts(); markDirty();
  }));
}
function labelOf(type) {
  return GB.BLOCKS[type].tokens.map(t => typeof t === 'string' ? t : (t.k === 'cond' ? '⟨…⟩' : '[' + (t.d != null ? t.d : t.k) + ']')).join(' ');
}

/* ------------------------------------------------------------------ */
/* stage drag (move selected sprite's start position)                 */
/* ------------------------------------------------------------------ */
function bindStage() {
  const cv = $('stage'); let dragging = null;
  cv.addEventListener('pointerdown', e => {
    if (playing) return;
    const r = cv.getBoundingClientRect(); const px = (e.clientX - r.left) * (cv.width / r.width), py = (e.clientY - r.top) * (cv.height / r.height);
    const s = engine.spriteAt(px, py);
    if (s) { selId = s.id; dragging = s; renderAll(); }
  });
  cv.addEventListener('pointermove', e => {
    if (!dragging || playing) return;
    const r = cv.getBoundingClientRect(); const px = (e.clientX - r.left) * (cv.width / r.width), py = (e.clientY - r.top) * (cv.height / r.height);
    const st = engine.canvasToStage(px, py); const def = dragging.def;
    def.x = Math.round(st.x); def.y = Math.round(st.y); dragging.x = def.x; dragging.y = def.y;
    renderProps(); markDirty();
  });
  addEventListener('pointerup', () => { dragging = null; });
}

/* ------------------------------------------------------------------ */
/* play / stop                                                        */
/* ------------------------------------------------------------------ */
function play() {
  playing = true; $('btn-play').textContent = '■ Stop'; $('btn-play').classList.add('playing');
  $('endcard').classList.add('hidden');
  engine.play();
  $('stage').focus && $('stage').focus();
  hudTimer = setInterval(() => { $('hud').innerHTML = `<div class="chip"><small>SCORE</small>${engine.score}</div>`; }, 120);
}
function stop() {
  playing = false; $('btn-play').textContent = '▶ Play'; $('btn-play').classList.remove('playing');
  clearInterval(hudTimer); $('hud').innerHTML = ''; $('endcard').classList.add('hidden');
  engine.stop(); renderAll();
}
function onEnd(res) {
  clearInterval(hudTimer);
  $('end-title').textContent = res.win ? '🏆 YOU WIN!' : '💥 GAME OVER';
  $('end-msg').textContent = 'Score: ' + res.score;
  $('endcard').classList.remove('hidden');
  playing = false; $('btn-play').textContent = '▶ Play'; $('btn-play').classList.remove('playing');
}
$('btn-play').addEventListener('click', () => playing ? stop() : play());
$('btn-endcard-stop').addEventListener('click', stop);
addEventListener('keydown', e => { if (e.code === 'Escape' && playing) stop(); });

/* ------------------------------------------------------------------ */
/* save / new / projects                                              */
/* ------------------------------------------------------------------ */
const loadProjects = () => { try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); } catch (e) { return []; } };
const saveProjects = l => { try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(l)); } catch (e) {} };
let dirtyT = 0;
function markDirty() { clearTimeout(dirtyT); dirtyT = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(project)); } catch (e) {} }, 400); }
function saveProject(silent) {
  project.updated = Date.now(); const list = loadProjects(); const i = list.findIndex(p => p.id === project.id);
  if (i >= 0) list[i] = project; else list.push(project); saveProjects(list);
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(project)); } catch (e) {}
  if (!silent) toast('Saved ✓');
}
$('btn-save').addEventListener('click', () => saveProject());
$('title-input').addEventListener('input', e => { project.title = e.target.value; markDirty(); });
$('btn-new').addEventListener('click', () => {
  showModal(`<h2>New game</h2><p style="color:var(--muted);font-size:.85rem;margin-bottom:8px">Start fresh?</p>
    <div class="bl-modal-buttons"><button class="bl-btn bl-btn-play" data-act="starter">▶ Starter (catch the coin)</button><button class="bl-btn" data-act="empty">Empty stage</button><button class="bl-btn" data-x>Cancel</button></div>`, act => {
    project = act === 'empty' ? Object.assign(EN.newProject('Untitled Game'), { sprites: [EN.newSprite('Sprite 1')] }) : starterProject();
    engine.project = project; engine.reset(); selId = project.sprites[0].id; $('title-input').value = project.title || ''; renderAll(); saveProject(true); toast('New game');
  });
});
$('btn-projects').addEventListener('click', () => {
  const list = loadProjects().sort((a, b) => b.updated - a.updated);
  const rows = list.length ? list.map(p => `<div class="bl-proj-row"><span class="nm">${esc(p.title || 'Untitled')} <span class="meta">· ${p.sprites.length} sprites</span></span><button class="bl-btn" data-act="open" data-id="${p.id}">Open</button><button class="bl-btn" data-act="del" data-id="${p.id}">🗑</button></div>`).join('') : '<p style="color:var(--muted)">No saved games yet.</p>';
  showModal(`<h2>📁 My Games</h2>${rows}<div class="bl-modal-buttons"><button class="bl-btn" data-x>Close</button></div>`, (act, btn) => {
    const id = btn.dataset.id;
    if (act === 'open') { const p = loadProjects().find(x => x.id === id); if (p) { project = p; engine.project = project; engine.reset(); selId = project.sprites[0] ? project.sprites[0].id : null; $('title-input').value = project.title || ''; renderAll(); toast('Loaded'); } }
    else if (act === 'del') { saveProjects(loadProjects().filter(x => x.id !== id)); toast('Deleted'); }
  });
});

/* ------------------------------------------------------------------ */
/* modal + toast                                                      */
/* ------------------------------------------------------------------ */
function showModal(html, onAct) {
  const m = $('modal'), box = $('modal-box'); box.innerHTML = html; m.classList.remove('hidden');
  box.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', closeModal));
  box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { closeModal(); onAct && onAct(b.dataset.act, b); }));
}
function closeModal() { $('modal').classList.add('hidden'); }
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
let toastT = 0;
function toast(m) { const t = $('bl-toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600); }

window.__blocks = { engine: () => engine, project: () => project, select: id => { selId = id; renderAll(); }, play, stop, addBlock: (arr, t) => { arr.push(GB.newBlock(t)); renderScripts(); } };
boot();
})();
