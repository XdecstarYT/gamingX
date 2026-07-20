/* ============================================================================
   PENSHARE — a microblog (Twitter-style) on the GamingX cloud.
   Text + image posts, For-You / Following feeds, threaded replies, likes,
   follows, search and profiles. Shares one GamingX account with Penfrank
   and PenTalk.
   ========================================================================== */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = window.GXSocial;
const MAX = 280;

let me = null;
let currentView = 'home';
let homeTab = 'foryou';

function fmt(n) { n = n || 0; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return String(n); }
function ago(ts) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return s + 's'; if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h'; if (s < 604800) return Math.floor(s / 86400) + 'd';
  return new Date(ts).toLocaleDateString();
}
function toast(m) { const t = $('ps-toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800); }

S.mountAuthGate({
  appName: 'PenShare', emoji: '🖊️', accent: '#1d9bf0', accent2: '#8b5cf6',
  tagline: 'Say something. Follow people. See what everyone shares.',
  onAuthed: start,
});

function start(profile) {
  me = profile;
  $('screen-app').classList.add('active');
  document.querySelectorAll('.ps-nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('btn-profile').addEventListener('click', () => switchView('profile'));
  S.startCommonNotifications(me);
  renderApp();
}
function switchView(v) {
  if (v === 'compose') { openCompose(); return; }
  currentView = v;
  document.querySelectorAll('.ps-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  renderApp();
}
function renderApp() {
  const body = $('app-body'); body.innerHTML = '<div class="ps-empty-note">Loading…</div>';
  if (currentView === 'home') renderHome(body);
  else if (currentView === 'search') renderSearch(body);
  else renderProfile(body);
}

/* ------------------------------------------------------------------ */
/* shared post rendering                                                */
/* ------------------------------------------------------------------ */
async function likedSetFor(ids) {
  if (!ids.length) return new Set();
  const { data } = await S.client().from('ps_likes').select('post_id').eq('user_id', me.id).in('post_id', ids);
  return new Set((data || []).map(l => l.post_id));
}
async function replyCountsFor(ids) {
  const map = {};
  if (!ids.length) return map;
  const { data } = await S.client().from('ps_posts').select('reply_to').in('reply_to', ids);
  for (const r of (data || [])) map[r.reply_to] = (map[r.reply_to] || 0) + 1;
  return map;
}

function postEl(p, likedByMe, replyCount, opts) {
  opts = opts || {};
  const a = p.profiles || { username: 'unknown', avatar: '❓', display_name: 'unknown' };
  const likeCount = (p.ps_likes && p.ps_likes[0] && p.ps_likes[0].count) || 0;
  const el = document.createElement('div'); el.className = 'ps-post'; el.dataset.id = p.id;
  el.innerHTML = `
    <div class="ps-avatar">${esc(a.avatar)}</div>
    <div class="ps-post-body">
      <div class="ps-post-head"><span class="name">${esc(a.display_name)}</span><span class="handle">@${esc(a.username)}</span><span class="time">· ${ago(p.created_at)}</span></div>
      <div class="ps-post-text">${esc(p.text)}</div>
      ${p.image_path ? `<img class="ps-post-img" src="${esc(S.publicUrl('images', p.image_path))}" alt="">` : ''}
      <div class="ps-post-actions">
        <button class="reply">💬 <span>${replyCount || 0}</span></button>
        <button class="like${likedByMe ? ' on' : ''}">${likedByMe ? '❤️' : '🤍'} <span>${fmt(likeCount)}</span></button>
        <button class="share">↗️</button>
        ${p.user_id === me.id ? '<button class="del">🗑️</button>' : ''}
      </div>
    </div>`;
  el._likeCount = likeCount; el._liked = likedByMe;
  el.querySelector('.like').addEventListener('click', e => { e.stopPropagation(); toggleLike(el, p); });
  el.querySelector('.reply').addEventListener('click', e => { e.stopPropagation(); openThread(p.id); });
  el.querySelector('.share').addEventListener('click', e => { e.stopPropagation(); sharePost(p, a); });
  const del = el.querySelector('.del');
  if (del) del.addEventListener('click', async e => { e.stopPropagation(); if (!confirm('Delete this post?')) return; await S.client().from('ps_posts').delete().eq('id', p.id); if (p.image_path) S.removeFile('images', p.image_path); if (opts.onDelete) opts.onDelete(); });
  if (!opts.noNavigate) el.addEventListener('click', () => openThread(p.id));
  return el;
}

async function toggleLike(el, p) {
  const c = S.client(); const will = !el._liked;
  el._liked = will; el._likeCount += will ? 1 : -1;
  const btn = el.querySelector('.like'); btn.classList.toggle('on', will);
  btn.innerHTML = `${will ? '❤️' : '🤍'} <span>${fmt(el._likeCount)}</span>`;
  try { if (will) await c.from('ps_likes').insert({ post_id: p.id, user_id: me.id }); else await c.from('ps_likes').delete().eq('post_id', p.id).eq('user_id', me.id); }
  catch (e) { el._liked = !will; el._likeCount += will ? -1 : 1; btn.classList.toggle('on', !will); btn.innerHTML = `${!will ? '❤️' : '🤍'} <span>${fmt(el._likeCount)}</span>`; }
}
async function sharePost(p, a) {
  const text = `@${a.username} on PenShare: "${p.text}"`;
  if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
  const r = window.GXCopy ? await window.GXCopy.copy(text) : { ok: false };
  toast(r.ok ? 'Copied to clipboard' : 'Could not copy');
}

/* ------------------------------------------------------------------ */
/* home feed                                                            */
/* ------------------------------------------------------------------ */
async function renderHome(body) {
  const inner = document.createElement('div'); inner.className = 'ps-inner';
  inner.innerHTML = `<div class="ps-feed-tabs">
    <button class="ps-feed-tab${homeTab === 'foryou' ? ' on' : ''}" data-t="foryou">For you</button>
    <button class="ps-feed-tab${homeTab === 'following' ? ' on' : ''}" data-t="following">Following</button>
  </div>
  <div class="ps-compose-card" id="inline-compose">
    <div class="ps-avatar sm">${esc(me.avatar)}</div>
    <div style="flex:1">
      <textarea id="ic-text" maxlength="${MAX}" placeholder="What's happening?"></textarea>
      <div id="ic-imgwrap"></div>
      <div class="ps-compose-bar">
        <div class="ps-compose-tools"><label style="cursor:pointer">🖼️<input type="file" accept="image/*" id="ic-file" hidden></label></div>
        <div style="display:flex;align-items:center"><span class="ps-char" id="ic-char">${MAX}</span><button class="ps-btn" id="ic-post" disabled>Post</button></div>
      </div>
    </div>
  </div>
  <div id="feed-list"></div>`;
  body.innerHTML = ''; body.appendChild(inner);

  inner.querySelectorAll('.ps-feed-tab').forEach(t => t.addEventListener('click', () => { homeTab = t.dataset.t; renderApp(); }));
  wireInlineCompose(inner);

  const list = $('feed-list'); list.innerHTML = '<div class="ps-empty-note">Loading…</div>';
  let q = S.client().from('ps_posts')
    .select('id,text,image_path,created_at,user_id,profiles!ps_posts_user_id_fkey(username,avatar,display_name),ps_likes(count)')
    .is('reply_to', null).order('created_at', { ascending: false }).limit(60);
  if (homeTab === 'following') {
    const ids = await S.followingIds();
    if (!ids.length) { list.innerHTML = '<div class="ps-empty-note">You\'re not following anyone yet.<br>Use <b>Search</b> to find people to follow.</div>'; return; }
    q = q.in('user_id', ids);
  }
  const { data: posts, error } = await q;
  if (error) { list.innerHTML = `<div class="ps-empty-note">Couldn't load feed.<br><small>${esc(error.message)}</small></div>`; return; }
  if (!posts.length) { list.innerHTML = '<div class="ps-empty-note">Nothing here yet — be the first to post!</div>'; return; }
  const ids = posts.map(p => p.id);
  const [likedSet, replyCounts] = await Promise.all([likedSetFor(ids), replyCountsFor(ids)]);
  list.innerHTML = '';
  for (const p of posts) list.appendChild(postEl(p, likedSet.has(p.id), replyCounts[p.id], { onDelete: renderApp }));
}

function wireInlineCompose(root) {
  let img = null;
  const ta = root.querySelector('#ic-text'), char = root.querySelector('#ic-char'), btn = root.querySelector('#ic-post'), imgwrap = root.querySelector('#ic-imgwrap');
  const upd = () => { const n = MAX - ta.value.length; char.textContent = n; char.className = 'ps-char' + (n < 0 ? ' over' : n < 20 ? ' warn' : ''); btn.disabled = (!ta.value.trim() && !img) || n < 0; };
  ta.addEventListener('input', upd);
  root.querySelector('#ic-file').addEventListener('change', e => {
    img = e.target.files[0] || null; imgwrap.innerHTML = '';
    if (img) { const d = document.createElement('div'); d.className = 'ps-img-preview'; const im = document.createElement('img'); im.src = URL.createObjectURL(img); const x = document.createElement('button'); x.textContent = '✕'; x.onclick = () => { img = null; imgwrap.innerHTML = ''; upd(); }; d.appendChild(im); d.appendChild(x); imgwrap.appendChild(d); }
    upd();
  });
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Posting…';
    try {
      let image_path = null;
      if (img) { const ext = (img.name.split('.').pop() || 'jpg').toLowerCase(); image_path = await S.uploadFile('images', img, ext); }
      await S.client().from('ps_posts').insert({ user_id: me.id, text: ta.value.trim(), image_path });
      toast('Posted!'); renderApp();
    } catch (e) { toast('Post failed: ' + (e.message || 'error')); btn.disabled = false; btn.textContent = 'Post'; }
  });
  upd();
}

/* full-screen compose (from the FAB) just focuses the inline composer */
function openCompose() { currentView = 'home'; document.querySelectorAll('.ps-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === 'home')); renderApp(); setTimeout(() => { const t = $('ic-text'); if (t) t.focus(); }, 60); }

/* ------------------------------------------------------------------ */
/* thread view                                                          */
/* ------------------------------------------------------------------ */
async function openThread(postId) {
  const ov = $('thread-overlay'); ov.classList.remove('hidden');
  ov.innerHTML = `<div class="ps-thread-head"><button id="th-back" style="font-size:1.1rem">←</button> Thread</div><div class="ps-thread-scroll" id="th-scroll"><div class="ps-empty-note">Loading…</div></div>`;
  $('th-back').addEventListener('click', () => { ov.classList.add('hidden'); ov.innerHTML = ''; });

  const c = S.client();
  const { data: post } = await c.from('ps_posts').select('id,text,image_path,created_at,user_id,profiles!ps_posts_user_id_fkey(username,avatar,display_name),ps_likes(count)').eq('id', postId).maybeSingle();
  if (!post) { $('th-scroll').innerHTML = '<div class="ps-empty-note">This post was deleted.</div>'; return; }
  const { data: replies } = await c.from('ps_posts').select('id,text,image_path,created_at,user_id,profiles!ps_posts_user_id_fkey(username,avatar,display_name),ps_likes(count)').eq('reply_to', postId).order('created_at', { ascending: true });
  const ids = [post.id].concat((replies || []).map(r => r.id));
  const [likedSet, replyCounts] = await Promise.all([likedSetFor(ids), replyCountsFor(ids)]);

  const scroll = $('th-scroll'); scroll.innerHTML = '';
  const main = postEl(post, likedSet.has(post.id), replyCounts[post.id], { noNavigate: true, onDelete: () => { ov.classList.add('hidden'); ov.innerHTML = ''; renderApp(); } });
  main.classList.add('ps-thread-main'); scroll.appendChild(main);
  const lbl = document.createElement('div'); lbl.className = 'ps-replies-label'; lbl.textContent = (replies || []).length ? 'Replies' : 'No replies yet — be the first.'; scroll.appendChild(lbl);
  for (const r of (replies || [])) scroll.appendChild(postEl(r, likedSet.has(r.id), replyCounts[r.id], { noNavigate: true, onDelete: () => openThread(postId) }));

  const bar = document.createElement('div'); bar.className = 'ps-thread-reply-bar';
  bar.innerHTML = `<div class="ps-avatar sm">${esc(me.avatar)}</div><textarea id="th-reply" rows="1" maxlength="${MAX}" placeholder="Post your reply"></textarea><button class="ps-btn" id="th-send">Reply</button>`;
  ov.appendChild(bar);
  $('th-send').addEventListener('click', async () => {
    const txt = $('th-reply').value.trim(); if (!txt) return;
    const b = $('th-send'); b.disabled = true;
    try { await c.from('ps_posts').insert({ user_id: me.id, text: txt, reply_to: postId }); openThread(postId); }
    catch (e) { toast('Reply failed'); b.disabled = false; }
  });
}

/* ------------------------------------------------------------------ */
/* search                                                               */
/* ------------------------------------------------------------------ */
function renderSearch(body) {
  const inner = document.createElement('div'); inner.className = 'ps-inner';
  inner.innerHTML = `<div class="ps-search-box"><input id="search-input" placeholder="Search people by name or @username"></div><div id="search-results"></div>`;
  body.innerHTML = ''; body.appendChild(inner);
  const input = $('search-input'), results = $('search-results');
  async function run() {
    const q = input.value.trim();
    results.innerHTML = '<div class="ps-empty-note">Searching…</div>';
    const people = (await S.searchProfiles(q, 30)).filter(p => p.id !== me.id);
    if (!people.length) { results.innerHTML = '<div class="ps-empty-note">No people found.</div>'; return; }
    results.innerHTML = '';
    for (const p of people) results.appendChild(await userRow(p));
  }
  let deb; input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(run, 250); });
  run();
}
async function userRow(p) {
  const row = document.createElement('div'); row.className = 'ps-user-row';
  row.innerHTML = `<div class="ps-avatar">${esc(p.avatar)}</div><div class="info"><div class="nm">${esc(p.display_name)}</div><div class="hd">@${esc(p.username)}</div>${p.bio ? `<div class="hd" style="margin-top:3px">${esc(p.bio)}</div>` : ''}</div><button class="ps-follow-btn">Follow</button>`;
  const btn = row.querySelector('.ps-follow-btn');
  const following = await S.isFollowing(p.id);
  const paint = f => { btn.classList.toggle('on', f); btn.textContent = f ? 'Following' : 'Follow'; };
  paint(following);
  btn.addEventListener('click', async () => { const on = btn.classList.contains('on'); try { on ? await S.unfollow(p.id) : await S.follow(p.id); paint(!on); } catch (e) { toast('Could not update'); } });
  return row;
}

/* ------------------------------------------------------------------ */
/* profile                                                              */
/* ------------------------------------------------------------------ */
async function renderProfile(body) {
  const c = S.client();
  const counts = await S.followCounts(me.id).catch(() => ({ followers: 0, following: 0 }));
  const inner = document.createElement('div'); inner.className = 'ps-inner';
  const socials = [['twitter', 'Twitter', me.social_twitter], ['instagram', 'Instagram', me.social_instagram], ['snapchat', 'Snapchat', me.social_snapchat], ['youtube', 'YouTube', me.social_youtube]].filter(s => s[2]);
  inner.innerHTML = `<div class="ps-profile-head">
    <div class="ps-profile-top"><div class="ps-avatar-big">${esc(me.avatar)}</div>
      <div style="display:flex;gap:8px"><button class="ps-btn ps-btn-outline" id="btn-edit">Edit</button><button class="ps-btn ps-btn-outline" id="btn-logout" style="color:#f87171">Log out</button></div></div>
    <div class="ps-profile-name">${esc(me.display_name)}</div>
    <div class="ps-profile-handle">@${esc(me.username)}</div>
    ${me.bio ? `<div class="ps-profile-bio">${esc(me.bio)}</div>` : ''}
    ${socials.length ? `<div class="ps-profile-socials">${socials.map(s => `<a href="#" onclick="return false">🔗 ${esc(s[1])}: ${esc(s[2])}</a>`).join('')}</div>` : ''}
    <div class="ps-profile-stats"><span><b>${counts.following}</b> Following</span><span><b>${counts.followers}</b> Followers</span></div>
    <div id="edit-wrap"></div>
  </div><div id="my-posts"></div>`;
  body.innerHTML = ''; body.appendChild(inner);
  $('btn-edit').addEventListener('click', () => renderEdit($('edit-wrap')));
  $('btn-logout').addEventListener('click', async () => { await S.signOut(); location.reload(); });

  const wrap = $('my-posts'); wrap.innerHTML = '<div class="ps-empty-note">Loading…</div>';
  const { data: posts } = await c.from('ps_posts').select('id,text,image_path,created_at,user_id,reply_to,profiles!ps_posts_user_id_fkey(username,avatar,display_name),ps_likes(count)').eq('user_id', me.id).order('created_at', { ascending: false }).limit(50);
  if (!posts || !posts.length) { wrap.innerHTML = '<div class="ps-empty-note">You haven\'t posted yet.</div>'; return; }
  const ids = posts.map(p => p.id);
  const [likedSet, replyCounts] = await Promise.all([likedSetFor(ids), replyCountsFor(ids)]);
  wrap.innerHTML = '';
  for (const p of posts) wrap.appendChild(postEl(p, likedSet.has(p.id), replyCounts[p.id], { onDelete: renderApp }));
}

function renderEdit(wrap) {
  if (wrap.dataset.open) { wrap.innerHTML = ''; wrap.dataset.open = ''; return; }
  wrap.dataset.open = '1';
  wrap.innerHTML = `<div class="ps-edit-form">
    <div><label>DISPLAY NAME</label><input id="e-name" maxlength="24" value="${esc(me.display_name)}"></div>
    <div><label>BIO</label><input id="e-bio" maxlength="160" value="${esc(me.bio)}" placeholder="a short bio"></div>
    <div><label>AVATAR</label><div class="ps-avatar-row" id="e-avs"></div></div>
    <div><label>TWITTER / X HANDLE</label><input id="e-tw" maxlength="40" value="${esc(me.social_twitter)}" placeholder="@you"></div>
    <div><label>INSTAGRAM</label><input id="e-ig" maxlength="40" value="${esc(me.social_instagram)}" placeholder="@you"></div>
    <div><label>SNAPCHAT</label><input id="e-sc" maxlength="40" value="${esc(me.social_snapchat)}" placeholder="@you"></div>
    <div><label>YOUTUBE</label><input id="e-yt" maxlength="40" value="${esc(me.social_youtube)}" placeholder="@you"></div>
    <button class="ps-btn" id="e-save" style="align-self:flex-start">Save</button>
  </div>`;
  let picked = me.avatar;
  const avs = $('e-avs');
  const draw = () => { avs.innerHTML = ''; for (const a of S.AVATARS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ps-av' + (a === picked ? ' on' : ''); b.textContent = a; b.onclick = () => { picked = a; draw(); }; avs.appendChild(b); } };
  draw();
  $('e-save').addEventListener('click', async () => {
    try {
      me = await S.updateProfile({
        display_name: $('e-name').value.trim() || me.username, bio: $('e-bio').value.trim(), avatar: picked,
        social_twitter: $('e-tw').value.trim(), social_instagram: $('e-ig').value.trim(), social_snapchat: $('e-sc').value.trim(), social_youtube: $('e-yt').value.trim(),
      });
      toast('Profile saved'); renderApp();
    } catch (e) { toast('Could not save'); }
  });
}
})();
