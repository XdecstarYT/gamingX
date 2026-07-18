/* ============================================================================
   PENWAVE — unified audio player.
   One control surface over two backends: uploaded files play through an
   <audio> element; procedurally-generated demo tracks play through a Web
   Audio AudioBufferSourceNode (see synth.js). Handles queue, shuffle,
   repeat, seek, volume, and emits state to subscribers.
   ========================================================================== */
window.PWPlayer = (() => {
'use strict';

let ctx = null, masterGain = null;
function ensureCtx() {
  if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); masterGain = ctx.createGain(); masterGain.gain.value = volume; masterGain.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

let queue = [], order = [], pos = 0;   // order = index sequence (for shuffle)
let backend = null, current = null;
let isPlaying = false, shuffle = false, repeat = 'off', volume = 0.9;
const subs = [];
function emit() { const s = getState(); subs.forEach(cb => { try { cb(s); } catch (e) {} }); }

/* ---------------- backends ---------------- */
function FileBackend(track) {
  const audio = new Audio(); audio.src = track.url; audio.preload = 'auto'; audio.volume = volume; audio.crossOrigin = 'anonymous';
  let onend = null;
  audio.addEventListener('ended', () => { if (onend) onend(); });
  return {
    kind: 'file',
    play() { return audio.play(); },
    pause() { audio.pause(); },
    seek(sec) { try { audio.currentTime = sec; } catch (e) {} },
    time() { return audio.currentTime || 0; },
    dur() { return isFinite(audio.duration) ? audio.duration : (track.duration || 0); },
    setVol(v) { audio.volume = v; },
    onEnd(cb) { onend = cb; },
    dispose() { audio.pause(); audio.src = ''; },
  };
}

function SynthBackend(track) {
  const c = ensureCtx();
  const gain = c.createGain(); gain.gain.value = volume; gain.connect(masterGain);
  let buffer = null, src = null, startAt = 0, pausedAt = 0, playing = false, manualStop = false, onend = null, ready = false, pendingPlay = false;
  const style = track.storage_path.slice(5);
  PWSynth.getBuffer(style, c.sampleRate).then(buf => { buffer = buf; ready = true; if (pendingPlay) { pendingPlay = false; start(pausedAt); } emit(); }).catch(() => {});
  function start(offset) {
    if (!buffer) { pendingPlay = true; pausedAt = offset || 0; return; }
    stopInternal();
    src = c.createBufferSource(); src.buffer = buffer; src.connect(gain);
    src.onended = () => { if (manualStop) { manualStop = false; return; } playing = false; if (onend) onend(); };
    startAt = c.currentTime - (offset || 0);
    src.start(0, Math.max(0, offset || 0)); playing = true;
  }
  function stopInternal() { if (src) { manualStop = true; try { src.stop(); } catch (e) {} src.disconnect(); src = null; } }
  return {
    kind: 'synth',
    play() { if (c.state === 'suspended') c.resume(); if (!playing) start(pausedAt); return Promise.resolve(); },
    pause() { if (playing) { pausedAt = c.currentTime - startAt; stopInternal(); playing = false; } },
    seek(sec) { pausedAt = Math.max(0, Math.min(sec, this.dur())); if (playing) start(pausedAt); },
    time() { return playing ? Math.min(c.currentTime - startAt, this.dur()) : pausedAt; },
    dur() { return buffer ? buffer.duration : (track.duration || 0); },
    setVol(v) { gain.gain.value = v; },
    onEnd(cb) { onend = cb; },
    dispose() { stopInternal(); gain.disconnect(); },
  };
}

/* ---------------- core ---------------- */
function buildOrder(startIndex) {
  order = queue.map((_, i) => i);
  if (shuffle) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    // ensure the chosen start track is first
    const oi = order.indexOf(startIndex); if (oi > 0) { [order[0], order[oi]] = [order[oi], order[0]]; }
  }
  pos = shuffle ? 0 : startIndex;
}

function loadCurrent(autoplay) {
  if (backend) { backend.dispose(); backend = null; }
  const idx = order[pos];
  current = queue[idx];
  if (!current) { isPlaying = false; emit(); return; }
  ensureCtx();
  backend = current.storage_path && current.storage_path.indexOf('demo:') === 0 ? SynthBackend(current) : FileBackend(current);
  backend.onEnd(handleEnded);
  backend.setVol(volume);
  if (autoplay) { isPlaying = true; backend.play().catch(() => {}); tick(); }
  emit();
}

function handleEnded() {
  if (repeat === 'one') { backend.seek(0); backend.play(); isPlaying = true; tick(); emit(); return; }
  next(true);
}

function setQueue(tracks, startIndex) {
  queue = tracks.slice(); buildOrder(startIndex || 0); loadCurrent(true);
}
function playTrack(track, contextList) {
  const list = contextList && contextList.length ? contextList : [track];
  const idx = Math.max(0, list.findIndex(t => t.id === track.id));
  setQueue(list, idx);
}
function toggle() { if (!backend) return; if (isPlaying) { backend.pause(); isPlaying = false; } else { ensureCtx(); backend.play().catch(() => {}); isPlaying = true; tick(); } emit(); }
function play() { if (backend && !isPlaying) toggle(); }
function pause() { if (backend && isPlaying) toggle(); }
function next(auto) {
  if (!queue.length) return;
  if (pos < order.length - 1) pos++;
  else if (repeat === 'all') pos = 0;
  else { if (auto) { isPlaying = false; if (backend) backend.pause(); emit(); } else { pos = 0; } if (auto) return; }
  loadCurrent(true);
}
function prev() {
  if (!queue.length) return;
  if (backend && backend.time() > 3) { backend.seek(0); emit(); return; }
  if (pos > 0) pos--; else if (repeat === 'all') pos = order.length - 1;
  loadCurrent(true);
}
function seekFrac(f) { if (backend) { backend.seek(f * backend.dur()); emit(); } }
function seekTo(sec) { if (backend) { backend.seek(sec); emit(); } }
function setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (backend) backend.setVol(volume); if (masterGain) masterGain.gain.value = volume; emit(); }
function setShuffle(on) { const cur = order[pos]; shuffle = on; buildOrder(cur); loadCurrent(false); if (isPlaying && backend) { backend.play(); tick(); } }
function cycleRepeat() { repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; emit(); }

let rafId = null;
function tick() {
  cancelAnimationFrame(rafId);
  const loop = () => { if (!isPlaying) return; emit(); rafId = requestAnimationFrame(loop); };
  rafId = requestAnimationFrame(loop);
}

function getState() {
  return {
    track: current, index: pos, queueLength: queue.length,
    isPlaying, shuffle, repeat, volume,
    currentTime: backend ? backend.time() : 0,
    duration: backend ? backend.dur() : (current ? current.duration : 0),
    queue: order.map(i => queue[i]),
  };
}
function subscribe(cb) { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); }; }

return { setQueue, playTrack, toggle, play, pause, next: () => next(false), prev, seekFrac, seekTo, setVolume, setShuffle, cycleRepeat, getState, subscribe };
})();
