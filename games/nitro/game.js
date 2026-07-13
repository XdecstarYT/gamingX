/* NITRO RUSH — 3D endless highway racer (three.js) */
(() => {
'use strict';
const SLUG = 'nitro';
const LANES = [-4.5, -1.5, 1.5, 4.5];
const ROAD_W = 12.6, VIEW = 300;

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1024);
scene.fog = new THREE.Fog(0x0b1024, 60, 250);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 500);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0x8899ff, 0x223311, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(20, 40, 10);
scene.add(sun);

/* road */
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD_W, VIEW * 2),
  new THREE.MeshStandardMaterial({ color: 0x23262e })
);
road.rotation.x = -Math.PI / 2; road.position.z = -VIEW / 2;
scene.add(road);
const grassL = new THREE.Mesh(new THREE.PlaneGeometry(200, VIEW * 2), new THREE.MeshStandardMaterial({ color: 0x0f2c17 }));
grassL.rotation.x = -Math.PI / 2; grassL.position.set(-ROAD_W / 2 - 100, -0.02, -VIEW / 2);
scene.add(grassL);
const grassR = grassL.clone(); grassR.position.x = ROAD_W / 2 + 100; scene.add(grassR);

/* dashed lane lines + road edges (recycled) */
const dashes = [];
const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8dce8 });
for (const lx of [-3, 0, 3]) {
  for (let z = 0; z < VIEW; z += 12) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 4), dashMat);
    d.rotation.x = -Math.PI / 2; d.position.set(lx, 0.01, -z);
    scene.add(d); dashes.push(d);
  }
}
const edgeMat = new THREE.MeshBasicMaterial({ color: 0xf2b03d });
for (const ex of [-ROAD_W / 2 + 0.2, ROAD_W / 2 - 0.2]) {
  const e = new THREE.Mesh(new THREE.PlaneGeometry(0.3, VIEW * 2), edgeMat);
  e.rotation.x = -Math.PI / 2; e.position.set(ex, 0.012, -VIEW / 2);
  scene.add(e);
}

/* roadside props (recycled) */
const props = [];
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a1e });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x1c5c2a });
for (let i = 0; i < 26; i++) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), trunkMat);
  trunk.position.y = 1.2;
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3.6, 6), leafMat);
  leaf.position.y = 4;
  g.add(trunk, leaf);
  const side = i % 2 ? 1 : -1;
  g.position.set(side * (ROAD_W / 2 + 3 + Math.random() * 8), 0, -Math.random() * VIEW);
  scene.add(g); props.push(g);
}

/* cars */
function makeCar(color, isPlayer) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 3.7),
    new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.4 }));
  body.position.y = 0.65;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x0e1526, metalness: 0.2, roughness: 0.1 }));
  cabin.position.set(0, 1.25, 0.1);
  g.add(body, cabin);
  const wg = new THREE.BoxGeometry(0.35, 0.7, 0.7);
  const wm = new THREE.MeshStandardMaterial({ color: 0x11131a });
  for (const [wx, wz] of [[-1, -1.2], [1, -1.2], [-1, 1.2], [1, 1.2]]) {
    const w = new THREE.Mesh(wg, wm);
    w.position.set(wx, 0.35, wz);
    g.add(w);
  }
  if (isPlayer) {
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
    glow.position.set(0, 0.5, 1.9);
    g.add(glow);
  }
  return g;
}
const player = makeCar(0x22d3ee, true);
scene.add(player);

const TRAFFIC_COLORS = [0xd12f2f, 0xe0a020, 0x8447d6, 0x3f7fd1, 0xd8d8d8, 0x2fae55];
let traffic = [];

/* state */
let state = 'menu', laneIdx = 1, carX = LANES[1];
let speed = 0, distT = 0, nitro = 100, spawnT = 0, shake = 0;
const meter = GX.$('meter'), meterFill = GX.$('meter-fill');

function reset() {
  for (const t of traffic) scene.remove(t.mesh);
  traffic = [];
  laneIdx = 1; carX = LANES[1]; player.position.set(carX, 0, 0);
  speed = 30; distT = 0; nitro = 100; spawnT = 0; shake = 0;
  state = 'play';
  meter.style.display = 'block';
  GX.hide();
}

function crash() {
  state = 'over'; shake = 1;
  GX.boom(0.3);
  meter.style.display = 'none';
  const score = Math.floor(distT);
  const rec = GX.setHi(SLUG, score);
  GX.show('WRECKED!', `You covered <b>${score} m</b>.${rec ? ' <b>NEW RECORD!</b>' : ' Best: ' + GX.hi(SLUG) + ' m'}`,
    [{ label: '↻ DRIVE AGAIN', primary: true, cb: reset },
     { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
}

/* input */
const steer = d => {
  if (state !== 'play') return;
  laneIdx = Math.max(0, Math.min(LANES.length - 1, laneIdx + d));
  GX.beep(300 + d * 40, 0.05, 'sine', 0.04);
};
addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') steer(-1);
  if (e.code === 'ArrowRight' || e.code === 'KeyD') steer(1);
});
let boostHeld = false;
addEventListener('keydown', e => { if (e.code === 'ShiftLeft' || e.code === 'Space') { boostHeld = true; e.preventDefault(); } });
addEventListener('keyup', e => { if (e.code === 'ShiftLeft' || e.code === 'Space') boostHeld = false; });
addEventListener('pointerdown', e => {
  if (state !== 'play' || e.target.closest('.gx-panel')) return;
  steer(e.clientX < innerWidth / 2 ? -1 : 1);
});

function spawnTraffic() {
  const lane = Math.floor(Math.random() * LANES.length);
  // keep the lane clear near the spawn point
  for (const t of traffic) if (t.lane === lane && t.mesh.position.z < -VIEW + 70) return;
  const color = TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)];
  const mesh = makeCar(color, false);
  mesh.position.set(LANES[lane], 0, -VIEW + 20);
  mesh.rotation.y = 0;
  scene.add(mesh);
  traffic.push({ mesh, lane, speed: 16 + Math.random() * 10 });
}

/* loop */
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());

  if (state === 'play') {
    // speed & nitro
    speed = Math.min(80, speed + 1.1 * dt);
    let v = speed;
    if (boostHeld && nitro > 0) { v *= 1.55; nitro = Math.max(0, nitro - 34 * dt); }
    else nitro = Math.min(100, nitro + 9 * dt);
    meterFill.style.width = nitro + '%';
    distT += v * dt;

    // steer
    carX = THREE.MathUtils.lerp(carX, LANES[laneIdx], 1 - Math.pow(0.0005, dt));
    player.position.x = carX;
    player.rotation.z = (carX - LANES[laneIdx]) * 0.12;
    player.rotation.y = (LANES[laneIdx] - carX) * 0.06;

    // recycle scenery
    for (const d of dashes) { d.position.z += v * dt; if (d.position.z > 15) d.position.z -= VIEW; }
    for (const p of props) { p.position.z += v * dt; if (p.position.z > 15) p.position.z -= VIEW; }

    // traffic
    spawnT -= dt;
    if (spawnT <= 0) { spawnTraffic(); spawnT = Math.max(0.55, 2.1 - v * 0.018); }
    for (let i = traffic.length - 1; i >= 0; i--) {
      const t = traffic[i];
      t.mesh.position.z += (v - t.speed) * dt;
      if (t.mesh.position.z > 30) { scene.remove(t.mesh); traffic.splice(i, 1); continue; }
      if (Math.abs(t.mesh.position.z) < 3.4 && Math.abs(t.mesh.position.x - carX) < 1.85) { crash(); break; }
    }

    GX.hud(`
      <div class="chip"><small>SPEED</small><b>${Math.round(v * 2.4)}</b> km/h</div>
      <div class="chip"><small>DISTANCE</small><b>${Math.floor(distT)}</b> m</div>
      <div class="chip"><small>BEST</small><b>${Math.max(GX.hi(SLUG), Math.floor(distT))}</b> m</div>`);
  }

  // camera
  shake = Math.max(0, shake - dt * 1.4);
  const sx = (Math.random() - 0.5) * shake * 1.6, sy = (Math.random() - 0.5) * shake * 1.6;
  camera.position.set(carX * 0.55 + sx, 5.6 + sy, 11);
  camera.lookAt(carX * 0.8, 1.4, -12);

  renderer.render(scene, camera);
}
frame();

GX.show('NITRO <span>RUSH</span>',
  'Weave through traffic at insane speed.<br><b>←/→</b> or <b>A/D</b> — change lane · <b>Shift/Space</b> — nitro boost<br>On mobile, tap the left / right half of the screen.' +
  (GX.hi(SLUG) ? '<br>Best run: <b>' + GX.hi(SLUG) + ' m</b>' : ''),
  [{ label: '▶ START ENGINE', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
