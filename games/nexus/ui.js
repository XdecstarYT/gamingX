/* ============================================================================
   PROJECT NEXUS — UI layer: map renderer + dashboard panels.
   Pure rendering + DOM wiring. Reads/mutates `state` via NexusSim's action
   functions; never touches simulation internals directly.
   ========================================================================== */
window.NexusUI = (() => {
'use strict';
const D = window.NexusData;
const S = window.NexusSim;
const W = window.NexusWorld;
const L = window.NexusLegislature;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => {
  n = Math.round(n);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
};
const fmtMoney = n => '$' + fmt(n);
function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

let state = null;
let onChange = () => {};       // called after any state-mutating UI action
let armedBuild = null;         // building id currently selected for placement
let selectedTile = null;

/* ------------------------------------------------------------------ */
/* map renderer — a real three.js 3D scene (elevation-shaded terrain,   */
/* instanced tiles/resources, 3D buildings with progress bars & icon   */
/* sprites, glowing capitals). Pan/zoom/click keep the exact same feel */
/* as before; picking is done by ray-casting a flat y=0 ground plane   */
/* so screen<->tile math stays exact regardless of visual elevation.   */
/* ------------------------------------------------------------------ */
const T = window.THREE;
const CAM_ANGLE = 55 * Math.PI / 180;
const DIST_MIN = 6, DIST_MAX = 34, DIST_DEFAULT = 13;
const TILE_THICK = 0.16;
const TERRAIN_HEIGHT = { ocean: -0.22, coast: -0.06, wetland: -0.08, plains: 0, desert: 0, tundra: 0, forest: 0.04, hills: 0.16, mountains: 0.38 };
const RESOURCE_COLOR = { iron: '#9aa5b1', coal: '#2b2f36', oil: '#6b4423', gold: '#fbbf24', fertile: '#22c55e' };
const CATEGORY_COLOR = { residential: '#f2b03d', commercial: '#38bdf8', industrial: '#f97316', agriculture: '#84cc16', energy: '#eab308', infra: '#94a3b8', civic: '#a855f7', research: '#22d3ee', government: '#ef4444', military: '#64748b' };
const CATEGORY_HEIGHT = { residential: 0.5, commercial: 0.7, industrial: 0.6, agriculture: 0.22, energy: 0.6, infra: 0.12, civic: 0.65, research: 0.55, government: 0.9, military: 0.5 };

let cam = { x: 0, z: 0, dist: DIST_DEFAULT };
let canvas, renderer, scene, camera, raycaster, groundPlane;
let listenersAttached = false;
let dragging = false, dragStart = null, lastPointer = null, dragMoved = 0;
let buildingMeshes = new Map();
let iconTextureCache = new Map();
let selectionMesh = null;

function initMap(_state) {
  canvas = $('map-canvas');
  if (renderer) renderer.dispose();
  buildingMeshes = new Map();

  scene = new T.Scene();
  scene.background = new T.Color(0x05070d);
  scene.fog = new T.Fog(0x05070d, 26, 58);
  scene.add(new T.HemisphereLight(0x88aaff, 0x141a2c, 0.75));
  scene.add(new T.AmbientLight(0xffffff, 0.25));
  const sun = new T.DirectionalLight(0xffffff, 0.9);
  sun.position.set(-24, 34, 14);
  scene.add(sun);

  camera = new T.PerspectiveCamera(45, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 200);
  renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  raycaster = new T.Raycaster();
  groundPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);

  cam.x = state.cities[0].x + 0.5;
  cam.z = state.cities[0].y + 0.5;
  cam.dist = DIST_DEFAULT;

  buildWorldMeshes();
  buildCapitals();
  buildSelectionMesh();

  if (!listenersAttached) {
    listenersAttached = true;
    canvas.addEventListener('pointerdown', e => {
      dragging = true; dragMoved = 0;
      dragStart = { x: e.clientX, y: e.clientY };
      lastPointer = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) { updateTip(e); return; }
      const dx = (e.clientX - dragStart.x), dy = (e.clientY - dragStart.y);
      dragMoved = Math.max(dragMoved, Math.hypot(dx, dy));
      const prevWorld = groundHit(lastPointer.x, lastPointer.y);
      const curWorld = groundHit(e.clientX, e.clientY);
      if (prevWorld && curWorld) { cam.x += prevWorld.x - curWorld.x; cam.z += prevWorld.z - curWorld.z; }
      lastPointer = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', e => {
      dragging = false;
      if (dragMoved < 5) handleMapClick(e);
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      cam.dist = clampDist(cam.dist * (e.deltaY < 0 ? 0.9 : 1.111));
    }, { passive: false });
    addEventListener('resize', resizeCanvas);
  }
  resizeCanvas();
}
function clampDist(d) { return Math.max(DIST_MIN, Math.min(DIST_MAX, d)); }
function resizeCanvas() {
  if (!canvas || !renderer) return;
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function updateCameraTransform() {
  camera.position.set(cam.x, cam.dist * Math.sin(CAM_ANGLE), cam.z + cam.dist * Math.cos(CAM_ANGLE));
  camera.lookAt(cam.x, 0, cam.z);
}

function ndcFromClient(clientX, clientY, out) {
  const rect = canvas.getBoundingClientRect();
  out.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  out.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  return out;
}
const _ndc = new T.Vector2();
function groundHit(clientX, clientY) {
  updateCameraTransform();
  ndcFromClient(clientX, clientY, _ndc);
  raycaster.setFromCamera(_ndc, camera);
  const hit = new T.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}
function pickTile(clientX, clientY) {
  const hit = groundHit(clientX, clientY);
  return hit ? { x: Math.floor(hit.x), y: Math.floor(hit.z) } : null;
}
function groundY(x, y) {
  const t = W.tileAt(state.world, x, y);
  return (t ? (TERRAIN_HEIGHT[t.terrain] || 0) : 0) + TILE_THICK / 2;
}

function updateTip(e) {
  const p = pickTile(e.clientX, e.clientY);
  const tip = $('map-tip');
  const tile = p && W.tileAt(state.world, p.x, p.y);
  if (!tile) { tip.classList.add('hidden'); return; }
  const b = state.buildings.find(bd => bd.x === p.x && bd.y === p.y);
  const owner = tile.owner === 0 ? 'Your territory' : tile.owner === -1 ? 'Unclaimed' : (state.nations.find(n => n.id === tile.owner) || {}).name || 'Foreign';
  let html = `<b>${cap(tile.terrain)}</b> · ${owner}`;
  if (tile.resource) html += ` · ${cap(tile.resource)} deposit`;
  if (b) { const def = D.BUILDINGS_BY_ID[b.type]; html += `<br>${def.icon} ${def.name}` + (b.built ? '' : ` (building… ${Math.round(b.progress * 100)}%)`); }
  tip.innerHTML = html;
  tip.classList.remove('hidden');
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function handleMapClick(e) {
  const p = pickTile(e.clientX, e.clientY);
  if (!p) return;
  const tile = W.tileAt(state.world, p.x, p.y);
  if (!tile) return;
  if (armedBuild) {
    const res = S.placeBuilding(state, armedBuild, p.x, p.y);
    if (res.ok) { toast(`Placed ${D.BUILDINGS_BY_ID[armedBuild].name}.`, 'build'); armedBuild = null; $('build-hint').classList.add('hidden'); onChange(); }
    else toast(res.reason || 'Cannot place there.', 'warn');
  } else {
    selectedTile = { x: p.x, y: p.y };
  }
}

function armBuild(type) {
  armedBuild = type;
  $('build-hint-name').textContent = D.BUILDINGS_BY_ID[type].name;
  $('build-hint').classList.remove('hidden');
}

/* ---- static world geometry: built once per initMap (terrain never changes) */
function buildWorldMeshes() {
  const world = state.world;
  const geo = new T.BoxGeometry(0.98, TILE_THICK, 0.98);
  const dummy = new T.Object3D();
  const riverTiles = [], resourceTiles = [];
  const byTerrain = {}, ownedTiles = [];

  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const t = world.tiles[y * world.w + x];
      const h = TERRAIN_HEIGHT[t.terrain] || 0;
      (byTerrain[t.terrain] ||= []).push({ x, y, h });
      if (t.river) riverTiles.push({ x, y, h });
      if (t.resource) resourceTiles.push({ x, y, h, resource: t.resource });
      if (t.owner !== -1) ownedTiles.push({ x, y, h, owner: t.owner });
    }
  }
  // one instanced mesh per terrain type — a solid-color material per group,
  // since per-instance vertex colors on InstancedMesh render as pure black
  // on this three.js build (no working USE_INSTANCING_COLOR shader chunk)
  for (const [terrain, tiles] of Object.entries(byTerrain)) {
    const mat = new T.MeshStandardMaterial({ color: D.TERRAIN[terrain].color, roughness: 0.95 });
    const mesh = new T.InstancedMesh(geo, mat, tiles.length);
    mesh.frustumCulled = false; // per-instance positions span the whole map; the mesh's own local bounding sphere would wrongly cull it
    tiles.forEach((t, i) => { dummy.position.set(t.x + 0.5, t.h, t.y + 0.5); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }
  // ownership tint — a thin translucent overlay grouped by owner color
  const byOwnerColor = {};
  for (const t of ownedTiles) {
    const color = t.owner === 0 ? '#22d3ee' : ((state.nations.find(n => n.id === t.owner) || {}).color || '#888888');
    (byOwnerColor[color] ||= []).push(t);
  }
  for (const [color, tiles] of Object.entries(byOwnerColor)) {
    const tintMat = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false });
    const tintMesh = new T.InstancedMesh(geo, tintMat, tiles.length);
    tintMesh.frustumCulled = false;
    tiles.forEach((t, i) => { dummy.position.set(t.x + 0.5, t.h + TILE_THICK / 2 + 0.01, t.y + 0.5); dummy.scale.set(1, 0.05, 1); dummy.updateMatrix(); tintMesh.setMatrixAt(i, dummy.matrix); });
    dummy.scale.set(1, 1, 1);
    tintMesh.instanceMatrix.needsUpdate = true;
    scene.add(tintMesh);
  }

  if (riverTiles.length) {
    const rGeo = new T.BoxGeometry(0.32, 0.05, 1.0);
    const rMat = new T.MeshStandardMaterial({ color: 0x4a9fd8, roughness: 0.3, metalness: 0.15 });
    const riverMesh = new T.InstancedMesh(rGeo, rMat, riverTiles.length);
    riverMesh.frustumCulled = false;
    riverTiles.forEach((t, i) => { dummy.position.set(t.x + 0.5, t.h + TILE_THICK / 2 + 0.03, t.y + 0.5); dummy.updateMatrix(); riverMesh.setMatrixAt(i, dummy.matrix); });
    riverMesh.instanceMatrix.needsUpdate = true;
    scene.add(riverMesh);
  }

  if (resourceTiles.length) {
    const resGeo = new T.SphereGeometry(0.16, 10, 8);
    const byType = {};
    for (const rt of resourceTiles) (byType[rt.resource] ||= []).push(rt);
    for (const [res, tiles] of Object.entries(byType)) {
      const c = RESOURCE_COLOR[res] || '#ffffff';
      const rmat = new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.4 });
      const mesh = new T.InstancedMesh(resGeo, rmat, tiles.length);
      mesh.frustumCulled = false;
      tiles.forEach((t, i) => { dummy.position.set(t.x + 0.5, t.h + TILE_THICK / 2 + 0.16, t.y + 0.5); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
    }
  }

  // territory outline for the player — edges between an owned tile and any non-owned neighbor
  const pos = [];
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const t = world.tiles[y * world.w + x];
      if (t.owner !== 0) continue;
      const eh = (TERRAIN_HEIGHT[t.terrain] || 0) + TILE_THICK / 2 + 0.02;
      const right = W.tileAt(world, x + 1, y); if (!right || right.owner !== 0) pos.push(x + 1, eh, y, x + 1, eh, y + 1);
      const left = W.tileAt(world, x - 1, y); if (!left || left.owner !== 0) pos.push(x, eh, y, x, eh, y + 1);
      const down = W.tileAt(world, x, y + 1); if (!down || down.owner !== 0) pos.push(x, eh, y + 1, x + 1, eh, y + 1);
      const up = W.tileAt(world, x, y - 1); if (!up || up.owner !== 0) pos.push(x, eh, y, x + 1, eh, y);
    }
  }
  if (pos.length) {
    const outlineGeo = new T.BufferGeometry();
    outlineGeo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    scene.add(new T.LineSegments(outlineGeo, new T.LineBasicMaterial({ color: 0x22d3ee })));
  }
}

function buildCapitals() {
  const group = new T.Group();
  for (const c of state.cities) group.add(makeCapitalMesh(c.x, c.y, '#22d3ee'));
  for (const n of state.nations) group.add(makeCapitalMesh(n.x, n.y, n.color));
  scene.add(group);
}
function makeCapitalMesh(x, y, color) {
  const g = new T.Group();
  const gy = groundY(x, y);
  const sphere = new T.Mesh(new T.SphereGeometry(0.42, 16, 12), new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }));
  sphere.position.set(x + 0.5, gy + 0.45, y + 0.5);
  g.add(sphere);
  const ring = new T.Mesh(new T.RingGeometry(0.5, 0.62, 24), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide, transparent: true, opacity: 0.6 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x + 0.5, gy + 0.02, y + 0.5);
  g.add(ring);
  return g;
}

function buildSelectionMesh() {
  const edges = new T.EdgesGeometry(new T.BoxGeometry(1, 0.05, 1));
  selectionMesh = new T.LineSegments(edges, new T.LineBasicMaterial({ color: 0xfde047 }));
  selectionMesh.visible = false;
  scene.add(selectionMesh);
}

function iconTexture(icon) {
  let tex = iconTextureCache.get(icon);
  if (tex) return tex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const cx = c.getContext('2d');
  cx.font = '46px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(icon, 32, 36);
  tex = new T.CanvasTexture(c);
  iconTextureCache.set(icon, tex);
  return tex;
}

function syncBuildings() {
  const seen = new Set();
  const fullW = 0.6;
  for (const b of state.buildings) {
    seen.add(b.id);
    const def = D.BUILDINGS_BY_ID[b.type];
    const height = CATEGORY_HEIGHT[def.cat] || 0.5;
    let rec = buildingMeshes.get(b.id);
    if (!rec) {
      const group = new T.Group();
      const box = new T.Mesh(new T.BoxGeometry(0.72, height, 0.72), new T.MeshStandardMaterial({ color: CATEGORY_COLOR[def.cat] || '#94a3b8', roughness: 0.7 }));
      box.position.y = height / 2;
      group.add(box);
      const barBg = new T.Mesh(new T.PlaneGeometry(fullW, 0.08), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, side: T.DoubleSide }));
      barBg.rotation.x = -Math.PI / 2; barBg.position.y = 0.02;
      const barFill = new T.Mesh(new T.PlaneGeometry(fullW, 0.08), new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }));
      barFill.rotation.x = -Math.PI / 2; barFill.position.y = 0.025;
      group.add(barBg); group.add(barFill);
      const sprite = new T.Sprite(new T.SpriteMaterial({ map: iconTexture(def.icon), transparent: true }));
      sprite.scale.set(0.55, 0.55, 1);
      group.add(sprite);
      const gy = groundY(b.x, b.y);
      group.position.set(b.x + 0.5, gy, b.y + 0.5);
      scene.add(group);
      rec = { group, box, barBg, barFill, sprite, height };
      buildingMeshes.set(b.id, rec);
    }
    rec.sprite.position.y = rec.height + 0.4;
    if (b.built) {
      rec.box.material.transparent = false; rec.box.material.opacity = 1;
      rec.barBg.visible = false; rec.barFill.visible = false;
    } else {
      rec.box.material.transparent = true; rec.box.material.opacity = 0.45;
      rec.barBg.visible = true; rec.barFill.visible = true;
      const p = Math.max(0.001, b.progress);
      rec.barFill.scale.x = p;
      rec.barFill.position.x = -fullW / 2 + (fullW * p) / 2;
    }
  }
  for (const [id, rec] of buildingMeshes) {
    if (!seen.has(id)) { scene.remove(rec.group); buildingMeshes.delete(id); }
  }
}

function renderMap() {
  if (!renderer) return;
  updateCameraTransform();
  syncBuildings();
  if (selectedTile) {
    selectionMesh.visible = true;
    selectionMesh.position.set(selectedTile.x + 0.5, groundY(selectedTile.x, selectedTile.y) + 0.02, selectedTile.y + 0.5);
  } else {
    selectionMesh.visible = false;
  }
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
/* toasts / notifications                                              */
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
  el.className = 'nx-toast' + (kind ? ' ' + kind : '');
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

/* ------------------------------------------------------------------ */
/* top bar                                                              */
/* ------------------------------------------------------------------ */
function renderTopbar() {
  $('hud-nation-name').textContent = state.meta.nationName;
  const week = state.meta.tick % 52, year = Math.floor(state.meta.tick / 52) + 1;
  $('hud-date').textContent = `Year ${year}, Week ${week + 1}`;
  const s = state.stats;
  $('hud-stats').innerHTML = `
    <div class="chip"><small>TREASURY</small>${fmtMoney(state.treasury)}</div>
    <div class="chip ${state.debt > 5000 ? 'warn' : ''}"><small>DEBT</small>${fmtMoney(state.debt)}</div>
    <div class="chip"><small>POP</small>${fmt(s.population)}</div>
    <div class="chip"><small>GDP</small>${fmtMoney(s.gdp)}</div>
    <div class="chip ${s.approval < 35 ? 'warn' : ''}"><small>APPROVAL</small>${Math.round(s.approval)}%</div>
    <div class="chip"><small>SCORE</small>${fmt(state.score)}</div>`;
  const govEl = $('hud-gov-status');
  const isGov = state.legislature.isPlayerGovernment;
  govEl.textContent = isGov ? 'GOVERNMENT' : 'OPPOSITION';
  govEl.classList.toggle('opposition', !isGov);
}

/* ------------------------------------------------------------------ */
/* dashboard: tab dispatch                                              */
/* ------------------------------------------------------------------ */
let currentTab = 'overview';
function renderDash() {
  const body = $('dash-body');
  const renderers = {
    overview: renderOverview, build: renderBuild, economy: renderEconomy, politics: renderPolitics,
    parliament: renderParliament, tech: renderTech, diplomacy: renderDiplomacy, territory: renderTerritory,
    events: renderEvents, archive: renderArchive,
  };
  body.innerHTML = '';
  (renderers[currentTab] || renderOverview)(body);
}
function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nx-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  renderDash();
}

function sparkline(values, color) {
  const c = document.createElement('canvas');
  c.className = 'nx-sparkline'; c.width = 300; c.height = 88;
  const cx = c.getContext('2d');
  if (!values || values.length < 2) return c;
  const min = Math.min(...values), max = Math.max(...values), range = (max - min) || 1;
  cx.strokeStyle = color; cx.lineWidth = 3; cx.beginPath();
  values.forEach((v, i) => {
    const x = i / (values.length - 1) * c.width;
    const y = c.height - ((v - min) / range) * (c.height - 8) - 4;
    i === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y);
  });
  cx.stroke();
  cx.lineTo(c.width, c.height); cx.lineTo(0, c.height); cx.closePath();
  cx.fillStyle = hexAlpha(color, 0.12); cx.fill();
  return c;
}

function renderOverview(body) {
  const s = state.stats;
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  g1.innerHTML = `<b class="hd">NATION SNAPSHOT</b>
    <div class="nx-stat-grid">
      <div class="nx-stat-card"><div class="v">${fmt(s.population)}</div><div class="l">POPULATION</div></div>
      <div class="nx-stat-card"><div class="v">${Math.round(s.happiness)}</div><div class="l">HAPPINESS</div></div>
      <div class="nx-stat-card"><div class="v">${Math.round(s.corruption)}</div><div class="l">CORRUPTION</div></div>
      <div class="nx-stat-card"><div class="v">${s.inflation.toFixed(1)}%</div><div class="l">INFLATION</div></div>
      <div class="nx-stat-card"><div class="v">${s.unemployed}</div><div class="l">UNEMPLOYED</div></div>
      <div class="nx-stat-card"><div class="v">${state.tech.unlocked.length}</div><div class="l">TECHS</div></div>
    </div>`;
  body.appendChild(g1);

  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">GDP OVER TIME</b>`;
  g2.appendChild(sparkline(s.gdpHistory, '#22d3ee'));
  body.appendChild(g2);

  const g3 = document.createElement('div'); g3.className = 'nx-group';
  g3.innerHTML = `<b class="hd">APPROVAL OVER TIME</b>`;
  g3.appendChild(sparkline(s.approvalHistory, '#a855f7'));
  body.appendChild(g3);

  const g4 = document.createElement('div'); g4.className = 'nx-group';
  g4.innerHTML = `<b class="hd">RECENT NEWS</b><div class="nx-feed">` +
    state.notifications.slice(-8).reverse().map(n => `<div class="nx-feed-item">${esc(n.text)}</div>`).join('') +
    `</div>`;
  body.appendChild(g4);
}

function renderBuild(body) {
  const isGov = state.legislature.isPlayerGovernment;
  if (!isGov) {
    const note = document.createElement('div'); note.className = 'nx-locked-note';
    note.textContent = 'You are in Opposition — only the Government can spend treasury on new construction. Win the next election to take power.';
    body.appendChild(note);
  }
  const cats = [['residential', 'HOUSING'], ['commercial', 'COMMERCIAL'], ['industrial', 'INDUSTRY'],
    ['agriculture', 'AGRICULTURE'], ['energy', 'ENERGY'], ['infra', 'INFRASTRUCTURE'], ['civic', 'CIVIC'],
    ['research', 'RESEARCH'], ['government', 'GOVERNMENT'], ['military', 'MILITARY']];
  for (const [cat, label] of cats) {
    const items = D.BUILDINGS.filter(b => b.cat === cat);
    if (!items.length) continue;
    const catEl = document.createElement('div'); catEl.className = 'nx-build-cat'; catEl.textContent = label;
    body.appendChild(catEl);
    for (const def of items) {
      const locked = def.needsTech && !S.techUnlocked(state, def.needsTech);
      const el = document.createElement('button');
      el.className = 'nx-build-item' + (locked || !isGov ? ' disabled' : '');
      el.innerHTML = `<span class="ic">${def.icon}</span><span class="info"><span class="nm">${def.name}</span><span class="ds">${def.desc}${locked ? ' 🔒 ' + D.TECHS_BY_ID[def.needsTech].name : ''}</span></span><span class="cost">${fmtMoney(def.cost)}</span>`;
      if (!locked && isGov) el.addEventListener('click', () => armBuild(def.id));
      body.appendChild(el);
    }
  }
}

function renderEconomy(body) {
  const isGov = state.legislature.isPlayerGovernment;
  if (!isGov) {
    const note = document.createElement('div'); note.className = 'nx-locked-note';
    note.textContent = 'You are in Opposition — tax rates and funding levels are set by the Government.';
    body.appendChild(note);
  }
  const s = state.stats;
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  g1.innerHTML = `<b class="hd">TAX RATES</b>`;
  for (const [k, label] of [['income', 'Income Tax'], ['corporate', 'Corporate Tax'], ['sales', 'Sales Tax']]) {
    const row = document.createElement('div'); row.className = 'nx-slider-row';
    row.innerHTML = `<label>${label} <span>${Math.round(state.taxRate[k] * 100)}%</span></label><input type="range" min="0" max="50" value="${state.taxRate[k] * 100}" ${isGov ? '' : 'disabled'}>`;
    if (isGov) row.querySelector('input').addEventListener('input', e => { S.setTaxRate(state, k, e.target.value / 100); row.querySelector('span').textContent = e.target.value + '%'; onChange(true); });
    g1.appendChild(row);
  }
  body.appendChild(g1);

  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">FUNDING LEVELS</b>`;
  for (const [k, label] of [['health', 'Healthcare'], ['education', 'Education'], ['environment', 'Environment'], ['military', 'Military']]) {
    const row = document.createElement('div'); row.className = 'nx-slider-row';
    const pct = Math.round(state.funding[k] * 100);
    row.innerHTML = `<label>${label} <span>${pct}%</span></label><input type="range" min="0" max="150" value="${pct}" ${isGov ? '' : 'disabled'}>`;
    if (isGov) row.querySelector('input').addEventListener('input', e => { S.setFunding(state, k, e.target.value / 100); row.querySelector('span').textContent = e.target.value + '%'; onChange(true); });
    g2.appendChild(row);
  }
  body.appendChild(g2);

  const g3 = document.createElement('div'); g3.className = 'nx-group';
  g3.innerHTML = `<b class="hd">BUDGET (per week)</b>
    <div class="nx-budget-row"><span>Tax revenue</span><span>+${fmtMoney(s.lastTaxRevenue || 0)}</span></div>
    <div class="nx-budget-row"><span>Upkeep &amp; interest</span><span>−${fmtMoney(s.lastUpkeep || 0)}</span></div>
    <div class="nx-budget-row total"><span>Net</span><span>${(s.netIncome || 0) >= 0 ? '+' : ''}${fmtMoney(s.netIncome || 0)}</span></div>`;
  body.appendChild(g3);

  const g4 = document.createElement('div'); g4.className = 'nx-group';
  g4.innerHTML = `<b class="hd">INFLATION</b>`;
  g4.appendChild(sparkline(s.inflationHistory, '#f2b03d'));
  body.appendChild(g4);
}

function partyName(id) { const p = D.PARTIES.find(x => x.id === id); return p ? p.name : id; }

function renderPolitics(body) {
  const s = state.stats;
  const gov = D.GOVERNMENTS_BY_ID[state.meta.government];
  const leg = state.legislature;
  const isGov = leg.isPlayerGovernment;
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  const nextElectionWeeks = gov.elections ? Math.max(0, state.nextElectionTick - state.meta.tick) : null;
  g1.innerHTML = `<b class="hd">GOVERNMENT</b>
    <div class="nx-stat-grid">
      <div class="nx-stat-card"><div class="v">${gov.name}</div><div class="l">TYPE</div></div>
      <div class="nx-stat-card"><div class="v">${Math.round(s.approval)}%</div><div class="l">APPROVAL</div></div>
    </div>
    <p style="color:var(--muted);font-size:.74rem;margin-top:10px">
      You are in <b style="color:${isGov ? 'var(--green)' : '#f87171'}">${isGov ? 'GOVERNMENT' : 'OPPOSITION'}</b> — ${esc(partyName(leg.leadParty))} leads, headed by ${esc(leg.headOfGovernment)}.
      ${gov.elections ? ` Next election in ${nextElectionWeeks} weeks.` : ' This government does not hold elections.'}
    </p>`;
  body.appendChild(g1);

  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">PARTY SUPPORT</b>`;
  const bar = document.createElement('div'); bar.className = 'nx-party-bar';
  const legend = document.createElement('div'); legend.className = 'nx-party-legend';
  for (const p of state.parties) {
    const def = D.PARTIES.find(x => x.id === p.id);
    const seg = document.createElement('div'); seg.className = 'nx-party-seg'; seg.style.width = p.support + '%'; seg.style.background = def.color;
    bar.appendChild(seg);
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<span class="dot" style="background:${def.color}"></span>${def.name} — ${p.support}%`;
    legend.appendChild(row);
  }
  g2.appendChild(bar); g2.appendChild(legend);
  body.appendChild(g2);

  const g3 = document.createElement('div'); g3.className = 'nx-group';
  const activeLaws = leg.activeLawIds.map(id => D.BILLS_BY_ID[id]).filter(Boolean);
  g3.innerHTML = `<b class="hd">ACTIVE LAWS (${activeLaws.length})</b>` +
    (activeLaws.length
      ? activeLaws.map(l => `<div class="nx-law-item"><span class="info"><span class="nm">${esc(l.name)}</span><span class="ds">${esc(l.desc)}</span></span></div>`).join('')
      : '<p style="color:var(--muted);font-size:.74rem">No laws in effect yet.</p>') +
    `<p style="color:var(--muted);font-size:.68rem;margin-top:8px">Propose, debate and vote on new legislation in the <b>Parliament</b> tab.</p>`;
  body.appendChild(g3);
}

function renderTech(body) {
  for (const cat of D.TECH_CATEGORIES) {
    const wrap = document.createElement('div'); wrap.className = 'nx-tech-cat';
    wrap.innerHTML = `<div class="hd">${cat.toUpperCase()}</div>`;
    for (const t of D.TECHS.filter(x => x.cat === cat)) {
      const unlocked = S.techUnlocked(state, t.id);
      const researching = state.tech.researching === t.id;
      const available = S.techAvailable(state, t.id);
      const card = document.createElement('div');
      card.className = 'nx-tech-card ' + (unlocked ? 'unlocked' : researching ? 'researching' : available ? '' : 'locked');
      let html = `<div class="top"><span>${t.name}</span><span>${unlocked ? '✓' : t.cost + ' RP'}</span></div><div class="ds">${t.desc}</div>`;
      if (researching) html += `<div class="prog"><i style="width:${Math.min(100, state.tech.progress / t.cost * 100)}%"></i></div>`;
      card.innerHTML = html;
      if (available && !state.tech.researching) {
        const btn = document.createElement('button'); btn.textContent = 'RESEARCH ▸';
        btn.addEventListener('click', () => { S.startResearch(state, t.id); onChange(true); });
        card.appendChild(btn);
      }
      wrap.appendChild(card);
    }
    body.appendChild(wrap);
  }
  const rp = document.createElement('div'); rp.className = 'nx-group';
  rp.innerHTML = `<b class="hd">RESEARCH POINTS</b><div class="nx-stat-grid"><div class="nx-stat-card"><div class="v">${fmt(state.stats.researchPoints)}</div><div class="l">STORED</div></div><div class="nx-stat-card"><div class="v">+${state.stats.researchPerTick}</div><div class="l">PER WEEK</div></div></div>`;
  body.insertBefore(rp, body.firstChild);
}

function renderDiplomacy(body) {
  const isGov = state.legislature.isPlayerGovernment;
  if (!isGov) {
    const note = document.createElement('div'); note.className = 'nx-locked-note';
    note.textContent = 'You are in Opposition — the Government conducts foreign policy. You can still observe relations.';
    body.appendChild(note);
  }
  for (const n of state.nations) {
    const card = document.createElement('div'); card.className = 'nx-nation-card';
    card.innerHTML = `
      <div class="top"><span class="dot" style="background:${n.color}"></span><span class="nm">${esc(n.name)}</span><span class="rel">${D.GOVERNMENTS_BY_ID[n.government].name}</span></div>
      <div class="stats"><span>Pop ${fmt(n.population)}</span><span>GDP ${fmtMoney(n.gdp)}</span><span>Approval ${Math.round(n.approval)}%</span></div>
      <div class="relbar"><i style="width:${n.relation}%"></i></div>`;
    const actions = document.createElement('div'); actions.className = 'nx-nation-actions';
    const acts = [
      ['trade', 'Trade Deal', n.tradeAgreement], ['alliance', 'Alliance', n.alliance],
      ['nonaggression', 'Non-Aggression', n.nonAggression], ['aid', 'Send Aid ($1000)', false],
    ];
    for (const [key, label, active] of acts) {
      const btn = document.createElement('button');
      btn.textContent = label; if (active) btn.classList.add('active');
      if (!isGov) btn.disabled = true;
      else btn.addEventListener('click', () => {
        const r = S.diplomacyAction(state, n.id, key);
        if (!r.ok) toast(r.reason || 'Action failed.', 'warn');
        onChange(true);
      });
      actions.appendChild(btn);
    }
    card.appendChild(actions);
    body.appendChild(card);
  }
}

/* ------------------------------------------------------------------ */
/* parliament tab                                                       */
/* ------------------------------------------------------------------ */
function renderParliament(body) {
  const leg = state.legislature;
  const isGov = leg.isPlayerGovernment;
  const gov = D.GOVERNMENTS_BY_ID[state.meta.government];
  const nextElectionWeeks = gov.elections ? Math.max(0, state.nextElectionTick - state.meta.tick) : null;

  const banner = document.createElement('div'); banner.className = 'nx-gov-banner' + (isGov ? '' : ' opposition');
  banner.innerHTML = `<b>${isGov ? 'YOU ARE IN GOVERNMENT' : 'YOU ARE IN OPPOSITION'}</b>
    <div style="font-size:.72rem;color:var(--muted);margin-top:4px">
      Head of Government: <b style="color:var(--text)">${esc(leg.headOfGovernment)}</b> (${esc(partyName(leg.leadParty))})
      ${gov.elections ? ` · Next election in ${nextElectionWeeks} weeks` : ''}
      ${leg.noConfidence ? ' · <span style="color:#f87171">No-confidence motion pending!</span>' : ''}
    </div>`;
  body.appendChild(banner);

  // seat composition
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  g1.innerHTML = `<b class="hd">PARLIAMENT — ${L.SEATS} SEATS</b>`;
  const seatCounts = {};
  for (const l of leg.legislators) seatCounts[l.party] = (seatCounts[l.party] || 0) + 1;
  const chart = document.createElement('div'); chart.className = 'nx-seat-chart';
  const legend = document.createElement('div'); legend.className = 'nx-party-legend';
  for (const p of D.PARTIES) {
    const count = seatCounts[p.id] || 0;
    if (!count) continue;
    const seg = document.createElement('div'); seg.className = 'nx-seat-seg';
    seg.style.width = (count / L.SEATS * 100) + '%'; seg.style.background = p.color;
    chart.appendChild(seg);
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<span class="dot" style="background:${p.color}"></span>${esc(p.name)} — ${count} seat${count === 1 ? '' : 's'}${leg.governingParties.includes(p.id) ? ' (Gov)' : ''}`;
    legend.appendChild(row);
  }
  g1.appendChild(chart); g1.appendChild(legend);
  body.appendChild(g1);

  // cabinet
  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">CABINET</b>`;
  if (!isGov) {
    const note = document.createElement('div'); note.className = 'nx-locked-note';
    note.textContent = 'Cabinet appointments are made by the governing party. Win an election to form Government.';
    g2.appendChild(note);
  }
  for (const pf of D.PORTFOLIOS) {
    const legId = leg.cabinet[pf.id];
    const minister = legId && leg.legislators.find(l => l.id === legId);
    const card = document.createElement('div'); card.className = 'nx-cabinet-card';
    card.innerHTML = `<span class="role"><b>${pf.icon} ${esc(pf.name)}</b><span>${minister ? esc(minister.name) + ' — competence ' + minister.competence : 'VACANT'}</span></span>`;
    if (isGov) {
      const btn = document.createElement('button');
      btn.textContent = minister ? 'DISMISS' : 'APPOINT';
      btn.addEventListener('click', () => {
        if (minister) { L.dismissMinister(state, pf.id); onChange(true); }
        else showAppointModal(pf.id);
      });
      card.appendChild(btn);
    }
    g2.appendChild(card);
  }
  body.appendChild(g2);

  // bills before parliament
  const g3 = document.createElement('div'); g3.className = 'nx-group';
  g3.innerHTML = `<b class="hd">BEFORE PARLIAMENT (${leg.bills.length})</b>`;
  if (!leg.bills.length) {
    const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.74rem';
    p.textContent = 'No bills currently before Parliament.';
    g3.appendChild(p);
  }
  for (const bill of leg.bills) {
    const def = D.BILLS_BY_ID[bill.billDefId];
    const pct = Math.min(100, Math.round(bill.turnsInStage / 3 * 100));
    const card = document.createElement('div'); card.className = 'nx-bill-card';
    card.innerHTML = `<div class="top"><b>${esc(def.name)}</b><span class="stage">IN COMMITTEE</span></div>
      <div class="ds">${esc(def.desc)}</div>
      <div class="prog"><i style="width:${pct}%"></i></div>
      <div class="meta"><span>Sponsor: ${esc(partyName(bill.sponsorParty))}</span><span>${esc(def.cat)}</span></div>`;
    g3.appendChild(card);
  }
  body.appendChild(g3);

  // propose legislation
  const g4 = document.createElement('div'); g4.className = 'nx-group';
  g4.innerHTML = `<b class="hd">PROPOSE LEGISLATION</b>`;
  const candidates = D.BILLS.filter(b => !leg.activeLawIds.includes(b.id) && !leg.bills.some(x => x.billDefId === b.id));
  if (!candidates.length) {
    const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.74rem';
    p.textContent = 'No further bills are currently available to propose.';
    g4.appendChild(p);
  }
  for (const cat of D.BILL_CATEGORIES) {
    const items = candidates.filter(b => b.cat === cat);
    if (!items.length) continue;
    const catEl = document.createElement('div'); catEl.className = 'nx-build-cat'; catEl.textContent = cat.toUpperCase();
    g4.appendChild(catEl);
    for (const def of items) {
      const card = document.createElement('div'); card.className = 'nx-cabinet-card';
      card.innerHTML = `<span class="role"><b>${esc(def.name)}</b><span>${esc(def.desc)}</span></span>`;
      const btn = document.createElement('button'); btn.textContent = 'INTRODUCE';
      btn.addEventListener('click', () => {
        const r = L.introduceBill(state, def.id, leg.playerParty);
        if (!r.ok) toast(r.reason, 'warn');
        onChange(true);
      });
      card.appendChild(btn);
      g4.appendChild(card);
    }
  }
  body.appendChild(g4);

  // executive orders + repeal — government only
  if (isGov) {
    const g5 = document.createElement('div'); g5.className = 'nx-group';
    const cd = Math.max(0, leg.nextExecutiveOrderTurn - state.meta.tick);
    g5.innerHTML = `<b class="hd">EXECUTIVE ORDERS</b>
      <p style="color:var(--muted);font-size:.7rem;margin-bottom:8px">Enact a law instantly, bypassing a floor vote — at a higher risk of being struck down by the courts. ${cd > 0 ? `On cooldown for ${cd} more weeks.` : ''}</p>`;
    if (cd <= 0 && candidates.length) {
      for (const def of candidates) {
        const card = document.createElement('div'); card.className = 'nx-cabinet-card';
        card.innerHTML = `<span class="role"><b>${esc(def.name)}</b><span>${esc(def.cat)}</span></span>`;
        const btn = document.createElement('button'); btn.textContent = 'ENACT NOW';
        btn.addEventListener('click', () => {
          const r = L.issueExecutiveOrder(state, def.id);
          if (!r.ok) toast(r.reason, 'warn');
          onChange(true);
        });
        card.appendChild(btn);
        g5.appendChild(card);
      }
    }
    body.appendChild(g5);

    const g6 = document.createElement('div'); g6.className = 'nx-group';
    const activeLaws = leg.activeLawIds.map(id => D.BILLS_BY_ID[id]).filter(Boolean);
    g6.innerHTML = `<b class="hd">REPEAL A LAW</b>`;
    if (!activeLaws.length) {
      const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.74rem';
      p.textContent = 'No active laws to repeal.';
      g6.appendChild(p);
    }
    for (const def of activeLaws) {
      const card = document.createElement('div'); card.className = 'nx-cabinet-card';
      card.innerHTML = `<span class="role"><b>${esc(def.name)}</b><span>${esc(def.desc)}</span></span>`;
      const btn = document.createElement('button'); btn.textContent = 'REPEAL'; btn.style.color = '#f87171';
      btn.addEventListener('click', () => {
        const r = L.repealLaw(state, def.id);
        if (!r.ok) toast(r.reason, 'warn');
        onChange(true);
      });
      card.appendChild(btn);
      g6.appendChild(card);
    }
    body.appendChild(g6);
  }

  // legislator roster
  const g7 = document.createElement('div'); g7.className = 'nx-group';
  g7.innerHTML = `<b class="hd">LEGISLATORS (${leg.legislators.length})</b>`;
  const roster = leg.legislators.slice().sort((a, b) =>
    D.PARTIES.findIndex(p => p.id === a.party) - D.PARTIES.findIndex(p => p.id === b.party) || b.popularity - a.popularity);
  for (const l of roster) {
    const pd = D.PARTIES.find(p => p.id === l.party);
    const row = document.createElement('div'); row.className = 'nx-legislator-row';
    row.innerHTML = `<span class="dot" style="background:${pd.color}"></span><span class="nm">${esc(l.name)} <span style="color:var(--muted)">— ${esc(l.constituency)}</span></span><span style="color:var(--muted);font-size:.64rem">Loyalty ${l.loyalty} · Pop ${l.popularity}</span>`;
    g7.appendChild(row);
  }
  body.appendChild(g7);
}

function showAppointModal(portfolioId) {
  const pf = D.PORTFOLIOS_BY_ID[portfolioId];
  const takenIds = new Set(Object.values(state.legislature.cabinet));
  const eligible = state.legislature.legislators
    .filter(l => state.legislature.governingParties.includes(l.party) && !takenIds.has(l.id))
    .sort((a, b) => b.competence - a.competence);
  const box = $('modal-box');
  box.innerHTML = `<h2>Appoint ${esc(pf.name)}</h2>
    <div class="nx-feed" style="max-height:360px;overflow-y:auto;margin:12px 0">` +
    (eligible.length
      ? eligible.map(l => `<div class="nx-feed-item" data-id="${l.id}" style="cursor:pointer"><b>${esc(l.name)}</b> (${esc(partyName(l.party))}) — competence ${l.competence}, experience ${l.experience}</div>`).join('')
      : '<div class="nx-feed-item">No eligible legislators from the governing party.</div>') +
    `</div><div class="nx-menu-buttons"><button class="nx-btn" data-act="cancel">CANCEL</button></div>`;
  box.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => {
    L.appointMinister(state, portfolioId, el.dataset.id);
    $('modal').classList.add('hidden');
    onChange(true);
  }));
  box.querySelector('[data-act="cancel"]').addEventListener('click', () => $('modal').classList.add('hidden'));
  $('modal').classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* archive tab                                                          */
/* ------------------------------------------------------------------ */
let archiveSubTab = 'elections';
function renderArchive(body) {
  const tabs = document.createElement('div'); tabs.className = 'nx-archive-tabs';
  for (const [key, label] of [['elections', 'Elections'], ['governments', 'Governments'], ['lawcode', 'Law Code'], ['budgets', 'Budgets']]) {
    const btn = document.createElement('button'); btn.textContent = label;
    btn.classList.toggle('on', archiveSubTab === key);
    btn.addEventListener('click', () => { archiveSubTab = key; renderDash(); });
    tabs.appendChild(btn);
  }
  body.appendChild(tabs);

  const g = document.createElement('div'); g.className = 'nx-group';
  const h = state.history;
  if (archiveSubTab === 'elections') {
    g.innerHTML = `<b class="hd">ELECTION HISTORY (${h.elections.length})</b>` +
      (h.elections.slice().reverse().map(e => {
        const year = Math.floor(e.turn / 52) + 1;
        const results = e.results.slice().sort((a, b) => b.seats - a.seats).map(r => `${esc(partyName(r.party))} ${r.seats}`).join(', ');
        return `<div class="nx-archive-row"><b>Year ${year}</b> — ${results}${e.isPlayerGovernment ? ' · <span style="color:var(--green)">You formed Government</span>' : ''}</div>`;
      }).join('') || '<div class="nx-archive-row">No elections recorded yet.</div>');
  } else if (archiveSubTab === 'governments') {
    g.innerHTML = `<b class="hd">GOVERNMENTS (${h.governments.length})</b>` +
      (h.governments.slice().reverse().map(gv => {
        const startY = Math.floor(gv.startTurn / 52) + 1;
        const endY = gv.endTurn != null ? Math.floor(gv.endTurn / 52) + 1 : null;
        return `<div class="nx-archive-row"><b>${esc(gv.headOfGovernment)}</b> (${esc(partyName(gv.leadParty))}) — Year ${startY}${endY ? ` to Year ${endY}` : ' – present'}</div>`;
      }).join('') || '<div class="nx-archive-row">No governments recorded yet.</div>');
  } else if (archiveSubTab === 'lawcode') {
    g.innerHTML = `<b class="hd">NATIONAL LAW CODE (${state.legislature.lawCode.length})</b>`;
    const list = state.legislature.lawCode.slice().reverse();
    if (!list.length) {
      const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.74rem';
      p.textContent = 'No bills have been introduced yet.';
      g.appendChild(p);
    }
    const statusClassOf = st => st === 'passed' ? 'passed' : st === 'failed' ? 'failed' : (st === 'struck_down' || st === 'repealed') ? 'struck' : '';
    const statusLabelOf = st => ({ in_committee: 'IN COMMITTEE', passed: 'LAW', failed: 'FAILED', struck_down: 'STRUCK DOWN', repealed: 'REPEALED' }[st] || st.toUpperCase());
    for (const bill of list) {
      const def = D.BILLS_BY_ID[bill.billDefId];
      const card = document.createElement('div'); card.className = 'nx-bill-card ' + statusClassOf(bill.status);
      card.innerHTML = `<div class="top"><b>${esc(def.name)}</b><span class="stage">${statusLabelOf(bill.status)}</span></div>
        <div class="ds">${esc(def.desc)}</div>
        <div class="meta"><span>${bill.origin === 'executive' ? 'Executive Order' : 'Sponsor: ' + esc(partyName(bill.sponsorParty))}</span><span>${esc(def.cat)} · Year ${Math.floor(bill.introducedTurn / 52) + 1}</span></div>
        ${bill.votesFor != null ? `<div class="meta"><span>Vote: ${bill.votesFor}-${bill.votesAgainst} (${bill.abstentions} abstain)</span></div>` : ''}`;
      g.appendChild(card);
    }
  } else if (archiveSubTab === 'budgets') {
    g.innerHTML = `<b class="hd">YEARLY BUDGET HISTORY (${h.budgets.length})</b>` +
      (h.budgets.slice().reverse().map(b =>
        `<div class="nx-archive-row"><b>Year ${b.year}</b> — Revenue ${fmtMoney(b.revenue)}, Spending ${fmtMoney(b.spending)}, Debt ${fmtMoney(b.debt)}, GDP ${fmtMoney(b.gdp)}, Pop ${fmt(b.population)}</div>`
      ).join('') || '<div class="nx-archive-row">No budget snapshots recorded yet (recorded once per in-game year).</div>');
  }
  body.appendChild(g);
}

function renderTerritory(body) {
  const g1 = document.createElement('div'); g1.className = 'nx-group';
  g1.innerHTML = `<b class="hd">CITIES</b>` + state.cities.map(c => `<div class="nx-feed-item"><b>${esc(c.name)}</b> — capital</div>`).join('');
  body.appendChild(g1);

  let owned = 0, resources = {};
  for (const t of state.world.tiles) {
    if (t.owner === 0) { owned++; if (t.resource) resources[t.resource] = (resources[t.resource] || 0) + 1; }
  }
  const g2 = document.createElement('div'); g2.className = 'nx-group';
  g2.innerHTML = `<b class="hd">TERRITORY</b><div class="nx-stat-grid">
    <div class="nx-stat-card"><div class="v">${owned}</div><div class="l">TILES OWNED</div></div>
    <div class="nx-stat-card"><div class="v">${Object.values(resources).reduce((a, b) => a + b, 0)}</div><div class="l">RESOURCE DEPOSITS</div></div>
  </div>`;
  body.appendChild(g2);

  const g3 = document.createElement('div'); g3.className = 'nx-group';
  const hasBase = state.buildings.some(b => b.built && b.type === 'military_base');
  g3.innerHTML = `<b class="hd">MILITARY</b>
    <div class="nx-stat-grid"><div class="nx-stat-card"><div class="v">${state.stats.defense}</div><div class="l">DEFENSE RATING</div></div></div>
    <div class="nx-military-row">
      <div class="nx-military-card"><div class="v">${state.militaryUnits.army}</div><div class="l">ARMY</div><button data-u="army">TRAIN $800</button></div>
      <div class="nx-military-card"><div class="v">${state.militaryUnits.navy}</div><div class="l">NAVY</div><button data-u="navy">TRAIN $2200</button></div>
      <div class="nx-military-card"><div class="v">${state.militaryUnits.airforce}</div><div class="l">AIR FORCE</div><button data-u="airforce">TRAIN $2600</button></div>
    </div>
    ${hasBase ? '' : '<p style="color:var(--muted);font-size:.7rem;margin-top:8px">Build a Military Base to train units.</p>'}`;
  g3.querySelectorAll('button[data-u]').forEach(btn => btn.addEventListener('click', () => {
    const r = S.trainUnit(state, btn.dataset.u);
    if (!r.ok) toast(r.reason || 'Cannot train unit.', 'warn');
    onChange(true);
  }));
  body.appendChild(g3);
}

function renderEvents(body) {
  const g = document.createElement('div'); g.className = 'nx-group';
  g.innerHTML = `<b class="hd">EVENT HISTORY</b><div class="nx-feed">` +
    (state.events.log.slice().reverse().map(e => `<div class="nx-feed-item"><b>${esc(e.title)}</b><br>${esc(e.choice)}</div>`).join('') || '<div class="nx-feed-item">No events yet.</div>') +
    `</div>`;
  body.appendChild(g);
}

/* ------------------------------------------------------------------ */
/* event modal                                                          */
/* ------------------------------------------------------------------ */
function showEventModal() {
  if (!state.events.pending) { $('event-modal').classList.add('hidden'); return; }
  const ev = D.EVENTS.find(e => e.id === state.events.pending.id);
  const box = $('event-box');
  box.innerHTML = `<div class="icon">${ev.icon}</div><h2>${esc(ev.title)}</h2><p>${esc(ev.desc)}</p><div class="nx-event-choices"></div>`;
  const wrap = box.querySelector('.nx-event-choices');
  ev.choices.forEach((c, i) => {
    const btn = document.createElement('button'); btn.textContent = c.label;
    btn.addEventListener('click', () => { S.resolveEvent(state, i); $('event-modal').classList.add('hidden'); onChange(true); });
    wrap.appendChild(btn);
  });
  $('event-modal').classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* full refresh                                                         */
/* ------------------------------------------------------------------ */
function refresh() {
  renderTopbar();
  renderDash();
  drainToasts();
  showEventModal();
}

function init(_state, changeCb) {
  state = _state;
  onChange = changeCb || (() => {});
  armedBuild = null; selectedTile = null; lastNotifShown = 0;
  initMap(state);
  document.querySelectorAll('.nx-tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  refresh();
}
function setState(_state) { state = _state; lastNotifShown = state.notifications.length ? state.notifications[state.notifications.length - 1].id : 0; }
function cancelBuild() { armedBuild = null; $('build-hint').classList.add('hidden'); }

return { init, setState, refresh, renderMap, cancelBuild, toast, get armedBuild() { return armedBuild; } };
})();
