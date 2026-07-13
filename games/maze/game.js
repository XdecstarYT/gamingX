/* MAZE ESCAPE — first-person 3D maze against the clock (three.js) */
(() => {
'use strict';
const SLUG = 'maze';
const CELL = 2, WALL_H = 3;

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d1a);
scene.fog = new THREE.Fog(0x0a0d1a, 4, 34);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 100);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0x7788cc, 0x151a2c, 0.7));
const lamp = new THREE.PointLight(0xffe0b0, 1.0, 18);
scene.add(lamp);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3558, roughness: 0.8 });
const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);

let wallMeshes = [], floorMesh = null, exitMesh = null, exitLight = null;
let mazeN = 0, walls = null;   // walls[r][c] = 1 wall / 0 open

/* recursive backtracker on cell grid; result is (2c+1) sized wall matrix */
function genMaze(cells) {
  const n = cells * 2 + 1;
  const m = Array.from({ length: n }, () => Array(n).fill(1));
  const visited = Array.from({ length: cells }, () => Array(cells).fill(false));
  const stack = [[0, 0]];
  visited[0][0] = true;
  m[1][1] = 0;
  while (stack.length) {
    const [cr, cc] = stack[stack.length - 1];
    const nbrs = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = cr + dr, nc = cc + dc;
      if (nr >= 0 && nr < cells && nc >= 0 && nc < cells && !visited[nr][nc]) nbrs.push([nr, nc, dr, dc]);
    }
    if (!nbrs.length) { stack.pop(); continue; }
    const [nr, nc, dr, dc] = nbrs[Math.floor(Math.random() * nbrs.length)];
    visited[nr][nc] = true;
    m[1 + cr * 2 + dr][1 + cc * 2 + dc] = 0;
    m[1 + nr * 2][1 + nc * 2] = 0;
    stack.push([nr, nc]);
  }
  return m;
}

function buildLevel(levelNum) {
  for (const w of wallMeshes) scene.remove(w);
  if (floorMesh) scene.remove(floorMesh);
  if (exitMesh) scene.remove(exitMesh);
  if (exitLight) scene.remove(exitLight);
  wallMeshes = [];

  const cells = Math.min(10, 5 + levelNum);
  mazeN = cells * 2 + 1;
  walls = genMaze(cells);

  const size = mazeN * CELL;
  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(size + 8, size + 8),
    new THREE.MeshStandardMaterial({ color: 0x141a2e, roughness: 0.9 }));
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(size / 2, 0, size / 2);
  scene.add(floorMesh);

  for (let r = 0; r < mazeN; r++) {
    for (let c = 0; c < mazeN; c++) {
      if (!walls[r][c]) continue;
      const w = new THREE.Mesh(wallGeo, wallMat);
      w.position.set(c * CELL + CELL / 2, WALL_H / 2, r * CELL + CELL / 2);
      scene.add(w);
      wallMeshes.push(w);
    }
  }

  // exit: far corner cell (opening glows green)
  const er = mazeN - 2, ec = mazeN - 2;
  exitMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, WALL_H * 2, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
  exitMesh.position.set(ec * CELL + CELL / 2, WALL_H, er * CELL + CELL / 2);
  scene.add(exitMesh);
  exitLight = new THREE.PointLight(0x22c55e, 1.4, 12);
  exitLight.position.copy(exitMesh.position);
  scene.add(exitLight);

  // player at start cell, facing the first open passage
  px = 1 * CELL + CELL / 2;
  pz = 1 * CELL + CELL / 2;
  yaw = walls[1][2] === 0 ? -Math.PI / 2 : Math.PI;
}

/* player state */
let state = 'menu', level = 1, score = 0, timeLeft = 75;
let px = 3, pz = 3, yaw = 0;

function isWall(cx, cz) {
  const c = Math.floor(cx / CELL), r = Math.floor(cz / CELL);
  if (r < 0 || c < 0 || r >= mazeN || c >= mazeN) return true;
  return walls[r][c] === 1;
}
function collide(nx, nz) {
  const R = 0.42;
  // sample around the circle against the wall grid
  for (const [ox, oz] of [[R, 0], [-R, 0], [0, R], [0, -R], [R * 0.7, R * 0.7], [-R * 0.7, R * 0.7], [R * 0.7, -R * 0.7], [-R * 0.7, -R * 0.7]]) {
    if (isWall(nx + ox, nz + oz)) return true;
  }
  return false;
}

function flash(txt) {
  const f = GX.$('flash');
  f.textContent = txt; f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 1000);
}

function reset() {
  level = 1; score = 0; timeLeft = 75;
  buildLevel(level);
  state = 'play';
  GX.hide();
  renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
}

function nextLevel() {
  const bonus = Math.floor(timeLeft) * 5 + level * 100;
  score += bonus;
  level++;
  timeLeft += 45;
  flash('ESCAPED! +' + bonus);
  GX.beep(523, 0.12, 'triangle', 0.09);
  GX.beep(784, 0.2, 'triangle', 0.09);
  buildLevel(level);
}

function gameOver() {
  state = 'over';
  document.exitPointerLock && document.exitPointerLock();
  GX.boom(0.2);
  const rec = GX.setHi(SLUG, score);
  GX.show("TIME'S UP", `You escaped <b>${level - 1}</b> maze${level - 1 === 1 ? '' : 's'} — Score: <b>${score}</b>${rec ? ' <b>NEW RECORD!</b>' : '<br>Best: ' + GX.hi(SLUG)}`,
    [{ label: '↻ TRY AGAIN', primary: true, cb: reset },
     { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
}

/* input */
const keys = {};
addEventListener('keydown', e => { keys[e.code] = 1; });
addEventListener('keyup', e => { keys[e.code] = 0; });
addEventListener('mousemove', e => {
  if (document.pointerLockElement === renderer.domElement) yaw -= e.movementX * 0.0024;
});
renderer.domElement.addEventListener('click', () => {
  if (state === 'play' && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
  }
});
// touch: left half = move forward, right half = turn by drag
let touchTurn = null, touchMove = false;
addEventListener('touchstart', e => {
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2) touchMove = true;
    else touchTurn = { id: t.identifier, x: t.clientX };
  }
}, { passive: true });
addEventListener('touchmove', e => {
  for (const t of e.changedTouches) {
    if (touchTurn && t.identifier === touchTurn.id) {
      yaw -= (t.clientX - touchTurn.x) * 0.006;
      touchTurn.x = t.clientX;
    }
  }
}, { passive: true });
addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (touchTurn && t.identifier === touchTurn.id) touchTurn = null;
    else touchMove = false;
  }
}, { passive: true });

const clock = new THREE.Clock();
let t = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;

  if (state === 'play') {
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; gameOver(); }

    // turning via keys
    if (keys.ArrowLeft) yaw += 2.4 * dt;
    if (keys.ArrowRight) yaw -= 2.4 * dt;

    const fwd = (keys.KeyW || keys.ArrowUp || touchMove ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const sp = 6.2;
    const dx = (Math.sin(yaw) * -fwd + Math.cos(yaw) * strafe) * sp * dt;
    const dz = (Math.cos(yaw) * -fwd - Math.sin(yaw) * strafe) * sp * dt;
    if (!collide(px + dx, pz)) px += dx;
    if (!collide(px, pz + dz)) pz += dz;

    // reached the exit?
    if (exitMesh && Math.hypot(px - exitMesh.position.x, pz - exitMesh.position.z) < 1.1) nextLevel();

    camera.position.set(px, 1.6 + Math.sin(t * 9) * (fwd ? 0.035 : 0), pz);
    camera.rotation.set(0, yaw, 0, 'YXZ');
    lamp.position.set(px, 2.2, pz);
    if (exitMesh) { exitMesh.rotation.y += dt; exitMesh.material.opacity = 0.3 + Math.sin(t * 4) * 0.15; }

    GX.hud(`
      <div class="chip ${timeLeft < 12 ? 'warn' : ''}"><small>TIME</small><b>${Math.ceil(timeLeft)}</b>s</div>
      <div class="chip"><small>MAZE</small><b>${level}</b></div>
      <div class="chip"><small>SCORE</small><b>${score}</b></div>
      <div class="chip"><small>BEST</small><b>${Math.max(GX.hi(SLUG), score)}</b></div>`);
  }

  renderer.render(scene, camera);
}
frame();

GX.show('MAZE <span>ESCAPE</span>',
  'Find the green beacon before time runs out. Each escape adds time and a bigger maze.<br><b>WASD</b> — move · <b>mouse</b> or <b>←/→</b> — look · click the screen to capture the mouse.<br>Mobile: hold left side to walk, drag right side to turn.' +
  (GX.hi(SLUG) ? '<br>Best score: <b>' + GX.hi(SLUG) + '</b>' : ''),
  [{ label: '▶ ENTER THE MAZE', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
