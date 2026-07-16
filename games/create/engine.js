/* ============================================================================
   GX ENGINE — the GamingX 2D game engine that powers GX Forge creations.

   A self-contained tile-based runtime: physics (platformer gravity or
   top-down), entities (walkers, flyers), coins/goals/hazards/bounce pads,
   camera, keyboard + touch input, canvas renderer and HUD.

   Usage:
     const game = GXEngine.run(canvas, levelData, {
       onEnd({won, score, coins, coinsTotal, time}) {...}
     });
     game.stop();

   Level data:
     { title, mode: 'platformer'|'topdown', w, h,
       theme: 'neon'|'lava'|'forest'|'candy',
       requireCoins: bool,
       tiles: number[h][w] }   // tile ids, see GXEngine.T
   ========================================================================== */
window.GXEngine = (() => {
'use strict';

const TILE = 32;
const T = { EMPTY: 0, SOLID: 1, HAZARD: 2, COIN: 3, GOAL: 4, SPAWN: 5, WALKER: 6, FLYER: 7, BOUNCE: 8 };
const TILE_NAMES = {
  [T.SOLID]: 'Block', [T.HAZARD]: 'Spikes', [T.COIN]: 'Coin', [T.GOAL]: 'Goal flag',
  [T.SPAWN]: 'Player start', [T.WALKER]: 'Walker bot', [T.FLYER]: 'Flyer bot', [T.BOUNCE]: 'Bounce pad',
};

const THEMES = {
  neon:   { bg1: '#0b1024', bg2: '#151c3d', tile: '#22d3ee', tileDark: '#0e7490', accent: '#a855f7', dots: '#3d4a80' },
  lava:   { bg1: '#1a0b0b', bg2: '#33130e', tile: '#f2b03d', tileDark: '#92580c', accent: '#ef4444', dots: '#6b2a1a' },
  forest: { bg1: '#08130d', bg2: '#10281a', tile: '#22c55e', tileDark: '#14532d', accent: '#fde047', dots: '#2a5c3d' },
  candy:  { bg1: '#160d1e', bg2: '#2a1638', tile: '#f973d1', tileDark: '#9d2777', accent: '#38bdf8', dots: '#5c3d80' },
};

/* ------------------------------------------------------------------ */
/* Shared tile rendering — used by the runtime AND the Forge editor,  */
/* so what you paint is exactly what you play.                        */
/* ------------------------------------------------------------------ */
function drawTile(ctx, id, x, y, s, theme, time) {
  const th = THEMES[theme] || THEMES.neon;
  const t = time || 0;
  ctx.save();
  ctx.translate(x, y);
  switch (id) {
    case T.SOLID: {
      ctx.fillStyle = th.tileDark;
      rr(ctx, s * 0.02, s * 0.02, s * 0.96, s * 0.96, s * 0.12); ctx.fill();
      ctx.fillStyle = th.tile;
      rr(ctx, s * 0.02, s * 0.02, s * 0.96, s * 0.30, s * 0.12); ctx.fill();
      break;
    }
    case T.HAZARD: {
      ctx.fillStyle = '#ef4444';
      const n = 3;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo((i + 0.1) * s / n, s * 0.98);
        ctx.lineTo((i + 0.5) * s / n, s * 0.25);
        ctx.lineTo((i + 0.9) * s / n, s * 0.98);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case T.COIN: {
      const w = Math.abs(Math.sin(t * 3 + x * 0.01)) * 0.32 + 0.06;
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.ellipse(s / 2, s / 2, s * w, s * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a16207'; ctx.lineWidth = s * 0.05; ctx.stroke();
      break;
    }
    case T.GOAL: {
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(s * 0.15, s * 0.05, s * 0.08, s * 0.93);
      ctx.fillStyle = '#22c55e';
      const wave = Math.sin(t * 5) * s * 0.06;
      ctx.beginPath();
      ctx.moveTo(s * 0.23, s * 0.08);
      ctx.lineTo(s * 0.9, s * 0.22 + wave);
      ctx.lineTo(s * 0.23, s * 0.42);
      ctx.closePath(); ctx.fill();
      break;
    }
    case T.SPAWN: {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.setLineDash([s * 0.1, s * 0.08]);
      ctx.lineWidth = s * 0.06;
      rr(ctx, s * 0.16, s * 0.1, s * 0.68, s * 0.84, s * 0.16); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `${s * 0.42}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('P', s / 2, s * 0.55);
      break;
    }
    case T.WALKER: {
      ctx.fillStyle = '#f2b03d';
      rr(ctx, s * 0.12, s * 0.3, s * 0.76, s * 0.62, s * 0.2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(s * 0.35, s * 0.55, s * 0.08, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.65, s * 0.55, s * 0.08, 0, 7); ctx.fill();
      break;
    }
    case T.FLYER: {
      const bob = Math.sin(t * 4 + y * 0.02) * s * 0.08;
      ctx.fillStyle = th.accent;
      ctx.beginPath();
      ctx.ellipse(s / 2, s / 2 + bob, s * 0.38, s * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s * 0.4, s * 0.46 + bob, s * 0.07, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(s * 0.6, s * 0.46 + bob, s * 0.07, 0, 7); ctx.fill();
      // wings
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      const flap = Math.sin(t * 18) * s * 0.12;
      ctx.beginPath(); ctx.ellipse(s * 0.14, s * 0.4 + bob + flap, s * 0.13, s * 0.07, -0.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(s * 0.86, s * 0.4 + bob + flap, s * 0.13, s * 0.07, 0.5, 0, 7); ctx.fill();
      break;
    }
    case T.BOUNCE: {
      ctx.fillStyle = th.accent;
      rr(ctx, s * 0.08, s * 0.62, s * 0.84, s * 0.3, s * 0.1); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = s * 0.07;
      ctx.beginPath();
      ctx.moveTo(s * 0.25, s * 0.52); ctx.lineTo(s * 0.5, s * 0.28); ctx.lineTo(s * 0.75, s * 0.52);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* Runtime                                                            */
/* ------------------------------------------------------------------ */
function run(canvas, level, cbs) {
  const ctx = canvas.getContext('2d');
  const mode = level.mode === 'topdown' ? 'topdown' : 'platformer';
  const theme = THEMES[level.theme] ? level.theme : 'neon';
  const th = THEMES[theme];
  const W = level.w, H = level.h;

  // runtime copy of the grid (coins get removed, spawns stripped)
  const grid = level.tiles.map(row => row.slice());
  let spawn = { x: 1.5, y: 1.5 };
  const enemies = [];
  let coinsTotal = 0;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const id = grid[r][c];
      if (id === T.SPAWN) { spawn = { x: c + 0.5, y: r + 0.5 }; grid[r][c] = T.EMPTY; }
      else if (id === T.WALKER) { enemies.push({ kind: 'walker', x: c + 0.5, y: r + 0.5, dir: 1, vy: 0, alive: true }); grid[r][c] = T.EMPTY; }
      else if (id === T.FLYER) { enemies.push({ kind: 'flyer', x: c + 0.5, y: r + 0.5, baseY: r + 0.5, phase: Math.random() * 6, alive: true }); grid[r][c] = T.EMPTY; }
      else if (id === T.COIN) coinsTotal++;
    }
  }

  const solid = (c, r) => {
    if (c < 0 || c >= W || r < 0) return true;         // side walls & ceiling
    if (r >= H) return mode === 'topdown';             // platformer: open pit below
    return grid[r][c] === T.SOLID;
  };

  /* player state (tile units) */
  const P = {
    x: spawn.x, y: spawn.y, vx: 0, vy: 0,
    w: 0.68, h: 0.86, face: 1, grounded: false,
    coyote: 0, jumpBuf: 0, invuln: 0,
  };
  let lives = 4, coins = 0, score = 0, time = 0, stateT = 0;
  let state = 'ready';   // ready | play | dead | won | lost
  let banner = { text: 'READY?', t: 0 };
  let camX = 0, camY = 0;

  /* input */
  const keys = {};
  let joy = null;   // {ox,oy,dx,dy} touch joystick
  const kd = e => {
    keys[e.code] = 1;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') P.jumpBuf = 0.12;
  };
  const ku = e => { keys[e.code] = 0; };
  const pd = e => {
    const rect = canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    if (mode === 'topdown') {
      joy = { ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
    } else {
      if (fx < 0.3) keys.__L = 1;
      else if (fx > 0.7) keys.__R = 1;
      else P.jumpBuf = 0.12;
    }
  };
  const pm = e => {
    if (joy) {
      joy.dx = THREE_clamp((e.clientX - joy.ox) / 46, -1, 1);
      joy.dy = THREE_clamp((e.clientY - joy.oy) / 46, -1, 1);
    }
  };
  const pu = () => { joy = null; keys.__L = 0; keys.__R = 0; };
  const THREE_clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  addEventListener('keydown', kd);
  addEventListener('keyup', ku);
  canvas.addEventListener('pointerdown', pd);
  addEventListener('pointermove', pm);
  addEventListener('pointerup', pu);
  addEventListener('pointercancel', pu);

  /* deterministic background dots */
  let seed = 1234;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const dots = [];
  for (let i = 0; i < 90; i++) dots.push({ x: rand() * W * TILE, y: rand() * H * TILE, r: rand() * 2.2 + 0.6, p: rand() * 0.5 + 0.25 });

  function die() {
    if (P.invuln > 0) return;
    lives--;
    beep(140, 0.2, 'sawtooth', 0.09, -60);
    if (lives <= 0) {
      state = 'lost'; stateT = 0;
      banner = { text: 'GAME OVER', t: 0 };
    } else {
      state = 'dead'; stateT = 0;
      banner = { text: '', t: 0 };
    }
  }
  function respawn() {
    P.x = spawn.x; P.y = spawn.y; P.vx = 0; P.vy = 0;
    P.invuln = 2.2;
    state = 'play';
  }
  function win() {
    state = 'won'; stateT = 0;
    score += Math.max(0, 3000 - Math.floor(time) * 25);
    banner = { text: 'LEVEL CLEAR!', t: 0 };
    beep(523, 0.12, 'triangle', 0.09); beep(659, 0.12, 'triangle', 0.09, 0, 0.13); beep(784, 0.3, 'triangle', 0.1, 0, 0.26);
  }

  /* tiny synth (independent of gx.js so the engine is portable) */
  let actx = null;
  function beep(freq, dur, type, gain, slide, when) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator(), g = actx.createGain();
      const t0 = actx.currentTime + (when || 0);
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(actx.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) {}
  }

  /* physics helpers */
  function collideAxis(axis, delta) {
    const dir = Math.sign(delta);
    if (!dir) return false;
    if (axis === 'x') P.x += delta; else P.y += delta;
    const x0 = Math.floor(P.x - P.w / 2), x1 = Math.floor(P.x + P.w / 2 - 0.001);
    const y0 = Math.floor(P.y - P.h / 2), y1 = Math.floor(P.y + P.h / 2 - 0.001);
    for (let r = y0; r <= y1; r++) {
      for (let c = x0; c <= x1; c++) {
        if (!solid(c, r)) continue;
        if (axis === 'x') P.x = dir > 0 ? c - P.w / 2 : c + 1 + P.w / 2;
        else P.y = dir > 0 ? r - P.h / 2 : r + 1 + P.h / 2;
        return true;
      }
    }
    return false;
  }
  function tileAt(x, y) {
    const c = Math.floor(x), r = Math.floor(y);
    if (c < 0 || c >= W || r < 0 || r >= H) return T.EMPTY;
    return grid[r][c];
  }
  function eatTiles() {
    // check the four corners + centre for pickups/hazards
    const pts = [
      [P.x, P.y],
      [P.x - P.w / 2 + 0.05, P.y - P.h / 2 + 0.05], [P.x + P.w / 2 - 0.05, P.y - P.h / 2 + 0.05],
      [P.x - P.w / 2 + 0.05, P.y + P.h / 2 - 0.05], [P.x + P.w / 2 - 0.05, P.y + P.h / 2 - 0.05],
    ];
    for (const [px, py] of pts) {
      const c = Math.floor(px), r = Math.floor(py);
      const id = tileAt(px, py);
      if (id === T.COIN) {
        grid[r][c] = T.EMPTY;
        coins++; score += 100;
        beep(980, 0.07, 'triangle', 0.07);
      } else if (id === T.HAZARD) {
        die(); return;
      } else if (id === T.GOAL) {
        if (level.requireCoins && coins < coinsTotal) {
          banner = { text: `${coinsTotal - coins} COIN${coinsTotal - coins === 1 ? '' : 'S'} LEFT!`, t: 0 };
        } else { win(); return; }
      } else if (id === T.BOUNCE) {
        if (mode === 'platformer' && P.vy > 2) {
          P.vy = -24;
          beep(300, 0.12, 'sine', 0.08, 500);
        }
      }
    }
  }

  function updatePlayer(dt) {
    const L = keys.ArrowLeft || keys.KeyA || keys.__L || (joy && joy.dx < -0.3);
    const R = keys.ArrowRight || keys.KeyD || keys.__R || (joy && joy.dx > 0.3);
    const U = keys.ArrowUp || keys.KeyW || (joy && joy.dy < -0.3);
    const D = keys.ArrowDown || keys.KeyS || (joy && joy.dy > 0.3);

    if (mode === 'platformer') {
      const targetVx = (R ? 1 : 0) - (L ? 1 : 0);
      P.vx += (targetVx * 8.5 - P.vx) * Math.min(1, dt * 12);
      if (targetVx) P.face = targetVx;
      P.vy = Math.min(30, P.vy + 55 * dt);
      P.coyote = P.grounded ? 0.1 : Math.max(0, P.coyote - dt);
      P.jumpBuf = Math.max(0, P.jumpBuf - dt);
      if (P.jumpBuf > 0 && (P.grounded || P.coyote > 0)) {
        P.vy = -17.5; P.grounded = false; P.coyote = 0; P.jumpBuf = 0;
        beep(440, 0.1, 'sine', 0.06, 260);
      }
      // variable jump height
      if (P.vy < -4 && !(keys.Space || keys.ArrowUp || keys.KeyW)) P.vy += 40 * dt;

      collideAxis('x', P.vx * dt);
      P.grounded = false;
      if (collideAxis('y', P.vy * dt)) {
        if (P.vy > 0) P.grounded = true;
        P.vy = 0;
      }
      if (P.y > H + 3) die();                    // fell into the pit
    } else {
      const mvx = (R ? 1 : 0) - (L ? 1 : 0);
      const mvy = (D ? 1 : 0) - (U ? 1 : 0);
      const m = Math.hypot(mvx, mvy) || 1;
      P.vx = mvx / m * 7;
      P.vy = mvy / m * 7;
      if (mvx) P.face = Math.sign(mvx);
      collideAxis('x', P.vx * dt);
      collideAxis('y', P.vy * dt);
    }
    P.invuln = Math.max(0, P.invuln - dt);
    eatTiles();
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.kind === 'walker') {
        if (mode === 'platformer') {
          e.vy = Math.min(25, (e.vy || 0) + 55 * dt);
          // vertical: settle on ground
          let ny = e.y + e.vy * dt;
          if (solid(Math.floor(e.x), Math.floor(ny + 0.42))) { ny = Math.floor(ny + 0.42) - 0.42; e.vy = 0; }
          e.y = ny;
          const ahead = e.x + e.dir * 0.45;
          const wall = solid(Math.floor(ahead + e.dir * 0.05), Math.floor(e.y));
          const gap = e.vy === 0 && !solid(Math.floor(ahead), Math.floor(e.y + 0.6));
          if (wall || gap) e.dir *= -1;
        } else {
          const ahead = e.x + e.dir * 0.5;
          if (solid(Math.floor(ahead + e.dir * 0.05), Math.floor(e.y))) e.dir *= -1;
        }
        e.x += e.dir * 2.1 * dt;
      } else {
        e.phase += dt;
        e.y = e.baseY + Math.sin(e.phase * 2.2) * 1.6;
      }

      // player contact
      const dx = Math.abs(e.x - P.x), dy = e.y - P.y;
      if (dx < 0.54 && Math.abs(dy) < 0.6 && state === 'play') {
        const stomp = mode === 'platformer' && P.vy > 3 && dy > 0.15;
        if (stomp) {
          e.alive = false;
          score += 200;
          P.vy = -11;
          beep(220, 0.1, 'square', 0.07, -120);
        } else {
          die();
        }
      }
    }
  }

  /* rendering */
  function render(t) {
    const cw = canvas.width, ch = canvas.height;
    const viewTiles = mode === 'topdown' ? 14 : 12.5;   // visible height
    const scale = ch / (viewTiles * TILE);
    const viewW = cw / scale, viewH = ch / scale;

    // camera
    let tx = P.x * TILE - viewW / 2, ty = P.y * TILE - viewH / 2;
    tx = Math.max(0, Math.min(W * TILE - viewW, tx));
    ty = Math.max(0, Math.min(H * TILE - viewH, ty));
    if (W * TILE < viewW) tx = (W * TILE - viewW) / 2;
    if (H * TILE < viewH) ty = (H * TILE - viewH) / 2;
    camX += (tx - camX) * 0.12; camY += (ty - camY) * 0.12;

    // background
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, th.bg2); g.addColorStop(1, th.bg1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);

    ctx.setTransform(scale, 0, 0, scale, -camX * scale, -camY * scale);

    // parallax dots
    ctx.fillStyle = th.dots;
    for (const d of dots) {
      const px = d.x - camX * (d.p - 1);   // slower than camera
      ctx.beginPath(); ctx.arc(px, d.y, d.r, 0, 7); ctx.fill();
    }

    // tiles (only visible range)
    const c0 = Math.max(0, Math.floor(camX / TILE) - 1), c1 = Math.min(W - 1, Math.ceil((camX + viewW) / TILE));
    const r0 = Math.max(0, Math.floor(camY / TILE) - 1), r1 = Math.min(H - 1, Math.ceil((camY + viewH) / TILE));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const id = grid[r][c];
        if (id) drawTile(ctx, id, c * TILE, r * TILE, TILE, theme, t);
      }
    }

    // enemies (drawn where they collide)
    for (const e of enemies) {
      if (!e.alive) continue;
      drawTile(ctx, e.kind === 'walker' ? T.WALKER : T.FLYER, (e.x - 0.5) * TILE, (e.y - 0.5) * TILE, TILE, theme, t);
    }

    // player
    if (!(P.invuln > 0 && Math.floor(t * 12) % 2)) {
      const px = (P.x - P.w / 2) * TILE, py = (P.y - P.h / 2) * TILE;
      ctx.fillStyle = '#ffffff';
      rr(ctx, px, py, P.w * TILE, P.h * TILE, 7); ctx.fill();
      ctx.fillStyle = th.tile;
      rr(ctx, px + 2, py + 2, P.w * TILE - 4, P.h * TILE * 0.45, 6); ctx.fill();
      ctx.fillStyle = '#0b0e17';
      const ex = px + P.w * TILE / 2 + P.face * 4;
      ctx.beginPath(); ctx.arc(ex - 3.5, py + 8, 2.4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + 3.5, py + 8, 2.4, 0, 7); ctx.fill();
    }

    // HUD
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const hud = [
      ['SCORE', String(score)],
      ['COINS', coins + '/' + coinsTotal],
      ['LIVES', '♥'.repeat(Math.max(0, lives))],
      ['TIME', Math.floor(time) + 's'],
    ];
    let hx = 12;
    for (const [label, val] of hud) {
      const w = Math.max(64, ctx.measureText(val).width + 26);
      ctx.fillStyle = 'rgba(8,12,22,0.72)';
      rr(ctx, hx, 10, w, 38, 9); ctx.fill();
      ctx.fillStyle = '#8b93ad';
      ctx.font = '700 8.5px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, hx + w / 2, 20);
      ctx.fillStyle = label === 'LIVES' ? '#ef4444' : '#22d3ee';
      ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(val, hx + w / 2, 36);
      hx += w + 8;
    }

    // banner
    if (banner.text && banner.t < 1.6) {
      ctx.globalAlpha = Math.min(1, (1.6 - banner.t) / 0.4);
      ctx.textAlign = 'center';
      ctx.font = '900 46px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(banner.text, cw / 2 + 2, ch * 0.35 + 2);
      ctx.fillStyle = '#fde047';
      ctx.fillText(banner.text, cw / 2, ch * 0.35);
      ctx.globalAlpha = 1;
    }
  }

  /* main loop */
  let last = 0, raf = 0, dead = false;
  function frame(ms) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    const t = ms / 1000;
    const dt = Math.min(0.033, t - last || 0.016);
    last = t;
    stateT += dt;
    if (banner.text) banner.t += dt;

    if (state === 'ready') {
      if (stateT > 0.9) { state = 'play'; banner = { text: 'GO!', t: 0 }; }
    } else if (state === 'play') {
      time += dt;
      updatePlayer(dt);
      if (state === 'play') updateEnemies(dt);
    } else if (state === 'dead') {
      if (stateT > 0.7) { respawn(); }
    } else if ((state === 'won' || state === 'lost') && stateT > 1.4) {
      stop();
      cbs && cbs.onEnd && cbs.onEnd({ won: state === 'won', score, coins, coinsTotal, time: Math.floor(time), lives });
      return;
    }
    render(t);
  }

  function stop() {
    dead = true;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', kd);
    removeEventListener('keyup', ku);
    canvas.removeEventListener('pointerdown', pd);
    removeEventListener('pointermove', pm);
    removeEventListener('pointerup', pu);
    removeEventListener('pointercancel', pu);
  }

  raf = requestAnimationFrame(frame);
  return { stop };
}

/* validation for the editor */
function validate(level) {
  const issues = [];
  let spawns = 0, goals = 0;
  for (const row of level.tiles) for (const id of row) {
    if (id === T.SPAWN) spawns++;
    if (id === T.GOAL) goals++;
  }
  if (spawns === 0) issues.push('Place a Player start (P) tile.');
  if (goals === 0) issues.push('Place at least one Goal flag.');
  return issues;
}

return { run, drawTile, validate, T, TILE, TILE_NAMES, THEMES };
})();
