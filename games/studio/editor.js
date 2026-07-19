/* ============================================================================
   GX STUDIO editor — hierarchy, inspector, viewport gizmos, play-in-editor,
   save/load/publish. Drives games/studio/engine.js.
   ========================================================================== */
(() => {
'use strict';
const GXS = window.GXStudio;
const $ = id => document.getElementById(id);
const PROJECTS_KEY = 'gamingx.studio.projects';
const DRAFT_KEY = 'gamingx.studio.draft';

/* ------------------------------------------------------------------ */
/* project storage                                                    */
/* ------------------------------------------------------------------ */
const loadProjects = () => { try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); } catch (e) { return []; } };
const saveProjects = list => { try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(list)); } catch (e) {} };

/* ------------------------------------------------------------------ */
/* templates                                                          */
/* ------------------------------------------------------------------ */
function templateBaseplate() {
  const s = GXS.newScene('Baseplate');
  s.settings.sky = { top: '#8ec5ff', bottom: '#dff0ff' };
  s.settings.fogColor = '#cfe6ff'; s.settings.fogDensity = 0.006;
  s.settings.ambient = { color: '#bfd4ff', intensity: 0.7 };
  s.entities.push(GXS.PREFABS.baseplate());
  s.entities.push(GXS.PREFABS.spawn());
  const sun = GXS.PREFABS.dirlight(); sun.transform.position = [30, 50, 20];
  s.entities.push(sun);
  return s;
}
function templateEmpty() {
  const s = GXS.newScene('Empty Scene');
  s.entities.push(GXS.PREFABS.plane());
  s.entities.push(GXS.PREFABS.dirlight());
  const cam = GXS.PREFABS.camerafollow();
  s.entities.push(cam);
  return s;
}
function templatePhysics() {
  const s = GXS.newScene('Physics Playground');
  s.entities.push(GXS.PREFABS.plane());
  s.entities.push(GXS.PREFABS.dirlight());
  s.entities.push(GXS.PREFABS.camerafollow());
  const player = GXS.PREFABS.player();
  player.transform.position = [0, 1, 8];
  s.entities.push(player);
  const ramp = GXS.PREFABS.crate(); ramp.name = 'Ramp'; ramp.transform.position = [-3, 1, 2]; ramp.rigidbody.mass = 0;
  ramp.transform.scale = [3, 0.4, 3]; ramp.transform.rotation = [0, 0, 18];
  s.entities.push(ramp);
  for (let i = 0; i < 5; i++) {
    const c = GXS.PREFABS.crate();
    c.name = 'Crate ' + (i + 1);
    c.transform.position = [2 + (i % 2) * 1.05, 1 + Math.floor(i / 2) * 1.05, -2];
    s.entities.push(c);
  }
  return s;
}
function templateArena() {
  const s = GXS.newScene('Arena Adventure');
  s.entities.push(GXS.PREFABS.plane());
  s.entities.push(GXS.PREFABS.dirlight());
  s.entities.push(GXS.PREFABS.camerafollow());
  const player = GXS.PREFABS.player();
  s.entities.push(player);
  const coinSpots = [[3, 1, 2], [-3, 1, -1], [5, 1, -5], [-5, 1, -6], [0, 1, -10]];
  for (let i = 0; i < coinSpots.length; i++) {
    const c = GXS.PREFABS.coin(); c.name = 'Coin ' + (i + 1); c.transform.position = coinSpots[i];
    s.entities.push(c);
  }
  const enemy = GXS.PREFABS.enemy(); enemy.transform.position = [0, 0.6, -4];
  s.entities.push(enemy);
  const platform = GXS.PREFABS.platform(); platform.transform.position = [4, 1.5, -8];
  s.entities.push(platform);
  const win = GXS.PREFABS.winzone(); win.transform.position = [0, 0.06, -16];
  s.entities.push(win);
  return s;
}

/* ------------------------------------------------------------------ */
/* state                                                              */
/* ------------------------------------------------------------------ */
let project = null;
let runtime = null;
let orbit = null, gizmo = null;
let selectedId = null;
let tool = 'move';
let undoStack = [];
let dirty = false;
let autosaveTimer = 0;
const CREDITS = window.GXCredits;
const IS_PRO = new URLSearchParams(location.search).get('pro') === '1';
const proMode = IS_PRO;            // GX Studio Pro is free — the FX are metered
function fxCost(key) { return CREDITS ? CREDITS.priceOf(key) : 20; }
function refreshCreditBadge() {
  const b = document.querySelector('.st-logo .gxc-badge');
  if (b && CREDITS) b.textContent = '⚡ ' + CREDITS.balance();
}
/* charge a powerful-engine action against the wallet; pops the top-up modal if broke */
async function chargeFX(feature, key) {
  if (!CREDITS) return true;
  const ok = await CREDITS.trySpend(key, feature, refreshCreditBadge);
  refreshCreditBadge();
  return ok;
}

/* ------------------------------------------------------------------ */
/* entity tree helpers                                                */
/* ------------------------------------------------------------------ */
function findWithParent(id, list, parentArr) {
  list = list || project.entities;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return { entity: list[i], array: list, index: i };
    const r = findWithParent(id, list[i].children || [], list[i].children);
    if (r) return r;
  }
  return null;
}
function entityKind(e) {
  if (e.mesh) return 'mesh';
  if (e.light) return 'light';
  if (e.camera) return 'camera';
  return 'empty';
}
function toolToGizmoMode(t) { return t === 'move' ? 'translate' : t; }
function entityIcon(e) {
  if (e.mesh) return (e.mesh.isSpawn ? '⬢' : { box: '◼', sphere: '●', cylinder: '⬤', cone: '▲', torus: '◎', wedge: '◹', plane: '▬' }[e.mesh.shape]) || '◼';
  if (e.light) return '💡';
  if (e.camera) return '🎥';
  return '📁';
}

/* ------------------------------------------------------------------ */
/* viewport / gizmo setup                                              */
/* ------------------------------------------------------------------ */
function initViewport() {
  const canvas = $('viewport');
  runtime = new GXS.Runtime(canvas, project, { onEnd: handleGameEnd, onLog: handleLog });

  orbit = new THREE.OrbitControls(runtime.editCamera, canvas);
  orbit.target.set(0, 1, 0);
  orbit.enableDamping = true; orbit.dampingFactor = 0.12;
  orbit.maxDistance = 120;

  gizmo = new THREE.TransformControls(runtime.editCamera, canvas);
  gizmo.setMode(toolToGizmoMode(tool));
  gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
  gizmo.addEventListener('objectChange', () => syncSelectedTransformFromGizmo());
  runtime.scene.add(gizmo);

  bindViewportPicking(canvas);

  let last = performance.now();
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    if (!runtime.playing) orbit.update();
    runtime.step(dt);
    runtime.render();
    updateStats();
  }
  requestAnimationFrame(frame);
}

/* click-to-select in the viewport (a drag beyond a few px is treated as an
   orbit drag, not a selection click — same convention as Unity/Unreal) */
function bindViewportPicking(canvas) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downX = 0, downY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY;
    if (runtime.playing && runtime.characterMode && document.pointerLockElement !== canvas && canvas.requestPointerLock) canvas.requestPointerLock();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (runtime.playing || gizmo.dragging) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // was a camera drag
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, runtime.editCamera);
    const meshes = [...runtime.entities.values()].filter(r => r.meshObj).map(r => r.meshObj);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.entityId) o = o.parent;
      if (o) selectEntity(o.userData.entityId);
    } else {
      selectEntity(null);
    }
  });
}

function reattachGizmoScene() {
  // loadScene() creates a brand new THREE.Scene; the gizmo helper must live in it.
  runtime.scene.add(gizmo);
}

function updateStats() {
  $('viewstats').textContent = `${runtime.entities.size} entities · ${tool.toUpperCase()} tool` + (runtime.playing ? ' · PLAYING' : '');
}

function syncSelectedTransformFromGizmo() {
  if (!selectedId) return;
  const rec = runtime.entities.get(selectedId);
  const ent = findWithParent(selectedId) && findWithParent(selectedId).entity;
  if (!rec || !ent) return;
  ent.transform.position = [rec.object3d.position.x, rec.object3d.position.y, rec.object3d.position.z];
  ent.transform.rotation = [THREE.MathUtils.radToDeg(rec.object3d.rotation.x), THREE.MathUtils.radToDeg(rec.object3d.rotation.y), THREE.MathUtils.radToDeg(rec.object3d.rotation.z)];
  ent.transform.scale = [rec.object3d.scale.x, rec.object3d.scale.y, rec.object3d.scale.z];
  refreshTransformFields();
  markDirty();
}

/* ------------------------------------------------------------------ */
/* selection                                                          */
/* ------------------------------------------------------------------ */
function selectEntity(id) {
  selectedId = id;
  const rec = id ? runtime.entities.get(id) : null;
  if (rec && rec.object3d) gizmo.attach(rec.object3d);
  else gizmo.detach();
  renderHierarchy();
  renderInspectorEntity();
}

/* ------------------------------------------------------------------ */
/* hierarchy panel                                                     */
/* ------------------------------------------------------------------ */
function renderHierarchy() {
  const root = $('hierarchy');
  root.innerHTML = '';
  const build = (list, container) => {
    for (const e of list) {
      const node = document.createElement('div');
      node.className = 'st-node' + (e.id === selectedId ? ' on' : '');
      node.innerHTML = `<span class="ic">${entityIcon(e)}</span><span class="nm">${escapeHtml(e.name)}</span>` + (e.tag ? `<span class="tag">${escapeHtml(e.tag)}</span>` : '');
      node.addEventListener('click', () => selectEntity(e.id));
      container.appendChild(node);
      if (e.children && e.children.length) {
        const kids = document.createElement('div');
        kids.className = 'st-node-children';
        container.appendChild(kids);
        build(e.children, kids);
      }
    }
  };
  build(project.entities, root);
  if (!project.entities.length) root.innerHTML = '<div class="st-empty-hint">Scene is empty.<br>Click “Add Object” to begin.</div>';
}

/* ------------------------------------------------------------------ */
/* inspector: entity tab                                               */
/* ------------------------------------------------------------------ */
function refreshTransformFields() {
  const found = selectedId && findWithParent(selectedId);
  if (!found) return;
  const e = found.entity;
  ['position', 'rotation', 'scale'].forEach(key => {
    ['x', 'y', 'z'].forEach((ax, i) => {
      const el = document.getElementById(`f-${key}-${ax}`);
      if (el && document.activeElement !== el) el.value = round2(e.transform[key][i]);
    });
  });
}
const round2 = n => Math.round(n * 100) / 100;
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function applyLiveVisual(entity, rec) {
  // called after any inspector field edit to reflect it immediately without a full rebuild
  if (!rec) return;
  const t = entity.transform;
  rec.object3d.position.set(...t.position);
  rec.object3d.rotation.set(THREE.MathUtils.degToRad(t.rotation[0]), THREE.MathUtils.degToRad(t.rotation[1]), THREE.MathUtils.degToRad(t.rotation[2]));
  rec.object3d.scale.set(...t.scale);
  if (entity.mesh && rec.meshObj) {
    // rebuild the material so Roblox material/transparency/reflectance all apply live
    const old = rec.meshObj.material;
    rec.meshObj.material = GXS.buildMaterial(entity.mesh);
    if (old && old.dispose) old.dispose();
    rec.meshObj.castShadow = entity.mesh.castShadow; rec.meshObj.receiveShadow = entity.mesh.receiveShadow;
  }
  if (entity.light && rec.lightObj) {
    rec.lightObj.color.set(entity.light.color); rec.lightObj.intensity = entity.light.intensity;
    if ('distance' in rec.lightObj) rec.lightObj.distance = entity.light.distance;
    if ('angle' in rec.lightObj) rec.lightObj.angle = entity.light.angle;
    if ('penumbra' in rec.lightObj) rec.lightObj.penumbra = entity.light.penumbra;
  }
  if (entity.camera && rec.cameraObj) {
    rec.cameraObj.fov = entity.camera.fov; rec.cameraObj.updateProjectionMatrix();
  }
}

function renderInspectorEntity() {
  const panel = $('inspector-entity');
  const found = selectedId && findWithParent(selectedId);
  if (!found) { panel.innerHTML = '<div class="st-empty-hint">Nothing selected.<br>Click an object in the Hierarchy or in the viewport.</div>'; return; }
  const e = found.entity;
  const rec = runtime.entities.get(e.id);

  let html = '';
  html += `<div class="st-group"><div class="st-group-head"><b>OBJECT</b></div>
    <div class="st-field"><label>NAME</label><input class="st-input" id="f-name" value="${escapeHtml(e.name)}"></div>
    <div class="st-field"><label>TAG</label><input class="st-input" id="f-tag" placeholder="e.g. player, enemy" value="${escapeHtml(e.tag)}"></div>
  </div>`;

  html += `<div class="st-group"><div class="st-group-head"><b>TRANSFORM</b></div>
    <div class="st-field"><label>POSITION</label><div class="st-row3">
      <input class="st-input" type="number" step="0.1" id="f-position-x" value="${round2(e.transform.position[0])}">
      <input class="st-input" type="number" step="0.1" id="f-position-y" value="${round2(e.transform.position[1])}">
      <input class="st-input" type="number" step="0.1" id="f-position-z" value="${round2(e.transform.position[2])}"></div></div>
    <div class="st-field"><label>ROTATION °</label><div class="st-row3">
      <input class="st-input" type="number" step="1" id="f-rotation-x" value="${round2(e.transform.rotation[0])}">
      <input class="st-input" type="number" step="1" id="f-rotation-y" value="${round2(e.transform.rotation[1])}">
      <input class="st-input" type="number" step="1" id="f-rotation-z" value="${round2(e.transform.rotation[2])}"></div></div>
    <div class="st-field"><label>SCALE</label><div class="st-row3">
      <input class="st-input" type="number" step="0.1" id="f-scale-x" value="${round2(e.transform.scale[0])}">
      <input class="st-input" type="number" step="0.1" id="f-scale-y" value="${round2(e.transform.scale[1])}">
      <input class="st-input" type="number" step="0.1" id="f-scale-z" value="${round2(e.transform.scale[2])}"></div></div>
  </div>`;

  if (e.mesh) html += meshSection(e);
  if (e.light) html += lightSection(e);
  if (e.camera) html += cameraSection(e);
  if (e.rigidbody) html += rigidbodySection(e);
  if (e.particles) html += particleSection(e);
  html += scriptsSection(e);

  const missing = [];
  if (!e.mesh) missing.push(['mesh', '📦 Mesh']);
  if (!e.light) missing.push(['light', '💡 Light']);
  if (!e.camera) missing.push(['camera', '🎥 Camera']);
  if (!e.rigidbody) missing.push(['rigidbody', '⚙️ RigidBody']);
  if (!e.particles) missing.push(['particles', '✨ Particles (⚡' + fxCost('studio.fx') + ')']);
  if (missing.length) {
    html += `<div class="st-addcomp">${missing.map(([k, l]) => `<button data-addcomp="${k}">+ ${l}</button>`).join('')}</div>`;
  }

  html += `<div class="st-modal-buttons">
    <button class="st-btn" id="btn-duplicate">⧉ Duplicate (Ctrl+D)</button>
    <button class="st-btn" id="btn-delete-entity" style="color:#f87171">🗑 Delete (Del)</button>
  </div>`;

  panel.innerHTML = html;
  wireEntityInspector(e, rec);
}

function meshSection(e) {
  const mat = e.mesh.material || 'plastic';
  const transparency = e.mesh.transparency != null ? e.mesh.transparency : (1 - (e.mesh.opacity != null ? e.mesh.opacity : 1));
  return `<div class="st-group"><div class="st-group-head"><b>📦 PART</b><button data-removecomp="mesh">✕</button></div>
    <div class="st-field"><label>SHAPE</label>
      <select class="st-input" id="f-mesh-shape">
        ${['box', 'sphere', 'cylinder', 'cone', 'wedge', 'torus', 'plane'].map(s => `<option value="${s}" ${e.mesh.shape === s ? 'selected' : ''}>${s === 'box' ? 'Block' : s}</option>`).join('')}
      </select></div>
    <div class="st-field"><label>MATERIAL</label>
      <select class="st-input" id="f-mesh-material">
        ${GXS.MATERIAL_ORDER.map(k => `<option value="${k}" ${mat === k ? 'selected' : ''}>${GXS.MATERIALS[k].label}</option>`).join('')}
      </select></div>
    <div class="st-field"><label>COLOR</label><input class="st-input" type="color" id="f-mesh-color" value="${e.mesh.color}"></div>
    <div class="st-field"><label>TRANSPARENCY</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="1" step="0.05" id="f-mesh-transparency" value="${transparency}"><span class="val">${round2(transparency)}</span></div></div>
    <div class="st-field"><label>REFLECTANCE</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="1" step="0.05" id="f-mesh-reflectance" value="${e.mesh.reflectance || 0}"><span class="val">${round2(e.mesh.reflectance || 0)}</span></div></div>
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-mesh-anchored" ${e.mesh.anchored !== false ? 'checked' : ''}> Anchored (won't fall)</label></div>
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-mesh-canCollide" ${e.mesh.canCollide !== false ? 'checked' : ''}> CanCollide</label></div>
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-mesh-castShadow" ${e.mesh.castShadow ? 'checked' : ''}> Cast shadow</label></div>
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-mesh-receiveShadow" ${e.mesh.receiveShadow ? 'checked' : ''}> Receive shadow</label></div>
  </div>`;
}
function lightSection(e) {
  const l = e.light;
  return `<div class="st-group"><div class="st-group-head"><b>💡 LIGHT</b><button data-removecomp="light">✕</button></div>
    <div class="st-field"><label>TYPE</label>
      <select class="st-input" id="f-light-type">
        ${['directional', 'point', 'spot', 'ambient'].map(s => `<option value="${s}" ${l.type === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></div>
    <div class="st-field"><label>COLOR</label><input class="st-input" type="color" id="f-light-color" value="${l.color}"></div>
    <div class="st-field"><label>INTENSITY</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="4" step="0.1" id="f-light-intensity" value="${l.intensity}"><span class="val">${l.intensity}</span></div></div>
    ${l.type !== 'directional' && l.type !== 'ambient' ? `<div class="st-field"><label>RANGE</label><div class="st-slider-row"><input class="st-input" type="range" min="2" max="40" step="1" id="f-light-distance" value="${l.distance}"><span class="val">${l.distance}</span></div></div>` : ''}
    ${l.type === 'spot' ? `<div class="st-field"><label>CONE ANGLE</label><div class="st-slider-row"><input class="st-input" type="range" min="0.05" max="1.2" step="0.05" id="f-light-angle" value="${l.angle}"><span class="val">${l.angle}</span></div></div>` : ''}
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-light-castShadow" ${l.castShadow ? 'checked' : ''}> Cast shadow (needs full rebuild)</label></div>
  </div>`;
}
function cameraSection(e) {
  return `<div class="st-group"><div class="st-group-head"><b>🎥 CAMERA</b><button data-removecomp="camera">✕</button></div>
    <div class="st-field"><label>FIELD OF VIEW</label><div class="st-slider-row"><input class="st-input" type="range" min="30" max="110" step="1" id="f-camera-fov" value="${e.camera.fov}"><span class="val">${e.camera.fov}</span></div></div>
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-camera-isMain" ${e.camera.isMain ? 'checked' : ''}> Main Camera (used in Play)</label></div>
  </div>`;
}
function rigidbodySection(e) {
  const r = e.rigidbody;
  return `<div class="st-group"><div class="st-group-head"><b>⚙️ RIGIDBODY</b><button data-removecomp="rigidbody">✕</button></div>
    <div class="st-field"><label>MASS (0 = static)</label><input class="st-input" type="number" step="0.5" min="0" id="f-rb-mass" value="${r.mass}"></div>
    <div class="st-field"><label>COLLIDER SHAPE</label>
      <select class="st-input" id="f-rb-shape">
        ${['box', 'sphere', 'cylinder'].map(s => `<option value="${s}" ${r.shape === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></div>
    <div class="st-field"><label>FRICTION</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="1" step="0.05" id="f-rb-friction" value="${r.friction}"><span class="val">${r.friction}</span></div></div>
    <div class="st-field"><label>BOUNCINESS</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="1" step="0.05" id="f-rb-restitution" value="${r.restitution}"><span class="val">${r.restitution}</span></div></div>
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-rb-fixedRotation" ${r.fixedRotation ? 'checked' : ''}> Lock rotation</label></div>
  </div>`;
}
function particleSection(e) {
  const p = e.particles;
  const sld = (id, lbl, min, max, step, v) => `<div class="st-field"><label>${lbl}</label><div class="st-slider-row"><input class="st-input" type="range" min="${min}" max="${max}" step="${step}" id="${id}" value="${v}"><span class="val">${v}</span></div></div>`;
  const shapes = (GXS.PARTICLE_SHAPES || ['cone', 'sphere', 'box', 'fountain']);
  const cur = p.shape || 'cone';
  return `<div class="st-group"><div class="st-group-head"><b>✨ PARTICLES <span style="color:#f5b301">FX</span></b><button data-removecomp="particles">✕</button></div>
    <div class="st-field"><label>EMITTER SHAPE</label>
      <select class="st-input" id="f-pt-shape">${shapes.map(s => `<option value="${s}" ${cur === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="st-field"><label>COLOR START</label><input class="st-input" type="color" id="f-pt-color" value="${p.color}"></div>
    <div class="st-field"><label>COLOR END</label><input class="st-input" type="color" id="f-pt-color2" value="${p.color2}"></div>
    ${sld('f-pt-rate', 'RATE (/sec)', 5, 200, 5, p.rate)}
    ${sld('f-pt-size', 'SIZE', 0.05, 2, 0.05, p.size)}
    ${sld('f-pt-life', 'LIFETIME', 0.3, 4, 0.1, p.life)}
    ${sld('f-pt-speed', 'SPEED', 0.5, 12, 0.5, p.speed)}
    ${sld('f-pt-spread', 'SPREAD', 0, 3, 0.1, p.spread)}
    ${sld('f-pt-gravity', 'GRAVITY', -12, 6, 0.5, p.gravity)}
    ${sld('f-pt-drag', 'DRAG', 0, 5, 0.1, p.drag || 0)}
    ${sld('f-pt-turbulence', 'TURBULENCE', 0, 20, 0.5, p.turbulence || 0)}
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-pt-burst" ${p.burst ? 'checked' : ''}> Burst (fire all at once, loops)</label></div>
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-pt-additive" ${p.additive ? 'checked' : ''}> Glowing (additive)</label></div>
  </div>`;
}
function scriptsSection(e) {
  let html = `<div class="st-group"><div class="st-group-head"><b>📜 SCRIPTS</b></div>`;
  e.scripts.forEach((s, i) => {
    const lang = s.lang || 'js';
    html += `<div class="st-script" data-script-idx="${i}">
      <div class="st-script-head">
        <input type="text" class="st-input f-script-name" value="${escapeHtml(s.name)}">
        <select class="st-input f-script-lang" title="Language" style="max-width:96px">
          <option value="gamx" ${lang === 'gamx' ? 'selected' : ''}>GamX</option>
          <option value="js" ${lang === 'js' ? 'selected' : ''}>JavaScript</option>
        </select>
        <label class="st-check" style="font-size:.68rem"><input type="checkbox" class="f-script-enabled" ${s.enabled ? 'checked' : ''}> on</label>
        <button class="btn-remove-script" title="Remove script" style="color:#f87171">✕</button>
      </div>
      <textarea class="f-script-code" spellcheck="false">${escapeHtml(s.code)}</textarea>
      <div class="st-script-foot"><span style="color:var(--muted);font-size:.62rem">Edits apply next time you press Play</span></div>
    </div>`;
  });
  html += `<div class="st-addcomp">
    <button data-addscript="gamx">+ GamX Script</button>
    <button data-addscript="blank">+ JS Script</button>
    <button data-addscript-menu="1">+ From Library</button>
  </div>
  <div class="st-api-hint">
    <b style="color:var(--text)">GamX</b> — plain-English code. Blocks: <code>when the game starts:</code> · <code>every frame:</code> · <code>when touched:</code> (close with <code>end</code>).<br>
    Commands: <code>move forward 6</code> · <code>spin 90</code> · <code>jump</code> · <code>say "hi"</code> · <code>make me blue</code> · <code>add 10 to score</code> · <code>win</code> / <code>lose</code> · <code>destroy me</code> · <code>let speed be 5</code>.<br>
    Ifs: <code>if key "W" is down:</code> · <code>if player is near 2:</code> · <code>if score is 30 or more:</code><br>
    <span style="color:var(--muted)">Switch a script to <b>JavaScript</b> for the full <code>api</code> (api.entity, api.velocity, api.find, api.dt…).</span>
  </div>
  </div>`;
  return html;
}

function wireEntityInspector(e, rec) {
  const panel = $('inspector-entity');
  const bindText = (id, path) => {
    const el = panel.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('input', () => {
      setPath(e, path, el.value);
      markDirty();
      if (path[0] === 'name') renderHierarchy();
    });
  };
  bindText('f-name', ['name']);
  bindText('f-tag', ['tag']);

  ['position', 'rotation', 'scale'].forEach(key => {
    ['x', 'y', 'z'].forEach((ax, i) => {
      const el = panel.querySelector(`#f-${key}-${ax}`);
      if (!el) return;
      el.addEventListener('input', () => {
        e.transform[key][i] = parseFloat(el.value) || 0;
        applyLiveVisual(e, rec);
        markDirty();
      });
    });
  });

  const bindSlider = (id, obj, key, isColor) => {
    const el = panel.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('input', () => {
      obj[key] = isColor ? el.value : parseFloat(el.value);
      const val = el.parentElement.querySelector('.val');
      if (val) val.textContent = obj[key];
      applyLiveVisual(e, rec);
      markDirty();
    });
  };
  const bindCheck = (id, obj, key, needsRebuild) => {
    const el = panel.querySelector('#' + id);
    if (!el) return;
    el.addEventListener('change', () => {
      obj[key] = el.checked;
      markDirty();
      if (needsRebuild) rebuildViewport(); else applyLiveVisual(e, rec);
    });
  };

  if (e.mesh) {
    const sel = panel.querySelector('#f-mesh-shape');
    if (sel) sel.addEventListener('change', () => { e.mesh.shape = sel.value; markDirty(); rebuildViewport(); });
    const matSel = panel.querySelector('#f-mesh-material');
    if (matSel) matSel.addEventListener('change', () => { e.mesh.material = matSel.value; applyLiveVisual(e, rec); markDirty(); });
    bindSlider('f-mesh-color', e.mesh, 'color', true);
    bindSlider('f-mesh-transparency', e.mesh, 'transparency');
    bindSlider('f-mesh-reflectance', e.mesh, 'reflectance');
    bindCheck('f-mesh-anchored', e.mesh, 'anchored');
    bindCheck('f-mesh-canCollide', e.mesh, 'canCollide');
    bindCheck('f-mesh-castShadow', e.mesh, 'castShadow');
    bindCheck('f-mesh-receiveShadow', e.mesh, 'receiveShadow');
  }
  if (e.light) {
    const sel = panel.querySelector('#f-light-type');
    if (sel) sel.addEventListener('change', () => { e.light.type = sel.value; markDirty(); rebuildViewport(); });
    bindSlider('f-light-color', e.light, 'color', true);
    bindSlider('f-light-intensity', e.light, 'intensity');
    bindSlider('f-light-distance', e.light, 'distance');
    bindSlider('f-light-angle', e.light, 'angle');
    bindCheck('f-light-castShadow', e.light, 'castShadow', true);
  }
  if (e.camera) {
    bindSlider('f-camera-fov', e.camera, 'fov');
    const main = panel.querySelector('#f-camera-isMain');
    if (main) main.addEventListener('change', () => {
      if (main.checked) for (const other of allEntitiesFlat()) if (other.camera) other.camera.isMain = false;
      e.camera.isMain = main.checked;
      markDirty(); rebuildViewport();
    });
  }
  if (e.rigidbody) {
    const mass = panel.querySelector('#f-rb-mass');
    if (mass) mass.addEventListener('input', () => { e.rigidbody.mass = parseFloat(mass.value) || 0; markDirty(); });
    const shape = panel.querySelector('#f-rb-shape');
    if (shape) shape.addEventListener('change', () => { e.rigidbody.shape = shape.value; markDirty(); });
    bindSlider('f-rb-friction', e.rigidbody, 'friction');
    bindSlider('f-rb-restitution', e.rigidbody, 'restitution');
    const fr = panel.querySelector('#f-rb-fixedRotation');
    if (fr) fr.addEventListener('change', () => { e.rigidbody.fixedRotation = fr.checked; markDirty(); });
  }

  if (e.particles) {
    const bindPt = (id, key, isColor) => {
      const el = panel.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('input', () => {
        e.particles[key] = isColor ? el.value : parseFloat(el.value);
        const val = el.parentElement.querySelector('.val');
        if (val) val.textContent = e.particles[key];
        markDirty(); rebuildViewport();
      });
    };
    bindPt('f-pt-color', 'color', true);
    bindPt('f-pt-color2', 'color2', true);
    bindPt('f-pt-rate', 'rate');
    bindPt('f-pt-size', 'size');
    bindPt('f-pt-life', 'life');
    bindPt('f-pt-speed', 'speed');
    bindPt('f-pt-spread', 'spread');
    bindPt('f-pt-gravity', 'gravity');
    bindPt('f-pt-drag', 'drag');
    bindPt('f-pt-turbulence', 'turbulence');
    const shape = panel.querySelector('#f-pt-shape');
    if (shape) shape.addEventListener('change', () => { e.particles.shape = shape.value; markDirty(); rebuildViewport(); });
    const burst = panel.querySelector('#f-pt-burst');
    if (burst) burst.addEventListener('change', () => { e.particles.burst = burst.checked; markDirty(); rebuildViewport(); });
    const add = panel.querySelector('#f-pt-additive');
    if (add) add.addEventListener('change', () => { e.particles.additive = add.checked; markDirty(); rebuildViewport(); });
  }

  panel.querySelectorAll('[data-addcomp]').forEach(btn => btn.addEventListener('click', async () => {
    const kind = btn.dataset.addcomp;
    if (kind === 'particles' && !(await chargeFX('Particle FX', 'studio.fx'))) return;
    if (kind === 'mesh') e.mesh = GXS.newEntity('mesh').mesh;
    if (kind === 'light') e.light = GXS.newEntity('light').light;
    if (kind === 'camera') e.camera = GXS.newEntity('camera').camera;
    if (kind === 'rigidbody') e.rigidbody = { mass: 1, shape: 'box', friction: 0.4, restitution: 0.1, fixedRotation: false, isTrigger: false, linearDamping: 0.05 };
    if (kind === 'particles') e.particles = GXS.defaultParticles();
    markDirty(); rebuildViewport(); renderInspectorEntity();
  }));
  panel.querySelectorAll('[data-removecomp]').forEach(btn => btn.addEventListener('click', () => {
    e[btn.dataset.removecomp] = null;
    markDirty(); rebuildViewport(); renderInspectorEntity();
  }));

  panel.querySelectorAll('.st-script').forEach(box => {
    const idx = parseInt(box.dataset.scriptIdx, 10);
    box.querySelector('.f-script-name').addEventListener('input', ev => { e.scripts[idx].name = ev.target.value; markDirty(); });
    box.querySelector('.f-script-enabled').addEventListener('change', ev => { e.scripts[idx].enabled = ev.target.checked; markDirty(); });
    box.querySelector('.f-script-code').addEventListener('input', ev => { e.scripts[idx].code = ev.target.value; markDirty(); });
    box.querySelector('.f-script-lang').addEventListener('change', ev => { e.scripts[idx].lang = ev.target.value; markDirty(); });
    box.querySelector('.btn-remove-script').addEventListener('click', () => { e.scripts.splice(idx, 1); markDirty(); renderInspectorEntity(); });
  });
  const gamxBtn = panel.querySelector('[data-addscript="gamx"]');
  if (gamxBtn) gamxBtn.addEventListener('click', () => {
    e.scripts.push({ id: GXS.uid(), name: 'GamX Script', enabled: true, lang: 'gamx', code: (window.GamX && window.GamX.SAMPLE) || 'every frame:\n  spin 90' });
    markDirty(); renderInspectorEntity();
  });
  const blankBtn = panel.querySelector('[data-addscript="blank"]');
  if (blankBtn) blankBtn.addEventListener('click', () => {
    e.scripts.push({ id: GXS.uid(), name: 'New Script', enabled: true, lang: 'js', code: GXS.SCRIPT_LIB.blank });
    markDirty(); renderInspectorEntity();
  });
  const libBtn = panel.querySelector('[data-addscript-menu]');
  if (libBtn) libBtn.addEventListener('click', () => showScriptLibraryModal(e));

  panel.querySelector('#btn-duplicate').addEventListener('click', () => duplicateEntity(e.id));
  panel.querySelector('#btn-delete-entity').addEventListener('click', () => deleteEntity(e.id));
}

function setPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = value;
}
function allEntitiesFlat(list) {
  list = list || project.entities;
  let out = [];
  for (const e of list) { out.push(e); out = out.concat(allEntitiesFlat(e.children || [])); }
  return out;
}

/* ------------------------------------------------------------------ */
/* inspector: scene tab                                                */
/* ------------------------------------------------------------------ */
function renderInspectorScene() {
  const s = project.settings;
  const panel = $('inspector-scene');
  panel.innerHTML = `
    <div class="st-group"><div class="st-group-head"><b>🌌 SKY & FOG</b></div>
      <div class="st-field"><label>SKY TOP</label><input class="st-input" type="color" id="s-sky-top" value="${s.sky.top}"></div>
      <div class="st-field"><label>SKY BOTTOM</label><input class="st-input" type="color" id="s-sky-bottom" value="${s.sky.bottom}"></div>
      <div class="st-field"><label>FOG COLOR</label><input class="st-input" type="color" id="s-fog-color" value="${s.fogColor}"></div>
      <div class="st-field"><label>FOG DENSITY</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="0.1" step="0.002" id="s-fog-density" value="${s.fogDensity}"><span class="val">${s.fogDensity}</span></div></div>
    </div>
    <div class="st-group"><div class="st-group-head"><b>💡 AMBIENT LIGHT</b></div>
      <div class="st-field"><label>COLOR</label><input class="st-input" type="color" id="s-amb-color" value="${s.ambient.color}"></div>
      <div class="st-field"><label>INTENSITY</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="1.5" step="0.05" id="s-amb-intensity" value="${s.ambient.intensity}"><span class="val">${s.ambient.intensity}</span></div></div>
    </div>
    <div class="st-group"><div class="st-group-head"><b>⚙️ PHYSICS & FX</b></div>
      <div class="st-field"><label>GRAVITY</label><div class="st-slider-row"><input class="st-input" type="range" min="-30" max="0" step="1" id="s-gravity" value="${s.gravity}"><span class="val">${s.gravity}</span></div></div>
      <div class="st-field"><label class="st-check"><input type="checkbox" id="s-shadows" ${s.shadows ? 'checked' : ''}> Shadows</label></div>
      <div class="st-field"><label class="st-check"><input type="checkbox" id="s-bloom" ${s.bloom ? 'checked' : ''}> Bloom glow</label></div>
      <div class="st-field"><label>BLOOM STRENGTH</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="2" step="0.05" id="s-bloom-strength" value="${s.bloomStrength}"><span class="val">${s.bloomStrength}</span></div></div>
    </div>`;

  const bind = (id, obj, key, isColor, cb) => {
    const el = panel.querySelector('#' + id);
    el.addEventListener('input', () => {
      obj[key] = isColor ? el.value : parseFloat(el.value);
      const val = el.parentElement.querySelector('.val');
      if (val) val.textContent = obj[key];
      markDirty();
      (cb || (() => runtime.applySettings()))();
    });
  };
  bind('s-sky-top', s.sky, 'top', true);
  bind('s-sky-bottom', s.sky, 'bottom', true);
  bind('s-fog-color', s, 'fogColor', true);
  bind('s-fog-density', s, 'fogDensity');
  bind('s-amb-color', s.ambient, 'color', true);
  bind('s-amb-intensity', s.ambient, 'intensity');
  bind('s-gravity', s, 'gravity');
  bind('s-bloom-strength', s, 'bloomStrength');
  panel.querySelector('#s-shadows').addEventListener('change', e => { s.shadows = e.target.checked; markDirty(); runtime.applySettings(); });
  panel.querySelector('#s-bloom').addEventListener('change', e => { s.bloom = e.target.checked; markDirty(); runtime.applySettings(); });
}

/* ------------------------------------------------------------------ */
/* structural edits (add / remove / duplicate) → full viewport rebuild */
/* ------------------------------------------------------------------ */
function rebuildViewport() {
  const wasSelected = selectedId;
  runtime.loadScene(project);
  reattachGizmoScene();
  selectEntity(wasSelected && runtime.entities.has(wasSelected) ? wasSelected : null);
}

function countParts() { return allEntitiesFlat().length; }
async function addEntity(key) {
  if (key === 'emitter' && !(await chargeFX('Particle Emitter', 'studio.emitter'))) return;
  const entity = GXS.PREFABS[key]();
  const sel = selectedId && findWithParent(selectedId);
  if (sel && entityKind(sel.entity) === 'empty') sel.entity.children.push(entity);
  else project.entities.push(entity);
  pushUndo();
  markDirty();
  rebuildViewport();
  selectEntity(entity.id);
  closeModal();
}
function duplicateEntity(id) {
  const found = findWithParent(id);
  if (!found) return;
  const clone = GXS.cloneEntity(found.entity);
  clone.name += ' Copy';
  found.array.splice(found.index + 1, 0, clone);
  pushUndo();
  markDirty();
  rebuildViewport();
  selectEntity(clone.id);
}
function deleteEntity(id) {
  const found = findWithParent(id);
  if (!found) return;
  found.array.splice(found.index, 1);
  pushUndo();
  markDirty();
  rebuildViewport();
  selectEntity(null);
}

/* ------------------------------------------------------------------ */
/* undo (coarse: whole-scene JSON snapshots on structural edits)       */
/* ------------------------------------------------------------------ */
function pushUndo() {
  undoStack.push(JSON.stringify({ entities: project.entities, settings: project.settings }));
  if (undoStack.length > 30) undoStack.shift();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) return setStatus('Nothing to undo', true);
  const data = JSON.parse(snap);
  project.entities = data.entities;
  project.settings = data.settings;
  rebuildViewport();
  renderInspectorScene();
  setStatus('Undone');
}

/* ------------------------------------------------------------------ */
/* toolbar / tool modes                                                */
/* ------------------------------------------------------------------ */
function setTool(t) {
  tool = t;
  document.querySelectorAll('.st-tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  if (t === 'select') gizmo.detach();
  else {
    gizmo.setMode(toolToGizmoMode(t));
    const rec = selectedId && runtime.entities.get(selectedId);
    if (rec) gizmo.attach(rec.object3d);
  }
}
$('toolbar').addEventListener('click', e => {
  const btn = e.target.closest('.st-tool');
  if (btn) setTool(btn.dataset.tool);
});
const quickBar = $('quick-insert');
if (quickBar) quickBar.addEventListener('click', e => {
  const btn = e.target.closest('.st-ins');
  if (btn) addEntity(btn.dataset.quick);
});
addEventListener('keydown', e => {
  if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.code === 'KeyQ') setTool('select');
  if (e.code === 'KeyW') setTool('move');
  if (e.code === 'KeyE') setTool('rotate');
  if (e.code === 'KeyR') setTool('scale');
  if (e.code === 'Delete' || e.code === 'Backspace') { if (selectedId) deleteEntity(selectedId); }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { if (selectedId) { duplicateEntity(selectedId); e.preventDefault(); } }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { undo(); e.preventDefault(); }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { saveProject(); e.preventDefault(); }
  if (e.code === 'Escape' && runtime.playing) stopPlay();
});

/* ------------------------------------------------------------------ */
/* tabs                                                                 */
/* ------------------------------------------------------------------ */
document.querySelectorAll('.st-tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.st-tab').forEach(t => t.classList.remove('on'));
  tab.classList.add('on');
  $('inspector-entity').classList.toggle('hidden', tab.dataset.tab !== 'entity');
  $('inspector-scene').classList.toggle('hidden', tab.dataset.tab !== 'scene');
  if (tab.dataset.tab === 'scene') renderInspectorScene();
}));

/* ------------------------------------------------------------------ */
/* console                                                             */
/* ------------------------------------------------------------------ */
function handleLog(who, msg, isError) {
  const log = $('console-log');
  const line = document.createElement('div');
  line.className = 'st-console-line' + (isError ? ' err' : '');
  line.innerHTML = `<b>${escapeHtml(who)}:</b> ${escapeHtml(msg)}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  if (isError) document.querySelector('.st-console').classList.remove('collapsed');
}
$('console-toggle').addEventListener('click', () => document.querySelector('.st-console').classList.toggle('collapsed'));
$('btn-clear-console').addEventListener('click', e => { e.stopPropagation(); $('console-log').innerHTML = ''; });

/* ------------------------------------------------------------------ */
/* play / stop                                                         */
/* ------------------------------------------------------------------ */
let hudTimer = 0;
function startPlay() {
  $('console-log').innerHTML = '';
  runtime.play();
  gizmo.detach();
  $('btn-play').textContent = '■ Stop';
  $('btn-play').classList.add('playing');
  $('playbadge').classList.remove('hidden');
  $('playbadge').textContent = runtime.characterMode ? '▶ PLAYING — WASD move · mouse look · Space jump · Esc to stop' : '▶ PLAYING — Esc to stop';
  $('gamehud').classList.remove('hidden');
  updateGameHud();
  hudTimer = setInterval(updateGameHud, 200);
  // pointer lock for mouse-look in character mode (from the Play click gesture)
  if (runtime.characterMode) { const cv = $('viewport'); if (cv.requestPointerLock) cv.requestPointerLock(); }
}
function updateGameHud() {
  if (!runtime.playing) return;
  $('gamehud').innerHTML = `<div class="chip"><small>SCORE</small>${runtime.score || 0}</div><div class="chip"><small>TIME</small>${Math.floor(runtime.time)}s</div>`;
}
function stopPlay() {
  clearInterval(hudTimer);
  if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
  runtime.stop();
  $('btn-play').textContent = '▶ Play';
  $('btn-play').classList.remove('playing');
  $('playbadge').classList.add('hidden');
  $('gamehud').classList.add('hidden');
  $('endcard').classList.add('hidden');
  reattachGizmoScene();
  renderHierarchy();
  selectEntity(selectedId && runtime.entities.has(selectedId) ? selectedId : null);
}
function handleGameEnd(result) {
  $('end-title').textContent = result.win ? '🏆 LEVEL CLEAR' : 'GAME OVER';
  $('end-msg').textContent = (result.message || '') + ` — Score: ${runtime.score || 0}`;
  $('endcard').classList.remove('hidden');
}
$('btn-play').addEventListener('click', () => { runtime.playing ? stopPlay() : startPlay(); });
$('btn-endcard-stop').addEventListener('click', stopPlay);

/* ------------------------------------------------------------------ */
/* status + autosave                                                    */
/* ------------------------------------------------------------------ */
let statusTimer = 0;
function setStatus(msg, err) {
  let el = $('gx-status');
  if (!el) { el = document.createElement('div'); el.id = 'gx-status'; el.className = 'st-status'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.toggle('err', !!err);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; }, 3200);
}
function markDirty() {
  dirty = true;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(project)); } catch (e) {} }, 500);
}

/* ------------------------------------------------------------------ */
/* save / publish / share / projects                                    */
/* ------------------------------------------------------------------ */
function saveProject(silent) {
  project.updated = Date.now();
  const list = loadProjects();
  const i = list.findIndex(p => p.id === project.id);
  if (i >= 0) list[i] = project; else list.push(project);
  saveProjects(list);
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(project)); } catch (e) {}
  dirty = false;
  if (!silent) setStatus('Saved ✓');
}
$('btn-save').addEventListener('click', () => saveProject());
$('title-input').addEventListener('input', e => { project.title = e.target.value; markDirty(); });

$('btn-publish').addEventListener('click', () => {
  const issues = GXS.validateScene(project);
  if (issues.length) return showModal(`<h2>NOT READY YET</h2><p>${issues.join('<br>')}</p><div class="st-modal-buttons"><button class="st-btn" data-x>OK</button></div>`);
  if (!project.title.trim()) project.title = 'Untitled Scene';
  project.published = true;
  saveProject(true);
  showModal(`<h2>🚀 PUBLISHED!</h2><p><b>${escapeHtml(project.title)}</b> is live in <b>My Creations</b> on the GamingX hub.</p>
    <div class="st-modal-buttons">
      <button class="st-btn st-btn-primary" data-act="play">▶ PLAY IT</button>
      <button class="st-btn" data-act="hub">GO TO HUB</button>
      <button class="st-btn" data-x>KEEP EDITING</button>
    </div>`, act => {
    if (act === 'play') location.href = 'play.html?id=' + project.id;
    if (act === 'hub') location.href = '../../index.html#creations';
  });
});

$('btn-share').addEventListener('click', () => {
  const json = JSON.stringify(project);
  showModal(`<h2>⇄ SHARE SCENE</h2><p>Copy this code to share your 3D scene, or paste one in and import it.</p>
    <textarea class="st-textarea" id="share-ta">${escapeHtml(json)}</textarea>
    <div class="st-modal-buttons">
      <button class="st-btn st-btn-primary" data-act="copy">COPY CODE</button>
      <button class="st-btn st-btn-accent" data-act="import">IMPORT</button>
      <button class="st-btn" data-x>CLOSE</button>
    </div>`, act => {
    const ta = document.getElementById('share-ta');
    if (act === 'copy') {
      ta.select();
      navigator.clipboard && navigator.clipboard.writeText(ta.value).catch(() => {});
      setStatus('Copied to clipboard');
    } else if (act === 'import') {
      try {
        const data = JSON.parse(ta.value);
        if (!data.entities || !Array.isArray(data.entities)) throw new Error('bad');
        data.id = GXS.uid(); data.published = false;
        project = data;
        rebuildViewport(); renderHierarchy(); selectEntity(null);
        $('title-input').value = project.title || '';
        saveProject(true);
        setStatus('Imported ✓');
      } catch (e) { setStatus('Invalid scene code', true); }
    }
  });
});

$('btn-myprojects').addEventListener('click', () => {
  const list = loadProjects().sort((a, b) => b.updated - a.updated);
  const rows = list.length ? list.map(p => `
    <div class="st-proj-row">
      <div class="nm">${escapeHtml(p.title || 'Untitled')} <span class="meta">· ${p.entities.length} objects</span>${p.published ? ' <span class="meta pub">· PUBLISHED</span>' : ''}</div>
      <button class="st-btn" data-act="open" data-id="${p.id}">OPEN</button>
      <button class="st-btn" data-act="del" data-id="${p.id}">🗑</button>
    </div>`).join('') : '<p>No saved scenes yet.</p>';
  showModal(`<h2>📁 MY PROJECTS</h2>${rows}<div class="st-modal-buttons"><button class="st-btn" data-x>CLOSE</button></div>`, (act, btn) => {
    const id = btn.dataset.id;
    if (act === 'open') {
      const p = loadProjects().find(x => x.id === id);
      if (p) { project = p; rebuildViewport(); renderHierarchy(); selectEntity(null); $('title-input').value = project.title || ''; setStatus('Loaded “' + (project.title || 'Untitled') + '”'); }
    } else if (act === 'del') {
      saveProjects(loadProjects().filter(x => x.id !== id));
      setStatus('Deleted');
    }
  });
});

$('btn-new').addEventListener('click', () => {
  showModal(`<h2>✚ NEW SCENE</h2>
    <div class="st-opt-row" id="nm-tpl">
      <button class="st-opt on" data-v="baseplate">BASEPLATE<small>baseplate + spawn (walk it!)</small></button>
      <button class="st-opt" data-v="physics">PHYSICS PLAYGROUND<small>ramps &amp; crates</small></button>
      <button class="st-opt" data-v="arena">ARENA ADVENTURE<small>coins, enemy, goal</small></button>
    </div>
    <div class="st-modal-buttons">
      <button class="st-btn st-btn-primary" data-act="create">CREATE</button>
      <button class="st-btn" data-x>CANCEL</button>
    </div>`, act => {
    if (act !== 'create') return;
    const v = document.querySelector('#nm-tpl .st-opt.on').dataset.v;
    project = v === 'physics' ? templatePhysics() : v === 'arena' ? templateArena() : templateBaseplate();
    undoStack = [];
    rebuildViewport(); renderHierarchy(); selectEntity(null);
    $('title-input').value = project.title || '';
    saveProject(true);
    setStatus('New scene created');
  });
  document.querySelectorAll('#nm-tpl .st-opt').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#nm-tpl .st-opt').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
  }));
});

/* ------------------------------------------------------------------ */
/* add-object modal                                                     */
/* ------------------------------------------------------------------ */
$('btn-add').addEventListener('click', () => {
  const cat = (title, items) => `<div class="st-cat">${title}</div><div class="st-grid-add">${items.map(([k, l, em]) => `<button data-add="${k}"><span class="em">${em}</span>${l}</button>`).join('')}</div>`;
  showModal(`<h2>✚ INSERT OBJECT</h2>
    ${cat('PARTS', [['part', 'Block', '◼'], ['ball', 'Ball', '●'], ['cylinder', 'Cylinder', '⬤'], ['wedge', 'Wedge', '◹'], ['cone', 'Cone', '▲'], ['spawn', 'SpawnLocation', '⬢'], ['baseplate', 'Baseplate', '▦'], ['group', 'Model (group)', '📁']])}
    ${cat('LIGHTING', [['dirlight', 'Sun (Directional)', '☀️'], ['pointlight', 'Point Light', '💡'], ['spotlight', 'Spot Light', '🔦'], ['ambient', 'Ambient', '🌫️']])}
    ${cat('CAMERA', [['camera', 'Camera', '🎥'], ['camerafollow', 'Follow Camera', '🎬']])}
    ${cat('GAMEPLAY PREFABS', [['coin', 'Coin Pickup', '🪙'], ['enemy', 'Patrol Enemy', '🔺'], ['platform', 'Moving Platform', '🟪'], ['winzone', 'Win Zone', '🏁'], ['crate', 'Physics Crate', '📦'], ['player', 'Scripted Player', '🔵']])}
    ${cat('FX — POWERFUL ENGINE ⚡' + fxCost('studio.emitter'), [['emitter', 'Particle Emitter', '✨']])}
    <div class="st-modal-buttons"><button class="st-btn" data-x>CANCEL</button></div>`);
  document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => addEntity(b.dataset.add)));
});

function showScriptLibraryModal(entity) {
  const items = [
    ['playerController', 'Player Controller'], ['cameraFollow', 'Camera Follow'], ['coinPickup', 'Coin Pickup'],
    ['patrolEnemy', 'Patrol Enemy'], ['movingPlatform', 'Moving Platform'], ['winZone', 'Win Zone'], ['blank', 'Blank Template'],
  ];
  showModal(`<h2>📜 SCRIPT LIBRARY</h2><p>Adds an editable copy — tweak it however you like.</p>
    <div class="st-grid-add">${items.map(([k, l]) => `<button data-lib="${k}"><span class="em">📜</span>${l}</button>`).join('')}</div>
    <div class="st-modal-buttons"><button class="st-btn" data-x>CANCEL</button></div>`);
  document.querySelectorAll('[data-lib]').forEach(b => b.addEventListener('click', () => {
    entity.scripts.push({ id: GXS.uid(), name: b.textContent.trim(), enabled: true, lang: 'js', code: GXS.SCRIPT_LIB[b.dataset.lib] });
    markDirty();
    closeModal();
    renderInspectorEntity();
  }));
}

/* ------------------------------------------------------------------ */
/* generic modal                                                        */
/* ------------------------------------------------------------------ */
function showModal(html, onAct) {
  const m = $('modal'), box = $('modal-box');
  box.innerHTML = html;
  m.classList.remove('hidden');
  box.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => m.classList.add('hidden')));
  box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { m.classList.add('hidden'); onAct && onAct(b.dataset.act, b); }));
  return box;
}
function closeModal() { $('modal').classList.add('hidden'); }
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

/* ------------------------------------------------------------------ */
/* boot                                                                 */
/* ------------------------------------------------------------------ */
function boot() {
  const params = new URLSearchParams(location.search);
  const loadId = params.get('load');
  const tpl = params.get('template');
  if (loadId) project = loadProjects().find(p => p.id === loadId) || null;
  if (!project && tpl === 'physics') project = templatePhysics();
  if (!project && tpl === 'arena') project = templateArena();
  if (!project) {
    try { project = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { project = null; }
    if (project && !project.entities) project = null;
  }
  if (!project) project = templateBaseplate();

  $('title-input').value = project.title || '';

  initViewport();
  renderHierarchy();
  selectEntity(null);
  renderInspectorScene();
  // lightweight hooks for automated tests / debugging
  window.__studio = { rt: () => runtime, project: () => project, selected: () => selectedId, select: selectEntity, insert: addEntity };

  // GX Studio Pro — free, but the powerful FX are metered by credits.
  if (proMode && CREDITS) {
    document.title = 'GX Studio Pro — GamingX';
    setupPro();
  }
}

/* async: init the wallet (server if signed in, else local), mount the badge,
   surface any dev broadcasts. */
async function setupPro() {
  try { await CREDITS.init(); } catch (e) {}
  const logo = document.querySelector('.st-logo');
  if (logo && !logo.querySelector('.gxc-badge')) {
    logo.insertAdjacentHTML('beforeend', ' ' + CREDITS.badgeHTML());
    const badge = logo.querySelector('.gxc-badge');
    if (badge) badge.addEventListener('click', () => CREDITS.showWallet({ onChange: refreshCreditBadge }));
  }
  refreshCreditBadge();
  renderInspectorEntity();       // re-render so labels show live pricing
  try { CREDITS.showBroadcasts(); } catch (e) {}
}
boot();
})();
