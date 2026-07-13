/* SNAKE 3D — classic snake on a neon grid (three.js) */
(() => {
'use strict';
const SLUG = 'snake';
const N = 17, HALF = (N - 1) / 2;   // grid cells, coords -8..8

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e17);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 19, 13);
camera.lookAt(0, 0, 0);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0xaabbff, 0x101828, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 0.75);
key.position.set(8, 20, 10);
scene.add(key);

/* board */
const board = new THREE.Mesh(new THREE.BoxGeometry(N + 1, 0.5, N + 1),
  new THREE.MeshStandardMaterial({ color: 0x131a30 }));
board.position.y = -0.3;
scene.add(board);
const grid = new THREE.GridHelper(N, N, 0x2a3558, 0x1d2440);
grid.position.y = -0.04;
scene.add(grid);
const rimMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0a4c5c });
for (const [w, d, x, z] of [[N + 1.6, 0.5, 0, HALF + 1], [N + 1.6, 0.5, 0, -HALF - 1], [0.5, N + 1.6, HALF + 1, 0], [0.5, N + 1.6, -HALF - 1, 0]]) {
  const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), rimMat);
  r.position.set(x, 0.15, z);
  scene.add(r);
}

/* snake + food meshes */
const segGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
const headMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490 });
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x14532d });
const food = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d }));
scene.add(food);

let state = 'menu', snake = [], segMeshes = [], dir = { x: 1, z: 0 }, queue = [];
let foodCell = { x: 4, z: 0 }, tick = 0, tickLen = 0.16, score = 0, t = 0;

function cellFree(x, z) { return !snake.some(s => s.x === x && s.z === z); }
function placeFood() {
  let x, z, guard = 0;
  do { x = Math.floor(Math.random() * N) - HALF; z = Math.floor(Math.random() * N) - HALF; } while (!cellFree(x, z) && ++guard < 500);
  foodCell = { x, z };
  food.position.set(x, 0.45, z);
}

function syncMeshes() {
  while (segMeshes.length < snake.length) {
    const m = new THREE.Mesh(segGeo, bodyMat);
    scene.add(m);
    segMeshes.push(m);
  }
  while (segMeshes.length > snake.length) scene.remove(segMeshes.pop());
  for (let i = 0; i < snake.length; i++) {
    segMeshes[i].material = i === 0 ? headMat : bodyMat;
    segMeshes[i].position.set(snake[i].x, 0.45, snake[i].z);
    const sc = i === 0 ? 1 : 1 - Math.min(0.25, i * 0.008);
    segMeshes[i].scale.setScalar(sc);
  }
}

function reset() {
  snake = [{ x: -2, z: 0 }, { x: -3, z: 0 }, { x: -4, z: 0 }];
  dir = { x: 1, z: 0 }; queue = [];
  tickLen = 0.16; tick = 0; score = 0;
  placeFood();
  syncMeshes();
  state = 'play';
  GX.hide();
}

function gameOver() {
  state = 'over';
  GX.boom(0.25);
  const rec = GX.setHi(SLUG, score);
  GX.show('GAME OVER', `Score: <b>${score}</b> · Length ${snake.length}.${rec ? ' <b>NEW RECORD!</b>' : ' Best: ' + GX.hi(SLUG)}`,
    [{ label: '↻ PLAY AGAIN', primary: true, cb: reset },
     { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
}

function step() {
  if (queue.length) {
    const d = queue.shift();
    if (!(d.x === -dir.x && d.z === -dir.z)) dir = d;
  }
  const head = { x: snake[0].x + dir.x, z: snake[0].z + dir.z };
  if (Math.abs(head.x) > HALF || Math.abs(head.z) > HALF) return gameOver();
  if (snake.some((s, i) => i < snake.length - 1 && s.x === head.x && s.z === head.z)) return gameOver();
  snake.unshift(head);
  if (head.x === foodCell.x && head.z === foodCell.z) {
    score += 10;
    tickLen = Math.max(0.07, tickLen - 0.0035);
    placeFood();
    GX.beep(760, 0.07, 'triangle', 0.06);
  } else {
    snake.pop();
  }
  syncMeshes();
}

const DIRS = {
  ArrowUp: { x: 0, z: -1 }, KeyW: { x: 0, z: -1 },
  ArrowDown: { x: 0, z: 1 }, KeyS: { x: 0, z: 1 },
  ArrowLeft: { x: -1, z: 0 }, KeyA: { x: -1, z: 0 },
  ArrowRight: { x: 1, z: 0 }, KeyD: { x: 1, z: 0 },
};
addEventListener('keydown', e => {
  const d = DIRS[e.code];
  if (d && state === 'play' && queue.length < 3) { queue.push(d); e.preventDefault(); }
});
// swipe controls
let ts = null;
addEventListener('touchstart', e => { ts = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
addEventListener('touchend', e => {
  if (!ts || state !== 'play') return;
  const dx = e.changedTouches[0].clientX - ts.x, dy = e.changedTouches[0].clientY - ts.y;
  if (Math.abs(dx) + Math.abs(dy) < 24) return;
  const d = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dy) };
  if (queue.length < 3) queue.push(d);
  ts = null;
}, { passive: true });

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;

  if (state === 'play') {
    tick += dt;
    while (tick >= tickLen) { tick -= tickLen; step(); if (state !== 'play') break; }
    food.scale.setScalar(1 + Math.sin(t * 6) * 0.15);
    food.rotation.y += dt * 2;
    GX.hud(`
      <div class="chip"><small>SCORE</small><b>${score}</b></div>
      <div class="chip"><small>LENGTH</small><b>${snake.length}</b></div>
      <div class="chip"><small>BEST</small><b>${Math.max(GX.hi(SLUG), score)}</b></div>`);
  }

  renderer.render(scene, camera);
}
frame();

GX.show('SNAKE <span>3D</span>',
  'Eat, grow, don\'t bite yourself.<br><b>Arrows / WASD</b> — steer · <b>Swipe</b> on mobile.<br>The snake speeds up with every meal!' +
  (GX.hi(SLUG) ? '<br>Best score: <b>' + GX.hi(SLUG) + '</b>' : ''),
  [{ label: '▶ PLAY', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
