/* ORB RUNNER — 3D endless lane runner (three.js) */
(() => {
'use strict';
const SLUG = 'runner';
const LANES = [-3, 0, 3];
const VIEW = 220;

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120b24);
scene.fog = new THREE.Fog(0x120b24, 40, 170);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 400);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0xa088ff, 0x140a22, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.7);
sun.position.set(10, 24, 8);
scene.add(sun);

/* track */
const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, VIEW * 2),
  new THREE.MeshStandardMaterial({ color: 0x1c1433 }));
floor.rotation.x = -Math.PI / 2;
floor.position.z = -VIEW / 2;
scene.add(floor);

const stripeMat = new THREE.MeshBasicMaterial({ color: 0x8b5cf6 });
const stripes = [];
for (let z = 0; z < VIEW; z += 10) {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.18), stripeMat);
  s.rotation.x = -Math.PI / 2; s.position.set(0, 0.01, -z);
  scene.add(s); stripes.push(s);
}
const railMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
for (const rx of [-5.6, 5.6]) {
  const r = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, VIEW * 2), railMat);
  r.position.set(rx, 0.25, -VIEW / 2);
  scene.add(r);
}

/* player orb */
const orb = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 18),
  new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, metalness: 0.3, roughness: 0.25 }));
scene.add(orb);
const orbLight = new THREE.PointLight(0x22d3ee, 1.1, 14);
scene.add(orbLight);

/* obstacles & coins */
const lowGeo = new THREE.BoxGeometry(2.6, 1.1, 1);
const lowMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x501010 });
const wallGeo = new THREE.BoxGeometry(2.7, 4.5, 1);
const wallMat = new THREE.MeshStandardMaterial({ color: 0xf2b03d, emissive: 0x4a3208 });
const coinGeo = new THREE.TorusGeometry(0.5, 0.16, 8, 20);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0x6b5b00, metalness: 0.7, roughness: 0.3 });

let obstacles = [], coins = [];

function spawnRow(z) {
  const r = Math.random();
  if (r < 0.42) {
    // low bar in 1-2 lanes: jump it
    const n = Math.random() < 0.5 ? 1 : 2;
    const start = Math.floor(Math.random() * (LANES.length - n + 1));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(lowGeo, lowMat);
      m.position.set(LANES[start + i], 0.55, z);
      scene.add(m);
      obstacles.push({ mesh: m, type: 'low', lane: start + i });
    }
  } else if (r < 0.78) {
    // full walls blocking 2 lanes: steer into the gap
    const gap = Math.floor(Math.random() * LANES.length);
    for (let i = 0; i < LANES.length; i++) {
      if (i === gap) continue;
      const m = new THREE.Mesh(wallGeo, wallMat);
      m.position.set(LANES[i], 2.25, z);
      scene.add(m);
      obstacles.push({ mesh: m, type: 'wall', lane: i });
    }
  } else {
    // coin arc
    const lane = Math.floor(Math.random() * LANES.length);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(coinGeo, coinMat);
      m.position.set(LANES[lane], 1 + Math.sin(i / 3 * Math.PI) * 0.9, z - i * 2.4);
      scene.add(m);
      coins.push({ mesh: m });
    }
  }
}

/* state */
let state = 'menu', laneIdx = 1, x = 0, y = 0.8, vy = 0, grounded = true;
let speed = 17, distT = 0, coinCount = 0, nextSpawn = -60;

function reset() {
  for (const o of obstacles) scene.remove(o.mesh);
  for (const c of coins) scene.remove(c.mesh);
  obstacles = []; coins = [];
  laneIdx = 1; x = 0; y = 0.8; vy = 0; grounded = true;
  speed = 17; distT = 0; coinCount = 0; nextSpawn = -60;
  orb.position.set(0, 0.8, 0);
  state = 'play';
  GX.hide();
}

function crash() {
  state = 'over';
  GX.boom(0.3);
  const score = Math.floor(distT + coinCount * 10);
  const rec = GX.setHi(SLUG, score);
  GX.show('CRASHED!', `Score: <b>${score}</b> (${Math.floor(distT)} m + ${coinCount} coins)${rec ? ' — <b>NEW RECORD!</b>' : '<br>Best: ' + GX.hi(SLUG)}`,
    [{ label: '↻ RUN AGAIN', primary: true, cb: reset },
     { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
}

const steer = d => { if (state === 'play') { laneIdx = THREE.MathUtils.clamp(laneIdx + d, 0, 2); GX.beep(300, 0.04, 'sine', 0.03); } };
const jump = () => {
  if (state === 'play' && grounded) { vy = 13.5; grounded = false; GX.beep(500, 0.08, 'sine', 0.05, 300); }
};
addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') steer(-1);
  if (e.code === 'ArrowRight' || e.code === 'KeyD') steer(1);
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') { jump(); e.preventDefault(); }
});
// touch: tap sides to steer, tap middle to jump
addEventListener('pointerdown', e => {
  if (state !== 'play' || e.target.closest('.gx-panel')) return;
  const fx = e.clientX / innerWidth;
  if (fx < 0.33) steer(-1);
  else if (fx > 0.67) steer(1);
  else jump();
});

const clock = new THREE.Clock();
let t = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;

  if (state === 'play') {
    speed = Math.min(44, speed + 0.45 * dt);
    distT += speed * dt;

    // lateral + vertical motion
    x = THREE.MathUtils.lerp(x, LANES[laneIdx], 1 - Math.pow(0.0004, dt));
    vy -= 30 * dt;
    y += vy * dt;
    if (y <= 0.8) { y = 0.8; vy = 0; grounded = true; }
    orb.position.set(x, y, 0);
    orb.rotation.x -= speed * dt / 0.8;
    orbLight.position.set(x, y + 1, 1);

    // scroll world
    for (const s of stripes) { s.position.z += speed * dt; if (s.position.z > 12) s.position.z -= VIEW; }

    // spawn ahead
    nextSpawn += speed * dt;
    if (nextSpawn >= 0) {
      spawnRow(-VIEW + 40);
      nextSpawn = -Math.max(36, 56 - speed * 0.25);
    }

    // obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.mesh.position.z += speed * dt;
      if (o.mesh.position.z > 8) { scene.remove(o.mesh); obstacles.splice(i, 1); continue; }
      if (Math.abs(o.mesh.position.z) < 0.85 && Math.abs(o.mesh.position.x - x) < 1.45) {
        const clearHeight = o.type === 'low' ? 1.1 : 99;
        if (y - 0.8 < clearHeight) { crash(); break; }
      }
    }
    // coins
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      c.mesh.position.z += speed * dt;
      c.mesh.rotation.y += 4 * dt;
      if (c.mesh.position.z > 8) { scene.remove(c.mesh); coins.splice(i, 1); continue; }
      if (c.mesh.position.distanceTo(orb.position) < 1.3) {
        scene.remove(c.mesh); coins.splice(i, 1);
        coinCount++;
        GX.beep(980, 0.07, 'triangle', 0.06);
      }
    }

    GX.hud(`
      <div class="chip"><small>SCORE</small><b>${Math.floor(distT + coinCount * 10)}</b></div>
      <div class="chip"><small>COINS</small><b>${coinCount}</b></div>
      <div class="chip"><small>BEST</small><b>${Math.max(GX.hi(SLUG), Math.floor(distT + coinCount * 10))}</b></div>`);
  }

  camera.position.set(x * 0.45, 5 + y * 0.25, 9.5);
  camera.lookAt(x * 0.65, 1.2 + y * 0.3, -10);
  renderer.render(scene, camera);
}
frame();

GX.show('ORB <span>RUNNER</span>',
  'Race down the neon track. Jump the red bars, dodge through the gaps, grab coins.<br><b>←/→</b> — change lane · <b>↑/Space</b> — jump<br>On mobile: tap sides to steer, middle to jump.' +
  (GX.hi(SLUG) ? '<br>Best score: <b>' + GX.hi(SLUG) + '</b>' : ''),
  [{ label: '▶ RUN', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
