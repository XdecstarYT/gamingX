/* ============================================================================
   GX BLOCKS — 2D runtime + block interpreter for the GamX Lite model.
   Stage coordinates: origin at centre, +x right, +y up, half-size 240 x 180.
   The simulation (state + step) is renderer-free so it can run headlessly
   for tests; render() is optional and only used when a 2D canvas is given.
   ========================================================================== */
window.GXBlocksEngine = (() => {
'use strict';
const HW = 240, HH = 180; // stage half-width / half-height
const GB = window.GXBlocks;

function newProject(title) {
  return {
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    title: title || '', updated: Date.now(), published: false,
    bg: '#0e1630',
    sprites: [],
  };
}
function newSprite(name) {
  return {
    id: 's' + Math.random().toString(36).slice(2, 7),
    name: name || 'Sprite', shape: 'circle', color: '#ff5470', size: 40,
    x: 0, y: 0, scripts: [],
  };
}

class Engine {
  constructor(project, opts) {
    this.project = project;
    this.opts = opts || {};
    this.canvas = this.opts.canvas || null;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.keys = {};
    this.playing = false;
    this.score = 0;
    this._ended = false;
    this.sprites = [];
    this._bindInput();
    this.reset();
  }

  reset() {
    // build live sprite state from project (start values preserved on project)
    this.sprites = this.project.sprites.map(sp => ({
      def: sp, id: sp.id, name: sp.name, shape: sp.shape, color: sp.color, size: sp.size,
      x: sp.x, y: sp.y, visible: true, dead: false, say: '', sayT: 0, vx: 0, vy: 0,
    }));
    this.byName = {};
    for (const s of this.sprites) this.byName[s.name] = s;
    this.score = 0; this._ended = false;
  }

  _bindInput() {
    if (typeof addEventListener === 'undefined') return;
    this._kd = e => { this.keys[e.code] = true; };
    this._ku = e => { this.keys[e.code] = false; };
    addEventListener('keydown', this._kd);
    addEventListener('keyup', this._ku);
  }
  dispose() {
    if (typeof removeEventListener !== 'undefined') { removeEventListener('keydown', this._kd); removeEventListener('keyup', this._ku); }
  }

  play() {
    this.reset();
    this.playing = true;
    this._ended = false;
    for (const s of this.sprites) this._runScripts(s, 'start');
  }
  stop() { this.playing = false; this.reset(); }

  end(win) {
    if (this._ended) return;
    this._ended = true; this.playing = false;
    (this.opts.onEnd || (() => {}))({ win: !!win, score: this.score });
  }
  log(who, msg) { (this.opts.onLog || (() => {}))(who, msg); }

  step() {
    if (!this.playing) return;
    for (const s of this.sprites) {
      if (s.dead) continue;
      this._runScripts(s, 'frame');
      for (const scr of s.def.scripts) {
        if (scr.hat === 'key' && this.keys[GB.keyCode(scr.key || 'Space')]) this._exec(scr.body, s);
      }
    }
    for (const s of this.sprites) { if (s.sayT > 0) s.sayT -= 1; }
  }

  _runScripts(s, hat) {
    for (const scr of s.def.scripts) if (scr.hat === hat) this._exec(scr.body, s);
  }

  _exec(body, s, depth) {
    depth = depth || 0;
    if (!body || depth > 50 || s.dead) return;
    for (const b of body) {
      if (s.dead) return;
      this._execBlock(b, s, depth);
    }
  }

  _execBlock(b, s, depth) {
    const I = b.inputs || {};
    switch (b.type) {
      case 'changeX': s.x += num(I.n); break;
      case 'changeY': s.y += num(I.n); break;
      case 'setX': s.x = num(I.n); break;
      case 'setY': s.y = num(I.n); break;
      case 'bounce':
        if (s.x > HW) s.x = HW; if (s.x < -HW) s.x = -HW;
        if (s.y > HH) s.y = HH; if (s.y < -HH) s.y = -HH;
        break;
      case 'setColor': s.color = I.color || s.color; break;
      case 'changeSize': s.size = clamp(s.size + num(I.n), 4, 400); break;
      case 'setSize': s.size = clamp(num(I.n), 4, 400); break;
      case 'show': s.visible = true; break;
      case 'hide': s.visible = false; break;
      case 'say': s.say = String(I.text == null ? '' : I.text); s.sayT = 120; this.log(s.name, s.say); break;
      case 'addScore': this.score += num(I.n); break;
      case 'win': this.end(true); break;
      case 'lose': this.end(false); break;
      case 'destroy': s.dead = true; s.visible = false; break;
      case 'if': if (this._cond(I.cond, s)) this._exec(b.body, s, depth + 1); break;
      case 'repeat': { const k = Math.min(1000, Math.max(0, Math.floor(num(I.n)))); for (let i = 0; i < k && !s.dead; i++) this._exec(b.body, s, depth + 1); break; }
    }
  }

  _cond(c, s) {
    if (!c) return false;
    if (c.kind === 'key') return !!this.keys[GB.keyCode(c.key)];
    if (c.kind === 'score') return this.score >= num(c.n);
    if (c.kind === 'touching') {
      if (c.target === 'edge') return Math.abs(s.x) >= HW - s.size / 2 || Math.abs(s.y) >= HH - s.size / 2;
      const o = this.byName[c.target];
      if (!o || o.dead || !o.visible || o === s) return false;
      const dx = s.x - o.x, dy = s.y - o.y;
      return Math.hypot(dx, dy) < (s.size + o.size) / 2;
    }
    return false;
  }

  /* ---------------- render (optional) ---------------- */
  render() {
    if (!this.ctx) return;
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const sc = Math.min(W / (HW * 2), H / (HH * 2));
    c.fillStyle = this.project.bg || '#0e1630'; c.fillRect(0, 0, W, H);
    // stage border
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 2;
    c.strokeRect(W / 2 - HW * sc, H / 2 - HH * sc, HW * 2 * sc, HH * 2 * sc);
    const list = this.playing ? this.sprites : this.sprites;
    for (const s of list) {
      if (!s.visible) continue;
      const px = W / 2 + s.x * sc, py = H / 2 - s.y * sc, r = (s.size / 2) * sc;
      c.fillStyle = s.color;
      if (s.shape === 'square') { c.fillRect(px - r, py - r, r * 2, r * 2); }
      else { c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill(); }
      if (this.opts.selectedId === s.id && !this.playing) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.setLineDash([5, 4]); if (s.shape === 'square') c.strokeRect(px - r, py - r, r * 2, r * 2); else { c.beginPath(); c.arc(px, py, r + 2, 0, Math.PI * 2); c.stroke(); } c.setLineDash([]); }
      if (s.sayT > 0 && s.say) {
        c.font = '13px Segoe UI, sans-serif';
        const tw = c.measureText(s.say).width + 16;
        c.fillStyle = '#fff'; roundRect(c, px + r, py - r - 26, tw, 22, 6); c.fill();
        c.fillStyle = '#111'; c.fillText(s.say, px + r + 8, py - r - 11);
      }
    }
  }
  spriteAt(px, py) { // canvas px -> topmost sprite (for editor drag)
    if (!this.canvas) return null;
    const W = this.canvas.width, H = this.canvas.height, sc = Math.min(W / (HW * 2), H / (HH * 2));
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i]; if (!s.visible) continue;
      const cx = W / 2 + s.x * sc, cy = H / 2 - s.y * sc, r = (s.size / 2) * sc + 3;
      if (Math.hypot(px - cx, py - cy) <= r + (s.shape === 'square' ? r * 0.2 : 0)) return s;
    }
    return null;
  }
  canvasToStage(px, py) {
    const W = this.canvas.width, H = this.canvas.height, sc = Math.min(W / (HW * 2), H / (HH * 2));
    return { x: (px - W / 2) / sc, y: -(py - H / 2) / sc };
  }
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

return { Engine, newProject, newSprite, HW, HH };
})();
