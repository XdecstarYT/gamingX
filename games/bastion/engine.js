/* ============================================================================
   BASTION — simulation engine. No DOM/canvas here: pure game state + tick(dt)
   so it can be unit-tested headlessly. games/bastion/ui.js renders it.
   ========================================================================== */
window.BastionEngine = (() => {
'use strict';
const D = window.BASTION_DATA;
let _uid = 1;
const uid = () => _uid++;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

class Game {
  constructor(mapId, opts) {
    opts = opts || {};
    const map = D.MAPS.find(m => m.id === mapId) || D.MAPS[0];
    this.map = map;
    this.mode = opts.mode || 'campaign';  // 'campaign' (finite waves) | 'endless'
    this.maxWave = opts.maxWave || 20;

    const cells = D.pathCells(map.waypoints);
    this.pathSet = new Set(cells.map(([x, y]) => x + ',' + y));
    this.pathPoints = cells.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 }));
    // cumulative distance along the path, in cells
    this.pathLen = [0];
    for (let i = 1; i < this.pathPoints.length; i++) {
      this.pathLen.push(this.pathLen[i - 1] + dist2(this.pathPoints[i - 1].x, this.pathPoints[i - 1].y, this.pathPoints[i].x, this.pathPoints[i].y));
    }
    this.totalLen = this.pathLen[this.pathLen.length - 1];

    this.gold = map.startGold;
    this.lives = map.startLives;
    this.maxLives = map.startLives;
    this.wave = 0;
    this.waveState = 'idle'; // idle | spawning | active | cleared
    this.spawnQueue = [];
    this.spawnClock = 0;
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    this.score = 0;
    this.gameOver = false;
    this.victory = false;
    this.events = []; // transient log for UI: {type,...}
    this.occupied = new Map(); // "col,row" -> tower id
  }

  /* ---------------- path helpers ---------------- */
  posAtDist(d) {
    d = clamp(d, 0, this.totalLen);
    for (let i = 1; i < this.pathLen.length; i++) {
      if (d <= this.pathLen[i] || i === this.pathLen.length - 1) {
        const segLen = this.pathLen[i] - this.pathLen[i - 1] || 1;
        const t = (d - this.pathLen[i - 1]) / segLen;
        const a = this.pathPoints[i - 1], b = this.pathPoints[i];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    return this.pathPoints[this.pathPoints.length - 1];
  }
  isBuildable(col, row) {
    if (col < 0 || row < 0 || col >= this.map.cols || row >= this.map.rows) return false;
    if (this.pathSet.has(col + ',' + row)) return false;
    if (this.occupied.has(col + ',' + row)) return false;
    return true;
  }

  /* ---------------- economy / towers ---------------- */
  placeTower(col, row, type) {
    const def = D.TOWERS[type];
    if (!def) return { ok: false, error: 'unknown_tower' };
    if (!this.isBuildable(col, row)) return { ok: false, error: 'not_buildable' };
    if (this.gold < def.cost) return { ok: false, error: 'insufficient_gold' };
    this.gold -= def.cost;
    const t = { id: uid(), type, tier: 0, col, row, cd: 0, spent: def.cost, kills: 0 };
    this.towers.push(t);
    this.occupied.set(col + ',' + row, t.id);
    return { ok: true, tower: t };
  }
  upgradeTower(id) {
    const t = this.towers.find(x => x.id === id);
    if (!t) return { ok: false, error: 'no_such_tower' };
    const def = D.TOWERS[t.type];
    const nextTier = t.tier + 1;
    if (nextTier >= def.tiers.length) return { ok: false, error: 'max_tier' };
    const cost = def.tiers[nextTier].cost || 0;
    if (this.gold < cost) return { ok: false, error: 'insufficient_gold' };
    this.gold -= cost;
    t.tier = nextTier;
    t.spent += cost;
    return { ok: true, tower: t };
  }
  sellTower(id) {
    const idx = this.towers.findIndex(x => x.id === id);
    if (idx === -1) return { ok: false, error: 'no_such_tower' };
    const t = this.towers[idx];
    const refund = Math.floor(t.spent * 0.7);
    this.gold += refund;
    this.occupied.delete(t.col + ',' + t.row);
    this.towers.splice(idx, 1);
    return { ok: true, refund };
  }

  /* ---------------- waves ---------------- */
  nextWaveComposition() { return D.generateWave(this.wave + 1); }
  startNextWave() {
    if (this.waveState === 'spawning') return { ok: false, error: 'already_spawning' };
    if (this.gameOver || this.victory) return { ok: false, error: 'game_over' };
    // reward interest for banking gold, bigger bonus if the field is fully clear
    const fullyClear = this.waveState === 'cleared' || this.wave === 0;
    const interest = Math.min(60, Math.floor(this.gold * (fullyClear ? 0.12 : 0.03)));
    this.gold += interest;
    this.wave++;
    const comp = D.generateWave(this.wave);
    this.currentIsBoss = comp.isBoss;
    this.spawnQueue = [];
    for (const g of comp.groups) {
      for (let i = 0; i < g.count; i++) {
        this.spawnQueue.push({ type: g.type, at: g.delay + i * g.gap, scale: g.scale });
      }
    }
    this.spawnQueue.sort((a, b) => a.at - b.at);
    this.spawnClock = 0;
    this.waveState = 'spawning';
    this.events.push({ type: 'wave_start', wave: this.wave, interest });
    return { ok: true, wave: this.wave, interest };
  }

  spawnEnemy(type, scale) {
    const base = D.ENEMIES[type];
    const hpScale = scale || 1;
    const e = {
      id: uid(), type, hp: Math.round(base.hp * hpScale), maxHp: Math.round(base.hp * hpScale),
      speed: base.speed, armor: base.armor, value: Math.round(base.value * (0.85 + hpScale * 0.15)),
      flying: !!base.flying, boss: !!base.boss, dist: 0, alive: true,
      slowUntil: 0, slowFactor: 1, freezeUntil: 0, stunUntil: 0,
      poison: [], // {dps, until}
      shieldMax: base.shield || 0, shield: base.shield || 0, shieldRegen: base.shieldRegen || 0, shieldCd: 0,
      regen: base.regen || 0, poisonImmune: !!base.poisonImmune, slowResist: base.slowResist || 0,
    };
    this.enemies.push(e);
    return e;
  }

  /* ---------------- combat ---------------- */
  effectiveSpeed(e) {
    if (e.stunUntil > this._time || e.freezeUntil > this._time) return 0;
    return e.speed * (e.slowUntil > this._time ? e.slowFactor : 1);
  }
  applyDamage(e, rawDmg, opts) {
    opts = opts || {};
    let dmg = rawDmg;
    if (!opts.ignoreArmor) {
      const armorPierce = clamp(opts.armorPierce || 0, 0, 1);
      const effArmor = e.armor * (1 - armorPierce);
      dmg = dmg * (1 - effArmor);
    }
    if (opts.crit) dmg *= 2;
    if (e.shield > 0) {
      const absorbed = Math.min(e.shield, dmg);
      e.shield -= absorbed; dmg -= absorbed; e.shieldCd = 2.5;
      if (dmg <= 0) return 0;
    }
    if (opts.execute && e.hp / e.maxHp <= opts.execute && !e.boss) dmg = e.hp;
    e.hp -= dmg;
    return dmg;
  }
  killIfDead(e) {
    if (e.hp <= 0 && e.alive) {
      e.alive = false;
      this.gold += e.value;
      this.score += e.value * (e.boss ? 5 : 1);
      this.events.push({ type: 'kill', enemyType: e.type, x: this.posAtDist(e.dist).x, y: this.posAtDist(e.dist).y });
      return true;
    }
    return false;
  }

  fireTower(t, dt) {
    const def = D.TOWERS[t.type];
    const tier = def.tiers[t.tier];
    const range = tier.range;
    const cx = t.col + 0.5, cy = t.row + 0.5;
    const canGround = def.targets.includes('ground'), canAir = def.targets.includes('air');
    let best = null, bestDist = -1;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.flying && !canAir) continue;
      if (!e.flying && !canGround) continue;
      const p = this.posAtDist(e.dist);
      const d = dist2(cx, cy, p.x, p.y);
      if (d > range) continue;
      if (e.dist > bestDist) { bestDist = e.dist; best = e; } // target furthest along path
    }
    if (!best) return;

    const p = this.posAtDist(best.dist);
    const crit = Math.random() < (tier.critChance || 0);
    switch (t.type) {
      case 'arrow': {
        const targets = [best];
        if (tier.pierce > 1) {
          const near = this.enemies.filter(e => e.alive && e !== best && !(e.flying && !canAir))
            .map(e => ({ e, d: dist2(p.x, p.y, this.posAtDist(e.dist).x, this.posAtDist(e.dist).y) }))
            .filter(x => x.d < 0.9).sort((a, b) => a.d - b.d).slice(0, tier.pierce - 1).map(x => x.e);
          targets.push(...near);
        }
        for (const e of targets) { const dmg = this.applyDamage(e, tier.damage, { crit }); if (this.killIfDead(e)) t.kills++; }
        break;
      }
      case 'cannon': {
        const hit = this.enemies.filter(e => e.alive && !(e.flying && !canAir))
          .filter(e => dist2(p.x, p.y, this.posAtDist(e.dist).x, this.posAtDist(e.dist).y) <= (tier.splash || 0.1));
        for (const e of hit) {
          this.applyDamage(e, tier.damage, { crit });
          if (tier.stun && Math.random() < 0.5) e.stunUntil = this._time + tier.stun;
          if (this.killIfDead(e)) t.kills++;
        }
        break;
      }
      case 'frost': {
        const hit = this.enemies.filter(e => e.alive && !(e.flying && !canAir))
          .filter(e => dist2(cx, cy, this.posAtDist(e.dist).x, this.posAtDist(e.dist).y) <= range);
        for (const e of hit) {
          this.applyDamage(e, tier.damage, {});
          const slowAmt = tier.slow * (1 - (e.slowResist || 0));
          e.slowFactor = Math.min(e.slowFactor, 1 - slowAmt);
          e.slowUntil = Math.max(e.slowUntil, this._time + tier.slowDur);
          if (tier.freeze && Math.random() < 0.25) e.freezeUntil = this._time + tier.freeze;
          if (this.killIfDead(e)) t.kills++;
        }
        break;
      }
      case 'poison': {
        const applyPoison = (e) => {
          this.applyDamage(e, tier.damage, {});
          if (!e.poisonImmune) {
            e.poison.push({ dps: tier.dot / tier.dotDur, until: this._time + tier.dotDur });
            e.armor = Math.max(0, e.armor - tier.armorShred);
          }
          if (this.killIfDead(e)) t.kills++;
        };
        applyPoison(best);
        if (tier.spread) {
          const near = this.enemies.filter(e => e.alive && e !== best)
            .filter(e => dist2(p.x, p.y, this.posAtDist(e.dist).x, this.posAtDist(e.dist).y) <= tier.spread);
          near.forEach(applyPoison);
        }
        break;
      }
      case 'sniper': {
        const dmg = this.applyDamage(best, tier.damage, { crit, armorPierce: tier.armorPierce, execute: tier.execute });
        if (this.killIfDead(best)) t.kills++;
        break;
      }
      case 'tesla': {
        let cur = best, hitSet = new Set(), falloff = 1;
        for (let i = 0; i < tier.chain; i++) {
          if (!cur) break;
          hitSet.add(cur.id);
          this.applyDamage(cur, tier.damage * falloff, {});
          if (tier.stun) cur.stunUntil = this._time + tier.stun;
          if (this.killIfDead(cur)) t.kills++;
          const cp = this.posAtDist(cur.dist);
          let next = null, nd = Infinity;
          for (const e of this.enemies) {
            if (!e.alive || hitSet.has(e.id) || (e.flying && !canAir)) continue;
            const ep = this.posAtDist(e.dist);
            const d = dist2(cp.x, cp.y, ep.x, ep.y);
            if (d <= tier.chainRange && d < nd) { nd = d; next = e; }
          }
          cur = next; falloff *= 0.8;
        }
        break;
      }
    }
  }

  /* ---------------- main tick ---------------- */
  tick(dt) {
    if (this.gameOver || this.victory) return;
    this._time = (this._time || 0) + dt;

    // spawn queue
    if (this.waveState === 'spawning') {
      this.spawnClock += dt;
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.spawnClock) {
        const s = this.spawnQueue.shift();
        this.spawnEnemy(s.type, s.scale);
      }
      if (!this.spawnQueue.length) this.waveState = 'active';
    }

    // towers
    for (const t of this.towers) {
      t.cd -= dt;
      if (t.cd <= 0) {
        const tier = D.TOWERS[t.type].tiers[t.tier];
        this.fireTower(t, dt);
        t.cd = tier.fireRate;
      }
    }

    // enemies
    let leaked = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // poison ticks
      if (e.poison.length) {
        let dps = 0;
        e.poison = e.poison.filter(p => p.until > this._time);
        for (const p of e.poison) dps += p.dps;
        if (dps > 0) { e.hp -= dps * dt; this.killIfDead(e); if (!e.alive) continue; }
      }
      if (e.regen && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.regen * dt);
      if (e.shieldMax) { e.shieldCd -= dt; if (e.shieldCd <= 0 && e.shield < e.shieldMax) e.shield = Math.min(e.shieldMax, e.shield + e.shieldRegen * dt); }

      const spd = this.effectiveSpeed(e);
      e.dist += spd * dt;
      if (e.dist >= this.totalLen) {
        e.alive = false; leaked++;
        this.lives -= e.boss ? 5 : 1;
      }
    }
    if (leaked) this.events.push({ type: 'leak', count: leaked });
    this.enemies = this.enemies.filter(e => e.alive);

    if (this.lives <= 0 && !this.gameOver) {
      this.lives = 0; this.gameOver = true;
      this.events.push({ type: 'game_over' });
    }

    // wave cleared?
    if (this.waveState === 'active' && !this.enemies.length && !this.spawnQueue.length) {
      this.waveState = 'cleared';
      const clearBonus = 20 + this.wave * 3;
      this.gold += clearBonus;
      this.events.push({ type: 'wave_clear', wave: this.wave, bonus: clearBonus });
      if (this.mode === 'campaign' && this.wave >= this.maxWave && !this.gameOver) {
        this.victory = true;
        const frac = this.lives / this.maxLives;
        this.stars = frac >= 0.8 ? 3 : frac >= 0.4 ? 2 : 1;
        this.events.push({ type: 'victory', stars: this.stars });
      }
    }
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}

return { Game, uid };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.BastionEngine;
