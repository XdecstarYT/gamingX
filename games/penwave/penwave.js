/* ============================================================================
   PENWAVE — a music app blending Spotify/Apple Music (glass UI, library,
   playlists, full player) with SoundCloud (upload your own tracks, follow
   artists). Playback via player.js; demo tracks synthesized by synth.js.
   Accounts/likes/uploads live in the GamingX cloud (shared GamingX account).
   ========================================================================== */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = window.GXSocial;

let me = null;
let currentView = 'home';
let likedIds = new Set();
let lastListContext = [];   // list used to build the queue for the current view action

const GENRES = [
  { name: 'Lo-Fi', color: '#8b5cf6', em: '🌙' }, { name: 'Synthwave', color: '#ec4899', em: '🌆' },
  { name: 'Ambient', color: '#22d3ee', em: '🌊' }, { name: 'House', color: '#f59e0b', em: '🪩' },
  { name: 'Hip-Hop', color: '#ef4444', em: '🎤' }, { name: 'Electronic', color: '#10b981', em: '⚡' },
  { name: 'Rock', color: '#f43f5e', em: '🎸' }, { name: 'Pop', color: '#3b82f6', em: '✨' },
];
const COLORS = ['#8b5cf6', '#ec4899', '#22d3ee', '#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#f43f5e', '#1db954', '#eab308'];

function toast(m) { const t = $('pw-toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800); }
function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function likeCount(t) { return (t.music_likes && t.music_likes[0] && t.music_likes[0].count) || 0; }
function artOf(t) { const c = t.color || '#7c3aed'; return `background:linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 30%, #000))`; }
function prep(t) { if (t && t.storage_path && t.storage_path.indexOf('demo:') !== 0) t.url = S.publicUrl('audio', t.storage_path); return t; }
function waveFor(id) { let h = 0; const str = String(id); for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; const bars = []; for (let i = 0; i < 56; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; bars.push(0.2 + (h % 1000) / 1000 * 0.8); } return bars; }

/* ------------------------------------------------------------------ */
S.mountAuthGate({
  appName: 'PenWave', emoji: '🎧', accent: '#1db954', accent2: '#8b5cf6',
  tagline: 'Stream, upload and share music. Your GamingX account, your sound.',
  onAuthed: start,
});

async function start(profile) {
  me = profile;
  $('screen-app').classList.add('active');
  document.querySelectorAll('.pw-nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('btn-profile').addEventListener('click', () => switchView('library'));
  wirePlayerChrome();
  PWPlayer.subscribe(renderPlayer);
  await refreshLikes();
  renderView();
}

function switchView(v) { currentView = v; document.querySelectorAll('.pw-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === v)); renderView(); }
function renderView() {
  const el = $('view'); el.scrollTop = 0; el.innerHTML = '<div class="pw-inner"><div class="pw-empty">Loading…</div></div>';
  if (currentView === 'home') renderHome(el);
  else if (currentView === 'search') renderSearch(el);
  else if (currentView === 'library') renderLibrary(el);
  else renderUpload(el);
}

async function refreshLikes() {
  const { data } = await S.client().from('music_likes').select('track_id').eq('user_id', me.id);
  likedIds = new Set((data || []).map(r => r.track_id));
}

/* ------------------------------------------------------------------ */
/* track row + tile                                                    */
/* ------------------------------------------------------------------ */
function trackRow(t, list) {
  const row = document.createElement('div'); row.className = 'pw-track'; row.dataset.id = t.id;
  const st = PWPlayer.getState();
  if (st.track && st.track.id === t.id) row.classList.add('playing');
  row.innerHTML = `
    <div class="pw-track-art" style="${artOf(t)}">🎵</div>
    <div class="pw-track-info"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || (t.profiles && t.profiles.display_name) || '')}</div></div>
    ${st.track && st.track.id === t.id && st.isPlaying ? '<span class="pw-track-eq">♫</span>' : ''}
    <button class="pw-track-like${likedIds.has(t.id) ? ' on' : ''}">${likedIds.has(t.id) ? '❤️' : '🤍'}</button>
    <button class="pw-track-more">⋯</button>`;
  row.querySelector('.pw-track-like').addEventListener('click', e => { e.stopPropagation(); toggleLike(t.id); });
  row.querySelector('.pw-track-more').addEventListener('click', e => { e.stopPropagation(); openAddToPlaylist(t); });
  row.addEventListener('click', () => playContext(list, t));
  return row;
}
function trackList(tracks, list) { const wrap = document.createElement('div'); tracks.forEach(t => wrap.appendChild(trackRow(t, list || tracks))); return wrap; }

function tile(t, list) {
  const el = document.createElement('div'); el.className = 'pw-tile';
  el.innerHTML = `<div class="pw-tile-art" style="${artOf(t)}"><span class="em">🎵</span><span class="pw-playpin">▶</span></div>
    <div class="nm">${esc(t.title)}</div><div class="by">${esc(t.artist || (t.profiles && t.profiles.display_name) || '')}</div>`;
  el.addEventListener('click', () => playContext(list, t));
  return el;
}

function playContext(list, track) {
  const prepped = list.map(prep);
  const target = prepped.find(t => t.id === track.id) || prep(track);
  lastListContext = prepped;
  PWPlayer.playTrack(target, prepped);
}

async function toggleLike(id) {
  const c = S.client(); const on = likedIds.has(id);
  if (on) { likedIds.delete(id); await c.from('music_likes').delete().eq('track_id', id).eq('user_id', me.id); }
  else { likedIds.add(id); await c.from('music_likes').insert({ track_id: id, user_id: me.id }); }
  // refresh visible like buttons + player chrome
  document.querySelectorAll(`.pw-track[data-id="${CSS.escape(id)}"] .pw-track-like`).forEach(b => { b.classList.toggle('on', likedIds.has(id)); b.textContent = likedIds.has(id) ? '❤️' : '🤍'; });
  renderPlayer(PWPlayer.getState());
}

/* ------------------------------------------------------------------ */
/* HOME                                                                 */
/* ------------------------------------------------------------------ */
async function renderHome(el) {
  const c = S.client();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const { data: tracks } = await c.from('music_tracks').select('*,profiles!music_tracks_user_id_fkey(username,avatar,display_name),music_likes(count)').order('created_at', { ascending: false }).limit(60);
  const all = (tracks || []);
  const trending = all.slice().sort((a, b) => likeCount(b) - likeCount(a)).slice(0, 10);
  const recent = all.slice(0, 10);
  const { data: feat } = await c.from('music_playlists').select('*').eq('id', '00000000-0000-0000-0000-0000000000e1').maybeSingle();

  const inner = document.createElement('div'); inner.className = 'pw-inner';
  inner.innerHTML = `<div class="pw-greeting">${greet}, ${esc(me.display_name)}</div><div class="pw-sub">Fresh sounds from the GamingX community.</div>`;

  if (feat) {
    const f = document.createElement('div'); f.className = 'pw-feature'; f.style.cssText = `background:linear-gradient(120deg, ${feat.color}, color-mix(in srgb, ${feat.color} 20%, #6d28d9))`;
    f.innerHTML = `<div class="art" style="background:rgba(0,0,0,.25)">💿</div><div><div class="lbl">FEATURED PLAYLIST</div><div class="ttl">${esc(feat.name)}</div><div class="meta">Tap to play the essentials</div></div>`;
    f.addEventListener('click', () => openPlaylist(feat));
    inner.appendChild(f);
  }

  inner.appendChild(sectionRail('New releases', recent.map(t => tile(t, recent))));
  inner.appendChild(sectionRail('Trending now', trending.map(t => tile(t, trending))));

  const gt = document.createElement('div'); gt.className = 'pw-section-title'; gt.textContent = 'Browse genres';
  inner.appendChild(gt);
  const grid = document.createElement('div'); grid.className = 'pw-genre-grid';
  GENRES.forEach(g => { const d = document.createElement('div'); d.className = 'pw-genre'; d.style.background = `linear-gradient(135deg, ${g.color}, color-mix(in srgb, ${g.color} 40%, #000))`; d.innerHTML = `${esc(g.name)}<span class="em">${g.em}</span>`; d.addEventListener('click', () => openGenre(g.name)); grid.appendChild(d); });
  inner.appendChild(grid);

  el.innerHTML = ''; el.appendChild(inner);
}
function sectionRail(title, tiles) {
  const wrap = document.createElement('div');
  const h = document.createElement('div'); h.className = 'pw-section-title'; h.textContent = title; wrap.appendChild(h);
  const rail = document.createElement('div'); rail.className = 'pw-rail';
  if (!tiles.length) { const e = document.createElement('div'); e.className = 'pw-empty'; e.textContent = 'Nothing here yet.'; wrap.appendChild(e); return wrap; }
  tiles.forEach(t => rail.appendChild(t)); wrap.appendChild(rail); return wrap;
}

async function openGenre(name) {
  const el = $('view'); el.innerHTML = '<div class="pw-inner"><div class="pw-empty">Loading…</div></div>';
  const { data } = await S.client().from('music_tracks').select('*,profiles!music_tracks_user_id_fkey(username,avatar,display_name),music_likes(count)').eq('genre', name).order('created_at', { ascending: false });
  const inner = document.createElement('div'); inner.className = 'pw-inner';
  inner.innerHTML = `<div class="pw-greeting">${esc(name)}</div><div class="pw-sub">${(data || []).length} track${(data || []).length === 1 ? '' : 's'}</div>`;
  if (!data || !data.length) inner.insertAdjacentHTML('beforeend', '<div class="pw-empty">No tracks in this genre yet — <b>upload</b> the first one!</div>');
  else inner.appendChild(trackList(data));
  el.innerHTML = ''; el.appendChild(inner);
}

/* ------------------------------------------------------------------ */
/* SEARCH                                                               */
/* ------------------------------------------------------------------ */
function renderSearch(el) {
  const inner = document.createElement('div'); inner.className = 'pw-inner';
  inner.innerHTML = `<div class="pw-search-box"><input id="pw-search-input" placeholder="Songs, artists, genres…"></div><div id="pw-search-results"></div>`;
  el.innerHTML = ''; el.appendChild(inner);
  const results = $('pw-search-results');
  function initial() {
    results.innerHTML = '';
    const gt = document.createElement('div'); gt.className = 'pw-section-title'; gt.textContent = 'Browse all';
    results.appendChild(gt);
    const grid = document.createElement('div'); grid.className = 'pw-genre-grid';
    GENRES.forEach(g => { const d = document.createElement('div'); d.className = 'pw-genre'; d.style.background = `linear-gradient(135deg, ${g.color}, color-mix(in srgb, ${g.color} 40%, #000))`; d.innerHTML = `${esc(g.name)}<span class="em">${g.em}</span>`; d.addEventListener('click', () => openGenre(g.name)); grid.appendChild(d); });
    results.appendChild(grid);
  }
  async function run(q) {
    results.innerHTML = '<div class="pw-empty">Searching…</div>';
    const c = S.client();
    const [tr, ppl] = await Promise.all([
      c.from('music_tracks').select('*,profiles!music_tracks_user_id_fkey(username,avatar,display_name),music_likes(count)').or(`title.ilike.%${q}%,artist.ilike.%${q}%,genre.ilike.%${q}%`).limit(40),
      S.searchProfiles(q, 10),
    ]);
    results.innerHTML = '';
    if (ppl.length) { const h = document.createElement('div'); h.className = 'pw-section-title'; h.textContent = 'Artists'; results.appendChild(h); ppl.filter(p => p.id !== me.id).forEach(p => results.appendChild(artistRow(p))); }
    const h2 = document.createElement('div'); h2.className = 'pw-section-title'; h2.textContent = 'Songs'; results.appendChild(h2);
    if (!tr.data || !tr.data.length) results.insertAdjacentHTML('beforeend', '<div class="pw-empty">No songs found.</div>');
    else results.appendChild(trackList(tr.data));
  }
  let deb; $('pw-search-input').addEventListener('input', e => { const q = e.target.value.trim(); clearTimeout(deb); if (!q) return initial(); deb = setTimeout(() => run(q), 250); });
  initial();
}
function artistRow(p) {
  const row = document.createElement('div'); row.className = 'pw-track';
  row.innerHTML = `<div class="pw-track-art" style="background:linear-gradient(135deg,#334,#112);border-radius:50%">${esc(p.avatar)}</div>
    <div class="pw-track-info"><div class="t">${esc(p.display_name)}</div><div class="a">@${esc(p.username)} · Artist</div></div><button class="pw-track-more">→</button>`;
  row.addEventListener('click', () => openArtist(p));
  return row;
}
async function openArtist(p) {
  const el = $('view'); el.innerHTML = '<div class="pw-inner"><div class="pw-empty">Loading…</div></div>';
  const { data } = await S.client().from('music_tracks').select('*,profiles!music_tracks_user_id_fkey(username,avatar,display_name),music_likes(count)').eq('user_id', p.id).order('created_at', { ascending: false });
  const following = await S.isFollowing(p.id);
  const inner = document.createElement('div'); inner.className = 'pw-inner';
  inner.innerHTML = `<div style="display:flex;align-items:center;gap:14px;margin:14px 0">
      <div class="pw-track-art" style="width:72px;height:72px;font-size:2rem;border-radius:50%;background:linear-gradient(135deg,#334,#112)">${esc(p.avatar)}</div>
      <div><div class="pw-greeting" style="margin:0">${esc(p.display_name)}</div><div class="pw-sub" style="margin:2px 0 0">@${esc(p.username)}</div></div></div>`;
  if (p.id !== me.id) { const fb = document.createElement('button'); fb.className = 'pw-btn pw-btn-2'; fb.style.maxWidth = '160px'; fb.textContent = following ? 'Following ✓' : 'Follow'; fb.addEventListener('click', async () => { const on = fb.textContent.includes('Following'); on ? await S.unfollow(p.id) : await S.follow(p.id); fb.textContent = on ? 'Follow' : 'Following ✓'; }); inner.appendChild(fb); }
  const h = document.createElement('div'); h.className = 'pw-section-title'; h.textContent = 'Tracks'; inner.appendChild(h);
  if (!data || !data.length) inner.insertAdjacentHTML('beforeend', '<div class="pw-empty">No tracks yet.</div>');
  else inner.appendChild(trackList(data));
  el.innerHTML = ''; el.appendChild(inner);
}

/* ------------------------------------------------------------------ */
/* LIBRARY                                                              */
/* ------------------------------------------------------------------ */
async function renderLibrary(el) {
  const c = S.client();
  const [likedRes, plRes, mineRes] = await Promise.all([
    c.from('music_likes').select('track_id, music_tracks(*,profiles!music_tracks_user_id_fkey(username,avatar,display_name),music_likes(count))').eq('user_id', me.id).order('created_at', { ascending: false }),
    c.from('music_playlists').select('*').eq('user_id', me.id).order('created_at', { ascending: false }),
    c.from('music_tracks').select('*,profiles!music_tracks_user_id_fkey(username,avatar,display_name),music_likes(count)').eq('user_id', me.id).order('created_at', { ascending: false }),
  ]);
  const liked = (likedRes.data || []).map(r => r.music_tracks).filter(Boolean);
  const playlists = plRes.data || [];
  const mine = mineRes.data || [];

  const inner = document.createElement('div'); inner.className = 'pw-inner';
  inner.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin:12px 0">
      <div class="pw-greeting" style="margin:0">Your Library</div>
      <button id="btn-logout" style="color:#f87171;font-weight:800;font-size:.8rem">Log out</button></div>`;

  // Liked Songs pseudo-playlist
  const likedCard = document.createElement('div'); likedCard.className = 'pw-feature'; likedCard.style.background = 'linear-gradient(120deg,#1db954,#8b5cf6)';
  likedCard.innerHTML = `<div class="art" style="background:rgba(0,0,0,.25)">❤️</div><div><div class="lbl">PLAYLIST</div><div class="ttl">Liked Songs</div><div class="meta">${liked.length} song${liked.length === 1 ? '' : 's'}</div></div>`;
  likedCard.addEventListener('click', () => { if (liked.length) openTrackScreen('Liked Songs', '❤️', liked.map(prep)); else toast('Like some songs first'); });
  inner.appendChild(likedCard);

  // playlists
  const ph = document.createElement('div'); ph.className = 'pw-section-title'; ph.innerHTML = 'Playlists <a id="new-pl">+ NEW</a>'; inner.appendChild(ph);
  if (!playlists.length) inner.insertAdjacentHTML('beforeend', '<div class="pw-empty" style="padding:20px">No playlists yet. Tap <b>+ NEW</b> to make one.</div>');
  else { const rail = document.createElement('div'); rail.className = 'pw-rail'; playlists.forEach(pl => { const el2 = document.createElement('div'); el2.className = 'pw-tile'; el2.innerHTML = `<div class="pw-tile-art" style="background:linear-gradient(135deg,${pl.color},#000)"><span class="em">💿</span></div><div class="nm">${esc(pl.name)}</div><div class="by">Playlist</div>`; el2.addEventListener('click', () => openPlaylist(pl)); rail.appendChild(el2); }); inner.appendChild(rail); }

  // uploads
  const uh = document.createElement('div'); uh.className = 'pw-section-title'; uh.textContent = 'Your uploads'; inner.appendChild(uh);
  if (!mine.length) inner.insertAdjacentHTML('beforeend', '<div class="pw-empty" style="padding:20px">You haven\'t uploaded anything yet. Head to <b>Upload</b>.</div>');
  else inner.appendChild(trackList(mine));

  el.innerHTML = ''; el.appendChild(inner);
  $('btn-logout').addEventListener('click', async () => { await S.signOut(); location.reload(); });
  $('new-pl') && $('new-pl').addEventListener('click', createPlaylist);
}

async function createPlaylist() {
  const name = prompt('Playlist name:'); if (!name || !name.trim()) return;
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const { error } = await S.client().from('music_playlists').insert({ user_id: me.id, name: name.trim(), color });
  if (error) toast('Could not create'); else { toast('Playlist created'); renderView(); }
}

async function openPlaylist(pl) {
  const el = $('view'); el.innerHTML = '<div class="pw-inner"><div class="pw-empty">Loading…</div></div>';
  const { data } = await S.client().from('music_playlist_tracks').select('position, music_tracks(*,profiles!music_tracks_user_id_fkey(username,avatar,display_name),music_likes(count))').eq('playlist_id', pl.id).order('position', { ascending: true });
  const tracks = (data || []).map(r => r.music_tracks).filter(Boolean);
  openTrackScreen(pl.name, '💿', tracks.map(prep), pl.color, pl.user_id === me.id ? pl : null);
}

function openTrackScreen(title, emoji, tracks, color, ownedPlaylist) {
  const el = $('view'); el.scrollTop = 0;
  const inner = document.createElement('div'); inner.className = 'pw-inner';
  const grad = color || '#7c3aed';
  const head = document.createElement('div'); head.className = 'pw-feature'; head.style.background = `linear-gradient(120deg, ${grad}, color-mix(in srgb, ${grad} 20%, #000))`;
  head.style.cursor = 'default';
  head.innerHTML = `<div class="art" style="background:rgba(0,0,0,.25)">${emoji}</div><div><div class="lbl">PLAYLIST</div><div class="ttl">${esc(title)}</div><div class="meta">${tracks.length} song${tracks.length === 1 ? '' : 's'}</div></div>`;
  inner.appendChild(head);
  const playBtn = document.createElement('button'); playBtn.className = 'pw-btn'; playBtn.style.margin = '4px 0 14px'; playBtn.textContent = '▶  Play';
  playBtn.addEventListener('click', () => { if (tracks.length) PWPlayer.setQueue(tracks, 0); });
  inner.appendChild(playBtn);
  if (!tracks.length) inner.insertAdjacentHTML('beforeend', '<div class="pw-empty">No songs here yet.</div>');
  else inner.appendChild(trackList(tracks, tracks));
  el.innerHTML = ''; el.appendChild(inner);
}

/* ------------------------------------------------------------------ */
/* UPLOAD                                                               */
/* ------------------------------------------------------------------ */
function renderUpload(el) {
  const inner = document.createElement('div'); inner.className = 'pw-inner';
  inner.innerHTML = `<div class="pw-greeting">Upload</div><div class="pw-sub">Share your own audio with the GamingX community.</div>
    <div class="pw-card">
      <input type="file" accept="audio/*" id="up-file" class="pw-file">
      <div class="pw-field"><label>TITLE</label><input type="text" id="up-title" placeholder="Track title" maxlength="80"></div>
      <div class="pw-field"><label>ARTIST</label><input type="text" id="up-artist" placeholder="${esc(me.display_name)}" maxlength="60"></div>
      <div class="pw-field"><label>GENRE</label><select id="up-genre">${GENRES.map(g => `<option>${g.name}</option>`).join('')}</select></div>
      <div class="pw-field"><label>COVER COLOUR</label><div class="pw-colors" id="up-colors"></div></div>
      <button class="pw-btn" id="up-btn" disabled>UPLOAD TRACK</button>
    </div>`;
  el.innerHTML = ''; el.appendChild(inner);
  let picked = null, dur = 0, color = COLORS[0];
  const colors = $('up-colors');
  COLORS.forEach((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pw-color' + (i === 0 ? ' on' : ''); b.style.background = c; b.addEventListener('click', () => { color = c; colors.querySelectorAll('.pw-color').forEach(x => x.classList.remove('on')); b.classList.add('on'); }); colors.appendChild(b); });
  $('up-file').addEventListener('change', e => {
    picked = e.target.files[0] || null; $('up-btn').disabled = !picked;
    if (picked) { if (!$('up-title').value) $('up-title').value = picked.name.replace(/\.[^.]+$/, ''); const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => { dur = a.duration || 0; }; a.src = URL.createObjectURL(picked); }
  });
  $('up-btn').addEventListener('click', async () => {
    if (!picked) return;
    const btn = $('up-btn'); btn.disabled = true; btn.textContent = 'UPLOADING…';
    try {
      const ext = (picked.name.split('.').pop() || 'mp3').toLowerCase();
      const path = await S.uploadFile('audio', picked, ext);
      const { error } = await S.client().from('music_tracks').insert({ user_id: me.id, title: $('up-title').value.trim() || 'Untitled', artist: $('up-artist').value.trim() || me.display_name, storage_path: path, genre: $('up-genre').value, color, duration: Math.round(dur) });
      if (error) throw error;
      toast('Track uploaded! 🎉'); switchView('library');
    } catch (e) { toast('Upload failed: ' + (e.message || 'error')); btn.disabled = false; btn.textContent = 'UPLOAD TRACK'; }
  });
}

/* ------------------------------------------------------------------ */
/* PLAYER CHROME (mini bar + full player)                              */
/* ------------------------------------------------------------------ */
function wirePlayerChrome() {
  $('mini').addEventListener('click', e => { if (e.target.closest('#mini-play') || e.target.closest('#mini-like')) return; openPlayer(); });
  $('mini-play').addEventListener('click', e => { e.stopPropagation(); PWPlayer.toggle(); });
  $('mini-like').addEventListener('click', e => { e.stopPropagation(); const s = PWPlayer.getState(); if (s.track) toggleLike(s.track.id); });
  $('player-close').addEventListener('click', closePlayer);
  $('c-play').addEventListener('click', () => PWPlayer.toggle());
  $('c-next').addEventListener('click', () => PWPlayer.next());
  $('c-prev').addEventListener('click', () => PWPlayer.prev());
  $('c-shuffle').addEventListener('click', () => { const s = PWPlayer.getState(); PWPlayer.setShuffle(!s.shuffle); });
  $('c-repeat').addEventListener('click', () => PWPlayer.cycleRepeat());
  $('c-like').addEventListener('click', () => { const s = PWPlayer.getState(); if (s.track) toggleLike(s.track.id); });
  $('c-addpl').addEventListener('click', () => { const s = PWPlayer.getState(); if (s.track) openAddToPlaylist(s.track); });
  $('c-vol').addEventListener('input', e => PWPlayer.setVolume(e.target.value / 100));
  $('player-queue-btn').addEventListener('click', openQueue);
  $('player-wave').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); PWPlayer.seekFrac((e.clientX - r.left) / r.width); });
  // build wave bars once
  const wave = $('player-wave'); wave.innerHTML = ''; for (let i = 0; i < 56; i++) { const b = document.createElement('div'); b.className = 'bar'; wave.appendChild(b); }
}
function openPlayer() { $('player').classList.remove('hidden'); requestAnimationFrame(() => $('player').classList.add('open')); }
function closePlayer() { $('player').classList.remove('open'); setTimeout(() => $('player').classList.add('hidden'), 320); }

let lastTrackId = null;
function renderPlayer(s) {
  const mini = $('mini');
  if (!s.track) { mini.classList.add('hidden'); return; }
  mini.classList.remove('hidden');
  document.documentElement.style.setProperty('--now', s.track.color || '#7c3aed');

  // mini
  $('mini-art').style.cssText = artOf(s.track); $('mini-art').textContent = '🎵';
  $('mini-title').textContent = s.track.title;
  $('mini-artist').textContent = s.track.artist || (s.track.profiles && s.track.profiles.display_name) || '';
  $('mini-play').textContent = s.isPlaying ? '⏸' : '▶';
  $('mini-like').textContent = likedIds.has(s.track.id) ? '❤️' : '🤍';
  const frac = s.duration ? s.currentTime / s.duration : 0;
  $('mini-prog-fill').style.width = (frac * 100) + '%';

  // full player
  $('player-art').style.cssText = artOf(s.track); $('player-art').textContent = '🎵';
  $('player-bg').style.setProperty('--now', s.track.color || '#7c3aed');
  $('player-title').textContent = s.track.title;
  $('player-artist').textContent = s.track.artist || (s.track.profiles && s.track.profiles.display_name) || '';
  $('player-cur').textContent = fmtTime(s.currentTime);
  $('player-dur').textContent = fmtTime(s.duration);
  $('c-play').textContent = s.isPlaying ? '⏸' : '▶';
  $('c-shuffle').classList.toggle('on', s.shuffle);
  $('c-repeat').classList.toggle('on', s.repeat !== 'off');
  $('c-repeat').textContent = s.repeat === 'one' ? '🔂' : '🔁';
  $('c-like').textContent = likedIds.has(s.track.id) ? '❤️' : '🤍';
  $('c-like').classList.toggle('on', likedIds.has(s.track.id));

  // waveform fill
  if (s.track.id !== lastTrackId) { lastTrackId = s.track.id; const heights = waveFor(s.track.id); const bars = $('player-wave').children; for (let i = 0; i < bars.length; i++) bars[i].style.height = (heights[i] * 100) + '%'; }
  const bars = $('player-wave').children; const fillTo = Math.floor(frac * bars.length);
  for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i <= fillTo);

  // reflect currently-playing row highlight in list
  document.querySelectorAll('.pw-track').forEach(r => r.classList.toggle('playing', r.dataset.id === s.track.id));
}

/* ------------------------------------------------------------------ */
/* sheets: queue + add to playlist                                     */
/* ------------------------------------------------------------------ */
function openSheet(title, buildBody) {
  const ov = $('sheet-overlay'), sh = $('sheet');
  sh.innerHTML = `<div class="pw-sheet-handle"></div><div class="pw-sheet-title">${esc(title)}</div><div class="pw-sheet-body" id="sheet-body"></div>`;
  buildBody($('sheet-body'));
  ov.classList.remove('hidden'); requestAnimationFrame(() => sh.classList.add('open'));
  ov.onclick = closeSheet;
}
function closeSheet() { $('sheet').classList.remove('open'); setTimeout(() => $('sheet-overlay').classList.add('hidden'), 280); }

function openQueue() {
  const s = PWPlayer.getState();
  openSheet('Up Next', body => {
    if (!s.queue || !s.queue.length) { body.innerHTML = '<div class="pw-empty">Queue is empty.</div>'; return; }
    s.queue.forEach((t, i) => { const row = document.createElement('div'); row.className = 'pw-sheet-row'; row.innerHTML = `<div class="ic" style="${artOf(t)}">🎵</div><div style="flex:1;min-width:0"><div class="t" style="font-weight:700">${esc(t.title)}</div><div class="a" style="color:var(--muted);font-size:.78rem">${esc(t.artist || '')}</div></div>${s.track && s.track.id === t.id ? '<span style="color:var(--accent)">♫</span>' : ''}`; row.addEventListener('click', () => { PWPlayer.setQueue(s.queue, i); closeSheet(); }); body.appendChild(row); });
  });
}

async function openAddToPlaylist(track) {
  const { data: pls } = await S.client().from('music_playlists').select('*').eq('user_id', me.id).order('created_at', { ascending: false });
  openSheet('Add to playlist', body => {
    const nu = document.createElement('div'); nu.className = 'pw-sheet-row'; nu.innerHTML = `<div class="ic">➕</div><div style="font-weight:700">New playlist…</div>`;
    nu.addEventListener('click', async () => { closeSheet(); const name = prompt('Playlist name:'); if (!name || !name.trim()) return; const color = COLORS[Math.floor(Math.random() * COLORS.length)]; const { data: pl, error } = await S.client().from('music_playlists').insert({ user_id: me.id, name: name.trim(), color }).select().maybeSingle(); if (error || !pl) return toast('Could not create'); await addTrackToPlaylist(pl.id, track.id); });
    body.appendChild(nu);
    (pls || []).forEach(pl => { const row = document.createElement('div'); row.className = 'pw-sheet-row'; row.innerHTML = `<div class="ic" style="background:linear-gradient(135deg,${pl.color},#000)">💿</div><div style="font-weight:700">${esc(pl.name)}</div>`; row.addEventListener('click', () => addTrackToPlaylist(pl.id, track.id)); body.appendChild(row); });
    if (!pls || !pls.length) body.insertAdjacentHTML('beforeend', '<div class="pw-empty" style="padding:16px">No playlists yet — make one above.</div>');
  });
}
async function addTrackToPlaylist(playlistId, trackId) {
  const { error } = await S.client().from('music_playlist_tracks').insert({ playlist_id: playlistId, track_id: trackId, position: Date.now() % 100000 });
  closeSheet();
  toast(error ? (/(duplicate|unique)/i.test(error.message) ? 'Already in that playlist' : 'Could not add') : 'Added to playlist');
}
})();
