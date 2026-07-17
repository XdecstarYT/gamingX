/* ============================================================================
   DOMINION — lightweight WebAudio feedback synth.
   Same generic oscillator-tone technique as the platform's assets/js/gx.js,
   adapted with Nexus-specific cues (elections, legislation, construction).
   Pure browser-side polish layer — never touches game state.
   ========================================================================== */
window.DomAudio = (() => {
'use strict';
let actx = null;
function ac() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, dur, type, gain, delay, slide) {
  const c = ac(); if (!c) return;
  const start = c.currentTime + (delay || 0);
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, start);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), start + dur);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain || 0.07, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(c.destination);
  o.start(start); o.stop(start + dur + 0.05);
}

function click() { tone(520, 0.05, 'square', 0.05); }
function place() { tone(360, 0.07, 'square', 0.06); tone(520, 0.06, 'square', 0.05, 0.05); }
function positive() { tone(600, 0.08, 'triangle', 0.07); tone(900, 0.1, 'triangle', 0.08, 0.07); }
function negative() { tone(220, 0.16, 'sawtooth', 0.06, 0, -80); }
function warn() { tone(180, 0.09, 'square', 0.05); }
function tech() { tone(700, 0.08, 'triangle', 0.07); tone(1000, 0.09, 'triangle', 0.07, 0.07); tone(1300, 0.14, 'triangle', 0.08, 0.14); }
function fanfare() {
  tone(523, 0.11, 'triangle', 0.09);
  tone(659, 0.11, 'triangle', 0.09, 0.09);
  tone(784, 0.11, 'triangle', 0.09, 0.18);
  tone(1047, 0.34, 'triangle', 0.11, 0.27);
}
function defeat() {
  tone(300, 0.22, 'sawtooth', 0.07, 0, -140);
  tone(220, 0.28, 'sawtooth', 0.06, 0.16, -100);
}
function achievement() {
  tone(784, 0.09, 'triangle', 0.08);
  tone(988, 0.09, 'triangle', 0.08, 0.08);
  tone(1319, 0.22, 'triangle', 0.1, 0.16);
}

window.addEventListener('pointerdown', ac, { once: true });
window.addEventListener('keydown', ac, { once: true });

return { click, place, positive, negative, warn, tech, fanfare, defeat, achievement };
})();
