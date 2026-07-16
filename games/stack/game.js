/* SKY STACK — 3D tower stacking (three.js) */
(() => {
'use strict';
const SLUG = 'stack';
const BLOCK_H = 1.2, BASE_SIZE = 10, RANGE = 13;

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e17);
scene.fog = new THREE.Fog(0x0b0e17, 40, 120);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 300);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x201040, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(18, 30, 12);
scene.add(sun);

const hue0 = Math.random();
function blockMat(layer) {
  const c = new THREE.Color().setHSL((hue0 + layer * 0.022) % 1, 0.6, 0.55);
  return new THREE.MeshStandardMaterial({ color: c, metalness: 0.15, roughness: 0.6 });
}
function makeBlock(w, d, layer) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, BLOCK_H, d), blockMat(layer));
  scene.add(m);
  return m;
}

let state = 'menu', layer = 0, score = 0, combo = 0;
let tower = [];            // {mesh, w, d, x, z}
let cur = null;            // moving block
let axis = 'x', t = 0, oscSpeed = 1.5;
let debris = [];           // falling cut-offs
let camY = 8;

function top() { return tower[tower.length - 1]; }

function reset() {
  for (const b of tower) scene.remove(b.mesh);
  for (const d of debris) scene.remove(d.mesh);
  if (cur) scene.remove(cur.mesh);
  tower = []; debris = []; cur = null;
  layer = 0; score = 0; combo = 0; t = 0; oscSpeed = 1.5; camY = 8;
  // base
  const base = makeBlock(BASE_SIZE, BASE_SIZE, 0);
  base.position.set(0, 0, 0);
  tower.push({ mesh: base, w: BASE_SIZE, d: BASE_SIZE, x: 0, z: 0 });
  newBlock();
  state = 'play';
  GX.hide();
}

function newBlock() {
  layer++;
  axis = layer % 2 ? 'x' : 'z';
  const p = top();
  const mesh = makeBlock(p.w, p.d, layer);
  mesh.position.set(axis === 'x' ? -RANGE : p.x, layer * BLOCK_H, axis === 'z' ? -RANGE : p.z);
  cur = { mesh, w: p.w, d: p.d, x: mesh.position.x, z: mesh.position.z };
  oscSpeed = Math.min(2.6, 1.2 + layer * 0.03);
  t = 0;
}

function flash(txt) {
  const f = GX.$('flash');
  f.textContent = txt; f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 700);
}

function drop() {
  if (state !== 'play' || !cur) return;
  const p = top();
  const a = axis;
  const curPos = a === 'x' ? cur.mesh.position.x : cur.mesh.position.z;
  const topPos = a === 'x' ? p.x : p.z;
  const size = a === 'x' ? cur.w : cur.d;
  const delta = curPos - topPos;
  const overlap = size - Math.abs(delta);

  if (overlap <= 0.05) {
    // total miss — the block tumbles
    debris.push({ mesh: cur.mesh, vy: 0, vr: (Math.random() - 0.5) * 4 });
    cur = null;
    gameOver();
    return;
  }

  if (Math.abs(delta) < 0.5) {
    // perfect
    combo++;
    score += 2 + combo * 2;
    if (a === 'x') cur.mesh.position.x = p.x; else cur.mesh.position.z = p.z;
    flash('PERFECT! ×' + combo);
    GX.beep(660 + combo * 60, 0.1, 'triangle', 0.08);
    if (combo > 0 && combo % 5 === 0) GX.confetti(50);
  } else {
    combo = 0;
    score += 1;
    // trim the block
    const newSize = overlap;
    const newCenter = topPos + delta / 2;
    const cutSize = Math.abs(delta);
    const cutCenter = newCenter + Math.sign(delta) * (newSize / 2 + cutSize / 2);
    // resize kept part
    if (a === 'x') {
      cur.w = newSize;
      cur.mesh.scale.x = newSize / cur.mesh.geometry.parameters.width;
      cur.mesh.position.x = newCenter;
    } else {
      cur.d = newSize;
      cur.mesh.scale.z = newSize / cur.mesh.geometry.parameters.depth;
      cur.mesh.position.z = newCenter;
    }
    // falling cut-off
    const cw = a === 'x' ? cutSize : cur.w;
    const cd = a === 'z' ? cutSize : cur.d;
    const cm = makeBlock(cw, cd, layer);
    cm.position.set(a === 'x' ? cutCenter : cur.mesh.position.x, cur.mesh.position.y, a === 'z' ? cutCenter : cur.mesh.position.z);
    debris.push({ mesh: cm, vy: 0, vr: (Math.random() - 0.5) * 3 });
    GX.beep(330, 0.07, 'square', 0.05);
  }

  cur.x = cur.mesh.position.x; cur.z = cur.mesh.position.z;
  tower.push(cur);
  // keep the scene light: hide deep layers
  if (tower.length > 24) tower[tower.length - 24].mesh.visible = false;
  newBlock();
}

function gameOver() {
  state = 'over';
  GX.boom(0.25);
  const h = layer - 1;
  const rec = GX.setHi(SLUG, score);
  if (rec) GX.celebrate();
  GX.show('TOWER DOWN', `Height: <b>${h} block${h === 1 ? '' : 's'}</b> · Score: <b>${score}</b>${rec ? ' — <b>NEW RECORD!</b>' : '<br>Best: ' + GX.hi(SLUG)}`,
    [{ label: '↻ STACK AGAIN', primary: true, cb: reset },
     { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
}

addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat) { drop(); e.preventDefault(); } });
addEventListener('pointerdown', e => { if (!e.target.closest('.gx-panel')) drop(); });

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;

  if (state === 'play' && cur) {
    const pos = Math.sin(t * oscSpeed) * RANGE;
    if (axis === 'x') cur.mesh.position.x = pos;
    else cur.mesh.position.z = pos;

    GX.hud(`
      <div class="chip"><small>HEIGHT</small><b>${layer - 1}</b></div>
      <div class="chip"><small>SCORE</small><b>${score}</b></div>
      <div class="chip"><small>COMBO</small><b>${combo ? '×' + combo : '—'}</b></div>
      <div class="chip"><small>BEST</small><b>${Math.max(GX.hi(SLUG), score)}</b></div>`);
  }

  // debris physics
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.vy -= 30 * dt;
    d.mesh.position.y += d.vy * dt;
    d.mesh.rotation.x += d.vr * dt;
    d.mesh.rotation.z += d.vr * dt;
    if (d.mesh.position.y < -40) { scene.remove(d.mesh); debris.splice(i, 1); }
  }

  // camera rises with the tower
  const targetY = layer * BLOCK_H + 7;
  camY = THREE.MathUtils.lerp(camY, targetY, 1 - Math.pow(0.02, dt));
  camera.position.set(16, camY, 16);
  camera.lookAt(0, camY - 6.5, 0);

  renderer.render(scene, camera);
}
frame();

GX.show('SKY <span>STACK</span>',
  'Stack the sliding blocks as high as you can.<br><b>Click / Space / Tap</b> — drop the block.<br>Land perfectly to keep the full size and build a combo!' +
  (GX.hi(SLUG) ? '<br>Best score: <b>' + GX.hi(SLUG) + '</b>' : ''),
  [{ label: '▶ START STACKING', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
