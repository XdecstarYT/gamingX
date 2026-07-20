/* ============================================================================
   TURBO CIRCUIT — simulation engine. No DOM/canvas here: pure race state +
   tick(dt) so it can be unit-tested headlessly. games/circuit/ui.js renders.

   Simplification note: checkpoints are captured by proximity (radius = track
   width * 2.2) rather than true line-crossing collision, which is the usual
   arcade-kart shortcut — it's not cheat-proof against wildly cutting the
   track, but AI follows the waypoints directly and the off-track speed
   penalty discourages players from doing so too.
   ========================================================================== */
window.CircuitEngine = (() => {
'use strict';
const D = window.CIRCUIT_DATA;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

const BASE_TURN = 2.6;      // rad/sec at handling=1, full speed
const FRICTION = 6;         // coast deceleration (units/sec^2)
const BRAKE_POWER = 2.2;    // multiplier over accel when braking
const DRIFT_CHARGE_RATE = 0.7;
const BOOST_DURATION = 1.1;
const OFFTRACK_MUL = 0.5;

function effectiveStats(vehicleKey, tuningLevels) {
  const base = D.VEHICLES[vehicleKey];
  const lv = tuningLevels || { engine: 0, handling: 0, boost: 0 };
  return {
    topSpeed: base.topSpeed + (lv.engine || 0) * D.TUNING.engine.perLevel,
    accel: base.accel,
    handling: base.handling + (lv.handling || 0) * D.TUNING.handling.perLevel,
    boostPower: base.boostPower + (lv.boost || 0) * D.TUNING.boost.perLevel,
  };
}

/* distance from point to the nearest point on segment ab */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cy = ay + dy * t;
  return dist(px, py, cx, cy);
}
function distToLoop(loop, px, py) {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    best = Math.min(best, distToSegment(px, py, a[0], a[1], b[0], b[1]));
  }
  return best;
}

class Kart {
  constructor(id, name, isPlayer, vehicleKey, tuningLevels, startPos, startAngle) {
    this.id = id; this.name = name; this.isPlayer = isPlayer; this.vehicleKey = vehicleKey;
    this.stats = effectiveStats(vehicleKey, tuningLevels);
    this.x = startPos[0]; this.y = startPos[1]; this.angle = startAngle;
    this.speed = 0; this.lap = 0; this.wpIdx = 0; this.finished = false; this.finishTime = 0;
    this.driftCharge = 0; this.boostTimer = 0; this.isDrifting = false;
    this.steer = 0; this.accelInput = 0; this.driftInput = false;
    this.offTrack = false;
    this.aiTargetIdx = 1;
  }
  progress(loopLen) {
    return this.lap * loopLen + this.wpIdx + (this.finished ? 1000000 : 0);
  }
}

class Game {
  constructor(trackKey, opts) {
    opts = opts || {};
    this.track = D.TRACKS[trackKey];
    this.trackKey = trackKey;
    this.loop = this.track.loop;
    this.loopLen = D.trackLength(this.loop);
    this.laps = this.track.laps;
    this.mode = opts.mode || 'quick'; // 'quick' | 'career'
    this.difficulty = D.DIFFICULTY[opts.difficulty || 'normal'];
    this.time = 0;
    this.raceOver = false;
    this.results = null;
    this.events = [];

    const start = this.loop[0], next = this.loop[1];
    const startAngle = Math.atan2(next[1] - start[1], next[0] - start[0]);

    this.karts = [];
    const playerVehicle = opts.vehicle || 'scamp';
    const playerTuning = opts.tuning || {};
    const player = new Kart('player', 'You', true, playerVehicle, playerTuning, this.gridPos(0, start, startAngle), startAngle);
    this.karts.push(player);
    this.player = player;

    const aiCount = opts.aiCount != null ? opts.aiCount : 4;
    const aiVehicles = D.VEHICLE_ORDER.filter(v => v !== playerVehicle).concat(D.VEHICLE_ORDER);
    for (let i = 0; i < aiCount; i++) {
      const vk = aiVehicles[i % aiVehicles.length];
      const k = new Kart('ai' + i, D.AI_NAMES[i % D.AI_NAMES.length], false, vk, {}, this.gridPos(i + 1, start, startAngle), startAngle);
      this.karts.push(k);
    }
  }

  gridPos(slot, start, angle) {
    // stagger the starting grid perpendicular to the initial heading
    const perp = angle + Math.PI / 2;
    const row = Math.floor(slot / 2), col = slot % 2 === 0 ? -1 : 1;
    const spacing = 1.6;
    return [start[0] + Math.cos(perp) * col * spacing - Math.cos(angle) * row * 2.2,
            start[1] + Math.sin(perp) * col * spacing - Math.sin(angle) * row * 2.2];
  }

  setPlayerInput(steer, accelInput, driftInput) {
    this.player.steer = clamp(steer, -1, 1);
    this.player.accelInput = clamp(accelInput, -1, 1);
    this.player.driftInput = !!driftInput;
  }

  aiDrive(k, dt) {
    const targetWp = this.loop[k.aiTargetIdx % this.loop.length];
    const ang = Math.atan2(targetWp[1] - k.y, targetWp[0] - k.x);
    let diff = ang - k.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const noise = (Math.random() - 0.5) * this.difficulty.noise;
    k.steer = clamp(diff * 1.4 + noise, -1, 1);
    k.accelInput = 1;
    k.driftInput = Math.abs(k.steer) > 0.55;
    if (dist(k.x, k.y, targetWp[0], targetWp[1]) < this.track.width * 1.6) {
      k.aiTargetIdx = (k.aiTargetIdx + 1) % this.loop.length;
    }
  }

  stepKart(k, dt) {
    const s = k.stats;
    // rubber-banding: AI gets a small speed nudge based on gap to the player
    let rubberMul = 1;
    if (!k.isPlayer && this.mode !== 'trainer') {
      const gap = k.progress(this.loopLen) - this.player.progress(this.loopLen);
      rubberMul = 1 + clamp(-gap / this.loopLen, -1, 1) * this.difficulty.rubberBand;
    }
    const speedMul = (!k.isPlayer ? this.difficulty.speedMul : 1) * rubberMul;

    k.offTrack = distToLoop(this.loop, k.x, k.y) > this.track.width;
    const trackMul = k.offTrack ? OFFTRACK_MUL : 1;
    const boosting = k.boostTimer > 0;
    const effTop = s.topSpeed * speedMul * trackMul * (boosting ? s.boostPower : 1);

    if (k.accelInput > 0) k.speed += s.accel * k.accelInput * dt;
    else if (k.accelInput < 0) k.speed += s.accel * BRAKE_POWER * k.accelInput * dt;
    else k.speed -= Math.sign(k.speed) * FRICTION * dt;
    k.speed = clamp(k.speed, -effTop * 0.4, effTop);

    const turnFactor = 0.35 + 0.65 * Math.min(1, Math.abs(k.speed) / (s.topSpeed || 1));
    k.angle += k.steer * s.handling * BASE_TURN * turnFactor * dt * Math.sign(k.speed || 1);
    k.x += Math.cos(k.angle) * k.speed * dt;
    k.y += Math.sin(k.angle) * k.speed * dt;

    // drift -> boost
    const drifting = k.driftInput && Math.abs(k.steer) > 0.4 && k.speed > s.topSpeed * 0.45;
    if (drifting) { k.driftCharge = Math.min(1, k.driftCharge + DRIFT_CHARGE_RATE * dt); k.isDrifting = true; }
    else {
      if (k.isDrifting && k.driftCharge > 0.3) { k.boostTimer = BOOST_DURATION; this.events.push({ type: 'boost', kartId: k.id }); }
      k.isDrifting = false; k.driftCharge = Math.max(0, k.driftCharge - dt * 0.5);
    }
    if (k.boostTimer > 0) k.boostTimer -= dt;

    // checkpoint capture
    if (!k.finished) {
      const cp = this.loop[k.wpIdx];
      if (dist(k.x, k.y, cp[0], cp[1]) <= this.track.width * 2.2) {
        k.wpIdx++;
        if (k.wpIdx >= this.loop.length) {
          k.wpIdx = 0; k.lap++;
          this.events.push({ type: 'lap', kartId: k.id, lap: k.lap });
          if (k.lap >= this.laps) {
            k.finished = true; k.finishTime = this.time;
            this.events.push({ type: 'finish', kartId: k.id, time: this.time });
          }
        }
      }
    }
  }

  tick(dt) {
    if (this.raceOver) return;
    this.time += dt;
    for (const k of this.karts) {
      if (k.isPlayer) { /* input already set via setPlayerInput */ }
      else if (!k.finished) this.aiDrive(k, dt);
      if (!k.finished) this.stepKart(k, dt);
    }
    if (this.player.finished && !this.raceOver) this.finishRace();
  }

  standings() {
    return [...this.karts].sort((a, b) => b.progress(this.loopLen) - a.progress(this.loopLen));
  }

  finishRace() {
    this.raceOver = true;
    const order = this.standings();
    const results = order.map((k, i) => {
      const pos = i + 1;
      const points = this.mode === 'career' ? (D.POINTS_TABLE[i] || 0) : 0;
      const coins = Math.max(10, 60 - i * 10) + (k.isPlayer ? Math.round(this.time * 0.3) : 0);
      return { id: k.id, name: k.name, isPlayer: k.isPlayer, position: pos, points, coins: k.isPlayer ? coins : 0 };
    });
    this.results = results;
    this.playerResult = results.find(r => r.isPlayer);
    this.events.push({ type: 'race_over', results });
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}

return { Game, Kart, effectiveStats, distToLoop };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.CircuitEngine;
