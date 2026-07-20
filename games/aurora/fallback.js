/* ============================================================================
   AURORA — 2D canvas fallback renderer. Used when the WebGPU module can't
   load (offline, file://, or a browser without ES-module/WebGPU support). It
   draws the exact same game core, so AURORA is always playable — the WebGPU
   path (render.js) is a spectacular upgrade layered on top when available.

   Registers a factory on window.Aurora2D; ui.js decides which renderer to use.
   ========================================================================== */
window.Aurora2D = (canvas) => {
  'use strict';
  const C = window.AuroraCore;
  const ctx = canvas.getContext('2d');
  let dpr = 1, cw = 0, ch = 0, ppu = 10;

  // a light decorative drifting-particle field so even the fallback feels alive
  const N = 900;
  const px = new Float32Array(N), py = new Float32Array(N), pv = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * C.ARENA;
    px[i] = Math.cos(a) * r; py[i] = Math.sin(a) * r; pv[i] = 0.3 + Math.random() * 1.2;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = canvas.clientWidth; ch = canvas.clientHeight;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    ppu = Math.max(6, Math.min(cw, ch) / 34);
  }

  function draw(game, dt) {
    const s = game.ship;
    const camX = s.x, camY = s.y;
    const w2s = (x, y) => ({ x: cw / 2 + (x - camX) * ppu, y: ch / 2 + (y - camY) * ppu });

    ctx.save(); ctx.scale(dpr, dpr);
    // deep-space gradient
    const g = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
    g.addColorStop(0, '#101a3a'); g.addColorStop(0.5, '#0a0e22'); g.addColorStop(1, '#05060f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);

    // drifting particles (curl-ish swirl around the arena centre + gentle pull toward the ship)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const ang = Math.atan2(py[i], px[i]) + Math.PI / 2;
      px[i] += Math.cos(ang) * pv[i] * dt * 6 + (s.x - px[i]) * 0.002;
      py[i] += Math.sin(ang) * pv[i] * dt * 6 + (s.y - py[i]) * 0.002;
      const rr = Math.hypot(px[i], py[i]);
      if (rr > C.ARENA) { px[i] *= C.ARENA / rr * 0.98; py[i] *= C.ARENA / rr * 0.98; }
      const p = w2s(px[i], py[i]);
      if (p.x < -4 || p.x > cw + 4 || p.y < -4 || p.y > ch + 4) continue;
      const t = i / N;
      ctx.fillStyle = `rgba(${90 + t * 60},${150 + t * 60},255,0.5)`;
      ctx.fillRect(p.x, p.y, 1.6, 1.6);
    }

    // arena boundary
    const cen = w2s(0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(120,180,255,.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cen.x, cen.y, C.ARENA * ppu, 0, Math.PI * 2); ctx.stroke();

    // pickups
    ctx.globalCompositeOperation = 'lighter';
    for (const pk of game.pickups) {
      const p = w2s(pk.x, pk.y);
      const pulse = 0.7 + 0.3 * Math.sin((game.time + pk.phase) * 4);
      if (pk.kind === 'core') {
        const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pk.r * ppu * 2.4);
        rg.addColorStop(0, `rgba(120,255,235,${0.9 * pulse})`); rg.addColorStop(0.4, 'rgba(60,200,255,.5)'); rg.addColorStop(1, 'rgba(60,200,255,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.x, p.y, pk.r * ppu * 2.4, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = `rgba(255,80,110,${0.8 * pulse})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, pk.r * ppu, 0, Math.PI * 2); ctx.stroke();
        const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pk.r * ppu);
        rg.addColorStop(0, 'rgba(30,0,10,.9)'); rg.addColorStop(1, 'rgba(120,20,40,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.x, p.y, pk.r * ppu, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
      }
    }

    // ship: a glowing craft with a thrust flare
    const ps = w2s(s.x, s.y);
    ctx.save(); ctx.translate(ps.x, ps.y); ctx.rotate(s.angle);
    if (s.thrust > 0.05) {
      const flare = ctx.createRadialGradient(-ppu * 1.2, 0, 0, -ppu * 1.2, 0, ppu * 2.4 * s.thrust);
      flare.addColorStop(0, 'rgba(120,200,255,.9)'); flare.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.fillStyle = flare; ctx.beginPath(); ctx.arc(-ppu * 1.2, 0, ppu * 2.4 * s.thrust, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#eaf6ff';
    ctx.beginPath(); ctx.moveTo(ppu * 1.5, 0); ctx.lineTo(-ppu, ppu * 0.9); ctx.lineTo(-ppu * 0.5, 0); ctx.lineTo(-ppu, -ppu * 0.9); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5fd3ff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  return { draw, resize, kind: '2d' };
};
