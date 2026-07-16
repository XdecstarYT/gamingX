/* GamingX shared game helpers: overlays, HUD, high scores, tiny synth. */
window.GX = (() => {
  'use strict';
  const $ = id => document.getElementById(id);

  /* ---------- overlay ---------- */
  function show(title, sub, buttons) {
    $('ov-title').innerHTML = title;
    $('ov-sub').innerHTML = sub || '';
    const wrap = $('ov-buttons');
    wrap.innerHTML = '';
    for (const b of buttons || []) {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' btn-primary' : '');
      el.textContent = b.label;
      el.addEventListener('click', e => { e.stopPropagation(); beep(660, 0.06, 'square', 0.05); b.cb(); });
      wrap.appendChild(el);
    }
    $('overlay').classList.remove('hidden');
  }
  function hide() { $('overlay').classList.add('hidden'); }

  function hud(html) { $('hud').innerHTML = html; }

  /* ---------- high scores ---------- */
  function hi(slug) {
    try { return parseInt(localStorage.getItem('gamingx.hi.' + slug), 10) || 0; } catch (e) { return 0; }
  }
  function setHi(slug, score) {
    const best = hi(slug);
    if (score > best) {
      try { localStorage.setItem('gamingx.hi.' + slug, String(Math.floor(score))); } catch (e) {}
      return true;
    }
    return false;
  }

  /* ---------- audio ---------- */
  let actx = null;
  function ac() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(freq, dur, type, gain, slide) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
    g.gain.setValueAtTime(gain || 0.06, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + dur + 0.05);
  }
  function boom(gain) { // filtered noise burst
    const c = ac(); if (!c) return;
    const len = c.sampleRate * 0.25, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = gain || 0.2;
    s.buffer = buf; s.connect(f).connect(g).connect(c.destination); s.start();
  }
  window.addEventListener('pointerdown', ac, { once: true });
  window.addEventListener('keydown', ac, { once: true });

  /* ---------- celebration: fanfare, screen shake, confetti ---------- */
  function fanfare() {
    beep(523, 0.11, 'triangle', 0.09);
    setTimeout(() => beep(659, 0.11, 'triangle', 0.09), 90);
    setTimeout(() => beep(784, 0.11, 'triangle', 0.09), 180);
    setTimeout(() => beep(1047, 0.32, 'triangle', 0.11), 270);
  }

  function shake(intensity, durationMs) {
    const canvas = $('game-canvas');
    if (!canvas) return;
    const dur = durationMs || 350;
    const start = performance.now();
    (function tick() {
      const t = (performance.now() - start) / dur;
      if (t >= 1) { canvas.style.transform = ''; return; }
      const k = (intensity || 10) * (1 - t);
      canvas.style.transform = `translate(${(Math.random() - 0.5) * k}px, ${(Math.random() - 0.5) * k}px)`;
      requestAnimationFrame(tick);
    })();
  }

  const CONFETTI_COLORS = ['#22d3ee', '#a855f7', '#fde047', '#4ade80', '#f87171', '#38bdf8', '#fb923c'];
  function confetti(count) {
    let c = $('gx-confetti');
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'gx-confetti';
      c.style.cssText = 'position:fixed;inset:0;z-index:25;pointer-events:none;width:100%;height:100%';
      document.body.appendChild(c);
    }
    const ctx = c.getContext('2d');
    const W = innerWidth, H = innerHeight;
    c.width = W; c.height = H;
    const particles = [];
    const n = count || 120;
    for (let i = 0; i < n; i++) {
      particles.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.6,
        y: H * 0.32 + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 380,
        vy: -(Math.random() * 300 + 180),
        w: Math.random() * 6 + 4, h: Math.random() * 10 + 6,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 9,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      });
    }
    let last = performance.now();
    const endAt = last + 2200;
    (function tick(now) {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.vy += 640 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (now < endAt) requestAnimationFrame(tick);
      else c.remove();
    })(last);
  }

  function celebrate(opts) {
    fanfare();
    confetti((opts && opts.count) || 120);
  }

  /* ---------- three.js boilerplate ---------- */
  function renderer3d() {
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.domElement.id = 'game-canvas';
    document.body.appendChild(r.domElement);
    return r;
  }
  function onResize(renderer, camera) {
    window.addEventListener('resize', () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    });
  }

  return { $, show, hide, hud, hi, setHi, beep, boom, fanfare, shake, confetti, celebrate, renderer3d, onResize };
})();
