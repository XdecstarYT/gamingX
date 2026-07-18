/* ============================================================================
   PENFRANK v2 — short-video feed backed by the GamingX cloud (Supabase).
   Real accounts, real uploads, everyone sees everyone's clips. Demo clips
   (storage_path "demo:<style>") render as canvas animations from
   demo-content.js so the feed is never empty.
   ========================================================================== */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = window.GXSocial;

let me = null;
let currentView = 'feed';
let currentFeedTab = 'foryou';
let feedObserver = null;
let currentCommentVideoId = null;
let lastMutePref = true;

function fmtCount(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function showToast(msg) {
  const t = $('pf-toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast._t); showToast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
function isDemo(v) { return typeof v.storage_path === 'string' && v.storage_path.indexOf('demo:') === 0; }
function demoStyle(v) { return v.storage_path.slice(5); }

/* ------------------------------------------------------------------ */
/* boot via shared GamingX auth gate                                   */
/* ------------------------------------------------------------------ */
S.mountAuthGate({
  appName: 'Penfrank', emoji: '📱', accent: '#ff5470', accent2: '#2dd4bf',
  tagline: 'Your short-video feed. Upload clips, scroll, like, follow.',
  onAuthed: start,
});

function start(profile) {
  me = profile;
  $('screen-app').classList.add('active');
  document.querySelectorAll('.pf-toptab').forEach(b => b.addEventListener('click', () => {
    currentFeedTab = b.dataset.feed;
    document.querySelectorAll('.pf-toptab').forEach(x => x.classList.toggle('on', x === b));
    renderApp();
  }));
  document.querySelectorAll('.pf-nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('btn-goto-profile').addEventListener('click', () => switchView('profile'));
  $('comment-overlay').addEventListener('click', closeComments);
  $('comment-drawer').querySelector('.pf-drawer-handle').addEventListener('click', closeComments);
  $('cd-send').addEventListener('click', postComment);
  $('cd-input').addEventListener('keydown', e => { if (e.key === 'Enter') postComment(); });
  renderApp();
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.pf-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $('top-tabs').classList.toggle('hidden', view !== 'feed');
  renderApp();
}
function renderApp() {
  if (feedObserver) { feedObserver.disconnect(); feedObserver = null; }
  const body = $('app-body');
  body.className = 'pf-main';
  body.innerHTML = '<div class="pf-empty-note">Loading…</div>';
  if (currentView === 'feed') renderFeed(body);
  else if (currentView === 'upload') renderUpload(body);
  else renderProfile(body);
}

/* ------------------------------------------------------------------ */
/* feed                                                                 */
/* ------------------------------------------------------------------ */
async function fetchVideos() {
  const c = S.client();
  let q = c.from('pf_videos')
    .select('id,user_id,storage_path,caption,tags,created_at,profiles(username,avatar,display_name),pf_likes(count),pf_comments(count)')
    .order('created_at', { ascending: false }).limit(60);
  if (currentFeedTab === 'following') {
    const ids = await S.followingIds();
    if (!ids.length) return { rows: [], likedSet: new Set(), noFollows: true };
    q = q.in('user_id', ids);
  }
  const { data: rows, error } = await q;
  if (error) throw error;
  const vids = rows || [];
  let likedSet = new Set();
  if (vids.length) {
    const { data: myLikes } = await c.from('pf_likes').select('video_id').eq('user_id', me.id).in('video_id', vids.map(v => v.id));
    likedSet = new Set((myLikes || []).map(l => l.video_id));
  }
  return { rows: vids, likedSet, noFollows: false };
}

async function renderFeed(body) {
  let data;
  try { data = await fetchVideos(); }
  catch (e) { body.innerHTML = `<div class="pf-empty-note">Couldn't load the feed.<br><small>${esc(e.message)}</small></div>`; return; }
  body.innerHTML = '';
  if (!data.rows.length) {
    body.innerHTML = data.noFollows
      ? '<div class="pf-empty-note">You\'re not following anyone yet. Find creators in the <b>For You</b> feed and tap their avatar to follow.</div>'
      : '<div class="pf-empty-note">No clips yet — be the first! Tap <b>+</b> to post one.</div>';
    return;
  }
  const scroll = document.createElement('div'); scroll.className = 'pf-feed-scroll'; scroll.id = 'pf-feed-scroll';
  for (const v of data.rows) scroll.appendChild(buildCard(v, data.likedSet.has(v.id)));
  body.appendChild(scroll);
  feedObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) playCard(entry.target);
      else pauseCard(entry.target, true);
    }
  }, { root: scroll, threshold: [0, 0.6, 1] });
  scroll.querySelectorAll('.pf-card').forEach(c => feedObserver.observe(c));
}

function buildCard(v, likedByMe) {
  const author = v.profiles || { username: 'unknown', avatar: '❓', display_name: 'unknown' };
  const likeCount = (v.pf_likes && v.pf_likes[0] && v.pf_likes[0].count) || 0;
  const commentCount = (v.pf_comments && v.pf_comments[0] && v.pf_comments[0].count) || 0;
  const mine = v.user_id === me.id;

  const card = document.createElement('div'); card.className = 'pf-card'; card.dataset.id = v.id;
  card._video = null; card._likeCount = likeCount; card._liked = likedByMe;

  if (isDemo(v)) {
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 640;
    card.appendChild(canvas); card._canvas = canvas; card._style = demoStyle(v);
  } else {
    const video = document.createElement('video');
    video.loop = true; video.muted = lastMutePref; video.playsInline = true; video.preload = 'metadata';
    video.src = S.publicUrl('videos', v.storage_path);
    card.appendChild(video); card._video = video;
    const muteBtn = document.createElement('button'); muteBtn.className = 'pf-mute-badge'; muteBtn.textContent = lastMutePref ? '🔇' : '🔊';
    muteBtn.addEventListener('click', e => { e.stopPropagation(); video.muted = !video.muted; lastMutePref = video.muted; muteBtn.textContent = video.muted ? '🔇' : '🔊'; });
    card.appendChild(muteBtn);
  }

  const grad = document.createElement('div'); grad.className = 'pf-card-gradient'; card.appendChild(grad);
  const pausedIcon = document.createElement('div'); pausedIcon.className = 'pf-paused-icon'; pausedIcon.textContent = '▶'; card.appendChild(pausedIcon);

  const info = document.createElement('div'); info.className = 'pf-card-info';
  info.innerHTML = `<div class="pf-card-user">${esc(author.avatar)} <b>@${esc(author.username)}</b></div>
    <div class="pf-card-caption">${esc(v.caption)}</div>
    <div class="pf-card-tags">${(v.tags || []).map(t => '<span>#' + esc(t) + '</span>').join('')}</div>`;
  card.appendChild(info);

  const actions = document.createElement('div'); actions.className = 'pf-actions';
  actions.innerHTML = `
    ${mine ? '' : `<button class="pf-action-btn pf-follow-btn" data-uid="${esc(v.user_id)}" title="Follow">${esc(author.avatar)}</button>`}
    <button class="pf-action-btn pf-like-btn${likedByMe ? ' liked' : ''}">❤️<span class="pf-action-count">${fmtCount(likeCount)}</span></button>
    <button class="pf-action-btn pf-comment-btn">💬<span class="pf-action-count">${commentCount}</span></button>
    <button class="pf-action-btn pf-share-btn">↗️<span class="pf-action-count">Share</span></button>`;
  card.appendChild(actions);

  const followBtn = actions.querySelector('.pf-follow-btn');
  if (followBtn) {
    S.isFollowing(v.user_id).then(f => followBtn.classList.toggle('following', f));
    followBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const on = followBtn.classList.contains('following');
      try { on ? await S.unfollow(v.user_id) : await S.follow(v.user_id); followBtn.classList.toggle('following', !on); showToast(on ? 'Unfollowed' : 'Following @' + author.username); }
      catch (err) { showToast('Could not update follow'); }
    });
  }
  actions.querySelector('.pf-like-btn').addEventListener('click', e => { e.stopPropagation(); toggleLike(card, v); });
  actions.querySelector('.pf-comment-btn').addEventListener('click', e => { e.stopPropagation(); openComments(v.id); });
  actions.querySelector('.pf-share-btn').addEventListener('click', e => { e.stopPropagation(); sharePost(v, author); });

  let lastTap = 0;
  card.addEventListener('click', e => {
    if (e.target.closest('.pf-actions')) return;
    const now = Date.now();
    if (now - lastTap < 300) { heartBurst(card); if (!card._liked) toggleLike(card, v); }
    else togglePlay(card);
    lastTap = now;
  });
  return card;
}

function playCard(card) { card.classList.remove('paused'); if (card._video) card._video.play().catch(() => {}); if (card._canvas) startCanvasLoop(card); }
function pauseCard(card, fromObs) { if (fromObs) card.classList.remove('paused'); if (card._video) card._video.pause(); if (card._canvas) stopCanvasLoop(card); }
function togglePlay(card) {
  const playing = card._video ? !card._video.paused : !!card._raf;
  if (playing) { pauseCard(card, false); card.classList.add('paused'); }
  else { card.classList.remove('paused'); if (card._video) card._video.play().catch(() => {}); if (card._canvas) startCanvasLoop(card); }
}
function startCanvasLoop(card) {
  if (card._raf) return;
  const ctx = card._canvas.getContext('2d');
  const draw = window.PFDemo.DRAW[card._style];
  if (!draw) return;
  const start0 = performance.now();
  function frame(now) { draw(ctx, card._canvas.width, card._canvas.height, (now - start0) / 1000); card._raf = requestAnimationFrame(frame); }
  card._raf = requestAnimationFrame(frame);
}
function stopCanvasLoop(card) { if (card._raf) { cancelAnimationFrame(card._raf); card._raf = null; } }
function heartBurst(card) { const el = document.createElement('div'); el.className = 'pf-heart-burst'; el.textContent = '❤️'; card.appendChild(el); setTimeout(() => el.remove(), 700); }

async function toggleLike(card, v) {
  const c = S.client();
  const willLike = !card._liked;
  card._liked = willLike;
  card._likeCount += willLike ? 1 : -1;
  const btn = card.querySelector('.pf-like-btn');
  btn.classList.toggle('liked', willLike);
  btn.querySelector('.pf-action-count').textContent = fmtCount(card._likeCount);
  try {
    if (willLike) await c.from('pf_likes').insert({ video_id: v.id, user_id: me.id });
    else await c.from('pf_likes').delete().eq('video_id', v.id).eq('user_id', me.id);
  } catch (e) { /* revert on failure */ card._liked = !willLike; card._likeCount += willLike ? -1 : 1; btn.classList.toggle('liked', !willLike); btn.querySelector('.pf-action-count').textContent = fmtCount(card._likeCount); }
}

function sharePost(v, author) {
  const text = `Check out @${author.username}'s Penfrank clip: "${v.caption}"`;
  if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard')).catch(() => showToast('Could not copy'));
  else showToast('Sharing not supported here');
}

/* comments */
async function openComments(videoId) {
  currentCommentVideoId = videoId;
  $('comment-overlay').classList.remove('hidden');
  $('comment-drawer').classList.add('open');
  $('cd-list').innerHTML = '<div class="pf-empty-note">Loading…</div>';
  await renderComments();
}
function closeComments() { $('comment-overlay').classList.add('hidden'); $('comment-drawer').classList.remove('open'); currentCommentVideoId = null; }
async function renderComments() {
  const { data } = await S.client().from('pf_comments').select('id,text,created_at,profiles(username,avatar)').eq('video_id', currentCommentVideoId).order('created_at', { ascending: true });
  const list = $('cd-list'); $('cd-count').textContent = (data || []).length;
  if (!data || !data.length) { list.innerHTML = '<div class="pf-empty-note">No comments yet. Say something!</div>'; return; }
  list.innerHTML = '';
  for (const c of data) {
    const a = c.profiles || { username: '?', avatar: '❓' };
    const row = document.createElement('div'); row.className = 'pf-comment-row';
    row.innerHTML = `<span class="av">${esc(a.avatar)}</span><div><span class="user">@${esc(a.username)}</span>${esc(c.text)}</div>`;
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}
async function postComment() {
  const input = $('cd-input'); const text = input.value.trim();
  if (!text || !currentCommentVideoId) return;
  input.value = '';
  try {
    await S.client().from('pf_comments').insert({ video_id: currentCommentVideoId, user_id: me.id, text });
    await renderComments();
    const card = document.querySelector(`.pf-card[data-id="${CSS.escape(currentCommentVideoId)}"]`);
    if (card) { const el = card.querySelector('.pf-comment-btn .pf-action-count'); el.textContent = (parseInt(el.textContent, 10) || 0) + 1; }
  } catch (e) { showToast('Could not post comment'); }
}

/* ------------------------------------------------------------------ */
/* upload                                                               */
/* ------------------------------------------------------------------ */
function renderUpload(body) {
  body.className = 'pf-main pf-panel-scroll';
  body.innerHTML = `<div class="pf-inner">
    <div class="pf-card2">
      <h2>Upload a clip</h2>
      <div class="sub">Pick a video (up to 50MB). It uploads to the GamingX cloud and appears in everyone's For You feed.</div>
      <input type="file" accept="video/*" id="up-file" class="pf-file-input">
      <div id="up-preview-wrap"></div>
      <div class="pf-field"><label>CAPTION</label><textarea id="up-caption" maxlength="150" rows="3" placeholder="Say something about this clip..."></textarea></div>
      <div class="pf-field"><label>HASHTAGS (space or comma separated)</label><input type="text" id="up-tags" placeholder="fyp funny loop"></div>
      <button id="up-post-btn" class="pf-btn pf-btn-primary" disabled>POST TO FEED</button>
    </div>
  </div>`;
  let pickedFile = null;
  $('up-file').addEventListener('change', e => {
    pickedFile = e.target.files[0] || null;
    const wrap = $('up-preview-wrap'); wrap.innerHTML = '';
    $('up-post-btn').disabled = !pickedFile;
    if (pickedFile) { const v = document.createElement('video'); v.controls = true; v.src = URL.createObjectURL(pickedFile); wrap.appendChild(v); }
  });
  $('up-post-btn').addEventListener('click', async () => {
    if (!pickedFile) return;
    const btn = $('up-post-btn'); btn.disabled = true; btn.textContent = 'UPLOADING…';
    try {
      const ext = (pickedFile.name.split('.').pop() || 'mp4').toLowerCase();
      const path = await S.uploadFile('videos', pickedFile, ext);
      const caption = $('up-caption').value.trim() || 'my new clip';
      const tags = $('up-tags').value.split(/[\s,]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
      await S.client().from('pf_videos').insert({ user_id: me.id, storage_path: path, caption, tags });
      showToast('Posted!');
      currentFeedTab = 'foryou';
      document.querySelectorAll('.pf-toptab').forEach(x => x.classList.toggle('on', x.dataset.feed === 'foryou'));
      switchView('feed');
    } catch (e) {
      showToast('Upload failed: ' + (e.message || 'error'));
      btn.disabled = false; btn.textContent = 'POST TO FEED';
    }
  });
}

/* ------------------------------------------------------------------ */
/* profile                                                              */
/* ------------------------------------------------------------------ */
let profileTab = 'posts';
async function renderProfile(body) {
  body.className = 'pf-main pf-panel-scroll';
  const counts = await S.followCounts(me.id).catch(() => ({ followers: 0, following: 0 }));
  const { data: myVids } = await S.client().from('pf_videos').select('id,storage_path,caption,pf_likes(count)').eq('user_id', me.id).order('created_at', { ascending: false });
  const vids = myVids || [];
  const totalLikes = vids.reduce((s, v) => s + ((v.pf_likes && v.pf_likes[0] && v.pf_likes[0].count) || 0), 0);
  body.innerHTML = `<div class="pf-inner">
    <div class="pf-profile-head">
      <div class="pf-avatar-big">${esc(me.avatar)}</div>
      <div class="pf-profile-name">${esc(me.display_name)} <span style="color:var(--muted);font-weight:400">· @${esc(me.username)}</span></div>
      ${me.bio ? `<div style="color:var(--muted);font-size:.82rem;margin-bottom:12px">${esc(me.bio)}</div>` : ''}
      <div class="pf-profile-stats">
        <div><b>${vids.length}</b><span>POSTS</span></div>
        <div><b>${fmtCount(totalLikes)}</b><span>LIKES</span></div>
        <div><b>${counts.followers}</b><span>FOLLOWERS</span></div>
        <div><b>${counts.following}</b><span>FOLLOWING</span></div>
      </div>
      <button id="btn-edit-profile" class="pf-btn" style="max-width:200px;margin:0 auto 4px">EDIT PROFILE</button>
      <button id="btn-logout" class="pf-btn" style="max-width:200px;margin:0 auto;color:#f87171">LOG OUT</button>
      <div id="edit-profile-form"></div>
    </div>
    <div class="pf-grid" id="profile-grid"></div>
  </div>`;
  $('btn-edit-profile').addEventListener('click', renderEditProfileForm);
  $('btn-logout').addEventListener('click', async () => { await S.signOut(); location.reload(); });
  const grid = $('profile-grid');
  if (!vids.length) { grid.innerHTML = '<div class="pf-empty-note">No uploads yet — tap the + button to post your first clip.</div>'; return; }
  for (const v of vids) {
    const tile = document.createElement('div'); tile.className = 'pf-grid-tile';
    if (isDemo(v)) { const c = document.createElement('canvas'); c.width = 180; c.height = 320; tile.appendChild(c); window.PFDemo.DRAW[demoStyle(v)](c.getContext('2d'), 180, 320, 1.2); }
    else { const el = document.createElement('video'); el.muted = true; el.preload = 'metadata'; el.src = S.publicUrl('videos', v.storage_path); tile.appendChild(el); }
    const cap = document.createElement('div'); cap.className = 'pf-grid-cap'; cap.textContent = '❤️ ' + fmtCount((v.pf_likes && v.pf_likes[0] && v.pf_likes[0].count) || 0);
    tile.appendChild(cap);
    const del = document.createElement('button'); del.className = 'pf-grid-del'; del.textContent = '✕';
    del.addEventListener('click', async e => { e.stopPropagation(); if (!confirm('Delete this post?')) return; await S.client().from('pf_videos').delete().eq('id', v.id); if (!isDemo(v)) S.removeFile('videos', v.storage_path); renderApp(); });
    tile.appendChild(del);
    grid.appendChild(tile);
  }
}

function renderEditProfileForm() {
  const wrap = $('edit-profile-form');
  if (wrap.dataset.open) { wrap.innerHTML = ''; wrap.dataset.open = ''; return; }
  wrap.dataset.open = '1';
  wrap.innerHTML = `<div class="pf-edit-form">
    <div class="pf-field"><label>DISPLAY NAME</label><input type="text" id="ep-name" maxlength="24" value="${esc(me.display_name)}"></div>
    <div class="pf-field"><label>BIO</label><input type="text" id="ep-bio" maxlength="120" value="${esc(me.bio)}" placeholder="a short bio"></div>
    <div class="pf-field"><label>AVATAR</label><div class="pf-avatar-row" id="ep-avatars"></div></div>
    <button id="ep-save" class="pf-btn pf-btn-primary">SAVE</button>
  </div>`;
  let picked = me.avatar;
  const avWrap = $('ep-avatars');
  function drawAv() { avWrap.innerHTML = ''; for (const a of S.AVATARS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'pf-avatar-choice' + (a === picked ? ' on' : ''); b.textContent = a; b.addEventListener('click', () => { picked = a; drawAv(); }); avWrap.appendChild(b); } }
  drawAv();
  $('ep-save').addEventListener('click', async () => {
    try { me = await S.updateProfile({ display_name: $('ep-name').value.trim() || me.username, bio: $('ep-bio').value.trim(), avatar: picked }); showToast('Profile updated'); renderApp(); }
    catch (e) { showToast('Could not save'); }
  });
}
})();
