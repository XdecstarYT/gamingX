/* ============================================================================
   OVERRUN — simulation engine. No DOM/canvas here: pure game state + tick(dt)
   so it can be unit-tested headlessly. games/overrun/ui.js renders it.
   ========================================================================== */
window.OverrunEngine = (() => {
'use strict';
const D = window.OVERRUN_DATA;
let _uid = 1;
const uid = () => _uid++;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const ARENA = 22; // half-extent in world units (square arena, origin-centered)

class Game {
  constructor(characterKey, metaLevels) {
    metaLevels = metaLevels || {};
    const ch = D.CHARACTERS[characterKey] || D.CHARACTERS.scout;
    this.character = characterKey;
    const metaHp = (metaLevels.maxhp || 0) * D.META_UPGRADES.maxhp.perLevel;
    const metaDmgMul = 1 + (metaLevels.damage || 0) * D.META_UPGRADES.damage.perLevel;
    const metaSpeedMul = 1 + (metaLevels.speed || 0) * D.META_UPGRADES.speed.perLevel;
    const metaArmor = (metaLevels.armor || 0) * D.META_UPGRADES.armor.perLevel;

    this.player = {
      x: 0, y: 0, hp: ch.hp + metaHp, maxHp: ch.hp + metaHp,
      speed: ch.speed * metaSpeedMul, armor: ch.armor + metaArmor,
      regen: 0, magnet: 1.2, critChance: 0.03, dmgMul: metaDmgMul,
      level: 1, xp: 0, weapons: [{ key: ch.weapon, level: 1, cd: 0 }],
    };
    this.inputX = 0; this.inputY = 0;
    this.time = 0;
    this.lastBossAt = 0; // first boss check is (time - 0) >= 90, i.e. the first boss arrives at t=90s
    this.spawnClock = 0;
    this.enemies = [];
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.pickups = [];
    this.score = 0;
    this.kills = 0;
    this.runOver = false;
    this.pendingUpgrade = null; // array of 3 upgrade option objects
    this.events = [];
  }

  setInput(dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.inputX = dx; this.inputY = dy;
  }

  /* ---------------- upgrades ---------------- */
  rollUpgradeChoices() {
    const opts = [];
    const ownedKeys = this.player.weapons.map(w => w.key);
    const canAddWeapon = this.player.weapons.length < 4;
    const pool = [];
    for (const w of D.WEAPON_ORDER) {
      const owned = this.player.weapons.find(x => x.key === w);
      if (owned && owned.level < 5) pool.push({ type: 'weapon', key: w, label: 'Upgrade ' + D.WEAPONS[w].name + ' Lv' + (owned.level + 1) });
      else if (!owned && canAddWeapon) pool.push({ type: 'weapon', key: w, label: 'New: ' + D.WEAPONS[w].name });
    }
    for (const s of D.STAT_UPGRADES) pool.push({ type: 'stat', key: s.key, label: s.name });
    // shuffle + take 3 unique
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, 3);
  }
  chooseUpgrade(idx) {
    if (!this.pendingUpgrade) return { ok: false, error: 'no_pending' };
    const choice = this.pendingUpgrade[idx];
    if (!choice) return { ok: false, error: 'bad_index' };
    if (choice.type === 'weapon') {
      const owned = this.player.weapons.find(w => w.key === choice.key);
      if (owned) owned.level = Math.min(5, owned.level + 1);
      else this.player.weapons.push({ key: choice.key, level: 1, cd: 0 });
    } else if (choice.type === 'stat') {
      const p = this.player;
      if (choice.key === 'maxhp') { p.maxHp += 20; p.hp += 20; }
      else if (choice.key === 'speed') p.speed *= 1.08;
      else if (choice.key === 'armor') p.armor += 3;
      else if (choice.key === 'regen') p.regen += 0.5;
      else if (choice.key === 'magnet') p.magnet += 0.8;
      else if (choice.key === 'crit') p.critChance += 0.05;
    }
    this.pendingUpgrade = null;
    return { ok: true };
  }

  /* ---------------- combat helpers ---------------- */
  /* target === this.player gets its armor applied (with a 1-dmg floor so
     armor can reduce but never fully nullify a hit); enemies take raw dmg. */
  dealDamage(target, rawDmg, opts) {
    opts = opts || {};
    let dmg = rawDmg;
    if (opts.crit) dmg *= 2;
    if (target === this.player) dmg = Math.max(1, dmg - this.player.armor);
    target.hp -= dmg;
    return dmg;
  }
  spawnPickup(x, y, kind, amount) { this.pickups.push({ id: uid(), x, y, kind, amount }); }

  spawnEnemy(type, hpScale) {
    const def = D.ENEMIES[type];
    // spawn at a random point on a ring just outside the visible arena, around the player
    const a = Math.random() * Math.PI * 2;
    const r = ARENA * 0.95;
    const e = {
      id: uid(), type, x: this.player.x + Math.cos(a) * r, y: this.player.y + Math.sin(a) * r,
      hp: Math.round(def.hp * hpScale), maxHp: Math.round(def.hp * hpScale), speed: def.speed,
      dmg: def.dmg, xp: def.xp, scrap: def.scrap, boss: !!def.boss,
      ranged: !!def.ranged, range: def.range || 0, fireRate: def.fireRate || 0, projSpeed: def.projSpeed || 0, fireCd: Math.random() * (def.fireRate || 1),
      explodeDmg: def.explodeDmg || 0, blastRadius: def.blastRadius || 0,
      contactCd: 0, alive: true,
    };
    this.enemies.push(e);
    return e;
  }

  /* ---------------- main tick ---------------- */
  tick(dt) {
    if (this.runOver || this.pendingUpgrade) return;
    this.time += dt;
    const p = this.player;

    // movement
    p.x += this.inputX * p.speed * 4.2 * dt;
    p.y += this.inputY * p.speed * 4.2 * dt;
    p.x = clamp(p.x, -ARENA, ARENA); p.y = clamp(p.y, -ARENA, ARENA);
    if (p.regen && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

    // spawn director
    this.spawnClock += dt;
    const interval = D.spawnIntervalAt(this.time);
    if (this.spawnClock >= interval) {
      this.spawnClock = 0;
      const pool = D.activeEnemyPool(this.time);
      const type = pool[Math.floor(Math.random() * pool.length)];
      const scale = D.hpScaleAt(this.time);
      if (D.ENEMIES[type].group) { for (let i = 0; i < D.ENEMIES[type].group; i++) this.spawnEnemy(type, scale); }
      else this.spawnEnemy(type, scale);
    }
    if (D.isBossTime(this.time, this.lastBossAt)) {
      this.lastBossAt = this.time;
      this.spawnEnemy('boss', 1 + this.time * 0.01);
      this.events.push({ type: 'boss_spawn' });
    }

    // enemies: AI + contact + ranged fire
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(e.x, e.y, p.x, p.y);
      if (e.ranged) {
        const standoff = e.range * 0.6;
        if (d > standoff) { e.x += (p.x - e.x) / (d || 1) * e.speed * 4 * dt; e.y += (p.y - e.y) / (d || 1) * e.speed * 4 * dt; }
        e.fireCd -= dt;
        if (d <= e.range && e.fireCd <= 0) {
          e.fireCd = e.fireRate;
          const ang = Math.atan2(p.y - e.y, p.x - e.x);
          this.enemyProjectiles.push({ id: uid(), x: e.x, y: e.y, vx: Math.cos(ang) * e.projSpeed, vy: Math.sin(ang) * e.projSpeed, dmg: e.dmg, life: 3 });
        }
      } else {
        e.x += (p.x - e.x) / (d || 1) * e.speed * 4 * dt;
        e.y += (p.y - e.y) / (d || 1) * e.speed * 4 * dt;
      }
      // contact damage (melee + bomber explode)
      const touchR = e.boss ? 1.3 : 0.55;
      if (d <= touchR) {
        if (e.blastRadius) {
          this.dealDamage(p, e.explodeDmg, {});
          e.alive = false; this.onEnemyDeath(e, false);
          continue;
        }
        e.contactCd -= dt;
        if (e.contactCd <= 0) { e.contactCd = 0.55; this.dealDamage(p, e.dmg, {}); }
      }
    }
    this.enemies = this.enemies.filter(e => e.alive);

    // weapons auto-fire
    for (const w of p.weapons) {
      w.cd -= dt;
      if (w.cd <= 0) {
        const def = D.WEAPONS[w.key];
        const rate = def.rate * D.LEVEL_RATE[w.level - 1];
        const target = this.nearestEnemy(def.range);
        if (target) { this.fireWeapon(def, w.level, target); w.cd = rate; }
        else w.cd = rate * 0.5; // keep checking soon even with nothing in range
      }
    }

    // player projectiles
    for (const pr of this.projectiles) {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (pr.life <= 0) { pr.dead = true; continue; }
      for (const e of this.enemies) {
        if (!e.alive || pr.hitSet.has(e.id)) continue;
        if (dist(pr.x, pr.y, e.x, e.y) <= (e.boss ? 1.1 : 0.5)) {
          const crit = Math.random() < p.critChance;
          this.dealDamage(e, pr.dmg, { crit });
          pr.hitSet.add(e.id);
          if (pr.splash) {
            for (const e2 of this.enemies) {
              if (!e2.alive || e2 === e) continue;
              if (dist(pr.x, pr.y, e2.x, e2.y) <= pr.splash) this.dealDamage(e2, pr.dmg * 0.6, {});
            }
          }
          pr.pierce--;
          if (pr.pierce < 0) { pr.dead = true; break; }
        }
      }
    }
    for (const e of this.enemies) if (e.hp <= 0 && e.alive) { e.alive = false; this.onEnemyDeath(e, true); }
    this.enemies = this.enemies.filter(e => e.alive);
    this.projectiles = this.projectiles.filter(pr => !pr.dead);

    // enemy projectiles
    for (const ep of this.enemyProjectiles) {
      ep.x += ep.vx * dt; ep.y += ep.vy * dt; ep.life -= dt;
      if (ep.life <= 0) { ep.dead = true; continue; }
      if (dist(ep.x, ep.y, p.x, p.y) <= 0.5) { this.dealDamage(p, ep.dmg, {}); ep.dead = true; }
    }
    this.enemyProjectiles = this.enemyProjectiles.filter(ep => !ep.dead);

    // pickups: magnet-attract + collect
    for (const pk of this.pickups) {
      const d = dist(pk.x, pk.y, p.x, p.y);
      if (d <= p.magnet * 2.2) { pk.x += (p.x - pk.x) * Math.min(1, dt * 6); pk.y += (p.y - pk.y) * Math.min(1, dt * 6); }
      if (d <= 0.55) {
        pk.collected = true;
        if (pk.kind === 'xp') this.gainXp(pk.amount);
        else if (pk.kind === 'scrap') this.score += pk.amount;
      }
    }
    this.pickups = this.pickups.filter(pk => !pk.collected);

    if (p.hp <= 0 && !this.runOver) {
      p.hp = 0; this.runOver = true;
      this.scrapEarned = Math.round(this.score * 0.5 + this.kills * 1.5 + this.time * 0.8);
      this.events.push({ type: 'death', time: this.time, kills: this.kills, scrap: this.scrapEarned });
    }
  }

  nearestEnemy(range) {
    let best = null, bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(e.x, e.y, this.player.x, this.player.y);
      if (d <= range && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
  fireWeapon(def, level, target) {
    const p = this.player;
    const dmg = def.dmg * D.LEVEL_MUL[level - 1] * p.dmgMul;
    const baseAng = Math.atan2(target.y - p.y, target.x - p.x);
    const pellets = def.pellets + (level >= 4 ? 1 : 0);
    for (let i = 0; i < pellets; i++) {
      const spreadAng = pellets > 1 ? (i / (pellets - 1) - 0.5) * def.spread * 2 : (Math.random() - 0.5) * def.spread;
      const ang = baseAng + spreadAng;
      this.projectiles.push({
        id: uid(), x: p.x, y: p.y, vx: Math.cos(ang) * def.speed, vy: Math.sin(ang) * def.speed,
        dmg, pierce: def.pierce || 0, splash: def.splash || 0, life: 1.6, hitSet: new Set(),
      });
    }
  }
  onEnemyDeath(e, killedByPlayer) {
    if (killedByPlayer) { this.kills++; this.score += e.scrap; }
    this.spawnPickup(e.x, e.y, 'xp', e.xp);
    if (Math.random() < 0.25) this.spawnPickup(e.x + 0.3, e.y + 0.3, 'scrap', Math.max(1, Math.round(e.scrap * 0.5)));
    this.events.push({ type: 'kill', enemyType: e.type });
  }
  gainXp(amount) {
    const p = this.player;
    p.xp += amount;
    const need = D.xpForLevel(p.level + 1);
    if (p.xp >= need) {
      p.xp -= need;
      p.level++;
      this.pendingUpgrade = this.rollUpgradeChoices();
      this.events.push({ type: 'level_up', level: p.level });
    }
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}

return { Game, ARENA, uid };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.OverrunEngine;
