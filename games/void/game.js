/* VOID STRIKERS — 3D space wave shooter (three.js) */
(() => {
'use strict';
const SLUG = 'void';
const BOUND_X = 16, BOUND_Y = 9;

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03040c);
scene.fog = new THREE.Fog(0x03040c, 120, 240);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 2, 26);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0x6688ff, 0x110022, 0.8));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(6, 10, 8);
scene.add(key);

/* starfield */
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(500 * 3);
for (let i = 0; i < 500; i++) {
  starPos[i * 3] = (Math.random() - 0.5) * 120;
  starPos[i * 3 + 1] = (Math.random() - 0.5) * 70;
  starPos[i * 3 + 2] = -Math.random() * 260 + 20;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbcd0ff, size: 0.4 }));
scene.add(stars);

/* player ship */
const ship = new THREE.Group();
const hull = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.6, 8),
  new THREE.MeshStandardMaterial({ color: 0x22d3ee, metalness: 0.5, roughness: 0.3 }));
hull.rotation.x = -Math.PI / 2;
const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 1.1),
  new THREE.MeshStandardMaterial({ color: 0x155e75, metalness: 0.4, roughness: 0.4 }));
wing.position.z = 0.6;
const engine = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xf973d1 }));
engine.position.z = 1.5;
ship.add(hull, wing, engine);
scene.add(ship);

/* pools */
let bullets = [], enemies = [], sparks = [];
const bulletGeo = new THREE.SphereGeometry(0.22, 6, 6);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0x7dfcb2 });
const sparkGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);

const ENEMY_KINDS = [
  { kind: 'drone',  color: 0xf2b03d, hp: 1, pts: 10 },
  { kind: 'weaver', color: 0xa855f7, hp: 1, pts: 15 },
  { kind: 'hunter', color: 0xef4444, hp: 2, pts: 25 },
];
function spawnEnemy() {
  const roll = Math.random();
  const def = ENEMY_KINDS[roll < 0.5 ? 0 : roll < 0.8 ? 1 : 2];
  let mesh;
  if (def.kind === 'drone') mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.1),
    new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.3, roughness: 0.5 }));
  else if (def.kind === 'weaver') mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0),
    new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.3, roughness: 0.5 }));
  else {
    mesh = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 6),
      new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.4, roughness: 0.4 }));
    mesh.rotation.x = Math.PI / 2;
  }
  mesh.position.set((Math.random() - 0.5) * BOUND_X * 2, (Math.random() - 0.5) * BOUND_Y * 2, -160);
  scene.add(mesh);
  enemies.push({
    mesh, ...def, hp: def.hp,
    vz: 15 + wave * 2 + Math.random() * 5,
    baseX: mesh.position.x, phase: Math.random() * 6.28,
  });
}

function burst(pos, color) {
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    scene.add(m);
    sparks.push({
      mesh: m, t: 0.5,
      vx: (Math.random() - 0.5) * 22, vy: (Math.random() - 0.5) * 22, vz: (Math.random() - 0.5) * 22,
    });
  }
}

/* state */
let state = 'menu', score = 0, wave = 1, kills = 0, lives = 3, invuln = 0;
let fireCd = 0, spawnT = 0, t = 0;
const keys = {};
addEventListener('keydown', e => { keys[e.code] = 1; if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => { keys[e.code] = 0; });
let pointerHeld = false, px = 0, py = 0, usePointer = false;
addEventListener('pointerdown', e => { if (!e.target.closest('.gx-panel')) pointerHeld = true; });
addEventListener('pointerup', () => pointerHeld = false);
addEventListener('pointermove', e => {
  usePointer = true;
  px = (e.clientX / innerWidth - 0.5) * 2 * BOUND_X;
  py = -(e.clientY / innerHeight - 0.5) * 2 * BOUND_Y;
});

function flash(txt) {
  const f = GX.$('flash');
  f.textContent = txt; f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 900);
}

function reset() {
  for (const e of enemies) scene.remove(e.mesh);
  for (const b of bullets) scene.remove(b.mesh);
  for (const s of sparks) scene.remove(s.mesh);
  enemies = []; bullets = []; sparks = [];
  score = 0; wave = 1; kills = 0; lives = 3; invuln = 0; spawnT = 0.4;
  ship.position.set(0, 0, 0);
  state = 'play';
  GX.hide();
}

function gameOver() {
  state = 'over';
  GX.boom(0.35);
  const rec = GX.setHi(SLUG, score);
  if (rec) GX.celebrate();
  GX.show('SHIP DESTROYED', `Score: <b>${score}</b> — Wave ${wave}.${rec ? ' <b>NEW RECORD!</b>' : ' Best: ' + GX.hi(SLUG)}`,
    [{ label: '↻ RELAUNCH', primary: true, cb: reset },
     { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;

  // stars always drift
  const sp = starGeo.attributes.position.array;
  for (let i = 0; i < 500; i++) {
    sp[i * 3 + 2] += (state === 'play' ? 55 : 18) * dt;
    if (sp[i * 3 + 2] > 25) sp[i * 3 + 2] -= 260;
  }
  starGeo.attributes.position.needsUpdate = true;

  if (state === 'play') {
    // move ship
    let mx = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    let my = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
    if (mx || my) usePointer = false;
    if (usePointer) {
      ship.position.x = THREE.MathUtils.lerp(ship.position.x, px, 1 - Math.pow(0.001, dt));
      ship.position.y = THREE.MathUtils.lerp(ship.position.y, py, 1 - Math.pow(0.001, dt));
    } else {
      ship.position.x += mx * 22 * dt;
      ship.position.y += my * 22 * dt;
    }
    ship.position.x = THREE.MathUtils.clamp(ship.position.x, -BOUND_X, BOUND_X);
    ship.position.y = THREE.MathUtils.clamp(ship.position.y, -BOUND_Y, BOUND_Y);
    ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -mx * 0.5, 0.1);
    ship.rotation.x = THREE.MathUtils.lerp(ship.rotation.x, my * 0.25, 0.1);
    engine.scale.setScalar(1 + Math.sin(t * 30) * 0.25);

    // fire
    fireCd -= dt;
    if ((keys.Space || pointerHeld) && fireCd <= 0) {
      fireCd = 0.16;
      for (const ox of [-0.9, 0.9]) {
        const m = new THREE.Mesh(bulletGeo, bulletMat);
        m.position.set(ship.position.x + ox, ship.position.y, ship.position.z - 1);
        scene.add(m);
        bullets.push({ mesh: m });
      }
      GX.beep(880, 0.05, 'square', 0.03, -300);
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
      bullets[i].mesh.position.z -= 170 * dt;
      if (bullets[i].mesh.position.z < -200) { scene.remove(bullets[i].mesh); bullets.splice(i, 1); }
    }

    // enemies
    spawnT -= dt;
    if (spawnT <= 0) { spawnEnemy(); spawnT = Math.max(0.5, 1.5 - wave * 0.08); }
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const m = e.mesh;
      m.position.z += e.vz * dt;
      if (e.kind === 'weaver') m.position.x = e.baseX + Math.sin(t * 3 + e.phase) * 6;
      if (e.kind === 'hunter') {
        m.position.x += THREE.MathUtils.clamp(ship.position.x - m.position.x, -1, 1) * 6 * dt;
        m.position.y += THREE.MathUtils.clamp(ship.position.y - m.position.y, -1, 1) * 6 * dt;
      }
      m.rotation.x += dt * 2; m.rotation.y += dt * 3;
      if (m.position.z > 28) { scene.remove(m); enemies.splice(i, 1); continue; }

      // bullet hits
      let dead = false;
      for (let j = bullets.length - 1; j >= 0; j--) {
        if (m.position.distanceTo(bullets[j].mesh.position) < 1.7) {
          scene.remove(bullets[j].mesh); bullets.splice(j, 1);
          if (--e.hp <= 0) { dead = true; }
          else GX.beep(220, 0.06, 'square', 0.05);
          break;
        }
      }
      if (dead) {
        burst(m.position, e.color);
        scene.remove(m); enemies.splice(i, 1);
        score += e.pts * wave; kills++;
        GX.beep(160, 0.12, 'sawtooth', 0.07, -80);
        if (kills >= wave * 10) { wave++; flash('WAVE ' + wave); GX.beep(520, 0.2, 'triangle', 0.08, 200); GX.confetti(60); }
        continue;
      }
      // ship collision
      if (invuln <= 0 && m.position.distanceTo(ship.position) < 1.7) {
        burst(ship.position, 0x22d3ee);
        scene.remove(m); enemies.splice(i, 1);
        lives--; invuln = 2.6;
        GX.boom(0.25);
        if (lives <= 0) { gameOver(); }
      }
    }

    invuln = Math.max(0, invuln - dt);
    ship.visible = invuln <= 0 || Math.floor(t * 12) % 2 === 0;

    GX.hud(`
      <div class="chip"><small>SCORE</small><b>${score}</b></div>
      <div class="chip"><small>WAVE</small><b>${wave}</b></div>
      <div class="chip ${lives <= 1 ? 'warn' : ''}"><small>HULL</small><b>${'▮'.repeat(Math.max(0, lives))}${'▯'.repeat(3 - Math.max(0, lives))}</b></div>
      <div class="chip"><small>BEST</small><b>${Math.max(GX.hi(SLUG), score)}</b></div>`);
  }

  // sparks
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.t -= dt;
    if (s.t <= 0) { scene.remove(s.mesh); sparks.splice(i, 1); continue; }
    s.mesh.position.x += s.vx * dt; s.mesh.position.y += s.vy * dt; s.mesh.position.z += s.vz * dt;
    s.mesh.rotation.x += dt * 10; s.mesh.rotation.y += dt * 8;
    s.mesh.scale.setScalar(s.t * 2);
  }

  camera.position.x = ship.position.x * 0.25;
  camera.position.y = 2 + ship.position.y * 0.2;
  camera.lookAt(ship.position.x * 0.5, ship.position.y * 0.5, -30);
  renderer.render(scene, camera);
}
frame();

GX.show('VOID <span>STRIKERS</span>',
  'Survive the enemy waves in deep space.<br><b>WASD/Arrows</b> or <b>mouse</b> — fly · <b>Space</b> or <b>hold click</b> — fire' +
  (GX.hi(SLUG) ? '<br>Best score: <b>' + GX.hi(SLUG) + '</b>' : ''),
  [{ label: '▶ LAUNCH', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
