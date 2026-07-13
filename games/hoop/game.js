/* HOOP SHOT — 3D basketball score attack (three.js) */
(() => {
'use strict';
const SLUG = 'hoop';
const RIM = new THREE.Vector3(0, 4.6, -10.9);
const RIM_R = 0.95, BALL_R = 0.55;

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101322);
scene.fog = new THREE.Fog(0x101322, 40, 90);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 200);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0xccd6ff, 0x24140a, 0.9));
const flood = new THREE.DirectionalLight(0xffffff, 0.85);
flood.position.set(-10, 22, 10);
scene.add(flood);

/* court */
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 44),
  new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.85 }));
floor.rotation.x = -Math.PI / 2;
floor.position.z = -6;
scene.add(floor);
const paint = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 7.5),
  new THREE.MeshStandardMaterial({ color: 0x275d8f, roughness: 0.85 }));
paint.rotation.x = -Math.PI / 2;
paint.position.set(0, 0.01, -8.5);
scene.add(paint);
const arc = new THREE.Mesh(new THREE.RingGeometry(7.1, 7.3, 48, 1, 0, Math.PI),
  new THREE.MeshBasicMaterial({ color: 0xe8ecf8, side: THREE.DoubleSide }));
arc.rotation.x = -Math.PI / 2;
arc.position.set(0, 0.02, -10.9);
scene.add(arc);

/* hoop */
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.2, 10),
  new THREE.MeshStandardMaterial({ color: 0x3a3f4d, metalness: 0.6 }));
pole.position.set(0, 2.6, -13.2);
scene.add(pole);
const board = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3, 0.18),
  new THREE.MeshStandardMaterial({ color: 0xe8ecf8, transparent: true, opacity: 0.55 }));
board.position.set(0, 5.6, -12.15);
scene.add(board);
const boardBox = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.2),
  new THREE.MeshBasicMaterial({ color: 0xef4444, wireframe: true }));
boardBox.position.set(0, 5.15, -12.05);
scene.add(boardBox);
const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, 0.07, 10, 32),
  new THREE.MeshStandardMaterial({ color: 0xf25c19, metalness: 0.5, roughness: 0.3 }));
rim.rotation.x = Math.PI / 2;
rim.position.copy(RIM);
scene.add(rim);
const net = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R * 0.95, 0.55, 1.3, 12, 3, true),
  new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }));
net.position.set(RIM.x, RIM.y - 0.7, RIM.z);
scene.add(net);

/* ball + aim arrow */
const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 18),
  new THREE.MeshStandardMaterial({ color: 0xe8641d, roughness: 0.6 }));
scene.add(ball);
const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 10),
  new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
scene.add(arrow);

const SPOTS = [
  { x: 0, z: -4.4, pts: 2 }, { x: -3.4, z: -5.4, pts: 2 }, { x: 3.4, z: -5.4, pts: 2 },
  { x: -5.6, z: -2.6, pts: 3 }, { x: 5.6, z: -2.6, pts: 3 }, { x: 0, z: -2.9, pts: 3 },
];
const meter = GX.$('meter'), meterFill = GX.$('meter-fill');

let state = 'menu', spot = SPOTS[0], phase = 'aim';
let score = 0, timeLeft = 60, power = 0, aimSide = 0;
let vel = new THREE.Vector3(), touched = false, scored = false, restT = 0;

function setSpot() {
  spot = SPOTS[Math.floor(Math.random() * SPOTS.length)];
  ball.position.set(spot.x, BALL_R, spot.z);
  vel.set(0, 0, 0);
  phase = 'aim';
  touched = false; scored = false; restT = 0;
  meter.style.display = 'none';
  arrow.visible = true;
}

function flash(txt) {
  const f = GX.$('flash');
  f.textContent = txt; f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 800);
}

function reset() {
  score = 0; timeLeft = 60;
  setSpot();
  state = 'play';
  GX.hide();
}

function gameOver() {
  state = 'over';
  meter.style.display = 'none';
  const rec = GX.setHi(SLUG, score);
  GX.show('FULL TIME', `You scored <b>${score}</b> points.${rec ? ' <b>NEW RECORD!</b>' : ' Best: ' + GX.hi(SLUG)}`,
    [{ label: '↻ PLAY AGAIN', primary: true, cb: reset },
     { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
}

/* input: hold to power, release to shoot; horizontal mouse trims the aim */
addEventListener('pointermove', e => { aimSide = (e.clientX / innerWidth - 0.5) * 2; });
function pressStart() {
  if (state === 'play' && phase === 'aim') {
    phase = 'power';
    power = 0;
    meter.style.display = 'block';
  }
}
function pressEnd() {
  if (state !== 'play' || phase !== 'power') return;
  phase = 'flight';
  meter.style.display = 'none';
  arrow.visible = false;

  const toRim = new THREE.Vector3().subVectors(RIM, ball.position);
  const flat = Math.hypot(toRim.x, toRim.z);
  // speed sweet spot scales with distance; aimSide skews direction
  const speed = 8.2 + power * 8.2;
  const dirF = new THREE.Vector3(toRim.x / flat, 0, toRim.z / flat);
  const side = new THREE.Vector3(-dirF.z, 0, dirF.x);
  dirF.addScaledVector(side, aimSide * 0.28).normalize();
  const elev = 0.98;   // ~56 degrees
  vel.set(dirF.x * Math.cos(elev) * speed, Math.sin(elev) * speed, dirF.z * Math.cos(elev) * speed);
  GX.beep(300, 0.08, 'sine', 0.06, 200);
}
addEventListener('pointerdown', e => { if (!e.target.closest('.gx-panel')) pressStart(); });
addEventListener('pointerup', pressEnd);
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat) { pressStart(); e.preventDefault(); } });
addEventListener('keyup', e => { if (e.code === 'Space') pressEnd(); });

const clock = new THREE.Clock();
let t = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, clock.getDelta());
  t += dt;

  if (state === 'play') {
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; gameOver(); }

    if (phase === 'power') {
      power = Math.min(1, power + dt / 0.9);
      meterFill.style.width = (power * 100) + '%';
    }

    if (phase === 'aim' || phase === 'power') {
      arrow.position.set(ball.position.x + aimSide * 0.8, ball.position.y + 1.4, ball.position.z - 0.6);
      arrow.rotation.z = -aimSide * 0.5;
    }

    if (phase === 'flight') {
      vel.y -= 20 * dt;
      ball.position.addScaledVector(vel, dt);
      ball.rotation.x -= vel.length() * dt * 0.6;

      // backboard
      if (ball.position.z < board.position.z + 0.3 && ball.position.z > board.position.z - 0.3 &&
          vel.z < 0 &&
          Math.abs(ball.position.x) < 2.2 && ball.position.y > 4.1 && ball.position.y < 7.1) {
        vel.z = Math.abs(vel.z) * 0.5;
        touched = true;
        GX.beep(200, 0.05, 'square', 0.05);
      }

      // rim interaction at rim height
      const flatD = Math.hypot(ball.position.x - RIM.x, ball.position.z - RIM.z);
      if (Math.abs(ball.position.y - RIM.y) < 0.22) {
        if (vel.y < 0 && flatD < RIM_R - BALL_R * 0.5 && !scored) {
          scored = true;
          const swish = !touched;
          const pts = spot.pts + (swish ? 1 : 0);
          score += pts;
          flash(swish ? `SWISH! +${pts}` : `+${pts}`);
          GX.beep(700, 0.1, 'triangle', 0.08);
          GX.beep(1050, 0.18, 'triangle', 0.08);
        } else if (Math.abs(flatD - RIM_R) < BALL_R * 0.9 && !scored) {
          // clang off the iron
          const nx = (ball.position.x - RIM.x) / (flatD || 1);
          const nz = (ball.position.z - RIM.z) / (flatD || 1);
          vel.x += nx * 6; vel.z += nz * 6;
          vel.y *= -0.35;
          touched = true;
          GX.beep(160, 0.08, 'square', 0.06);
        }
      }

      // floor bounce
      if (ball.position.y < BALL_R) {
        ball.position.y = BALL_R;
        vel.y = Math.abs(vel.y) * 0.55;
        vel.x *= 0.8; vel.z *= 0.8;
        if (vel.length() < 2) restT += dt;
        GX.beep(120, 0.04, 'sine', Math.min(0.06, vel.length() * 0.01));
      }
      restT += dt * 0.25;
      if (restT > 1.6 || ball.position.z > 8 || ball.position.y < -2) setSpot();
    }

    GX.hud(`
      <div class="chip"><small>SCORE</small><b>${score}</b></div>
      <div class="chip ${timeLeft < 10 ? 'warn' : ''}"><small>TIME</small><b>${Math.ceil(timeLeft)}</b>s</div>
      <div class="chip"><small>SPOT</small><b>${spot.pts} PT</b></div>
      <div class="chip"><small>BEST</small><b>${Math.max(GX.hi(SLUG), score)}</b></div>`);
  }

  // camera follows the active spot
  const cx = spot.x * 0.75, cz = spot.z + 6.2;
  camera.position.lerp(new THREE.Vector3(cx, 2.9, cz), 1 - Math.pow(0.02, dt));
  camera.lookAt(RIM.x, RIM.y - 0.6, RIM.z);
  net.rotation.y += dt * 0.3;

  renderer.render(scene, camera);
}
frame();

GX.show('HOOP <span>SHOT</span>',
  '60 seconds. Score from wherever the ball spawns — beyond the arc is worth 3.<br><b>Hold click / Space</b> — charge power · <b>release</b> — shoot · mouse left/right trims the aim.<br>The sweet spot depends on distance. Swish for a bonus point!' +
  (GX.hi(SLUG) ? '<br>Best: <b>' + GX.hi(SLUG) + '</b>' : ''),
  [{ label: '▶ BALL UP', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
