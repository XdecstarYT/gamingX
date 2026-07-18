/* ============================================================================
   PENFRANK — bootstrap: onboarding, feed (scroll/autoplay/like/comment/
   save/follow), upload, profile. All state lives in localStorage
   (metadata) + IndexedDB (video blobs, see db.js). No server involved.
   ========================================================================== */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PROFILE_KEY = 'gamingx.penfrank.profile';
const POSTS_KEY = 'gamingx.penfrank.posts';
const FOLLOWS_KEY = 'gamingx.penfrank.follows';
const AVATARS = ['🦊', '🐼', '🐸', '🐵', '🦄', '🐙', '🐧', '🐯', '👾', '🎭'];

function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function showToast(msg) {
  const t = $('pf-toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast._t); showToast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
function showScreen(id) {
  document.querySelectorAll('.pf-screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

/* ------------------------------------------------------------------ */
/* storage                                                              */
/* ------------------------------------------------------------------ */
function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { return null; } }
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) {} }
function loadPosts() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(POSTS_KEY) || 'null'); } catch (e) {}
  if (!stored) { stored = window.PFDemo.makePosts(); savePosts(stored); }
  return stored;
}
function savePosts(list) { try { localStorage.setItem(POSTS_KEY, JSON.stringify(list)); } catch (e) {} }
function loadFollows() { try { return JSON.parse(localStorage.getItem(FOLLOWS_KEY) || '{}'); } catch (e) { return {}; } }
function saveFollows(f) { try { localStorage.setItem(FOLLOWS_KEY, JSON.stringify(f)); } catch (e) {} }

let profile = loadProfile();
let posts = loadPosts();
let follows = loadFollows();
let lastMutePref = true;
let currentView = 'feed';      // 'feed' | 'upload' | 'profile'
let currentFeedTab = 'foryou'; // 'foryou' | 'following'
let feedObserver = null;
let currentCommentPostId = null;

/* ------------------------------------------------------------------ */
/* onboarding                                                           */
/* ------------------------------------------------------------------ */
let obAvatar = AVATARS[0];
function renderOnboardAvatars() {
  const wrap = $('ob-avatars'); wrap.innerHTML = '';
  for (const a of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pf-avatar-choice' + (a === obAvatar ? ' on' : ''); b.textContent = a;
    b.addEventListener('click', () => { obAvatar = a; renderOnboardAvatars(); });
    wrap.appendChild(b);
  }
}
$('btn-onboard-start').addEventListener('click', () => {
  const display = $('ob-name').value.trim() || ('guest' + Math.floor(Math.random() * 9000 + 1000));
  const handle = display.toLowerCase().replace(/[^a-z0-9]+/g, '') || ('guest' + Math.floor(Math.random() * 9000));
  profile = { display, handle, avatar: obAvatar, createdAt: Date.now() };
  saveProfile(profile);
  showScreen('screen-app');
  currentView = 'feed'; currentFeedTab = 'foryou';
  renderApp();
});

/* ------------------------------------------------------------------ */
/* top tabs / bottom nav                                               */
/* ------------------------------------------------------------------ */
document.querySelectorAll('.pf-toptab').forEach(b => b.addEventListener('click', () => {
  currentFeedTab = b.dataset.feed;
  document.querySelectorAll('.pf-toptab').forEach(x => x.classList.toggle('on', x === b));
  renderApp();
}));
document.querySelectorAll('.pf-nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
$('btn-goto-profile').addEventListener('click', () => switchView('profile'));

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
  body.innerHTML = '';
  if (currentView === 'feed') renderFeed(body);
  else if (currentView === 'upload') renderUpload(body);
  else renderProfile(body);
}

/* ------------------------------------------------------------------ */
/* feed                                                                 */
/* ------------------------------------------------------------------ */
function visiblePosts() {
  return currentFeedTab === 'following' ? posts.filter(p => p.mine) : posts.slice();
}

function renderFeed(body) {
  const list = visiblePosts();
  if (!list.length) {
    body.innerHTML = currentFeedTab === 'following'
      ? '<div class="pf-empty-note">You don\'t follow any real creators — there are none on this device. Your own uploads show up here. Tap <b>+</b> to post your first clip.</div>'
      : '<div class="pf-empty-note">No clips yet.</div>';
    return;
  }
  const scroll = document.createElement('div'); scroll.className = 'pf-feed-scroll'; scroll.id = 'pf-feed-scroll';
  for (const post of list) scroll.appendChild(buildCard(post));
  body.appendChild(scroll);
  feedObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) playCard(entry.target);
      else pauseCard(entry.target, true);
    }
  }, { root: scroll, threshold: [0, 0.6, 1] });
  scroll.querySelectorAll('.pf-card').forEach(c => feedObserver.observe(c));
}

function buildCard(post) {
  const card = document.createElement('div'); card.className = 'pf-card'; card.dataset.id = post.id;

  if (post.kind === 'demo') {
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 640;
    card.appendChild(canvas); card._canvas = canvas; card._style = post.demoStyle;
  } else {
    const video = document.createElement('video');
    video.loop = true; video.muted = lastMutePref; video.playsInline = true; video.preload = 'metadata';
    card.appendChild(video); card._video = video;
    window.PFDB.getBlob(post.id).then(blob => { if (blob) video.src = URL.createObjectURL(blob); }).catch(() => {});
    const muteBtn = document.createElement('button'); muteBtn.className = 'pf-mute-badge';
    muteBtn.textContent = lastMutePref ? '🔇' : '🔊';
    muteBtn.addEventListener('click', e => { e.stopPropagation(); toggleMute(card, muteBtn); });
    card.appendChild(muteBtn);
  }

  const grad = document.createElement('div'); grad.className = 'pf-card-gradient'; card.appendChild(grad);
  const pausedIcon = document.createElement('div'); pausedIcon.className = 'pf-paused-icon'; pausedIcon.textContent = '▶'; card.appendChild(pausedIcon);

  const info = document.createElement('div'); info.className = 'pf-card-info';
  info.innerHTML = `<div class="pf-card-user">${post.avatar} <b>${esc(post.username)}</b></div>
    <div class="pf-card-caption">${esc(post.caption)}</div>
    <div class="pf-card-tags">${post.tags.map(t => '<span>#' + esc(t) + '</span>').join('')}</div>`;
  card.appendChild(info);

  const actions = document.createElement('div'); actions.className = 'pf-actions';
  actions.innerHTML = `
    ${post.mine ? '' : `<button class="pf-action-btn pf-follow-btn${follows[post.demoStyle || post.id] ? ' following' : ''}" title="Follow">${post.avatar}</button>`}
    <button class="pf-action-btn pf-like-btn${post.likedByMe ? ' liked' : ''}">❤️<span class="pf-action-count">${fmtCount(post.likes)}</span></button>
    <button class="pf-action-btn pf-comment-btn">💬<span class="pf-action-count">${post.comments.length}</span></button>
    <button class="pf-action-btn pf-share-btn">↗️<span class="pf-action-count">Share</span></button>
    <button class="pf-action-btn pf-save-btn${post.saved ? ' liked' : ''}">🔖</button>`;
  card.appendChild(actions);

  const followBtn = actions.querySelector('.pf-follow-btn');
  if (followBtn) followBtn.addEventListener('click', e => { e.stopPropagation(); toggleFollow(post, followBtn); });
  actions.querySelector('.pf-like-btn').addEventListener('click', e => { e.stopPropagation(); toggleLike(post.id); });
  actions.querySelector('.pf-comment-btn').addEventListener('click', e => { e.stopPropagation(); openComments(post.id); });
  actions.querySelector('.pf-share-btn').addEventListener('click', e => { e.stopPropagation(); sharePost(post); });
  actions.querySelector('.pf-save-btn').addEventListener('click', e => { e.stopPropagation(); toggleSave(post.id); });

  let lastTap = 0;
  card.addEventListener('click', e => {
    if (e.target.closest('.pf-actions')) return;
    const now = Date.now();
    if (now - lastTap < 300) {
      heartBurst(card);
      if (!findPost(post.id).likedByMe) toggleLike(post.id);
    } else {
      togglePlay(card);
    }
    lastTap = now;
  });

  return card;
}

function findPost(id) { return posts.find(p => p.id === id); }

function playCard(card) {
  card.classList.remove('paused');
  if (card._video) card._video.play().catch(() => {});
  if (card._canvas) startCanvasLoop(card);
}
function pauseCard(card, fromObserver) {
  if (fromObserver) card.classList.remove('paused');
  if (card._video) card._video.pause();
  if (card._canvas) stopCanvasLoop(card);
}
function togglePlay(card) {
  const playing = card._video ? !card._video.paused : !!card._raf;
  if (playing) { pauseCard(card, false); card.classList.add('paused'); }
  else { card.classList.remove('paused'); if (card._video) card._video.play().catch(() => {}); if (card._canvas) startCanvasLoop(card); }
}
function startCanvasLoop(card) {
  if (card._raf) return;
  const ctx = card._canvas.getContext('2d');
  const draw = window.PFDemo.DRAW[card._style];
  const start = performance.now();
  function frame(now) {
    draw(ctx, card._canvas.width, card._canvas.height, (now - start) / 1000);
    card._raf = requestAnimationFrame(frame);
  }
  card._raf = requestAnimationFrame(frame);
}
function stopCanvasLoop(card) { if (card._raf) { cancelAnimationFrame(card._raf); card._raf = null; } }

function heartBurst(card) {
  const el = document.createElement('div'); el.className = 'pf-heart-burst'; el.textContent = '❤️';
  card.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

function toggleMute(card, btn) {
  if (!card._video) return;
  card._video.muted = !card._video.muted;
  lastMutePref = card._video.muted;
  btn.textContent = card._video.muted ? '🔇' : '🔊';
}

/* ------------------------------------------------------------------ */
/* actions: like / save / follow / comment / share                     */
/* ------------------------------------------------------------------ */
function updateCardStats(id) {
  const post = findPost(id); if (!post) return;
  const card = document.querySelector(`.pf-card[data-id="${CSS.escape(id)}"]`); if (!card) return;
  const likeBtn = card.querySelector('.pf-like-btn');
  likeBtn.classList.toggle('liked', post.likedByMe);
  likeBtn.querySelector('.pf-action-count').textContent = fmtCount(post.likes);
  card.querySelector('.pf-comment-btn .pf-action-count').textContent = post.comments.length;
  card.querySelector('.pf-save-btn').classList.toggle('liked', post.saved);
}

function toggleLike(id) {
  const post = findPost(id); if (!post) return;
  post.likedByMe = !post.likedByMe;
  post.likes += post.likedByMe ? 1 : -1;
  savePosts(posts);
  updateCardStats(id);
}
function toggleSave(id) {
  const post = findPost(id); if (!post) return;
  post.saved = !post.saved;
  savePosts(posts);
  updateCardStats(id);
  showToast(post.saved ? 'Saved' : 'Removed from saved');
}
function toggleFollow(post, btn) {
  const key = post.demoStyle || post.id;
  follows[key] = !follows[key];
  saveFollows(follows);
  btn.classList.toggle('following', follows[key]);
  showToast(follows[key] ? `Following ${post.username}` : `Unfollowed ${post.username}`);
}
function sharePost(post) {
  const text = `Check out ${post.username}'s Penfrank clip: "${post.caption}"`;
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard')).catch(() => showToast('Could not copy'));
  } else {
    showToast('Sharing not supported here');
  }
}

function openComments(id) {
  currentCommentPostId = id;
  renderComments();
  $('comment-overlay').classList.remove('hidden');
  $('comment-drawer').classList.add('open');
}
function closeComments() {
  $('comment-overlay').classList.add('hidden');
  $('comment-drawer').classList.remove('open');
  currentCommentPostId = null;
}
function renderComments() {
  const post = findPost(currentCommentPostId); if (!post) return;
  $('cd-count').textContent = post.comments.length;
  const list = $('cd-list'); list.innerHTML = '';
  if (!post.comments.length) {
    list.innerHTML = '<div class="pf-empty-note">No comments yet. Say something!</div>';
  } else {
    for (const c of post.comments) {
      const row = document.createElement('div'); row.className = 'pf-comment-row';
      row.innerHTML = `<span class="av">${esc(c.avatar)}</span><div><span class="user">${esc(c.user)}</span>${esc(c.text)}</div>`;
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }
}
$('comment-overlay').addEventListener('click', closeComments);
$('comment-drawer').querySelector('.pf-drawer-handle').addEventListener('click', closeComments);
$('cd-send').addEventListener('click', postComment);
$('cd-input').addEventListener('keydown', e => { if (e.key === 'Enter') postComment(); });
function postComment() {
  const input = $('cd-input');
  const text = input.value.trim();
  if (!text || !currentCommentPostId) return;
  const post = findPost(currentCommentPostId); if (!post) return;
  post.comments.push({ id: 'c' + Date.now().toString(36), user: '@' + profile.handle, avatar: profile.avatar, text, createdAt: Date.now() });
  savePosts(posts);
  input.value = '';
  renderComments();
  updateCardStats(post.id);
}

/* ------------------------------------------------------------------ */
/* upload                                                               */
/* ------------------------------------------------------------------ */
function renderUpload(body) {
  body.className = 'pf-main pf-panel-scroll';
  body.innerHTML = `<div class="pf-inner">
    <div class="pf-card2">
      <h2>Upload a clip</h2>
      <div class="sub">Pick a video from this device. It's saved only in this browser (IndexedDB) — never uploaded anywhere.</div>
      <input type="file" accept="video/*" id="up-file" class="pf-file-input">
      <div id="up-preview-wrap"></div>
      <div class="pf-field"><label>CAPTION</label><textarea id="up-caption" maxlength="150" rows="3" placeholder="Say something about this clip..."></textarea></div>
      <div class="pf-field"><label>HASHTAGS (space or comma separated)</label><input type="text" id="up-tags" placeholder="fyi funny loop"></div>
      <button id="up-post-btn" class="pf-btn pf-btn-primary" disabled>POST TO FEED</button>
    </div>
  </div>`;

  let pickedFile = null;
  $('up-file').addEventListener('change', e => {
    pickedFile = e.target.files[0] || null;
    const wrap = $('up-preview-wrap'); wrap.innerHTML = '';
    $('up-post-btn').disabled = !pickedFile;
    if (pickedFile) {
      const v = document.createElement('video'); v.controls = true; v.src = URL.createObjectURL(pickedFile);
      wrap.appendChild(v);
    }
  });

  $('up-post-btn').addEventListener('click', async () => {
    if (!pickedFile) return;
    const btn = $('up-post-btn'); btn.disabled = true; btn.textContent = 'POSTING…';
    const id = 'up-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    try { await window.PFDB.putBlob(id, pickedFile); } catch (e) { showToast('Could not save video'); btn.disabled = false; btn.textContent = 'POST TO FEED'; return; }
    const caption = $('up-caption').value.trim() || 'my new clip';
    const tags = $('up-tags').value.split(/[\s,]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
    const post = {
      id, kind: 'upload', username: '@' + profile.handle, avatar: profile.avatar,
      caption, tags, mine: true, createdAt: Date.now(), likes: 0, likedByMe: false, saved: false, comments: [],
    };
    posts.unshift(post);
    savePosts(posts);
    showToast('Posted!');
    switchView('feed'); currentFeedTab = 'foryou';
    document.querySelectorAll('.pf-toptab').forEach(x => x.classList.toggle('on', x.dataset.feed === 'foryou'));
    document.querySelectorAll('.pf-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === 'feed'));
    $('top-tabs').classList.remove('hidden');
  });
}

/* ------------------------------------------------------------------ */
/* profile                                                              */
/* ------------------------------------------------------------------ */
let profileTab = 'posts';
function renderProfile(body) {
  body.className = 'pf-main pf-panel-scroll';
  const mine = posts.filter(p => p.mine);
  const totalLikes = mine.reduce((s, p) => s + p.likes, 0);
  const followingCount = Object.values(follows).filter(Boolean).length;
  body.innerHTML = `<div class="pf-inner">
    <div class="pf-profile-head">
      <div class="pf-avatar-big">${profile.avatar}</div>
      <div class="pf-profile-name">${esc(profile.display)} <span style="color:var(--muted);font-weight:400">· @${esc(profile.handle)}</span></div>
      <div class="pf-profile-stats">
        <div><b>${mine.length}</b><span>POSTS</span></div>
        <div><b>${fmtCount(totalLikes)}</b><span>LIKES</span></div>
        <div><b>${followingCount}</b><span>FOLLOWING</span></div>
      </div>
      <button id="btn-edit-profile" class="pf-btn" style="max-width:200px;margin:0 auto">EDIT PROFILE</button>
      <div id="edit-profile-form"></div>
    </div>
    <div class="pf-profile-tabs">
      <button class="pf-ptab${profileTab === 'posts' ? ' on' : ''}" data-ptab="posts">Your Posts</button>
      <button class="pf-ptab${profileTab === 'saved' ? ' on' : ''}" data-ptab="saved">Saved</button>
    </div>
    <div class="pf-grid" id="profile-grid"></div>
  </div>`;

  body.querySelectorAll('.pf-ptab').forEach(b => b.addEventListener('click', () => {
    profileTab = b.dataset.ptab;
    body.querySelectorAll('.pf-ptab').forEach(x => x.classList.toggle('on', x === b));
    renderProfileGrid();
  }));
  $('btn-edit-profile').addEventListener('click', renderEditProfileForm);
  renderProfileGrid();
}

function renderEditProfileForm() {
  const wrap = $('edit-profile-form');
  if (wrap.dataset.open) { wrap.innerHTML = ''; wrap.dataset.open = ''; return; }
  wrap.dataset.open = '1';
  wrap.innerHTML = `<div class="pf-edit-form">
    <div class="pf-field"><label>DISPLAY NAME</label><input type="text" id="ep-name" maxlength="20" value="${esc(profile.display)}"></div>
    <div class="pf-field"><label>AVATAR</label><div class="pf-avatar-row" id="ep-avatars"></div></div>
    <button id="ep-save" class="pf-btn pf-btn-primary">SAVE</button>
  </div>`;
  let picked = profile.avatar;
  const avWrap = $('ep-avatars');
  function drawAv() {
    avWrap.innerHTML = '';
    for (const a of AVATARS) {
      const b = document.createElement('button'); b.type = 'button';
      b.className = 'pf-avatar-choice' + (a === picked ? ' on' : ''); b.textContent = a;
      b.addEventListener('click', () => { picked = a; drawAv(); });
      avWrap.appendChild(b);
    }
  }
  drawAv();
  $('ep-save').addEventListener('click', () => {
    const name = $('ep-name').value.trim() || profile.display;
    profile.display = name;
    profile.handle = name.toLowerCase().replace(/[^a-z0-9]+/g, '') || profile.handle;
    profile.avatar = picked;
    saveProfile(profile);
    renderProfile($('app-body'));
    showToast('Profile updated');
  });
}

function renderProfileGrid() {
  const grid = $('profile-grid'); grid.innerHTML = '';
  const list = profileTab === 'posts' ? posts.filter(p => p.mine) : posts.filter(p => p.saved);
  if (!list.length) {
    grid.innerHTML = `<div class="pf-empty-note">${profileTab === 'posts' ? 'No uploads yet — tap the + button to post your first clip.' : 'Nothing saved yet — tap the bookmark icon on any clip to save it here.'}</div>`;
    return;
  }
  for (const post of list) {
    const tile = document.createElement('div'); tile.className = 'pf-grid-tile';
    if (post.kind === 'demo') {
      const c = document.createElement('canvas'); c.width = 180; c.height = 320; tile.appendChild(c);
      window.PFDemo.DRAW[post.demoStyle](c.getContext('2d'), 180, 320, 1.2);
    } else {
      const v = document.createElement('video'); v.muted = true; v.preload = 'metadata'; tile.appendChild(v);
      window.PFDB.getBlob(post.id).then(b => { if (b) v.src = URL.createObjectURL(b); }).catch(() => {});
    }
    const cap = document.createElement('div'); cap.className = 'pf-grid-cap'; cap.textContent = '❤️ ' + fmtCount(post.likes);
    tile.appendChild(cap);
    if (post.mine) {
      const del = document.createElement('button'); del.className = 'pf-grid-del'; del.textContent = '✕';
      del.addEventListener('click', e => { e.stopPropagation(); if (confirm('Delete this post?')) deletePost(post.id); });
      tile.appendChild(del);
    }
    tile.addEventListener('click', () => {
      currentFeedTab = post.mine ? 'following' : 'foryou';
      switchView('feed');
      document.querySelectorAll('.pf-toptab').forEach(x => x.classList.toggle('on', x.dataset.feed === currentFeedTab));
      $('top-tabs').classList.remove('hidden');
      document.querySelectorAll('.pf-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === 'feed'));
      setTimeout(() => {
        const card = document.querySelector(`.pf-card[data-id="${CSS.escape(post.id)}"]`);
        if (card) card.scrollIntoView();
      }, 60);
    });
    grid.appendChild(tile);
  }
}

function deletePost(id) {
  const post = findPost(id); if (!post) return;
  posts = posts.filter(p => p.id !== id);
  savePosts(posts);
  if (post.kind === 'upload') window.PFDB.deleteBlob(id).catch(() => {});
  renderApp();
}

/* ------------------------------------------------------------------ */
/* boot                                                                 */
/* ------------------------------------------------------------------ */
if (profile) {
  showScreen('screen-app');
  renderApp();
} else {
  renderOnboardAvatars();
  showScreen('screen-onboard');
}
})();
