/* PENALTY KINGS — 3D penalty shootout (three.js) */
(() => {
'use strict';
const SLUG = 'penalty';
const GOAL_Z = -16, GOAL_W = 5.2, GOAL_H = 3.4;

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1b3a);
scene.fog = new THREE.Fog(0x0d1b3a, 60, 140);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 2.7, 7.5);
camera.lookAt(0, 1.8, GOAL_Z);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x0c3a1c, 0.95));
const flood = new THREE.DirectionalLight(0xffffff, 0.9);
flood.position.set(-14, 24, 8);
scene.add(flood);

/* pitch */
const grass = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0x1a7a34 }));
grass.rotation.x = -Math.PI / 2;
scene.add(grass);
// box lines
const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const goalLine = new THREE.Mesh(new THREE.PlaneGeometry(24, 0.14), lineMat);
goalLine.rotation.x = -Math.PI / 2; goalLine.position.set(0, 0.01, GOAL_Z);
scene.add(goalLine);
const spotM = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), lineMat);
spotM.rotation.x = -Math.PI / 2; spotM.position.set(0, 0.011, 0);
scene.add(spotM);

/* goal frame + net */
const postMat = new THREE.MeshStandardMaterial({ color: 0xf5f7fb, metalness: 0.2, roughness: 0.3 });
const postGeo = new THREE.CylinderGeometry(0.09, 0.09, GOAL_H, 10);
for (const sx of [-GOAL_W, GOAL_W]) {
  const p = new THREE.Mesh(postGeo, postMat);
  p.position.set(sx, GOAL_H / 2, GOAL_Z);
  scene.add(p);
}
const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, GOAL_W * 2 + 0.2, 10), postMat);
bar.rotation.z = Math.PI / 2;
bar.position.set(0, GOAL_H, GOAL_Z);
scene.add(bar);
const netMat = new THREE.MeshBasicMaterial({ color: 0xdde4f5, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
const netBack = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W * 2, GOAL_H), netMat);
netBack.position.set(0, GOAL_H / 2, GOAL_Z - 1.6);
const netTop = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W * 2, 1.7), netMat);
netTop.rotation.x = Math.PI / 2;
netTop.position.set(0, GOAL_H, GOAL_Z - 0.8);
scene.add(netBack, netTop);

/* keeper */
const keeper = new THREE.Group();
const kBody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.5),
  new THREE.MeshStandardMaterial({ color: 0xf2b03d }));
kBody.position.y = 1.1;
const kHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10),
  new THREE.MeshStandardMaterial({ color: 0xd9a066 }));
kHead.position.y = 2.15;
const kArmL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 0.25),
  new THREE.MeshStandardMaterial({ color: 0xf2b03d }));
kArmL.position.set(-0.65, 1.35, 0);
const kArmR = kArmL.clone(); kArmR.position.x = 0.65;
keeper.add(kBody, kHead, kArmL, kArmR);
keeper.position.set(0, 0, GOAL_Z + 0.4);
scene.add(keeper);

/* ball & reticle */
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 18),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
ball.position.set(0, 0.36, 0);
scene.add(ball);
const reticle = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 10, 30),
  new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
reticle.position.set(0, 1.6, GOAL_Z + 0.1);
scene.add(reticle);

const meter = GX.$('meter'), meterFill = GX.$('meter-fill');

/* shootout state */
let state = 'menu';       // aim | power | shot | cpu | done phases inside 'play'
let phase = 'aim';
let round = 0, youScore = 0, cpuScore = 0, youKicks = [], cpuKicks = [];
let aimX = 0, aimY = 1.6, power = 0, powerDir = 1;
let shot = null;          // {from,to,T,t,zone}
let keeperFrom = null, keeperTo = null, keeperT = 0;
let phaseTimer = 0, sudden = false;

function zoneOf(x, y) {
  const col = x < -GOAL_W / 3 ? 0 : x > GOAL_W / 3 ? 2 : 1;
  const rowHigh = y > GOAL_H / 2 ? 1 : 0;
  return col + rowHigh * 3;   // 0..5
}
function zoneCenter(z) {
  const col = z % 3, high = z >= 3;
  return { x: (col - 1) * (GOAL_W * 0.62), y: high ? GOAL_H * 0.72 : GOAL_H * 0.25 };
}

function flash(txt, color) {
  const f = GX.$('flash');
  f.textContent = txt;
  f.style.color = color || '#fde047';
  f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 1000);
}

function kicksRow(arr, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += arr[i] === undefined ? '·' : arr[i] ? '●' : '✕';
  return s;
}
function updateHud() {
  const n = sudden ? Math.max(youKicks.length, cpuKicks.length, 1) : 5;
  GX.hud(`
    <div class="chip"><small>YOU</small><b>${youScore}</b> ${kicksRow(youKicks, n)}</div>
    <div class="chip"><small>CPU</small><b>${cpuScore}</b> ${kicksRow(cpuKicks, n)}</div>
    <div class="chip"><small>STREAK BEST</small><b>${GX.hi(SLUG)}</b></div>`);
}

function reset() {
  round = 0; youScore = 0; cpuScore = 0; youKicks = []; cpuKicks = []; sudden = false;
  state = 'play';
  GX.hide();
  startAim();
}

function startAim() {
  phase = 'aim';
  ball.position.set(0, 0.36, 0);
  ball.visible = true;
  keeper.position.set(0, 0, GOAL_Z + 0.4);
  keeper.rotation.z = 0;
  reticle.visible = true;
  meter.style.display = 'none';
  updateHud();
}

function startPower() {
  phase = 'power';
  power = 0; powerDir = 1;
  meter.style.display = 'block';
}

function shoot() {
  phase = 'shot';
  meter.style.display = 'none';
  reticle.visible = false;

  // high power = faster but wilder
  let tx = aimX, ty = aimY;
  const wild = Math.max(0, power - 0.85) * 7;
  tx += (Math.random() - 0.5) * (0.5 + wild);
  ty += (Math.random() - 0.5) * (0.4 + wild * 0.7) + power * 0.3;

  const T = 0.9 - power * 0.35;
  shot = {
    from: ball.position.clone(),
    to: new THREE.Vector3(tx, Math.max(0.15, ty), GOAL_Z),
    T, t: 0,
    offTarget: Math.abs(tx) > GOAL_W - 0.15 || ty > GOAL_H - 0.12,
    zone: zoneOf(tx, ty),
  };

  // keeper picks a zone: 38% reads your corner column, else random
  let kz;
  if (Math.random() < 0.38) {
    const col = shot.zone % 3;
    kz = col + (Math.random() < 0.5 ? 0 : 3);
  } else kz = Math.floor(Math.random() * 6);
  const kc = zoneCenter(kz);
  keeperFrom = keeper.position.clone();
  keeperTo = new THREE.Vector3(kc.x, 0, GOAL_Z + 0.4);
  keeper.userData.zone = kz;
  keeperT = 0;
  GX.beep(180, 0.1, 'square', 0.08);
}

function resolveShot() {
  const kz = keeper.userData.zone;
  let goal;
  if (shot.offTarget) {
    goal = false;
    flash('WIDE!', '#f87171');
  } else if (kz === shot.zone && power < 0.78) {
    goal = false;
    flash('SAVED!', '#f87171');
    GX.boom(0.2);
    // ball parried out
    ball.position.set(shot.to.x * 0.7, 0.36, GOAL_Z + 3);
  } else {
    goal = true;
    youScore++;
    flash('GOAL!');
    GX.beep(523, 0.12, 'triangle', 0.1);
    GX.beep(784, 0.25, 'triangle', 0.1);
  }
  youKicks.push(goal);
  updateHud();
  phase = 'cpu';
  phaseTimer = 1.4;
}

function cpuKick() {
  // CPU converts ~62%
  const goal = Math.random() < 0.62;
  if (goal) cpuScore++;
  cpuKicks.push(goal);
  flash(goal ? 'CPU SCORES' : 'CPU MISSES!', goal ? '#f87171' : '#4ade80');
  GX.beep(goal ? 200 : 600, 0.15, goal ? 'sawtooth' : 'triangle', 0.07);
  updateHud();
  round++;
  phase = 'between';
  phaseTimer = 1.3;
}

function checkEnd() {
  const you = youScore, cpu = cpuScore, k = round;
  if (!sudden) {
    const left = 5 - k;
    // decided early?
    if (you > cpu + left || cpu > you + left) return finish();
    if (k >= 5) {
      if (you !== cpu) return finish();
      sudden = true;
      flash('SUDDEN DEATH', '#fde047');
    }
  } else if (youKicks.length === cpuKicks.length && you !== cpu) {
    return finish();
  }
  startAim();
}

function finish() {
  state = 'over';
  const won = youScore > cpuScore;
  let streak = won ? (parseInt(sessionStorage.getItem('gx.pk.streak') || '0', 10) + 1) : 0;
  try { sessionStorage.setItem('gx.pk.streak', String(streak)); } catch (e) {}
  const rec = won && GX.setHi(SLUG, streak);
  if (won) GX.celebrate({ count: rec ? 150 : 100 });
  GX.show(won ? '🏆 YOU WIN THE SHOOTOUT!' : 'SHOOTOUT LOST',
    `Final: <b>YOU ${youScore} — ${cpuScore} CPU</b>` +
    (won ? `<br>Win streak: <b>${streak}</b>${rec ? ' — <b>NEW RECORD!</b>' : ''}` : '<br>Best streak: <b>' + GX.hi(SLUG) + '</b>'),
    [{ label: '↻ NEW SHOOTOUT', primary: true, cb: reset },
     { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
}

/* input */
addEventListener('pointermove', e => {
  if (state !== 'play' || phase !== 'aim' && phase !== 'power') return;
  const nx = (e.clientX / innerWidth - 0.5) * 2;
  const ny = -(e.clientY / innerHeight - 0.5) * 2;
  aimX = THREE.MathUtils.clamp(nx * (GOAL_W + 1.2), -GOAL_W + 0.2, GOAL_W - 0.2);
  aimY = THREE.MathUtils.clamp(1.7 + ny * 2.4, 0.3, GOAL_H - 0.15);
});
function act() {
  if (state !== 'play') return;
  if (phase === 'aim') startPower();
  else if (phase === 'power') shoot();
}
addEventListener('pointerdown', e => { if (!e.target.closest('.gx-panel')) act(); });
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat) return;
  e.preventDefault();
  // keyboard aiming: arrows nudge, space acts
  act();
});
addEventListener('keydown', e => {
  if (state !== 'play' || (phase !== 'aim' && phase !== 'power')) return;
  const step = 0.45;
  if (e.code === 'ArrowLeft') aimX = Math.max(-GOAL_W + 0.2, aimX - step);
  if (e.code === 'ArrowRight') aimX = Math.min(GOAL_W - 0.2, aimX + step);
  if (e.code === 'ArrowUp') aimY = Math.min(GOAL_H - 0.15, aimY + step);
  if (e.code === 'ArrowDown') aimY = Math.max(0.3, aimY - step);
});

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());

  if (state === 'play') {
    reticle.position.set(aimX, aimY, GOAL_Z + 0.1);
    reticle.rotation.z += dt * 2;

    if (phase === 'power') {
      power += powerDir * dt / 0.55;
      if (power >= 1) { power = 1; powerDir = -1; }
      if (power <= 0) { power = 0; powerDir = 1; }
      meterFill.style.width = (power * 100) + '%';
    }

    if (phase === 'shot' && shot) {
      shot.t += dt;
      const k = Math.min(1, shot.t / shot.T);
      ball.position.lerpVectors(shot.from, shot.to, k);
      ball.position.y += Math.sin(k * Math.PI) * (1.2 - power * 0.5);
      ball.rotation.x -= dt * 20;
      // keeper dive
      keeperT = Math.min(1, keeperT + dt / Math.max(0.3, shot.T));
      keeper.position.lerpVectors(keeperFrom, keeperTo, keeperT);
      const kz = keeper.userData.zone;
      keeper.position.y = kz >= 3 ? Math.sin(keeperT * Math.PI) * 1.0 : 0;
      keeper.rotation.z = (keeperTo.x - keeperFrom.x) * -0.12 * keeperT;
      if (k >= 1) resolveShot();
    }

    if (phase === 'cpu') {
      phaseTimer -= dt;
      if (phaseTimer <= 0) cpuKick();
    }
    if (phase === 'between') {
      phaseTimer -= dt;
      if (phaseTimer <= 0) checkEnd();
    }
  }

  renderer.render(scene, camera);
}
frame();

updateHud();
GX.show('PENALTY <span>KINGS</span>',
  'Best-of-five shootout against the CPU.<br><b>Aim</b> with the mouse (or arrow keys) · <b>Click/Space</b> to lock aim · <b>Click/Space again</b> to set power.<br>Full power beats the keeper — but you might blaze it wide.',
  [{ label: '▶ START SHOOTOUT', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
