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
  if (e.mesh) return { box: '◼', sphere: '●', cylinder: '⬤', cone: '▲', torus: '◎', plane: '▬' }[e.mesh.shape] || '◼';
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
  canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
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
    const m = rec.meshObj.material;
    m.color.set(entity.mesh.color); m.metalness = entity.mesh.metalness; m.roughness = entity.mesh.roughness;
    m.emissive.set(entity.mesh.emissive); m.emissiveIntensity = entity.mesh.emissiveIntensity;
    m.opacity = entity.mesh.opacity; m.transparent = entity.mesh.opacity < 1; m.wireframe = !!entity.mesh.wireframe;
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
  html += scriptsSection(e);

  const missing = [];
  if (!e.mesh) missing.push(['mesh', '📦 Mesh']);
  if (!e.light) missing.push(['light', '💡 Light']);
  if (!e.camera) missing.push(['camera', '🎥 Camera']);
  if (!e.rigidbody) missing.push(['rigidbody', '⚙️ RigidBody']);
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
  return `<div class="st-group"><div class="st-group-head"><b>📦 MESH RENDERER</b><button data-removecomp="mesh">✕</button></div>
    <div class="st-field"><label>SHAPE</label>
      <select class="st-input" id="f-mesh-shape">
        ${['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'].map(s => `<option value="${s}" ${e.mesh.shape === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></div>
    <div class="st-field"><label>COLOR</label><input class="st-input" type="color" id="f-mesh-color" value="${e.mesh.color}"></div>
    <div class="st-field"><label>METALNESS</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="1" step="0.05" id="f-mesh-metalness" value="${e.mesh.metalness}"><span class="val">${e.mesh.metalness}</span></div></div>
    <div class="st-field"><label>ROUGHNESS</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="1" step="0.05" id="f-mesh-roughness" value="${e.mesh.roughness}"><span class="val">${e.mesh.roughness}</span></div></div>
    <div class="st-field"><label>EMISSIVE</label><input class="st-input" type="color" id="f-mesh-emissive" value="${e.mesh.emissive}"></div>
    <div class="st-field"><label>EMISSIVE STRENGTH</label><div class="st-slider-row"><input class="st-input" type="range" min="0" max="3" step="0.1" id="f-mesh-emissiveIntensity" value="${e.mesh.emissiveIntensity}"><span class="val">${e.mesh.emissiveIntensity}</span></div></div>
    <div class="st-field"><label>OPACITY</label><div class="st-slider-row"><input class="st-input" type="range" min="0.05" max="1" step="0.05" id="f-mesh-opacity" value="${e.mesh.opacity}"><span class="val">${e.mesh.opacity}</span></div></div>
    <div class="st-field"><label class="st-check"><input type="checkbox" id="f-mesh-wireframe" ${e.mesh.wireframe ? 'checked' : ''}> Wireframe</label></div>
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
function scriptsSection(e) {
  let html = `<div class="st-group"><div class="st-group-head"><b>📜 SCRIPTS</b></div>`;
  e.scripts.forEach((s, i) => {
    html += `<div class="st-script" data-script-idx="${i}">
      <div class="st-script-head">
        <input type="text" class="st-input f-script-name" value="${escapeHtml(s.name)}">
        <label class="st-check" style="font-size:.68rem"><input type="checkbox" class="f-script-enabled" ${s.enabled ? 'checked' : ''}> on</label>
        <button class="btn-remove-script" title="Remove script" style="color:#f87171">✕</button>
      </div>
      <textarea class="f-script-code" spellcheck="false">${escapeHtml(s.code)}</textarea>
      <div class="st-script-foot"><span style="color:var(--muted);font-size:.62rem">Edits apply next time you press Play</span></div>
    </div>`;
  });
  html += `<div class="st-addcomp">
    <button data-addscript="blank">+ Blank Script</button>
    <button data-addscript-menu="1">+ From Library</button>
  </div>
  <div class="st-api-hint">
    <b style="color:var(--text)">Scripting API</b> — inside a script you get an <code>api</code> object:<br>
    <code>api.entity</code> get/set position, rotation · <code>api.input.isDown(code)</code> / <code>.pressed(code)</code> ·
    <code>api.velocity.set/add/get</code> (RigidBody) · <code>api.isGrounded()</code> · <code>api.find(name)</code> ·
    <code>api.distance(handle)</code> · <code>api.score.add(n)</code> · <code>api.end({win,message})</code> · <code>api.log(...)</code> · <code>api.dt</code> <code>api.time</code>
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
    bindSlider('f-mesh-color', e.mesh, 'color', true);
    bindSlider('f-mesh-metalness', e.mesh, 'metalness');
    bindSlider('f-mesh-roughness', e.mesh, 'roughness');
    bindSlider('f-mesh-emissive', e.mesh, 'emissive', true);
    bindSlider('f-mesh-emissiveIntensity', e.mesh, 'emissiveIntensity');
    bindSlider('f-mesh-opacity', e.mesh, 'opacity');
    bindCheck('f-mesh-wireframe', e.mesh, 'wireframe');
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

  panel.querySelectorAll('[data-addcomp]').forEach(btn => btn.addEventListener('click', () => {
    const kind = btn.dataset.addcomp;
    if (kind === 'mesh') e.mesh = GXS.newEntity('mesh').mesh;
    if (kind === 'light') e.light = GXS.newEntity('light').light;
    if (kind === 'camera') e.camera = GXS.newEntity('camera').camera;
    if (kind === 'rigidbody') e.rigidbody = { mass: 1, shape: 'box', friction: 0.4, restitution: 0.1, fixedRotation: false, isTrigger: false, linearDamping: 0.05 };
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
    box.querySelector('.btn-remove-script').addEventListener('click', () => { e.scripts.splice(idx, 1); markDirty(); renderInspectorEntity(); });
  });
  const blankBtn = panel.querySelector('[data-addscript="blank"]');
  if (blankBtn) blankBtn.addEventListener('click', () => {
    e.scripts.push({ id: GXS.uid(), name: 'New Script', enabled: true, code: GXS.SCRIPT_LIB.blank });
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

function addEntity(key) {
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
  const issues = GXS.validateScene(project);
  if (issues.length) return showModal(`<h2>CAN'T PLAY YET</h2><p>${issues.join('<br>')}</p><div class="st-modal-buttons"><button class="st-btn" data-x>OK</button></div>`);
  $('console-log').innerHTML = '';
  runtime.play();
  gizmo.detach();
  $('btn-play').textContent = '■ Stop';
  $('btn-play').classList.add('playing');
  $('playbadge').classList.remove('hidden');
  $('gamehud').classList.remove('hidden');
  updateGameHud();
  hudTimer = setInterval(updateGameHud, 200);
}
function updateGameHud() {
  if (!runtime.playing) return;
  $('gamehud').innerHTML = `<div class="chip"><small>SCORE</small>${runtime.score || 0}</div><div class="chip"><small>TIME</small>${Math.floor(runtime.time)}s</div>`;
}
function stopPlay() {
  clearInterval(hudTimer);
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
      <button class="st-opt on" data-v="empty">EMPTY<small>ground + sun + camera</small></button>
      <button class="st-opt" data-v="physics">PHYSICS PLAYGROUND<small>ramps &amp; crates</small></button>
      <button class="st-opt" data-v="arena">ARENA ADVENTURE<small>coins, enemy, goal</small></button>
    </div>
    <div class="st-modal-buttons">
      <button class="st-btn st-btn-primary" data-act="create">CREATE</button>
      <button class="st-btn" data-x>CANCEL</button>
    </div>`, act => {
    if (act !== 'create') return;
    const v = document.querySelector('#nm-tpl .st-opt.on').dataset.v;
    project = v === 'physics' ? templatePhysics() : v === 'arena' ? templateArena() : templateEmpty();
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
  showModal(`<h2>✚ ADD OBJECT</h2>
    ${cat('PRIMITIVES', [['cube', 'Cube', '◼'], ['sphere', 'Sphere', '●'], ['cylinder', 'Cylinder', '⬤'], ['cone', 'Cone', '▲'], ['torus', 'Torus', '◎'], ['plane', 'Ground Plane', '▬'], ['group', 'Empty Group', '📁']])}
    ${cat('LIGHTS', [['dirlight', 'Directional', '☀️'], ['pointlight', 'Point Light', '💡'], ['spotlight', 'Spot Light', '🔦'], ['ambient', 'Ambient', '🌫️']])}
    ${cat('CAMERA', [['camera', 'Camera', '🎥'], ['camerafollow', 'Follow Camera', '🎬']])}
    ${cat('GAME PREFABS', [['player', 'Player Controller', '🔵'], ['coin', 'Coin Pickup', '🪙'], ['enemy', 'Patrol Enemy', '🔺'], ['platform', 'Moving Platform', '🟪'], ['winzone', 'Win Zone', '🏁'], ['crate', 'Physics Crate', '📦']])}
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
    entity.scripts.push({ id: GXS.uid(), name: b.textContent.trim(), enabled: true, code: GXS.SCRIPT_LIB[b.dataset.lib] });
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
  if (!project) project = templateArena();

  $('title-input').value = project.title || '';
  initViewport();
  renderHierarchy();
  selectEntity(null);
  renderInspectorScene();
}
boot();
})();
