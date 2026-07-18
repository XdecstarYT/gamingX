/* ============================================================================
   PENTALK — ephemeral messaging (Snapchat-style) on the GamingX cloud.
   Capture or upload a photo/video, send it to friends as a disappearing
   snap (deleted once viewed) or post it to your 24-hour Story. Friend
   requests, chats and stories. Shares one GamingX account with the others.
   ========================================================================== */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = window.GXSocial;
const SEEN_KEY = 'gamingx.pentalk.seenStories';

let me = null;
let currentView = 'camera';
let camStream = null;
let pending = null; // { blob, url, type } captured/picked media awaiting send

function toast(m) { const t = $('pt-toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1900); }
function fkFriendReq() { return 'pt_friends_requester_id_fkey'; }
function fkFriendAdr() { return 'pt_friends_addressee_id_fkey'; }
function fkSnapSender() { return 'pt_snaps_sender_id_fkey'; }
function seenStories() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; } }
function markStorySeen(id) { const s = seenStories(); if (!s.includes(id)) { s.push(id); try { localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-300))); } catch (e) {} } }

S.mountAuthGate({
  appName: 'PenTalk', emoji: '👻', accent: '#ffd60a', accent2: '#a855f7',
  tagline: 'Snap your friends. Watch it disappear. Post to your Story.',
  onAuthed: start,
});

function start(profile) {
  me = profile;
  $('screen-app').classList.add('active');
  document.querySelectorAll('.pt-nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  $('btn-profile').addEventListener('click', () => switchView('profile'));
  renderApp();
}
function switchView(v) {
  if (v !== 'camera') stopCamera();
  currentView = v;
  document.querySelectorAll('.pt-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  renderApp();
}
function renderApp() {
  const body = $('app-body'); body.innerHTML = '';
  if (currentView === 'camera') renderCamera(body);
  else if (currentView === 'chats') renderChats(body);
  else if (currentView === 'stories') renderStories(body);
  else if (currentView === 'friends') renderFriends(body);
  else renderProfile(body);
}

/* ------------------------------------------------------------------ */
/* friends data                                                         */
/* ------------------------------------------------------------------ */
async function getFriends() {
  const { data } = await S.client().from('pt_friends')
    .select(`requester_id,addressee_id,status,req:profiles!${fkFriendReq()}(*),adr:profiles!${fkFriendAdr()}(*)`)
    .eq('status', 'accepted');
  return (data || []).map(e => (e.requester_id === me.id ? e.adr : e.req)).filter(Boolean);
}
async function getIncomingRequests() {
  const { data } = await S.client().from('pt_friends')
    .select(`requester_id,req:profiles!${fkFriendReq()}(*)`)
    .eq('status', 'pending').eq('addressee_id', me.id);
  return (data || []).map(e => e.req).filter(Boolean);
}
async function getOutgoingRequests() {
  const { data } = await S.client().from('pt_friends').select('addressee_id').eq('status', 'pending').eq('requester_id', me.id);
  return new Set((data || []).map(e => e.addressee_id));
}

/* ------------------------------------------------------------------ */
/* camera                                                               */
/* ------------------------------------------------------------------ */
function renderCamera(body) {
  const cam = document.createElement('div'); cam.className = 'pt-camera';
  cam.innerHTML = `
    <div class="pt-cam-stage" id="cam-stage">
      <video id="cam-video" autoplay playsinline muted></video>
      <div class="pt-cam-placeholder hidden" id="cam-ph">📷<br>Camera not available here.<br>Tap <b>Upload</b> to pick a photo or video from your device instead.</div>
      <div class="pt-caption-input hidden" id="cam-cap-wrap"><input id="cam-cap" maxlength="80" placeholder="Add a caption…"></div>
    </div>
    <div class="pt-cam-controls">
      <button class="pt-cam-side" id="cam-upload"><span class="ic">🖼️</span>Upload</button>
      <button class="pt-shutter" id="cam-shutter" title="Capture"></button>
      <button class="pt-cam-side" id="cam-flip"><span class="ic">🔄</span>Flip</button>
      <input type="file" accept="image/*,video/*" id="cam-file" hidden>
    </div>`;
  body.appendChild(cam);
  $('cam-shutter').addEventListener('click', capturePhoto);
  $('cam-upload').addEventListener('click', () => $('cam-file').click());
  $('cam-flip').addEventListener('click', () => { facing = facing === 'user' ? 'environment' : 'user'; startCamera(); });
  $('cam-file').addEventListener('change', e => { const f = e.target.files[0]; if (f) openSend(f, f.type.startsWith('video') ? 'video' : 'image'); });
  startCamera();
}
let facing = 'user';
async function startCamera() {
  stopCamera();
  const v = $('cam-video'), ph = $('cam-ph'); if (!v) return;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
    v.srcObject = camStream; v.classList.remove('hidden'); if (ph) ph.classList.add('hidden');
  } catch (e) {
    if (v) v.classList.add('hidden'); if (ph) ph.classList.remove('hidden');
  }
}
function stopCamera() { if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; } }
function capturePhoto() {
  const v = $('cam-video');
  if (!camStream || !v || !v.videoWidth) { $('cam-file').click(); return; }
  const canvas = document.createElement('canvas'); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0);
  canvas.toBlob(b => { if (b) openSend(b, 'image'); }, 'image/jpeg', 0.9);
}

/* ------------------------------------------------------------------ */
/* send screen                                                          */
/* ------------------------------------------------------------------ */
async function openSend(blob, type) {
  stopCamera();
  pending = { blob, url: URL.createObjectURL(blob), type };
  const body = $('app-body'); body.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'pt-send';
  wrap.innerHTML = `
    <div class="pt-send-head"><button id="send-cancel" style="font-size:1.1rem">←</button> Send to…</div>
    <div class="pt-send-preview">${type === 'video' ? `<video src="${pending.url}" controls></video>` : `<img src="${pending.url}">`}
      <div style="margin-top:10px"><input id="send-cap" maxlength="80" placeholder="Add a caption…" style="width:90%;background:var(--panel2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:9px;text-align:center;outline:none"></div>
    </div>
    <div class="pt-send-list" id="send-list"><div class="pt-empty-note">Loading friends…</div></div>
    <div class="pt-send-bar">
      <label class="pt-story-toggle"><span class="pt-check" id="story-check"></span> Post to My Story</label>
      <button class="pt-btn" id="send-btn" disabled>Send</button>
    </div>`;
  body.appendChild(wrap);
  $('send-cancel').addEventListener('click', () => { pending = null; switchView('camera'); });

  let toStory = false;
  const selected = new Set();
  $('story-check').addEventListener('click', () => { toStory = !toStory; $('story-check').classList.toggle('on', toStory); $('story-check').textContent = toStory ? '✓' : ''; updateSendBtn(); });

  const friends = await getFriends();
  const list = $('send-list');
  if (!friends.length) list.innerHTML = '<div class="pt-empty-note">No friends yet — add some in the <b>Friends</b> tab. You can still post to your Story.</div>';
  else {
    list.innerHTML = '';
    for (const f of friends) {
      const row = document.createElement('div'); row.className = 'pt-send-row';
      row.innerHTML = `<div class="pt-avatar">${esc(f.avatar)}</div><div class="info"><div class="nm">${esc(f.display_name)}</div><div class="hd">@${esc(f.username)}</div></div><div class="pt-check"></div>`;
      const chk = row.querySelector('.pt-check');
      row.addEventListener('click', () => { if (selected.has(f.id)) { selected.delete(f.id); chk.classList.remove('on'); chk.textContent = ''; } else { selected.add(f.id); chk.classList.add('on'); chk.textContent = '✓'; } updateSendBtn(); });
      list.appendChild(row);
    }
  }
  function updateSendBtn() { $('send-btn').disabled = selected.size === 0 && !toStory; }
  $('send-btn').addEventListener('click', () => doSend(selected, toStory, $('send-cap').value.trim()));
}

async function doSend(selected, toStory, caption) {
  const btn = $('send-btn'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const ext = pending.type === 'video' ? 'webm' : 'jpg';
    const file = new File([pending.blob], 'snap.' + ext, { type: pending.blob.type || (pending.type === 'video' ? 'video/webm' : 'image/jpeg') });
    const path = await S.uploadFile('snaps', file, ext);
    const expires_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const rows = [];
    for (const rid of selected) rows.push({ sender_id: me.id, recipient_id: rid, storage_path: path, media_type: pending.type, caption, is_story: false, expires_at });
    if (toStory) rows.push({ sender_id: me.id, recipient_id: null, storage_path: path, media_type: pending.type, caption, is_story: true, expires_at });
    const { error } = await S.client().from('pt_snaps').insert(rows);
    if (error) throw error;
    pending = null;
    toast(toStory && selected.size ? 'Sent & posted to story!' : toStory ? 'Posted to your story!' : 'Snap sent!');
    switchView('chats');
  } catch (e) { toast('Send failed: ' + (e.message || 'error')); btn.disabled = false; btn.textContent = 'Send'; }
}

/* ------------------------------------------------------------------ */
/* chats                                                                */
/* ------------------------------------------------------------------ */
async function renderChats(body) {
  const inner = document.createElement('div'); inner.className = 'pt-inner';
  inner.innerHTML = '<div class="pt-empty-note">Loading…</div>';
  body.appendChild(inner);
  const c = S.client();
  const [friends, incoming, outgoing] = await Promise.all([
    getFriends(),
    c.from('pt_snaps').select(`id,sender_id,storage_path,media_type,caption,created_at,sender:profiles!${fkSnapSender()}(*)`).eq('recipient_id', me.id).eq('is_story', false).order('created_at', { ascending: true }),
    c.from('pt_snaps').select('recipient_id').eq('sender_id', me.id).eq('is_story', false),
  ]);
  const incomingBySender = {};
  for (const s of (incoming.data || [])) (incomingBySender[s.sender_id] = incomingBySender[s.sender_id] || []).push(s);
  const outgoingTo = {};
  for (const s of (outgoing.data || [])) outgoingTo[s.recipient_id] = (outgoingTo[s.recipient_id] || 0) + 1;

  inner.innerHTML = '';
  if (!friends.length) { inner.innerHTML = '<div class="pt-empty-note">Add friends in the <b>Friends</b> tab, then snap them from the <b>Camera</b>.</div>'; return; }
  // sort: friends with new snaps first
  friends.sort((a, b) => ((incomingBySender[b.id] ? 1 : 0) - (incomingBySender[a.id] ? 1 : 0)));
  for (const f of friends) {
    const news = incomingBySender[f.id] || [];
    const row = document.createElement('div'); row.className = 'pt-chat-row';
    let status;
    if (news.length) status = `<span class="pt-chat-status" style="color:var(--red)"><span class="pt-dot new"></span> New Snap${news.length > 1 ? ' ×' + news.length : ''}</span>`;
    else if (outgoingTo[f.id]) status = `<span class="pt-chat-status" style="color:var(--accent)"><span class="pt-dot sent"></span> Delivered</span>`;
    else status = `<span class="pt-chat-status hd"><span class="pt-dot opened"></span> Tap camera to snap</span>`;
    row.innerHTML = `<div class="pt-avatar">${esc(f.avatar)}</div><div class="info"><div class="nm">${esc(f.display_name)}</div>${status}</div>`;
    if (news.length) row.addEventListener('click', () => viewSnaps(news, f));
    inner.appendChild(row);
  }
}

/* fullscreen ephemeral viewer for a queue of direct snaps (deleted after view) */
async function viewSnaps(snaps, friend) {
  const viewer = $('viewer'); viewer.classList.remove('hidden');
  let idx = 0;
  const c = S.client();
  async function show() {
    if (idx >= snaps.length) { viewer.classList.add('hidden'); viewer.innerHTML = ''; renderApp(); return; }
    const snap = snaps[idx];
    let url;
    try { url = await S.signedUrl('snaps', snap.storage_path, 600); }
    catch (e) { idx++; return show(); }
    viewer.innerHTML = `
      <div class="pt-progress">${snaps.map((_, i) => `<i><b style="width:${i < idx ? 100 : 0}%"></b></i>`).join('')}</div>
      <div class="meta"><span class="pt-avatar sm">${esc(friend.avatar)}</span> @${esc(friend.username)}</div>
      <button class="close" id="v-close">✕</button>
      ${snap.media_type === 'video' ? `<video src="${url}" autoplay playsinline id="v-media"></video>` : `<img src="${url}" id="v-media">`}
      ${snap.caption ? `<div class="cap">${esc(snap.caption)}</div>` : ''}
      <div class="tapzones"><div id="v-prev"></div><div id="v-next"></div></div>`;
    $('v-close').addEventListener('click', () => { viewer.classList.add('hidden'); viewer.innerHTML = ''; renderApp(); });
    const advance = async () => { try { await c.from('pt_snaps').delete().eq('id', snap.id); } catch (e) {} idx++; show(); };
    $('v-next').addEventListener('click', advance);
    $('v-prev').addEventListener('click', advance);
    if (snap.media_type === 'video') { const m = $('v-media'); m.addEventListener('ended', advance); }
    else { clearTimeout(show._t); show._t = setTimeout(advance, 5000); }
  }
  show();
}

/* ------------------------------------------------------------------ */
/* stories                                                              */
/* ------------------------------------------------------------------ */
async function renderStories(body) {
  const inner = document.createElement('div'); inner.className = 'pt-inner';
  inner.innerHTML = '<div class="pt-empty-note">Loading…</div>';
  body.appendChild(inner);
  const { data } = await S.client().from('pt_snaps')
    .select(`id,sender_id,storage_path,media_type,caption,created_at,sender:profiles!${fkSnapSender()}(*)`)
    .eq('is_story', true).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true });
  const bySender = {};
  for (const s of (data || [])) (bySender[s.sender_id] = bySender[s.sender_id] || []).push(s);
  const senders = Object.keys(bySender);
  inner.innerHTML = '';
  const seen = seenStories();

  // My Story bubble first
  const myStories = bySender[me.id] || [];
  const rail = document.createElement('div'); rail.className = 'pt-stories-rail';
  const mine = document.createElement('div'); mine.className = 'pt-story-bubble';
  mine.innerHTML = `<div class="pt-story-ring mine"><div class="pt-avatar">${esc(me.avatar)}</div></div><span class="lbl">My Story${myStories.length ? ' (' + myStories.length + ')' : ''}</span>`;
  mine.addEventListener('click', () => myStories.length ? viewStory(myStories, me) : switchView('camera'));
  rail.appendChild(mine);

  for (const sid of senders) {
    if (sid === me.id) continue;
    const set = bySender[sid]; const who = set[0].sender;
    const allSeen = set.every(s => seen.includes(s.id));
    const b = document.createElement('div'); b.className = 'pt-story-bubble';
    b.innerHTML = `<div class="pt-story-ring${allSeen ? ' seen' : ''}"><div class="pt-avatar">${esc(who.avatar)}</div></div><span class="lbl">@${esc(who.username)}</span>`;
    b.addEventListener('click', () => viewStory(set, who));
    rail.appendChild(b);
  }
  inner.appendChild(rail);

  if (senders.filter(s => s !== me.id).length === 0 && !myStories.length)
    inner.insertAdjacentHTML('beforeend', '<div class="pt-empty-note">No stories right now.<br>Post one from the <b>Camera</b> — it stays up for 24 hours.</div>');
}

async function viewStory(snaps, who) {
  const viewer = $('viewer'); viewer.classList.remove('hidden');
  let idx = 0;
  async function show() {
    if (idx >= snaps.length) { viewer.classList.add('hidden'); viewer.innerHTML = ''; renderApp(); return; }
    const snap = snaps[idx]; markStorySeen(snap.id);
    let url; try { url = await S.signedUrl('snaps', snap.storage_path, 600); } catch (e) { idx++; return show(); }
    viewer.innerHTML = `
      <div class="pt-progress">${snaps.map((_, i) => `<i><b style="width:${i < idx ? 100 : 0}%"></b></i>`).join('')}</div>
      <div class="meta"><span class="pt-avatar sm">${esc(who.avatar)}</span> @${esc(who.username)}</div>
      <button class="close" id="s-close">✕</button>
      ${snap.media_type === 'video' ? `<video src="${url}" autoplay playsinline id="s-media"></video>` : `<img src="${url}">`}
      ${snap.caption ? `<div class="cap">${esc(snap.caption)}</div>` : ''}
      <div class="tapzones"><div id="s-prev"></div><div id="s-next"></div></div>`;
    $('s-close').addEventListener('click', () => { viewer.classList.add('hidden'); viewer.innerHTML = ''; renderApp(); });
    const next = () => { idx++; show(); };
    const prev = () => { idx = Math.max(0, idx - 1); show(); };
    $('s-next').addEventListener('click', next);
    $('s-prev').addEventListener('click', prev);
    if (snap.media_type === 'video') { const m = $('s-media'); if (m) m.addEventListener('ended', next); }
    else { clearTimeout(show._t); show._t = setTimeout(next, 5000); }
  }
  show();
}

/* ------------------------------------------------------------------ */
/* friends                                                              */
/* ------------------------------------------------------------------ */
async function renderFriends(body) {
  const inner = document.createElement('div'); inner.className = 'pt-inner';
  inner.innerHTML = `<div class="pt-search-box"><input id="fr-search" placeholder="Find people by name or @username"></div>
    <div id="fr-requests"></div><div id="fr-results"></div>
    <div class="pt-section-title">YOUR FRIENDS</div><div id="fr-list"></div>`;
  body.appendChild(inner);

  const [friends, incoming, outgoing] = await Promise.all([getFriends(), getIncomingRequests(), getOutgoingRequests()]);
  const friendIds = new Set(friends.map(f => f.id));

  // incoming requests
  const reqWrap = $('fr-requests');
  if (incoming.length) {
    reqWrap.innerHTML = '<div class="pt-section-title">FRIEND REQUESTS</div>';
    for (const r of incoming) {
      const row = document.createElement('div'); row.className = 'pt-friend-row';
      row.innerHTML = `<div class="pt-avatar">${esc(r.avatar)}</div><div class="info"><div class="nm">${esc(r.display_name)}</div><div class="hd">@${esc(r.username)}</div></div><button class="pt-mini-btn accept">Accept</button>`;
      row.querySelector('button').addEventListener('click', async () => {
        try { await S.client().from('pt_friends').update({ status: 'accepted' }).eq('requester_id', r.id).eq('addressee_id', me.id); toast('You\'re now friends with @' + r.username); renderApp(); }
        catch (e) { toast('Could not accept'); }
      });
      reqWrap.appendChild(row);
    }
  }

  // friends list
  const list = $('fr-list');
  if (!friends.length) list.innerHTML = '<div class="pt-empty-note">No friends yet. Search above to add some.</div>';
  else for (const f of friends) {
    const row = document.createElement('div'); row.className = 'pt-friend-row';
    row.innerHTML = `<div class="pt-avatar">${esc(f.avatar)}</div><div class="info"><div class="nm">${esc(f.display_name)}</div><div class="hd">@${esc(f.username)}</div></div><button class="pt-mini-btn ghost">Friends ✓</button>`;
    list.appendChild(row);
  }

  // search
  const input = $('fr-search'), results = $('fr-results');
  async function run() {
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    results.innerHTML = '<div class="pt-empty-note">Searching…</div>';
    const people = (await S.searchProfiles(q, 25)).filter(p => p.id !== me.id);
    results.innerHTML = people.length ? '<div class="pt-section-title">RESULTS</div>' : '<div class="pt-empty-note">No people found.</div>';
    for (const p of people) {
      const row = document.createElement('div'); row.className = 'pt-friend-row';
      const isFriend = friendIds.has(p.id), isPending = outgoing.has(p.id);
      row.innerHTML = `<div class="pt-avatar">${esc(p.avatar)}</div><div class="info"><div class="nm">${esc(p.display_name)}</div><div class="hd">@${esc(p.username)}</div></div>
        <button class="pt-mini-btn${isFriend || isPending ? ' ghost' : ''}" ${isFriend || isPending ? 'disabled' : ''}>${isFriend ? 'Friends ✓' : isPending ? 'Requested' : 'Add'}</button>`;
      const btn = row.querySelector('button');
      if (!isFriend && !isPending) btn.addEventListener('click', async () => {
        try { await S.client().from('pt_friends').insert({ requester_id: me.id, addressee_id: p.id, status: 'pending' }); btn.textContent = 'Requested'; btn.classList.add('ghost'); btn.disabled = true; outgoing.add(p.id); toast('Friend request sent'); }
        catch (e) { toast(/duplicate/i.test(e.message) ? 'Already requested' : 'Could not send'); }
      });
      results.appendChild(row);
    }
  }
  let deb; input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(run, 250); });
}

/* ------------------------------------------------------------------ */
/* profile                                                              */
/* ------------------------------------------------------------------ */
async function renderProfile(body) {
  const friends = await getFriends();
  const inner = document.createElement('div'); inner.className = 'pt-inner';
  inner.innerHTML = `<div class="pt-profile-head">
    <div class="pt-avatar-big">${esc(me.avatar)}</div>
    <div class="pt-profile-name">${esc(me.display_name)}</div>
    <div class="pt-profile-handle">@${esc(me.username)}</div>
    <div class="pt-profile-stats"><div><b>${friends.length}</b><span>FRIENDS</span></div></div>
    <button class="pt-btn pt-btn-outline" id="btn-edit" style="margin:0 6px">Edit profile</button>
    <button class="pt-btn pt-btn-outline" id="btn-logout" style="color:#f87171">Log out</button>
    <div id="edit-wrap"></div>
  </div>`;
  body.appendChild(inner);
  $('btn-logout').addEventListener('click', async () => { await S.signOut(); location.reload(); });
  $('btn-edit').addEventListener('click', () => {
    const wrap = $('edit-wrap');
    if (wrap.dataset.open) { wrap.innerHTML = ''; wrap.dataset.open = ''; return; }
    wrap.dataset.open = '1';
    wrap.innerHTML = `<div class="pt-edit-form">
      <div><label>DISPLAY NAME</label><input id="e-name" maxlength="24" value="${esc(me.display_name)}"></div>
      <div><label>AVATAR</label><div class="pt-avatar-row" id="e-avs"></div></div>
      <button class="pt-btn" id="e-save">Save</button></div>`;
    let picked = me.avatar; const avs = $('e-avs');
    const draw = () => { avs.innerHTML = ''; for (const a of S.AVATARS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'pt-av' + (a === picked ? ' on' : ''); b.textContent = a; b.onclick = () => { picked = a; draw(); }; avs.appendChild(b); } };
    draw();
    $('e-save').addEventListener('click', async () => { try { me = await S.updateProfile({ display_name: $('e-name').value.trim() || me.username, avatar: picked }); toast('Saved'); renderApp(); } catch (e) { toast('Could not save'); } });
  });
}
})();
