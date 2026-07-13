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

  return { $, show, hide, hud, hi, setHi, beep, boom, renderer3d, onResize };
})();
