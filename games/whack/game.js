/* WHACK-A-BOT — 3D reaction game (three.js) */
(() => {
'use strict';
const SLUG = 'whack';
const GRID = [-3, 0, 3];

const renderer = GX.renderer3d();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141024);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 8.5, 9.5);
camera.lookAt(0, 0, -0.5);
GX.onResize(renderer, camera);

scene.add(new THREE.HemisphereLight(0xbbaaff, 0x1a1030, 0.95));
const key = new THREE.DirectionalLight(0xffffff, 0.8);
key.position.set(6, 14, 8);
scene.add(key);

/* platform + holes */
const platform = new THREE.Mesh(new THREE.BoxGeometry(13, 1.2, 13),
  new THREE.MeshStandardMaterial({ color: 0x1d2440, roughness: 0.6 }));
platform.position.y = -0.6;
scene.add(platform);
const holeMat = new THREE.MeshStandardMaterial({ color: 0x05060d });
const rimMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0a4c5c });

function makeBot(bomb) {
  const g = new THREE.Group();
  const bodyColor = bomb ? 0xef4444 : 0x9aa4c0;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.75, 1.3, 14),
    new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.55, roughness: 0.35 }));
  body.position.y = 0.65;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12),
    new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.55, roughness: 0.35 }));
  head.position.y = 1.55;
  const eyeMat = new THREE.MeshBasicMaterial({ color: bomb ? 0xfde047 : 0x22d3ee });
  for (const ex of [-0.22, 0.22]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), eyeMat);
    eye.position.set(ex, 1.62, 0.46);
    g.add(eye);
  }
  if (bomb) {
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x333333 }));
    fuse.position.y = 2.2;
    g.add(fuse);
  }
  const antenna = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshBasicMaterial({ color: bomb ? 0xff2222 : 0x4ade80 }));
  antenna.position.y = bomb ? 2.5 : 2.25;
  g.add(body, head, antenna);
  return g;
}

/* 9 holes with bot slots */
const slots = [];
for (const gz of GRID) {
  for (const gx of GRID) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.3, 20), holeMat);
    hole.position.set(gx, 0.02, gz);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 8, 24), rimMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(gx, 0.12, gz);
    scene.add(hole, ring);
    slots.push({ x: gx, z: gz, bot: null, bomb: false, phase: 'down', t: 0, upFor: 1 });
  }
}

let state = 'menu', score = 0, combo = 0, timeLeft = 45, spawnT = 0, elapsed = 0;

function spawn() {
  const free = slots.filter(s => s.phase === 'down');
  if (!free.length) return;
  const s = free[Math.floor(Math.random() * free.length)];
  s.bomb = Math.random() < 0.11;
  s.bot = makeBot(s.bomb);
  s.bot.position.set(s.x, -2.2, s.z);
  scene.add(s.bot);
  s.phase = 'rising'; s.t = 0;
  s.upFor = Math.max(0.8, 1.55 - elapsed * 0.012);
}

function hideBot(s) {
  if (s.bot) scene.remove(s.bot);
  s.bot = null;
  s.phase = 'down';
}

function flash(txt, color) {
  const f = GX.$('flash');
  f.textContent = txt;
  f.style.color = color || '#fde047';
  f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 500);
}

function reset() {
  for (const s of slots) hideBot(s);
  score = 0; combo = 0; timeLeft = 45; spawnT = 0.3; elapsed = 0;
  state = 'play';
  GX.hide();
}

function gameOver() {
  state = 'over';
  const rec = GX.setHi(SLUG, score);
  GX.show('SHIFT OVER', `You scored <b>${score}</b>.${rec ? ' <b>NEW RECORD!</b>' : ' Best: ' + GX.hi(SLUG)}`,
    [{ label: '↻ WHACK AGAIN', primary: true, cb: reset },
     { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
}

/* clicking bots */
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
addEventListener('pointerdown', e => {
  if (state !== 'play' || e.target.closest('.gx-panel')) return;
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(mouse, camera);
  for (const s of slots) {
    if (!s.bot || (s.phase !== 'up' && s.phase !== 'rising')) continue;
    const hit = ray.intersectObject(s.bot, true);
    if (hit.length) {
      if (s.bomb) {
        score = Math.max(0, score - 20);
        combo = 0;
        flash('-20 BOMB!', '#f87171');
        GX.boom(0.3);
      } else {
        combo++;
        const pts = 10 * Math.min(5, combo);
        score += pts;
        flash('+' + pts);
        GX.beep(500 + combo * 60, 0.07, 'square', 0.06);
      }
      s.phase = 'whacked'; s.t = 0;
      return;
    }
  }
});

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());

  if (state === 'play') {
    elapsed += dt;
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; gameOver(); }

    spawnT -= dt;
    if (spawnT <= 0) {
      spawn();
      spawnT = Math.max(0.4, 1.0 - elapsed * 0.012);
    }

    for (const s of slots) {
      if (!s.bot) continue;
      s.t += dt;
      if (s.phase === 'rising') {
        s.bot.position.y = THREE.MathUtils.lerp(-2.2, 0, Math.min(1, s.t / 0.22));
        if (s.t >= 0.22) { s.phase = 'up'; s.t = 0; }
      } else if (s.phase === 'up') {
        s.bot.position.y = Math.sin(s.t * 6) * 0.06;
        if (s.t >= s.upFor) {
          s.phase = 'sinking'; s.t = 0;
          if (!s.bomb) { combo = 0; }   // a good bot escaped
        }
      } else if (s.phase === 'sinking') {
        s.bot.position.y = THREE.MathUtils.lerp(0, -2.2, Math.min(1, s.t / 0.25));
        if (s.t >= 0.25) hideBot(s);
      } else if (s.phase === 'whacked') {
        s.bot.scale.y = Math.max(0.15, 1 - s.t * 6);
        s.bot.scale.x = s.bot.scale.z = 1 + s.t * 1.5;
        if (s.t >= 0.18) hideBot(s);
      }
    }

    GX.hud(`
      <div class="chip"><small>SCORE</small><b>${score}</b></div>
      <div class="chip ${timeLeft < 10 ? 'warn' : ''}"><small>TIME</small><b>${Math.ceil(timeLeft)}</b>s</div>
      <div class="chip"><small>COMBO</small><b>${combo ? '×' + Math.min(5, combo) : '—'}</b></div>
      <div class="chip"><small>BEST</small><b>${Math.max(GX.hi(SLUG), score)}</b></div>`);
  }

  renderer.render(scene, camera);
}
frame();

GX.show('WHACK-A-<span>BOT</span>',
  'Rogue bots are popping out of the service hatches. Click them before they hide!<br>Chain hits to build a combo multiplier (up to ×5).<br><b style="color:#f87171">Don\'t hit the red bomb bots — they cost 30 points.</b>' +
  (GX.hi(SLUG) ? '<br>Best score: <b>' + GX.hi(SLUG) + '</b>' : ''),
  [{ label: '▶ START SHIFT', primary: true, cb: reset },
   { label: 'GAMINGX HUB', cb: () => location.href = '../../index.html' }]);
})();
