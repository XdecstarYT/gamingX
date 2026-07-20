/* ============================================================================
   AURORA — game core. Pure simulation, no DOM/WebGPU here, so it runs and is
   unit-tested headlessly. The WebGPU renderer (render.js) and the 2D fallback
   (fallback.js) both just draw whatever state this produces.

   You pilot a light-craft through a nebula. Collect glowing star-cores (score
   + energy), avoid dark voids (drain), and outlast a steadily rising energy
   drain. Bounded circular arena so everything stays reachable.
   ========================================================================== */
window.AuroraCore = (() => {
'use strict';
let _uid = 1;
const uid = () => _uid++;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

const ARENA = 62;          // arena radius (world units)
const SHIP_R = 1.4;        // ship collision radius
const CORE_R = 1.6, VOID_R = 2.1;
const MAX_PICKUPS = 26;

class Game {
  constructor(opts) {
    opts = opts || {};
    this.arena = ARENA;
    this.ship = { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: 0 };
    this.accel = 46;        // thrust acceleration
    this.drag = 1.4;        // velocity damping per sec
    this.maxSpeed = 30;
    this.energy = 100; this.maxEnergy = 100;
    this.score = 0; this.combo = 0; this.bestCombo = 0;
    this.time = 0;
    this.pickups = [];
    this.gameOver = false;
    this.inX = 0; this.inY = 0; this.boost = false;
    this.spawnClock = 0;
    this.magnet = 7;
    this.sinceCore = 0;     // time since last core collected (combo decay)
    this.events = [];
    // seed a starting field
    for (let i = 0; i < 10; i++) this.spawnPickup(true);
  }

  setInput(x, y, boost) {
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.inX = x; this.inY = y; this.boost = !!boost;
  }

  spawnPickup(forceCore) {
    if (this.pickups.length >= MAX_PICKUPS) return;
    // spawn away from the ship so nothing appears on top of you
    let x, y, tries = 0;
    do {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (ARENA - 4);
      x = Math.cos(a) * r; y = Math.sin(a) * r; tries++;
    } while (dist(x, y, this.ship.x, this.ship.y) < 10 && tries < 12);
    // void ratio rises with time (0.18 -> ~0.5)
    const voidRatio = Math.min(0.5, 0.18 + this.time * 0.004);
    const kind = forceCore ? 'core' : (Math.random() < voidRatio ? 'void' : 'core');
    this.pickups.push({ id: uid(), x, y, kind, r: kind === 'core' ? CORE_R : VOID_R, phase: Math.random() * 6.28 });
  }

  tick(dt) {
    if (this.gameOver) return;
    this.time += dt;
    const s = this.ship;

    // thrust + integrate
    const boostMul = this.boost ? 1.7 : 1;
    s.vx += this.inX * this.accel * boostMul * dt;
    s.vy += this.inY * this.accel * boostMul * dt;
    const damp = Math.max(0, 1 - this.drag * dt);
    s.vx *= damp; s.vy *= damp;
    const spd = Math.hypot(s.vx, s.vy);
    const maxS = this.maxSpeed * boostMul;
    if (spd > maxS) { s.vx = s.vx / spd * maxS; s.vy = s.vy / spd * maxS; }
    if (this.inX || this.inY) s.angle = Math.atan2(this.inY, this.inX);
    s.thrust = Math.hypot(this.inX, this.inY);
    s.x += s.vx * dt; s.y += s.vy * dt;

    // keep inside the arena (soft bounce off the boundary)
    const r = Math.hypot(s.x, s.y);
    if (r > ARENA - SHIP_R) {
      const nx = s.x / r, ny = s.y / r;
      s.x = nx * (ARENA - SHIP_R); s.y = ny * (ARENA - SHIP_R);
      const dot = s.vx * nx + s.vy * ny;
      s.vx -= 1.6 * dot * nx; s.vy -= 1.6 * dot * ny; // reflect + damp
    }

    // energy drain ramps up over time; boosting costs a little extra
    const drain = (2.2 + this.time * 0.03) * (this.boost ? 1.5 : 1);
    this.energy -= drain * dt;

    // combo decays if you go too long without a core
    this.sinceCore += dt;
    if (this.sinceCore > 4 && this.combo > 0) { this.combo = 0; this.events.push({ type: 'combo_lost' }); }

    // spawn director
    this.spawnClock += dt;
    const interval = Math.max(0.5, 1.6 - this.time * 0.01);
    if (this.spawnClock >= interval) { this.spawnClock = 0; this.spawnPickup(false); }

    // pickups: magnet-attract cores, resolve collisions
    for (const p of this.pickups) {
      if (p.collected) continue;
      const d = dist(p.x, p.y, s.x, s.y);
      if (p.kind === 'core' && d < this.magnet) {
        const pull = (1 - d / this.magnet) * 18 * dt;
        p.x += (s.x - p.x) / (d || 1) * pull; p.y += (s.y - p.y) / (d || 1) * pull;
      }
      if (d <= SHIP_R + p.r) {
        p.collected = true;
        if (p.kind === 'core') {
          this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo); this.sinceCore = 0;
          const gain = 10 * (1 + this.combo * 0.15);
          this.score += Math.round(gain);
          this.energy = Math.min(this.maxEnergy, this.energy + 9);
          this.events.push({ type: 'core', x: p.x, y: p.y, combo: this.combo });
        } else {
          this.combo = 0;
          this.energy -= 22;
          this.events.push({ type: 'void', x: p.x, y: p.y });
        }
      }
    }
    this.pickups = this.pickups.filter(p => !p.collected);
    // keep a healthy density
    while (this.pickups.length < 10) this.spawnPickup(false);

    if (this.energy <= 0 && !this.gameOver) {
      this.energy = 0; this.gameOver = true;
      this.events.push({ type: 'game_over', score: this.score, time: this.time });
    }
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}

return { Game, ARENA, SHIP_R };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.AuroraCore;
