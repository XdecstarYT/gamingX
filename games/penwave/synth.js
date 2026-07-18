/* ============================================================================
   PENWAVE — procedural music synthesizer.
   Renders original, royalty-free demo tracks entirely in the browser with
   the Web Audio API (OfflineAudioContext), so the app has real, playable
   music out of the box without shipping or streaming anyone's copyrighted
   catalogue. Each "demo:<style>" track is generated here on first play.
   ========================================================================== */
window.PWSynth = (() => {
'use strict';

const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

const STYLES = {
  lofi:      { bpm: 76,  bars: 16, root: 57, prog: [0, 8, 5, 7],  seventh: 'min', pad: 'sine',     cutoff: 1300, drums: 'soft',   arp: 'gentle',  swing: 0.06 },
  lofi2:     { bpm: 82,  bars: 16, root: 60, prog: [0, 5, 8, 3],  seventh: 'min', pad: 'triangle', cutoff: 1700, drums: 'soft',   arp: 'gentle',  swing: 0.05 },
  synthwave: { bpm: 100, bars: 16, root: 53, prog: [0, 8, 5, 7],  seventh: 'min', pad: 'sawtooth', cutoff: 2600, drums: 'punchy', arp: 'drive',   swing: 0 },
  house:     { bpm: 122, bars: 16, root: 55, prog: [0, 7, 5, 8],  seventh: 'min', pad: 'sawtooth', cutoff: 3000, drums: 'four',   arp: 'off',     stab: true, swing: 0 },
  ambient:   { bpm: 60,  bars: 12, root: 60, prog: [0, 7, 9, 5],  seventh: 'maj', pad: 'sine',     cutoff: 950,  drums: 'none',   arp: 'sparse',  swing: 0 },
};

const cache = {};

function triad(sev) { return sev === 'maj' ? [0, 4, 7, 11] : [0, 3, 7, 10]; }

function env(ctx, param, start, peak, a, d, s, sustainTime, r) {
  param.setValueAtTime(0.0001, start);
  param.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + a);
  param.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), start + a + d);
  param.setValueAtTime(Math.max(0.0001, peak * s), start + a + d + sustainTime);
  param.exponentialRampToValueAtTime(0.0001, start + a + d + sustainTime + r);
}

function tone(ctx, dest, type, freq, start, dur, peak, filterHz, detune) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; if (detune) o.detune.value = detune;
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz || 20000;
  o.connect(f); f.connect(g); g.connect(dest);
  const a = Math.min(0.04, dur * 0.2), r = Math.min(0.3, dur * 0.5);
  env(ctx, g.gain, start, peak, a, dur * 0.2, 0.7, Math.max(0, dur - a - dur * 0.2 - r), r);
  o.start(start); o.stop(start + dur + r + 0.05);
}

function padChord(ctx, dest, rootMidi, tones, start, dur, type, cutoff, peak) {
  for (const t of tones) {
    const f = midiToFreq(rootMidi + t);
    tone(ctx, dest, type, f, start, dur, peak, cutoff, -6);
    tone(ctx, dest, type, f, start, dur, peak * 0.8, cutoff, +6);
  }
}

function kick(ctx, dest, start, strength) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.setValueAtTime(130, start); o.frequency.exponentialRampToValueAtTime(45, start + 0.12);
  g.gain.setValueAtTime(strength, start); g.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
  o.connect(g); g.connect(dest); o.start(start); o.stop(start + 0.3);
}
function noiseBurst(ctx, dest, start, dur, hp, peak) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain(); g.gain.setValueAtTime(peak, start); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f); f.connect(g); g.connect(dest); src.start(start); src.stop(start + dur + 0.02);
}

function render(style, sampleRate) {
  const cfg = STYLES[style] || STYLES.lofi;
  const spb = 60 / cfg.bpm;              // seconds per beat
  const barLen = spb * 4;
  const total = cfg.bars * barLen + 1.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * total), sampleRate);

  const master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp); comp.connect(ctx.destination);

  const padBus = ctx.createGain(); padBus.gain.value = 0.16; padBus.connect(master);
  const arpBus = ctx.createGain(); arpBus.gain.value = 0.10; arpBus.connect(master);
  const bassBus = ctx.createGain(); bassBus.gain.value = 0.28; bassBus.connect(master);
  const drumBus = ctx.createGain(); drumBus.gain.value = 0.7; drumBus.connect(master);
  const tones = triad(cfg.seventh);

  for (let bar = 0; bar < cfg.bars; bar++) {
    const barStart = bar * barLen;
    const chordRoot = cfg.root + cfg.prog[bar % cfg.prog.length];

    // pad (whole bar)
    padChord(ctx, padBus, chordRoot, tones, barStart, barLen * 0.98, cfg.pad, cfg.cutoff, 0.5);
    // bass (root, per beat or held)
    if (cfg.drums === 'four') { for (let b = 0; b < 4; b++) tone(ctx, bassBus, 'sawtooth', midiToFreq(chordRoot - 12), barStart + b * spb, spb * 0.9, 0.5, 500); }
    else tone(ctx, bassBus, 'sine', midiToFreq(chordRoot - 12), barStart, barLen * 0.95, 0.6, 400);

    // stabs (house)
    if (cfg.stab) for (let b = 0; b < 4; b++) padChord(ctx, arpBus, chordRoot + 12, tones.slice(0, 3), barStart + b * spb + spb * 0.5, spb * 0.3, cfg.pad, cfg.cutoff, 0.6);

    // arpeggio
    if (cfg.arp !== 'off') {
      const step = cfg.arp === 'sparse' ? spb : spb / 2;
      const notes = tones.map(t => chordRoot + 12 + t);
      let i = 0;
      for (let t = 0; t < barLen - 0.001; t += step) {
        const sw = (Math.round(t / step) % 2 === 1) ? cfg.swing * spb : 0;
        const n = notes[i % notes.length];
        tone(ctx, arpBus, cfg.arp === 'drive' ? 'square' : 'triangle', midiToFreq(n), barStart + t + sw, step * 0.9, cfg.arp === 'sparse' ? 0.5 : 0.35, cfg.cutoff + 800);
        i++;
      }
    }

    // drums
    if (cfg.drums === 'soft') {
      kick(ctx, drumBus, barStart, 0.7); kick(ctx, drumBus, barStart + 2 * spb, 0.6);
      for (let h = 0; h < 4; h++) noiseBurst(ctx, drumBus, barStart + h * spb + spb * 0.5, 0.05, 8000, 0.06);
    } else if (cfg.drums === 'punchy') {
      kick(ctx, drumBus, barStart, 0.95); kick(ctx, drumBus, barStart + 2 * spb, 0.9);
      noiseBurst(ctx, drumBus, barStart + spb, 0.14, 1800, 0.35);
      noiseBurst(ctx, drumBus, barStart + 3 * spb, 0.14, 1800, 0.35);
      for (let h = 0; h < 8; h++) noiseBurst(ctx, drumBus, barStart + h * (spb / 2), 0.03, 9000, 0.05);
    } else if (cfg.drums === 'four') {
      for (let b = 0; b < 4; b++) kick(ctx, drumBus, barStart + b * spb, 0.95);
      for (let h = 0; h < 4; h++) noiseBurst(ctx, drumBus, barStart + h * spb + spb * 0.5, 0.06, 9000, 0.12);
    }
  }

  return ctx.startRendering();
}

function getBuffer(style, sampleRate) {
  const key = style + '@' + sampleRate;
  if (!cache[key]) cache[key] = render(style, sampleRate);
  return cache[key];
}

return { getBuffer, STYLES };
})();
