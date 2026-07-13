/* =========================================================================
   SOCCER PRO '26 — GamingX flagship title
   Full 11v11 arcade football in pure canvas JS.
   World units: 1m = 10u. Pitch 1050x680. 60fps target, dt-based physics.
   ========================================================================= */
(() => {
'use strict';

/* ============================== HELPERS ============================== */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
// centered noise, denser around 0
const noise = m => (Math.random() - Math.random()) * m;

/* ============================== CONSTANTS ============================= */
const W = 1050, H = 680;            // pitch size
const MARGIN = 46;                  // grass beyond the lines
const GOAL_HALF = 50;               // half goal-mouth height
const GOAL_Y1 = H / 2 - GOAL_HALF, GOAL_Y2 = H / 2 + GOAL_HALF;
const GOAL_DEPTH = 34;
const PLAYER_R = 9, BALL_R = 5;
const CONTROL_R = 14;               // pick-up radius
const VIEW_H = 560;                 // camera view height in world units

const TEAMS = [
  { name: 'Blaze United',   short: 'BLZ', c1: '#e11d2e', c2: '#ffffff', rating: 89 },
  { name: 'Royal Azul',     short: 'RYL', c1: '#1d4ed8', c2: '#facc15', rating: 88 },
  { name: 'Verde Santos',   short: 'VSN', c1: '#16a34a', c2: '#fde047', rating: 87 },
  { name: 'Atlantic City',  short: 'ATL', c1: '#38bdf8', c2: '#ffffff', rating: 86 },
  { name: 'Nordic Storm',   short: 'NRD', c1: '#e5e7eb', c2: '#1e3a8a', rating: 84 },
  { name: 'Rising Sun XI',  short: 'RSX', c1: '#111c44', c2: '#ef4444', rating: 83 },
  { name: 'Desert Falcons', short: 'DFC', c1: '#d4a017', c2: '#111111', rating: 82 },
  { name: 'Iron Wolves',    short: 'IRW', c1: '#6b7280', c2: '#f97316', rating: 80 },
];

// 4-4-2, fractions of pitch, for a team attacking RIGHT
const FORMATION = [
  { role: 'GK', x: 0.045, y: 0.50 },
  { role: 'DF', x: 0.17,  y: 0.16 },
  { role: 'DF', x: 0.15,  y: 0.38 },
  { role: 'DF', x: 0.15,  y: 0.62 },
  { role: 'DF', x: 0.17,  y: 0.84 },
  { role: 'MF', x: 0.40,  y: 0.14 },
  { role: 'MF', x: 0.37,  y: 0.38 },
  { role: 'MF', x: 0.37,  y: 0.62 },
  { role: 'MF', x: 0.40,  y: 0.86 },
  { role: 'FW', x: 0.58,  y: 0.36 },
  { role: 'FW', x: 0.58,  y: 0.64 },
];

const DIFFICULTY = {
  easy:   { speed: 0.86, react: 0.55, passAcc: 0.75, tackle: 0.55, shoot: 0.7,  label: 'AMATEUR' },
  normal: { speed: 1.00, react: 0.80, passAcc: 0.90, tackle: 0.80, shoot: 0.9,  label: 'PRO' },
  hard:   { speed: 1.10, react: 1.00, passAcc: 1.00, tackle: 1.00, shoot: 1.05, label: 'LEGEND' },
};

/* ============================== AUDIO ================================ */
const Snd = (() => {
  let ctx = null;
  const ac = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function tone(freq, dur, type, gain, when = 0, slide = 0) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime + when);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), c.currentTime + when + dur);
    g.gain.setValueAtTime(gain, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + when); o.stop(c.currentTime + when + dur + 0.05);
  }
  function thump(gain) { // ball kick
    const c = ac(); if (!c) return;
    const len = c.sampleRate * 0.08, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 380;
    g.gain.value = gain;
    s.buffer = buf; s.connect(f).connect(g).connect(c.destination); s.start();
  }
  return {
    unlock() { ac(); },
    kick(p) { thump(0.25 + 0.35 * p); },
    whistle(long) {
      tone(2300, 0.16, 'square', 0.06);
      if (long) { tone(2300, 0.16, 'square', 0.06, 0.22); tone(2300, 0.5, 'square', 0.06, 0.44); }
    },
    goal() {
      tone(523, 0.14, 'triangle', 0.12); tone(659, 0.14, 'triangle', 0.12, 0.13);
      tone(784, 0.14, 'triangle', 0.12, 0.26); tone(1046, 0.42, 'triangle', 0.14, 0.39);
      const c = ac(); if (!c) return; // crowd roar
      const len = c.sampleRate * 1.6, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t) * 0.5; }
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.4; g.gain.value = 0.22;
      s.buffer = buf; s.connect(f).connect(g).connect(c.destination); s.start();
    },
    save() { tone(300, 0.1, 'sawtooth', 0.08, 0, -120); },
    post() { tone(180, 0.25, 'square', 0.1, 0, -60); },
  };
})();

/* ============================== INPUT ================================ */
const input = {
  up: 0, down: 0, left: 0, right: 0, sprint: 0,
  passHeld: 0, shootHeld: 0,
  passPressed: 0, shootPressed: 0, shootReleased: 0, switchPressed: 0, pausePressed: 0,
  // touch stick vector
  tx: 0, ty: 0, touchActive: false,
  clearEdges() { this.passPressed = this.shootPressed = this.shootReleased = this.switchPressed = this.pausePressed = 0; },
  moveVec() {
    let x = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    let y = (this.down ? 1 : 0) - (this.up ? 1 : 0);
    if (this.touchActive) { x = this.tx; y = this.ty; }
    const m = Math.hypot(x, y);
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  },
};

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
};
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  Snd.unlock();
  const m = KEYMAP[e.code];
  if (m) { input[m] = 1; e.preventDefault(); return; }
  switch (e.code) {
    case 'KeyX': case 'KeyK': input.passHeld = 1; input.passPressed = 1; e.preventDefault(); break;
    case 'KeyC': case 'KeyL': input.shootHeld = 1; input.shootPressed = 1; e.preventDefault(); break;
    case 'KeyZ': case 'KeyJ': input.switchPressed = 1; e.preventDefault(); break;
    case 'KeyP': case 'Escape': input.pausePressed = 1; break;
  }
});
window.addEventListener('keyup', e => {
  const m = KEYMAP[e.code];
  if (m) { input[m] = 0; return; }
  switch (e.code) {
    case 'KeyX': case 'KeyK': input.passHeld = 0; break;
    case 'KeyC': case 'KeyL': if (input.shootHeld) input.shootReleased = 1; input.shootHeld = 0; break;
  }
});

/* -------- touch controls -------- */
function setupTouch() {
  const zone = document.getElementById('stick-zone');
  const base = document.getElementById('stick-base');
  const knob = document.getElementById('stick-knob');
  let stickId = null, ox = 0, oy = 0;

  document.addEventListener('touchstart', () => {
    document.body.classList.add('touch'); Snd.unlock();
  }, { once: true, passive: true });

  zone.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    stickId = t.identifier; ox = t.clientX; oy = t.clientY;
    base.style.display = 'block';
    base.style.left = (ox - 60) + 'px'; base.style.top = (oy - 60) + 'px';
    base.style.bottom = 'auto';
    knob.style.left = '33px'; knob.style.top = '33px';
    input.touchActive = true; input.tx = 0; input.ty = 0;
    e.preventDefault();
  }, { passive: false });

  zone.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== stickId) continue;
      let dx = t.clientX - ox, dy = t.clientY - oy;
      const m = Math.hypot(dx, dy), max = 52;
      if (m > max) { dx = dx / m * max; dy = dy / m * max; }
      knob.style.left = (33 + dx) + 'px'; knob.style.top = (33 + dy) + 'px';
      const dead = 8;
      input.tx = Math.abs(dx) > dead ? dx / max : 0;
      input.ty = Math.abs(dy) > dead ? dy / max : 0;
      input.sprint = m > max * 0.92 ? 1 : input.sprint;
    }
    e.preventDefault();
  }, { passive: false });

  const stickEnd = e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== stickId) continue;
      stickId = null; input.touchActive = false; input.tx = input.ty = 0;
      base.style.display = 'none';
      if (!btnState.sprint) input.sprint = 0;
    }
  };
  zone.addEventListener('touchend', stickEnd);
  zone.addEventListener('touchcancel', stickEnd);

  const btnState = { sprint: 0 };
  const bindBtn = (id, down, up) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { el.classList.add('held'); down(); e.preventDefault(); }, { passive: false });
    const end = e => { el.classList.remove('held'); if (up) up(); e.preventDefault(); };
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  };
  bindBtn('tb-pass', () => { input.passHeld = 1; input.passPressed = 1; }, () => { input.passHeld = 0; });
  bindBtn('tb-shoot', () => { input.shootHeld = 1; input.shootPressed = 1; }, () => { if (input.shootHeld) input.shootReleased = 1; input.shootHeld = 0; });
  bindBtn('tb-switch', () => { input.switchPressed = 1; });
  bindBtn('tb-sprint', () => { btnState.sprint = 1; input.sprint = 1; }, () => { btnState.sprint = 0; input.sprint = 0; });
}

/* ============================== GAME STATE =========================== */
const G = {
  running: false,
  state: 'idle',        // kickoff | play | restart | goal | half | full
  stateT: 0,
  paused: false,
  half: 1,
  halfReal: 180,        // real seconds per half
  tHalf: 0,             // elapsed play seconds this half
  score: [0, 0],
  teams: [],            // [{def, dir, gkColor, jersey, alt}]
  players: [],
  ball: null,
  controlled: null,
  kickTeam: 0,          // team taking next kickoff
  diff: DIFFICULTY.normal,
  banner: null,         // {text, sub, t, dur}
  restart: null,        // {type, team, x, y, taker, t}
  goalScorerTeam: 0,
  charge: 0, charging: false,
  switchCd: 0,
  camX: W / 2, camY: H / 2,
  shots: [0, 0],
  finished: false,
};

function colorsClash(a, b) {
  const hx = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const [r1, g1, b1] = hx(a), [r2, g2, b2] = hx(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) < 180;
}

function makePlayers(homeDef, awayDef) {
  const players = [];
  const homeJersey = homeDef.c1;
  const awayJersey = colorsClash(homeDef.c1, awayDef.c1) ? awayDef.c2 : awayDef.c1;
  G.teams = [
    { def: homeDef, dir: 1,  jersey: homeJersey, gk: '#f59e0b' },
    { def: awayDef, dir: -1, jersey: awayJersey, gk: '#10b981' },
  ];
  if (colorsClash(G.teams[0].jersey, G.teams[1].jersey)) G.teams[1].jersey = awayDef.c2;
  if (colorsClash(G.teams[0].gk, G.teams[0].jersey)) G.teams[0].gk = '#84cc16';
  if (colorsClash(G.teams[1].gk, G.teams[1].jersey)) G.teams[1].gk = '#e879f9';

  for (let t = 0; t < 2; t++) {
    const def = t === 0 ? homeDef : awayDef;
    const ratingBoost = 0.88 + (def.rating - 78) * 0.011;
    FORMATION.forEach((f, i) => {
      const fx = t === 0 ? f.x : 1 - f.x;
      players.push({
        team: t, i, role: f.role, isGK: f.role === 'GK',
        bx: fx, by: f.y,
        x: fx * W, y: f.y * H, vx: 0, vy: 0,
        dirx: t === 0 ? 1 : -1, diry: 0,
        speed: (f.role === 'GK' ? 150 : 158) * ratingBoost * rnd(0.96, 1.05),
        lungeT: 0, lungeDx: 0, lungeDy: 0, lungeCd: 0,
        kickCd: 0, decideT: rnd(0, 0.4), holdT: 0,
      });
    });
  }
  return players;
}

function goalX(team)  { return G.teams[team].dir === 1 ? W : 0; }   // goal this team ATTACKS
function ownGoalX(team) { return G.teams[team].dir === 1 ? 0 : W; }

/* ---------------- match setup ---------------- */
function startMatch(cfg) {
  G.players = makePlayers(cfg.home, cfg.away);
  G.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, owner: null, noTouchP: null, noTouchT: 0, spin: 0 };
  G.score = [0, 0];
  G.shots = [0, 0];
  G.half = 1;
  G.tHalf = 0;
  G.halfReal = cfg.halfReal;
  G.diff = DIFFICULTY[cfg.difficulty];
  G.kickTeam = Math.random() < 0.5 ? 0 : 1;
  G.firstKickTeam = G.kickTeam;
  G.controlled = null;
  G.paused = false;
  G.finished = false;
  G.running = true;
  setupKickoff(G.kickTeam);
  Snd.whistle(false);
}

function setupKickoff(team) {
  G.state = 'kickoff'; G.stateT = 0;
  const b = G.ball;
  b.x = W / 2; b.y = H / 2; b.vx = b.vy = 0; b.owner = null; b.noTouchP = null;
  for (const p of G.players) {
    p.x = p.bx * W; p.y = p.by * H;
    // pull kicking team strikers to the centre spot
    p.vx = p.vy = 0; p.lungeT = 0; p.lungeCd = 0; p.kickCd = 0; p.holdT = 0;
  }
  const strikers = G.players.filter(p => p.team === team && p.role === 'FW');
  strikers.sort((a, b2) => dist(a.x, a.y, W / 2, H / 2) - dist(b2.x, b2.y, W / 2, H / 2));
  const taker = strikers[0];
  taker.x = W / 2 - G.teams[team].dir * 14; taker.y = H / 2;
  if (strikers[1]) { strikers[1].x = W / 2 - G.teams[team].dir * 30; strikers[1].y = H / 2 - 60; }
  G.restart = { type: 'kickoff', team, x: W / 2, y: H / 2, taker, t: 1.0 };
  if (team === 0) G.controlled = taker; else pickAutoControlled(true);
}

/* ---------------- restarts (throw-in / corner / goal kick) ------------ */
function setRestart(type, team, x, y) {
  G.state = 'restart'; G.stateT = 0;
  const b = G.ball;
  b.owner = null; b.vx = b.vy = 0; b.x = x; b.y = y; b.noTouchP = null;
  let taker;
  if (type === 'goalkick') {
    taker = G.players.find(p => p.team === team && p.isGK);
  } else {
    let best = 1e9;
    for (const p of G.players) {
      if (p.team !== team || p.isGK) continue;
      const d = dist(p.x, p.y, x, y);
      if (d < best) { best = d; taker = p; }
    }
  }
  // stand the taker just off the ball, facing the pitch
  const cx = W / 2 - x, cy = H / 2 - y, m = Math.hypot(cx, cy) || 1;
  taker.x = x - cx / m * 16; taker.y = y - cy / m * 16;
  taker.vx = taker.vy = 0;
  G.restart = { type, team, x, y, taker, t: 1.0 };
  const label = { throwin: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK' }[type];
  G.banner = { text: label, sub: G.teams[team].def.name, t: 0, dur: 1.1 };
  if (team === 0) G.controlled = taker; else pickAutoControlled(true);
}

function executeRestart() {
  const r = G.restart;
  const taker = r.taker, team = r.team, dir = G.teams[team].dir;
  G.ball.x = r.x; G.ball.y = r.y;
  if (r.type === 'corner') {
    // drive it toward the penalty spot area
    const tx = goalX(team) - dir * 110 + noise(50);
    const ty = H / 2 + noise(120);
    kickToPoint(taker, tx, ty, rnd(560, 660));
  } else if (r.type === 'kickoff') {
    // lay it back to a midfielder
    const mids = G.players.filter(p => p.team === team && p.role === 'MF');
    mids.sort((a, b) => dist(a.x, a.y, taker.x, taker.y) - dist(b.x, b.y, taker.x, taker.y));
    aiPassTo(taker, mids[0] || nearestMate(taker));
  } else {
    const mate = choosePassTarget(taker, true);
    if (mate) aiPassTo(taker, mate);
    else kickToPoint(taker, taker.x + dir * 200, taker.y + noise(80), 480);
  }
  G.state = 'play';
  G.restart = null;
}

/* ---------------- kicking the ball ---------------- */
function kickBall(p, vx, vy) {
  const b = G.ball;
  b.owner = null;
  b.vx = vx; b.vy = vy;
  b.noTouchP = p; b.noTouchT = 0.38;
  p.kickCd = 0.3;
  Snd.kick(clamp(Math.hypot(vx, vy) / 1000, 0, 1));
}

function kickToPoint(p, tx, ty, speed) {
  const dx = tx - p.x, dy = ty - p.y, m = Math.hypot(dx, dy) || 1;
  kickBall(p, dx / m * speed, dy / m * speed);
}

function aiPassTo(p, mate) {
  const acc = G.diff.passAcc * (p.team === 0 ? 1 : 1); // same model both ways
  const lead = 0.32;
  let tx = mate.x + mate.vx * lead + G.teams[p.team].dir * 12;
  let ty = mate.y + mate.vy * lead;
  tx += noise((1.05 - acc) * 90); ty += noise((1.05 - acc) * 90);
  const d = dist(p.x, p.y, tx, ty);
  kickToPoint(p, tx, ty, clamp(d * 2.1, 330, 740));
}

function nearestMate(p) {
  let best = null, bd = 1e9;
  for (const q of G.players) {
    if (q === p || q.team !== p.team || q.isGK) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

// score teammates as pass options; forward progress vs interception risk
function choosePassTarget(p, allowBackwards) {
  const dir = G.teams[p.team].dir;
  const opps = G.players.filter(q => q.team !== p.team);
  let best = null, bestScore = -1e9;
  for (const q of G.players) {
    if (q === p || q.team !== p.team || q.isGK) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < 40 || d > 480) continue;
    const forward = (q.x - p.x) * dir;
    if (!allowBackwards && forward < -140) continue;
    // interception risk: opponents close to the passing lane
    let risk = 0;
    const dx = (q.x - p.x) / d, dy = (q.y - p.y) / d;
    for (const o of opps) {
      const px = o.x - p.x, py = o.y - p.y;
      const along = px * dx + py * dy;
      if (along < 0 || along > d) continue;
      const off = Math.abs(px * dy - py * dx);
      if (off < 46) risk += (46 - off) * 2.2;
      if (dist(o.x, o.y, q.x, q.y) < 55) risk += 60;
    }
    const score = forward * 1.15 - d * 0.28 - risk + rnd(0, 30);
    if (score > bestScore) { bestScore = score; best = q; }
  }
  return best;
}

/* ---------------- user actions ---------------- */
function userPass() {
  const p = G.controlled;
  if (!p) return;
  if (G.ball.owner === p) {
    const mv = input.moveVec();
    let best = null, bestScore = -1e9;
    const aimx = mv.x || p.dirx, aimy = mv.y || p.diry;
    const am = Math.hypot(aimx, aimy) || 1;
    for (const q of G.players) {
      if (q === p || q.team !== p.team || q.isGK) continue;
      const d = dist(p.x, p.y, q.x, q.y);
      if (d < 26 || d > 520) continue;
      const dot = ((q.x - p.x) / d) * (aimx / am) + ((q.y - p.y) / d) * (aimy / am);
      const score = dot * 300 - d * 0.35;
      if (score > bestScore) { bestScore = score; best = q; }
    }
    if (best && bestScore > -80) {
      const lead = 0.3;
      const tx = best.x + best.vx * lead, ty = best.y + best.vy * lead;
      const d = dist(p.x, p.y, tx, ty);
      kickToPoint(p, tx, ty, clamp(d * 2.2, 340, 760));
      G.controlled = best;          // pre-switch to the receiver
    } else {
      // no good option: knock it forward
      kickBall(p, (aimx / am) * 420, (aimy / am) * 420);
    }
  } else {
    startLunge(p, 1);
  }
}

function userShoot(power) {
  const p = G.controlled;
  if (!p) return;
  if (G.ball.owner === p) {
    const gx = goalX(p.team);
    const mv = input.moveVec();
    let ty = H / 2 + mv.y * 62;
    ty = clamp(ty + noise((1 - power) * 55 + 18), GOAL_Y1 + 6, GOAL_Y2 - 6);
    const speed = 640 + 470 * power;
    const dx = gx - p.x, dy = ty - p.y, m = Math.hypot(dx, dy) || 1;
    kickBall(p, dx / m * speed, dy / m * speed);
    G.shots[p.team]++;
  } else {
    startLunge(p, 1.35);   // slide tackle
  }
}

function startLunge(p, mult) {
  if (p.lungeCd > 0 || p.lungeT > 0) return;
  const mv = input.moveVec();
  let dx = mv.x, dy = mv.y;
  if (!dx && !dy) {
    const b = G.ball;
    dx = b.x - p.x; dy = b.y - p.y;
  }
  const m = Math.hypot(dx, dy) || 1;
  p.lungeDx = dx / m; p.lungeDy = dy / m;
  p.lungeT = 0.26 * mult;
  p.lungeCd = 0.85 * mult;
}

function pickAutoControlled(force) {
  // control the user outfielder closest to the ball
  const b = G.ball;
  let best = null, bd = 1e9;
  for (const p of G.players) {
    if (p.team !== 0 || p.isGK) continue;
    const d = dist(p.x, p.y, b.x, b.y);
    if (d < bd) { bd = d; best = p; }
  }
  if (!G.controlled || force) { G.controlled = best; return; }
  const cd = dist(G.controlled.x, G.controlled.y, b.x, b.y);
  if (best !== G.controlled && bd < cd - 30) G.controlled = best;
}

function manualSwitch() {
  const b = G.ball;
  const cands = G.players.filter(p => p.team === 0 && !p.isGK && p !== G.controlled);
  cands.sort((a, q) => dist(a.x, a.y, b.x, b.y) - dist(q.x, q.y, b.x, b.y));
  if (cands[0]) G.controlled = cands[0];
}

/* ============================== AI =================================== */
function formationTarget(p) {
  const team = G.teams[p.team];
  const b = G.ball;
  const owning = b.owner && b.owner.team === p.team;
  const push = owning ? 0.085 * team.dir : -0.03 * team.dir;
  let fx = p.bx + push + (b.x / W - 0.5) * 0.34;
  let fy = p.by + (b.y / H - 0.5) * 0.30;
  fx = clamp(fx, 0.03, 0.97); fy = clamp(fy, 0.04, 0.96);
  return { x: fx * W, y: fy * H };
}

function moveToward(p, tx, ty, speed, dt) {
  const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
  if (d < 3) { p.vx *= 0.7; p.vy *= 0.7; return; }
  const s = d < 30 ? speed * (d / 30) : speed;
  p.vx = dx / d * s; p.vy = dy / d * s;
  p.dirx = dx / d; p.diry = dy / d;
}

// which players of `team` should hunt the ball
function assignChasers(team) {
  const b = G.ball;
  const cands = G.players.filter(p => p.team === team && !p.isGK && p !== G.controlled);
  cands.sort((a, q) => dist(a.x, a.y, b.x, b.y) - dist(q.x, q.y, b.x, b.y));
  const owning = b.owner && b.owner.team === team;
  const n = owning ? 0 : (b.owner ? 2 : 1);
  return new Set(cands.slice(0, n));
}

function aiDribble(p, dt) {
  const team = G.teams[p.team];
  const gx = goalX(p.team), gy = H / 2;
  const distGoal = dist(p.x, p.y, gx, gy);
  const df = G.diff;

  // nearest opponent
  let opp = null, od = 1e9;
  for (const q of G.players) {
    if (q.team === p.team) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < od) { od = d; opp = q; }
  }

  p.decideT -= dt;
  if (p.decideT <= 0) {
    p.decideT = rnd(0.25, 0.5);
    // shoot?
    const shootRange = 235 * df.shoot;
    if (distGoal < shootRange && Math.abs(p.y - gy) < 200 && Math.random() < 0.65 * df.react) {
      const ty = clamp(gy + noise((1.1 - df.passAcc) * 120 + 30), GOAL_Y1 + 5, GOAL_Y2 - 5);
      const power = clamp(1 - distGoal / 500, 0.35, 0.95);
      const speed = 640 + 460 * power;
      const dx = gx - p.x, dy = ty - p.y, m = Math.hypot(dx, dy) || 1;
      kickBall(p, dx / m * speed, dy / m * speed);
      G.shots[p.team]++;
      return;
    }
    // pass under pressure or opportunistically
    const pressured = od < 42;
    if (pressured || Math.random() < 0.30) {
      const mate = choosePassTarget(p, pressured);
      if (mate && (pressured || (mate.x - p.x) * team.dir > 30)) {
        aiPassTo(p, mate);
        return;
      }
    }
  }

  // carry the ball: head for goal, swerve around the nearest defender
  let tx = gx, ty = gy + (p.y - gy) * 0.35;
  let dx = tx - p.x, dy = ty - p.y, m = Math.hypot(dx, dy) || 1;
  dx /= m; dy /= m;
  if (opp && od < 80) {
    const ox = p.x - opp.x, oy = p.y - opp.y, om = Math.hypot(ox, oy) || 1;
    const w = (80 - od) / 80 * 1.15;
    dx += ox / om * w; dy += oy / om * w;
    const mm = Math.hypot(dx, dy) || 1; dx /= mm; dy /= mm;
  }
  const sp = p.speed * (p.team === 1 ? G.diff.speed : 1) * 0.86;
  p.vx = dx * sp; p.vy = dy * sp;
  p.dirx = dx; p.diry = dy;
}

function aiKeeper(p, dt) {
  const b = G.ball;
  const own = ownGoalX(p.team);
  const dir = own === 0 ? 1 : -1;           // facing into the pitch
  const boxX = own === 0 ? 110 : W - 110;

  if (b.owner === p) {                       // holding: punt after a beat
    p.holdT += dt;
    p.vx = p.vy = 0;
    if (p.holdT > 1.15) {
      p.holdT = 0;
      const mates = G.players.filter(q => q.team === p.team && !q.isGK);
      let best = null, bs = -1e9;
      for (const m of mates) {
        const forward = (m.x - p.x) * G.teams[p.team].dir;
        const s = forward + rnd(0, 120);
        if (s > bs) { bs = s; best = m; }
      }
      if (best) {
        const tx = best.x + noise(60), ty = best.y + noise(60);
        kickToPoint(p, tx, ty, 820);
      }
    }
    return;
  }

  const threat = Math.abs(b.x - own) < 340;
  let tx = own + dir * 16, ty = H / 2;
  if (threat) {
    // track the ball's y, come off the line a little
    const t = clamp(1 - Math.abs(b.x - own) / 340, 0, 1);
    ty = clamp(H / 2 + (b.y - H / 2) * (0.55 + 0.45 * t), GOAL_Y1 - 14, GOAL_Y2 + 14);
    tx = own + dir * (16 + 40 * t);
    // charge a loose ball inside the box
    const inBox = Math.abs(b.x - own) < 165 && b.y > H / 2 - 205 && b.y < H / 2 + 205;
    if (!b.owner && inBox && Math.hypot(b.vx, b.vy) < 260) { tx = b.x; ty = b.y; }
  }
  const sp = p.speed * (threat ? 1.35 : 0.9);
  moveToward(p, tx, ty, sp, dt);
  // keep keepers near their box
  p.x = own === 0 ? Math.min(p.x, boxX + 60) : Math.max(p.x, boxX - 60);
}

function aiFieldPlayer(p, dt, chasers) {
  const b = G.ball;
  const df = G.diff;
  const isCpu = p.team === 1;
  const spdMult = isCpu ? df.speed : 1;

  if (chasers.has(p)) {
    // chase the ball (or its owner) and try to win it
    let tx = b.x, ty = b.y;
    if (b.owner && b.owner.team !== p.team) {
      // aim slightly goal-side of the dribbler
      const dir = G.teams[p.team].dir;
      tx = b.owner.x - dir * 10; ty = b.owner.y;
    } else if (!b.owner) {
      tx = b.x + b.vx * 0.22; ty = b.y + b.vy * 0.22;
    }
    moveToward(p, tx, ty, p.speed * spdMult, dt);
    // lunge tackle
    if (b.owner && b.owner.team !== p.team && p.lungeCd <= 0 && p.lungeT <= 0) {
      const d = dist(p.x, p.y, b.owner.x, b.owner.y);
      if (d < 30 && Math.random() < df.tackle * (isCpu ? 6 : 5) * dt) {
        const dx = b.owner.x - p.x, dy = b.owner.y - p.y, m = Math.hypot(dx, dy) || 1;
        p.lungeDx = dx / m; p.lungeDy = dy / m;
        p.lungeT = 0.26; p.lungeCd = 0.9;
      }
    }
  } else {
    const t = formationTarget(p);
    moveToward(p, t.x, t.y, p.speed * 0.82 * spdMult, dt);
  }
}

/* ============================== UPDATE =============================== */
function updatePlayers(dt) {
  const b = G.ball;
  const chasers0 = assignChasers(0);
  const chasers1 = assignChasers(1);

  for (const p of G.players) {
    p.lungeCd = Math.max(0, p.lungeCd - dt);
    p.kickCd = Math.max(0, p.kickCd - dt);

    if (p.lungeT > 0) {
      p.lungeT -= dt;
      p.vx = p.lungeDx * 330; p.vy = p.lungeDy * 330;
      p.x += p.vx * dt; p.y += p.vy * dt;
      continue;
    }

    const frozen = G.state !== 'play' && G.state !== 'restart' && G.state !== 'kickoff';
    if (frozen) {
      // drift back to formation during goal celebrations etc.
      const t = formationTarget(p);
      moveToward(p, t.x, t.y, p.speed * 0.5, dt);
    } else if (G.state === 'kickoff' || G.state === 'restart') {
      if (p !== (G.restart && G.restart.taker)) {
        const t = formationTarget(p);
        moveToward(p, t.x, t.y, p.speed * 0.55, dt);
      } else { p.vx = p.vy = 0; }
    } else if (p === G.controlled) {
      updateUserPlayer(p, dt);
    } else if (p.isGK) {
      aiKeeper(p, dt);
    } else if (b.owner === p) {
      aiDribble(p, dt);
    } else {
      aiFieldPlayer(p, dt, p.team === 0 ? chasers0 : chasers1);
    }

    p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = clamp(p.x, -MARGIN + 8, W + MARGIN - 8);
    p.y = clamp(p.y, -MARGIN + 8, H + MARGIN - 8);
  }

  // soft separation so players don't stack
  for (let i = 0; i < G.players.length; i++) {
    for (let j = i + 1; j < G.players.length; j++) {
      const a = G.players[i], c = G.players[j];
      const dx = c.x - a.x, dy = c.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.001 && d < PLAYER_R * 2) {
        const push = (PLAYER_R * 2 - d) / 2;
        a.x -= dx / d * push; a.y -= dy / d * push;
        c.x += dx / d * push; c.y += dy / d * push;
      }
    }
  }
}

function updateUserPlayer(p, dt) {
  const mv = input.moveVec();
  const hasBall = G.ball.owner === p;
  let sp = p.speed * (input.sprint ? 1.34 : 1);
  if (hasBall) sp *= 0.86;
  if (G.charging) sp *= 0.6;
  p.vx = mv.x * sp; p.vy = mv.y * sp;
  if (mv.x || mv.y) {
    const m = Math.hypot(mv.x, mv.y);
    p.dirx = mv.x / m; p.diry = mv.y / m;
  }
}

function updateBall(dt) {
  const b = G.ball;
  if (b.noTouchT > 0) b.noTouchT -= dt;

  if (b.owner) {
    const o = b.owner;
    // ball rides just ahead of the dribbler
    const lead = o.isGK ? 4 : 13;
    b.x = o.x + o.dirx * lead;
    b.y = o.y + o.diry * lead;
    b.vx = o.vx; b.vy = o.vy;

    // tackles on the dribbler
    if (!o.isGK) {
      for (const q of G.players) {
        if (q.team === o.team || q.lungeT <= 0) continue;
        if (dist(q.x, q.y, b.x, b.y) < 17) {
          // won the ball — knock it loose
          b.owner = null;
          b.vx = q.lungeDx * 250 + noise(60);
          b.vy = q.lungeDy * 250 + noise(60);
          b.noTouchP = o; b.noTouchT = 0.3;
          q.lungeT = 0;
          break;
        }
      }
    }
  } else {
    b.x += b.vx * dt; b.y += b.vy * dt;
    const f = Math.pow(0.42, dt);
    b.vx *= f; b.vy *= f;
    b.spin += Math.hypot(b.vx, b.vy) * dt * 0.06;

    if (G.state !== 'play') return;

    // pick-ups & saves
    const speed = Math.hypot(b.vx, b.vy);
    let taken = false;
    for (const p of G.players) {
      if (taken) break;
      if (p.kickCd > 0) continue;
      if (b.noTouchT > 0 && b.noTouchP === p) continue;
      const d = dist(p.x, p.y, b.x, b.y);
      if (p.isGK) {
        // keepers claim anything close, with a save roll on hard shots
        if (d < CONTROL_R + 6) {
          const towardOwn = Math.abs(b.x - ownGoalX(p.team)) < 200;
          if (towardOwn && speed > 420) {
            const catchChance = clamp(1.2 - speed / 950, 0.28, 0.95);
            if (Math.random() < catchChance) {
              b.owner = p; p.holdT = 0; taken = true; Snd.save();
            } else {
              // parried!
              const away = G.teams[p.team].dir;
              b.vx = away * rnd(180, 320); b.vy = noise(260);
              b.noTouchP = p; b.noTouchT = 0.4;
              Snd.save();
            }
          } else {
            b.owner = p; p.holdT = 0; taken = true;
          }
        }
        continue;
      }
      if (d < CONTROL_R) {
        if (speed < 380) { b.owner = p; taken = true; }
        else if (speed < 700) {
          if (Math.random() < 0.55) { b.owner = p; taken = true; }
          else { // heavy touch: ball pops off
            b.vx *= -0.35; b.vy *= -0.35;
            b.vx += noise(120); b.vy += noise(120);
            b.noTouchP = p; b.noTouchT = 0.25;
          }
        }
      }
    }
    if (taken && b.owner) {
      if (b.owner.team === 0 && !b.owner.isGK) G.controlled = b.owner;
    }
  }
}

function checkGoalsAndBounds() {
  const b = G.ball;
  if (G.state !== 'play') return;

  // goals
  if (b.x < -BALL_R) {
    if (b.y > GOAL_Y1 && b.y < GOAL_Y2 && b.x > -GOAL_DEPTH) { scoreGoal(1); return; }
    if (b.x < -2) { outOverGoalLine(0); return; }
  }
  if (b.x > W + BALL_R) {
    if (b.y > GOAL_Y1 && b.y < GOAL_Y2 && b.x < W + GOAL_DEPTH) { scoreGoal(0); return; }
    if (b.x > W + 2) { outOverGoalLine(1); return; }
  }
  // touchlines
  if (b.y < -2 || b.y > H + 2) {
    const lastTeam = b.owner ? b.owner.team : (b.noTouchP ? b.noTouchP.team : 0);
    const winner = 1 - lastTeam;
    const y = b.y < 0 ? 6 : H - 6;
    setRestart('throwin', winner, clamp(b.x, 12, W - 12), y);
  }
}

// ball fully crossed the goal line at side `side` (0 = left/home goal, 1 = right/away goal), no goal
function outOverGoalLine(side) {
  const b = G.ball;
  const defender = side === 0 ? 0 : 1;              // team defending that goal
  const lastTeam = b.owner ? b.owner.team : (b.noTouchP ? b.noTouchP.team : defender);
  if (lastTeam === defender) {
    // corner for the attackers
    const attacker = 1 - defender;
    const cx = side === 0 ? 10 : W - 10;
    const cy = b.y < H / 2 ? 10 : H - 10;
    setRestart('corner', attacker, cx, cy);
  } else {
    const gx = side === 0 ? 62 : W - 62;
    setRestart('goalkick', defender, gx, H / 2);
  }
}

function scoreGoal(team) {
  G.score[team]++;
  G.goalScorerTeam = team;
  G.state = 'goal'; G.stateT = 0;
  G.ball.vx *= 0.1; G.ball.vy *= 0.1; G.ball.owner = null;
  G.kickTeam = 1 - team;
  G.banner = { text: 'GOOOAL!', sub: G.teams[team].def.name, t: 0, dur: 2.4 };
  Snd.goal();
}

/* ---------------- match clock & flow ---------------- */
function updateFlow(dt) {
  G.stateT += dt;

  switch (G.state) {
    case 'kickoff':
    case 'restart':
      if (G.restart) {
        G.restart.t -= dt;
        if (G.restart.t <= 0) {
          if (G.restart.type === 'kickoff') Snd.whistle(false);
          executeRestart();
        }
      }
      break;
    case 'play':
      G.tHalf += dt;
      if (G.tHalf >= G.halfReal) {
        if (G.half === 1) enterHalfTime();
        else enterFullTime();
      }
      break;
    case 'goal':
      if (G.stateT > 2.5) setupKickoff(G.kickTeam);
      break;
  }

  if (G.banner) {
    G.banner.t += dt;
    if (G.banner.t > G.banner.dur) G.banner = null;
  }
}

function gameClockMin() {
  const base = G.half === 1 ? 0 : 45;
  return Math.min(90, base + Math.floor(45 * G.tHalf / G.halfReal));
}

function enterHalfTime() {
  G.state = 'half';
  Snd.whistle(true);
  showBreak('HALF TIME', `${G.teams[0].def.short} ${G.score[0]} — ${G.score[1]} ${G.teams[1].def.short}`,
    'Shots: ' + G.shots[0] + ' — ' + G.shots[1],
    [{ label: '▶ SECOND HALF', primary: true, fn: () => {
      hideBreak();
      G.half = 2; G.tHalf = 0;
      setupKickoff(1 - G.firstKickTeam);
    } }]);
}

function enterFullTime() {
  G.state = 'full';
  G.finished = true;
  Snd.whistle(true);
  saveStats();
  const [h, a] = G.score;
  const title = h > a ? '🏆 YOU WIN!' : h < a ? 'FULL TIME — DEFEAT' : 'FULL TIME — DRAW';
  showBreak(title, `${G.teams[0].def.short} ${h} — ${a} ${G.teams[1].def.short}`,
    'Shots: ' + G.shots[0] + ' — ' + G.shots[1],
    [
      { label: '↻ REMATCH', primary: true, fn: () => { hideBreak(); startMatch(menu.cfg()); } },
      { label: 'MATCH SETUP', fn: () => { hideBreak(); G.running = false; showScreen('screen-select'); } },
      { label: 'MAIN MENU', fn: () => { hideBreak(); G.running = false; showScreen('screen-menu'); } },
    ]);
}

function saveStats() {
  try {
    const key = 'gamingx.soccer.stats';
    const s = JSON.parse(localStorage.getItem(key) || '{}');
    s.played = (s.played || 0) + 1;
    const [h, a] = G.score;
    if (h > a) {
      s.wins = (s.wins || 0) + 1;
      const margin = h - a;
      const bw = s.bestWin ? s.bestWin.split('-').map(Number) : null;
      if (!bw || margin > bw[0] - bw[1] || (margin === bw[0] - bw[1] && h > bw[0])) s.bestWin = h + '-' + a;
    } else if (h < a) s.losses = (s.losses || 0) + 1;
    else s.draws = (s.draws || 0) + 1;
    s.goalsFor = (s.goalsFor || 0) + h;
    s.goalsAgainst = (s.goalsAgainst || 0) + a;
    localStorage.setItem(key, JSON.stringify(s));
  } catch (e) {}
}

/* ---------------- per-frame user input ---------------- */
function handleUserInput(dt) {
  if (input.pausePressed && (G.state === 'play' || G.state === 'restart' || G.state === 'kickoff')) {
    togglePause();
  }
  if (G.paused) return;
  if (G.state !== 'play') { G.charging = false; G.charge = 0; return; }

  G.switchCd = Math.max(0, G.switchCd - dt);
  const p = G.controlled;

  if (input.switchPressed && G.switchCd <= 0 && (!G.ball.owner || G.ball.owner.team !== 0)) {
    manualSwitch(); G.switchCd = 0.25;
  }

  if (input.passPressed) userPass();

  if (input.shootPressed) {
    if (p && G.ball.owner === p) { G.charging = true; G.charge = 0; }
    else userShoot(0.5);   // defensive slide
  }
  if (G.charging) {
    G.charge = Math.min(1, G.charge + dt / 0.85);
    if (!p || G.ball.owner !== p) { G.charging = false; G.charge = 0; }
    else if (input.shootReleased || G.charge >= 1) {
      G.charging = false;
      userShoot(0.25 + 0.75 * G.charge);
      G.charge = 0;
    }
  }

  // auto-switch when defending / ball loose
  if (!G.ball.owner || G.ball.owner.team !== 0) pickAutoControlled(false);
}

/* ============================== RENDER ================================ */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let cw = 0, ch = 0, dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cw = window.innerWidth; ch = window.innerHeight;
  canvas.width = cw * dpr; canvas.height = ch * dpr;
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
}
window.addEventListener('resize', resize);
resize();

function updateCamera(dt) {
  const b = G.ball;
  const scale = ch / VIEW_H;
  const viewW = cw / scale;
  let txm = clamp(b.x, viewW / 2 - MARGIN, W + MARGIN - viewW / 2);
  let tym = clamp(b.y, VIEW_H / 2 - MARGIN, H + MARGIN - VIEW_H / 2);
  if (viewW >= W + MARGIN * 2) txm = W / 2;
  if (VIEW_H >= H + MARGIN * 2) tym = H / 2;
  const k = 1 - Math.pow(0.02, dt);
  G.camX = lerp(G.camX, txm, k);
  G.camY = lerp(G.camY, tym, k);
}

function render() {
  const scale = ch / VIEW_H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0a3d1f';
  ctx.fillRect(0, 0, cw, ch);

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale,
    dpr * (cw / 2 - G.camX * scale), dpr * (ch / 2 - G.camY * scale));

  drawPitch();
  drawGoal(0); drawGoal(1);

  // draw entities sorted by y for a hint of depth
  const ents = G.players.slice();
  ents.sort((a, b) => a.y - b.y);
  const b = G.ball;
  let ballDrawn = false;
  for (const p of ents) {
    if (!ballDrawn && b.y < p.y && b.owner !== p) { drawBall(); ballDrawn = true; }
    drawPlayer(p);
  }
  if (!ballDrawn) drawBall();

  // screen-space HUD
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawHUD();
}

function drawPitch() {
  // out-of-play apron
  ctx.fillStyle = '#0c4a25';
  ctx.fillRect(-MARGIN, -MARGIN, W + MARGIN * 2, H + MARGIN * 2);
  // mowing stripes
  const stripes = 12, sw = W / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#15803d' : '#16a34a';
    ctx.fillRect(i * sw, 0, sw + 0.5, H);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 2.4;
  ctx.strokeRect(0, 0, W, H);
  // halfway + centre circle
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 91.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
  // boxes both ends
  for (const side of [0, 1]) {
    const sgn = side === 0 ? 1 : -1;
    const gx = side === 0 ? 0 : W;
    // penalty area
    ctx.strokeRect(side === 0 ? 0 : W - 165, H / 2 - 201.5, 165, 403);
    // six-yard box
    ctx.strokeRect(side === 0 ? 0 : W - 55, H / 2 - 91.5, 55, 183);
    // spot
    ctx.beginPath(); ctx.arc(gx + sgn * 110, H / 2, 2.5, 0, Math.PI * 2); ctx.fill();
    // arc
    ctx.beginPath();
    const a = Math.acos(55 / 91.5);
    if (side === 0) ctx.arc(110, H / 2, 91.5, -a, a);
    else ctx.arc(W - 110, H / 2, 91.5, Math.PI - a, Math.PI + a);
    ctx.stroke();
    // corner arcs
    ctx.beginPath(); ctx.arc(gx, 0, 12, side === 0 ? 0 : Math.PI / 2, side === 0 ? Math.PI / 2 : Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(gx, H, 12, side === 0 ? -Math.PI / 2 : Math.PI, side === 0 ? 0 : Math.PI * 1.5); ctx.stroke();
  }
}

function drawGoal(side) {
  const gx = side === 0 ? -GOAL_DEPTH : W;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(gx, GOAL_Y1, GOAL_DEPTH, GOAL_Y2 - GOAL_Y1);
  // net
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 0.8;
  for (let x = 0; x <= GOAL_DEPTH; x += 8) {
    ctx.beginPath(); ctx.moveTo(gx + x, GOAL_Y1); ctx.lineTo(gx + x, GOAL_Y2); ctx.stroke();
  }
  for (let y = GOAL_Y1; y <= GOAL_Y2; y += 10) {
    ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + GOAL_DEPTH, y); ctx.stroke();
  }
  // posts
  ctx.fillStyle = '#f8fafc';
  const px = side === 0 ? 0 : W;
  ctx.fillRect(px - 2.5, GOAL_Y1 - 5, 5, 5);
  ctx.fillRect(px - 2.5, GOAL_Y2, 5, 5);
}

function drawPlayer(p) {
  const team = G.teams[p.team];
  const col = p.isGK ? team.gk : team.jersey;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 4, PLAYER_R * 0.95, PLAYER_R * 0.5, 0, 0, Math.PI * 2); ctx.fill();

  // lunge = flatten into a slide
  const sliding = p.lungeT > 0;

  // controlled indicator
  if (p === G.controlled && G.running) {
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(p.x, p.y, PLAYER_R + 4.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - PLAYER_R - 14);
    ctx.lineTo(p.x - 5, p.y - PLAYER_R - 21);
    ctx.lineTo(p.x + 5, p.y - PLAYER_R - 21);
    ctx.closePath(); ctx.fill();
  }

  ctx.save();
  ctx.translate(p.x, p.y);
  if (sliding) { ctx.rotate(Math.atan2(p.lungeDy, p.lungeDx)); ctx.scale(1.35, 0.75); }
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();
  // trim
  ctx.fillStyle = team.def.c2;
  ctx.beginPath(); ctx.arc(0, 0, PLAYER_R * 0.45, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // facing nub
  if (!sliding) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(p.x + p.dirx * (PLAYER_R + 2), p.y + p.diry * (PLAYER_R + 2), 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBall() {
  const b = G.ball;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(b.x, b.y + 3, BALL_R, BALL_R * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  // rolling pattern
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  const a = b.spin;
  ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * 2.4, b.y + Math.sin(a) * 2.4, 1.4, 0, Math.PI * 2); ctx.fill();
}

/* ---------------- HUD ---------------- */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHUD() {
  const t0 = G.teams[0], t1 = G.teams[1];
  // scoreboard
  const sbW = 250, sbH = 44, sx = 16, sy = 14;
  ctx.fillStyle = 'rgba(8,12,22,0.82)';
  roundRect(sx, sy, sbW, sbH, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();

  ctx.fillStyle = t0.jersey; roundRect(sx + 10, sy + 13, 8, 18, 2); ctx.fill();
  ctx.fillStyle = t1.jersey; roundRect(sx + 158, sy + 13, 8, 18, 2); ctx.fill();

  ctx.fillStyle = '#e8ecf8';
  ctx.font = '800 16px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(t0.def.short, sx + 24, sy + sbH / 2 + 1);
  ctx.fillText(t1.def.short, sx + 172, sy + sbH / 2 + 1);
  ctx.textAlign = 'center';
  ctx.font = '900 19px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(G.score[0] + ' - ' + G.score[1], sx + 118, sy + sbH / 2 + 1);

  // clock
  ctx.fillStyle = 'rgba(8,12,22,0.82)';
  roundRect(sx + sbW + 8, sy, 74, sbH, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
  ctx.fillStyle = '#22d3ee';
  ctx.font = '900 17px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(gameClockMin() + "'", sx + sbW + 45, sy + sbH / 2 + 1);
  ctx.font = '700 9px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#8b93ad';
  ctx.fillText(G.half === 1 ? '1ST' : '2ND', sx + sbW + 45, sy + sbH - 8);

  drawMinimap();

  // power bar
  if (G.charging && G.controlled) {
    const bw = 160, bh = 12, bx = cw / 2 - bw / 2, by = ch - 46;
    ctx.fillStyle = 'rgba(8,12,22,0.8)';
    roundRect(bx - 4, by - 4, bw + 8, bh + 8, 8); ctx.fill();
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, '#22c55e'); g.addColorStop(0.6, '#eab308'); g.addColorStop(1, '#ef4444');
    ctx.fillStyle = g;
    roundRect(bx, by, bw * G.charge, bh, 6); ctx.fill();
  }

  // banner
  if (G.banner) {
    const bl = G.banner;
    const fade = Math.min(1, bl.t / 0.15, (bl.dur - bl.t) / 0.3);
    ctx.globalAlpha = clamp(fade, 0, 1);
    const isGoal = bl.text === 'GOOOAL!';
    ctx.textAlign = 'center';
    ctx.font = `900 ${isGoal ? 64 : 34}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(bl.text, cw / 2 + 3, ch * 0.34 + 3);
    ctx.fillStyle = isGoal ? '#fde047' : '#ffffff';
    ctx.fillText(bl.text, cw / 2, ch * 0.34);
    if (bl.sub) {
      ctx.font = '800 20px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#e8ecf8';
      ctx.fillText(bl.sub, cw / 2, ch * 0.34 + (isGoal ? 46 : 32));
    }
    ctx.globalAlpha = 1;
  }

  // kickoff hint
  if (G.state === 'kickoff' && G.restart) {
    ctx.textAlign = 'center';
    ctx.font = '800 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('KICK OFF — ' + G.teams[G.restart.team].def.name, cw / 2, ch * 0.24);
  }
}

function drawMinimap() {
  const mw = 150, mh = 97;
  const mx = cw - mw - 16, my = 14;
  ctx.fillStyle = 'rgba(8,20,12,0.75)';
  roundRect(mx, my, mw, mh, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  ctx.strokeRect(mx + 4, my + 4, mw - 8, mh - 8);
  ctx.beginPath(); ctx.moveTo(mx + mw / 2, my + 4); ctx.lineTo(mx + mw / 2, my + mh - 4); ctx.stroke();
  const px = x => mx + 4 + (x / W) * (mw - 8);
  const py = y => my + 4 + (y / H) * (mh - 8);
  for (const p of G.players) {
    ctx.fillStyle = p === G.controlled ? '#fde047' : G.teams[p.team].jersey;
    ctx.beginPath(); ctx.arc(px(p.x), py(p.y), p === G.controlled ? 2.6 : 1.9, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(px(clamp(G.ball.x, 0, W)), py(clamp(G.ball.y, 0, H)), 2.2, 0, Math.PI * 2); ctx.fill();
}

/* ============================== LOOP ================================== */
let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (!G.running) return;

  handleUserInput(dt);
  if (!G.paused && G.state !== 'half' && G.state !== 'full') {
    updateFlow(dt);
    if (G.state !== 'half' && G.state !== 'full') {
      updatePlayers(dt);
      updateBall(dt);
      checkGoalsAndBounds();
    }
  }
  input.clearEdges();
  updateCamera(G.paused ? 0.0001 : dt);
  render();
}
requestAnimationFrame(frame);

/* ============================== MENUS ================================= */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function togglePause() {
  G.paused = !G.paused;
  document.getElementById('overlay-pause').classList.toggle('hidden', !G.paused);
}

function showBreak(title, score, sub, buttons) {
  document.getElementById('break-title').textContent = title;
  document.getElementById('break-score').textContent = score;
  document.getElementById('break-sub').textContent = sub;
  const wrap = document.getElementById('break-buttons');
  wrap.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'btn' + (b.primary ? ' btn-primary' : '');
    el.textContent = b.label;
    el.addEventListener('click', b.fn);
    wrap.appendChild(el);
  }
  document.getElementById('overlay-break').classList.remove('hidden');
}
function hideBreak() { document.getElementById('overlay-break').classList.add('hidden'); }

const menu = (() => {
  let homeIdx = 0, awayIdx = 1;
  let difficulty = 'normal', halfReal = 180;

  const crest = t => `conic-gradient(${t.c1} 0 25%, ${t.c2} 25% 50%, ${t.c1} 50% 75%, ${t.c2} 75% 100%)`;

  function renderPick() {
    const h = TEAMS[homeIdx], a = TEAMS[awayIdx];
    document.getElementById('home-crest').style.background = crest(h);
    document.getElementById('home-name').textContent = h.name;
    document.getElementById('home-rating').innerHTML = `★ <b>${h.rating}</b> OVR`;
    document.getElementById('away-crest').style.background = crest(a);
    document.getElementById('away-name').textContent = a.name;
    document.getElementById('away-rating').innerHTML = `★ <b>${a.rating}</b> OVR`;
  }

  function cycle(which, delta) {
    if (which === 'home') {
      homeIdx = (homeIdx + delta + TEAMS.length) % TEAMS.length;
      if (homeIdx === awayIdx) homeIdx = (homeIdx + delta + TEAMS.length) % TEAMS.length;
    } else {
      awayIdx = (awayIdx + delta + TEAMS.length) % TEAMS.length;
      if (awayIdx === homeIdx) awayIdx = (awayIdx + delta + TEAMS.length) % TEAMS.length;
    }
    renderPick();
  }

  document.getElementById('home-prev').addEventListener('click', () => cycle('home', -1));
  document.getElementById('home-next').addEventListener('click', () => cycle('home', 1));
  document.getElementById('away-prev').addEventListener('click', () => cycle('away', -1));
  document.getElementById('away-next').addEventListener('click', () => cycle('away', 1));

  function segWire(id, fn) {
    const seg = document.getElementById(id);
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      fn(b.dataset.v);
    }));
  }
  segWire('seg-difficulty', v => { difficulty = v; });
  segWire('seg-length', v => { halfReal = parseInt(v, 10); });

  document.getElementById('btn-play').addEventListener('click', () => { Snd.unlock(); showScreen('screen-select'); });
  document.getElementById('btn-howto').addEventListener('click', () => showScreen('screen-howto'));
  document.getElementById('btn-howto-back').addEventListener('click', () => showScreen('screen-menu'));
  document.getElementById('btn-select-back').addEventListener('click', () => showScreen('screen-menu'));
  document.getElementById('btn-kickoff').addEventListener('click', () => {
    Snd.unlock();
    showScreen('screen-match');
    startMatch(cfg());
  });

  document.getElementById('btn-resume').addEventListener('click', togglePause);
  document.getElementById('btn-restart').addEventListener('click', () => {
    togglePause();
    startMatch(cfg());
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    togglePause();
    G.running = false;
    showScreen('screen-menu');
  });

  function cfg() {
    // ?half=SECONDS overrides half length (handy for quick matches / testing)
    const q = parseInt(new URLSearchParams(location.search).get('half'), 10);
    return { home: TEAMS[homeIdx], away: TEAMS[awayIdx], difficulty, halfReal: q > 0 ? Math.max(10, q) : halfReal };
  }

  renderPick();
  return { cfg };
})();

setupTouch();

})();
