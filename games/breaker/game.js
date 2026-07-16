/* CUBE BREAKER — 3D breakout (three.js) */
(() => {
'use strict';
const SLUG = 'breaker';
const FIELD_X = 10.6, TOP_Y = 16.5, PADDLE_Y = 0.7;

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e17);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 6.5, 22);
camera.lookAt(0, 7.5, 0);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0xaabbff, 0x101828, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(6, 18, 14);
scene.add(key);

/* arena */
const wallMat = new THREE.MeshStandardMaterial({ color: 0x1d2440, metalness: 0.3, roughness: 0.5 });
const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 20, 2), wallMat);
wallL.position.set(-FIELD_X - 0.6, 8.5, 0);
const wallR = wallL.clone(); wallR.position.x = FIELD_X + 0.6;
const wallT = new THREE.Mesh(new THREE.BoxGeometry(FIELD_X * 2 + 1.8, 0.6, 2), wallMat);
wallT.position.set(0, TOP_Y + 0.6, 0);
scene.add(wallL, wallR, wallT);
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_X * 2 + 2, 20),
  new THREE.MeshStandardMaterial({ color: 0x0e1526 }));
backdrop.position.set(0, 8.5, -1.2);
scene.add(backdrop);

/* paddle & ball */
const paddle = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.55, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0a4c5c, metalness: 0.5, roughness: 0.3 }));
paddle.position.set(0, PADDLE_Y, 0);
scene.add(paddle);
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16),
  new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x666666 }));
scene.add(ball);

/* bricks */
const ROW_COLORS = [0xef4444, 0xf2b03d, 0xfde047, 0x22c55e, 0x38bdf8, 0xa855f7, 0xf973d1];
let bricks = [];
function buildBricks(level) {
  for (const b of bricks) scene.remove(b.mesh);
  bricks = [];
  const rows = Math.min(7, 4 + level);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 10; c++) {
      const hp = r < Math.floor(level / 2) ? 2 : 1;
      const color = ROW_COLORS[r % ROW_COLORS.length];
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.82, 1),
        new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5 }));
      m.position.set(-FIELD_X + 1.06 + c * 2.12, 15.4 - r * 1.05, 0);
      scene.add(m);
      bricks.push({ mesh: m, hp, color });
    }
  }
}

/* state */
let state = 'menu', score = 0, lives = 3, level = 1;
let bx = 0, by = 0, bvx = 0, bvy = 0, ballSpeed = 12.5, stuck = true;
let paddleX = 0;

function resetBallOnPaddle() {
  stuck = true;
  bvx = 0; bvy = 0;
}
function launch() {
  if (!stuck || state !== 'play') return;
  stuck = false;
  const a = (Math.random() * 0.6 - 0.3) + Math.PI / 2;
  bvx = Math.cos(a) * ballSpeed;
  bvy = Math.sin(a) * ballSpeed;
  GX.beep(520, 0.06, 'square', 0.05);
}

function reset() {
  score = 0; lives = 3; level = 1; ballSpeed = 12.5;
  paddleX = 0;
  buildBricks(level);
  resetBallOnPaddle();
  state = 'play';
  GX.hide();
}

function flash(txt) {
  const f = GX.$('flash');
  f.textContent = txt; f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 900);
}

function loseBall() {
  lives--;
  GX.boom(0.22);
  if (lives <= 0) {
    state = 'over';
    const rec = GX.setHi(SLUG, score);
    if (rec) GX.celebrate();
    GX.show('GAME OVER', `Score: <b>${score}</b> — Level ${level}.${rec ? ' <b>NEW RECORD!</b>' : ' Best: ' + GX.hi(SLUG)}`,
      [{ label: '↻ PLAY AGAIN', primary: true, cb: reset },
       { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
  } else {
    resetBallOnPaddle();
  }
}

/* input */
let mouseX = null;
addEventListener('pointermove', e => { mouseX = (e.clientX / innerWidth - 0.5) * 2 * (FIELD_X + 2); });
addEventListener('pointerdown', e => { if (!e.target.closest('.gx-panel')) launch(); });
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = 1;
  if (e.code === 'Space') { launch(); e.preventDefault(); }
});
addEventListener('keyup', e => { keys[e.code] = 0; });

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.04, clock.getDelta());

  if (state === 'play') {
    // paddle
    if (keys.ArrowLeft || keys.KeyA) { paddleX -= 20 * dt; mouseX = null; }
    if (keys.ArrowRight || keys.KeyD) { paddleX += 20 * dt; mouseX = null; }
    if (mouseX !== null) paddleX = THREE.MathUtils.lerp(paddleX, mouseX, 1 - Math.pow(0.0001, dt));
    paddleX = THREE.MathUtils.clamp(paddleX, -FIELD_X + 2.2, FIELD_X - 2.2);
    paddle.position.x = paddleX;

    if (stuck) {
      bx = paddleX; by = PADDLE_Y + 0.85;
    } else {
      bx += bvx * dt; by += bvy * dt;

      // walls
      if (bx < -FIELD_X + 0.42) { bx = -FIELD_X + 0.42; bvx = Math.abs(bvx); GX.beep(240, 0.04, 'square', 0.03); }
      if (bx > FIELD_X - 0.42) { bx = FIELD_X - 0.42; bvx = -Math.abs(bvx); GX.beep(240, 0.04, 'square', 0.03); }
      if (by > TOP_Y - 0.42) { by = TOP_Y - 0.42; bvy = -Math.abs(bvy); GX.beep(240, 0.04, 'square', 0.03); }

      // paddle
      if (bvy < 0 && by - 0.42 < PADDLE_Y + 0.3 && by > PADDLE_Y - 0.4 && Math.abs(bx - paddleX) < 2.5) {
        const off = (bx - paddleX) / 2.2;
        const angle = Math.PI / 2 - off * 1.05;
        bvx = Math.cos(angle) * ballSpeed;
        bvy = Math.abs(Math.sin(angle) * ballSpeed);
        GX.beep(420, 0.05, 'square', 0.05);
      }

      // bricks
      for (let i = bricks.length - 1; i >= 0; i--) {
        const b = bricks[i];
        const p = b.mesh.position;
        const dx = bx - p.x, dy = by - p.y;
        if (Math.abs(dx) < 0.96 + 0.42 && Math.abs(dy) < 0.41 + 0.42) {
          // reflect on the axis of least penetration
          const penX = 0.96 + 0.42 - Math.abs(dx);
          const penY = 0.41 + 0.42 - Math.abs(dy);
          if (penX < penY) bvx = Math.sign(dx) * Math.abs(bvx);
          else bvy = Math.sign(dy) * Math.abs(bvy);
          b.hp--;
          if (b.hp <= 0) {
            scene.remove(b.mesh);
            bricks.splice(i, 1);
            score += 10 * level;
            GX.beep(700 + Math.random() * 200, 0.06, 'triangle', 0.06);
          } else {
            b.mesh.material.color.multiplyScalar(0.55);
            score += 5;
            GX.beep(500, 0.05, 'square', 0.04);
          }
          break;
        }
      }

      if (bricks.length === 0) {
        level++;
        ballSpeed = Math.min(21, 12.5 + level * 1.0);
        flash('LEVEL ' + level);
        GX.confetti(60);
        GX.beep(660, 0.15, 'triangle', 0.08, 300);
        buildBricks(level);
        resetBallOnPaddle();
      }

      if (by < -2.5) loseBall();
    }
    ball.position.set(bx, by, 0);

    GX.hud(`
      <div class="chip"><small>SCORE</small><b>${score}</b></div>
      <div class="chip"><small>LEVEL</small><b>${level}</b></div>
      <div class="chip ${lives <= 1 ? 'warn' : ''}"><small>BALLS</small><b>${'●'.repeat(Math.max(0, lives))}${'○'.repeat(3 - Math.max(0, lives))}</b></div>
      <div class="chip"><small>BEST</small><b>${Math.max(GX.hi(SLUG), score)}</b></div>`);
  }

  renderer.render(scene, camera);
}
frame();

GX.show('CUBE <span>BREAKER</span>',
  'Smash every brick in the wall.<br><b>Mouse</b> or <b>←/→</b> — move paddle · <b>Click / Space</b> — launch ball<br>Darker bricks take two hits.' +
  (GX.hi(SLUG) ? '<br>Best score: <b>' + GX.hi(SLUG) + '</b>' : ''),
  [{ label: '▶ PLAY', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
