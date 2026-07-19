/* ============================================================================
   PENTALK — voice & video calling (WebRTC).
   Signalling runs over Supabase Realtime broadcast: each user listens on a
   personal inbox channel for call invites, and each call gets its own
   channel for the offer/answer/ICE exchange. Media is peer-to-peer via
   RTCPeerConnection with public STUN servers.

   Requirements (be aware): needs https (camera/mic are blocked on file://),
   both people online at once, and — on strict/symmetric NATs — a TURN
   server, which this project doesn't run (only free STUN). So calls are
   best-effort. Injects its own UI + styles; drive it via PTCalls.call().
   ========================================================================== */
window.PTCalls = (() => {
'use strict';
const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
] };

let S = null, me = null;
let inbox = null;         // my invite channel
let callCh = null;        // per-call signalling channel
let pc = null, localStream = null, remoteStream = null;
let cur = null;           // { callId, peerId, peerName, peerAvatar, media, role, state }
let pendingInvite = null; // incoming invite awaiting accept/decline
let ringTimer = null, tickTimer = null, startedAt = 0;

/* ---------------- init ---------------- */
function init(_S, _me) {
  S = _S; me = _me;
  if (!S || !S.available || !S.available()) return;
  injectCss();
  inbox = S.client().channel('pt-inbox-' + me.id, { config: { broadcast: { self: false } } });
  inbox.on('broadcast', { event: 'sig' }, ({ payload }) => onInbox(payload)).subscribe();
  maybeAnswerFromUrl(); // opened via an incoming-call push notification?
}

/* If the page was opened from an incoming-call push (…?call=<id>), present it. */
async function maybeAnswerFromUrl() {
  const m = location.search.match(/[?&]call=([^&]+)/);
  if (!m) return;
  const callId = decodeURIComponent(m[1]);
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  try {
    const { data } = await S.client().from('pt_calls').select('*').eq('id', callId).maybeSingle();
    if (!data || data.status !== 'ringing' || data.callee_id !== me.id || cur) return;
    const caller = await S.getProfile(data.caller_id).catch(() => null);
    pendingInvite = { kind: 'invite', callId, media: data.media, from: data.caller_id, fromName: caller ? caller.display_name : 'Caller', fromAvatar: caller ? caller.avatar : '👤' };
    showIncomingUi(pendingInvite); startRing();
  } catch (e) {}
}

async function setCallStatus(callId, status) { try { await S.client().from('pt_calls').update({ status }).eq('id', callId); } catch (e) {} }

function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection); }

/* send a one-off signalling message to a user's inbox */
async function sendInbox(targetId, payload) {
  const ch = S.client().channel('pt-inbox-' + targetId);
  await new Promise(res => { let done = false; ch.subscribe(st => { if (st === 'SUBSCRIBED' && !done) { done = true; res(); } }); setTimeout(() => { if (!done) { done = true; res(); } }, 2500); });
  await ch.send({ type: 'broadcast', event: 'sig', payload: Object.assign({ from: me.id, fromName: me.display_name, fromAvatar: me.avatar }, payload) });
  setTimeout(() => { try { S.client().removeChannel(ch); } catch (e) {} }, 3000);
}
function sendCall(payload) { if (callCh) callCh.send({ type: 'broadcast', event: 'sig', payload: Object.assign({ from: me.id }, payload) }); }

/* ---------------- outgoing call ---------------- */
async function call(friend, media) {
  if (cur) return;
  if (!supported()) { toast('Calls need camera/mic access over https — not available here.'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia(media === 'video' ? { audio: true, video: true } : { audio: true }); }
  catch (e) { toast('Couldn\'t access your ' + (media === 'video' ? 'camera/mic' : 'microphone') + '.'); return; }
  localStream = stream;
  const callId = 'call-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  cur = { callId, peerId: friend.id, peerName: friend.display_name, peerAvatar: friend.avatar, media, role: 'caller', state: 'ringing' };
  joinCallChannel(callId);
  newPeer();
  showCallUi();
  startRing();
  // record the call -> fires a push to the callee (rings them even if the app is closed)
  try { await S.client().from('pt_calls').insert({ id: callId, caller_id: me.id, callee_id: friend.id, media, status: 'ringing' }); } catch (e) {}
  // and a live invite for the instant case where they already have the app open
  await sendInbox(friend.id, { kind: 'invite', callId, media });
  // give them time to receive a push, open the app and answer
  ringTimer = setTimeout(() => { if (cur && cur.state === 'ringing') { toast('No answer'); setCallStatus(callId, 'missed'); sendInbox(friend.id, { kind: 'cancel', callId }); endCall(false); } }, 60000);
}

/* ---------------- incoming ---------------- */
function onInbox(p) {
  if (!p || !p.kind) return;
  if (p.kind === 'invite') {
    if (cur) { sendInbox(p.from, { kind: 'decline', callId: p.callId, busy: true }); return; }
    pendingInvite = p; showIncomingUi(p); startRing();
    if (typeof document !== 'undefined' && document.hidden && S.notify) S.notify('📞', 'Incoming call', (p.fromName || 'Someone') + ' is calling…', () => { try { window.focus(); } catch (e) {} });
  } else if (p.kind === 'cancel') {
    if (pendingInvite && pendingInvite.callId === p.callId) { pendingInvite = null; stopRing(); hideIncomingUi(); }
  } else if (p.kind === 'decline') {
    if (cur && cur.callId === p.callId) { toast(p.busy ? 'They\'re on another call' : 'Call declined'); endCall(false); }
  }
}

async function accept() {
  const p = pendingInvite; if (!p) return;
  stopRing(); hideIncomingUi();
  setCallStatus(p.callId, 'accepted');
  if (!supported()) { toast('Calls need camera/mic over https.'); sendInbox(p.from, { kind: 'decline', callId: p.callId }); pendingInvite = null; return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia(p.media === 'video' ? { audio: true, video: true } : { audio: true }); }
  catch (e) { toast('Couldn\'t access your camera/mic.'); sendInbox(p.from, { kind: 'decline', callId: p.callId }); pendingInvite = null; return; }
  localStream = stream;
  cur = { callId: p.callId, peerId: p.from, peerName: p.fromName, peerAvatar: p.fromAvatar, media: p.media, role: 'callee', state: 'connecting' };
  pendingInvite = null;
  joinCallChannel(p.callId);
  newPeer();
  showCallUi();
  sendCall({ kind: 'accept', callId: p.callId }); // tell caller we're ready for the offer
}
function decline() { const p = pendingInvite; if (!p) return; sendInbox(p.from, { kind: 'decline', callId: p.callId }); setCallStatus(p.callId, 'declined'); pendingInvite = null; stopRing(); hideIncomingUi(); }

/* ---------------- webrtc plumbing ---------------- */
function joinCallChannel(callId) {
  callCh = S.client().channel('pt-call-' + callId, { config: { broadcast: { self: false } } });
  callCh.on('broadcast', { event: 'sig' }, ({ payload }) => onCallSig(payload)).subscribe();
}
function newPeer() {
  pc = new RTCPeerConnection(ICE);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate) sendCall({ kind: 'ice', candidate: e.candidate }); };
  pc.ontrack = e => { remoteStream = e.streams[0]; const rv = document.getElementById('pt-call-remote'); if (rv) { try { rv.srcObject = remoteStream; } catch (err) {} rv.play && rv.play().catch(() => {}); } setConnected(); };
  pc.onconnectionstatechange = () => { if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) { toast('Call disconnected'); endCall(true); } };
}
async function onCallSig(p) {
  if (!p || !cur || !pc) return;
  try {
    if (p.kind === 'accept' && cur.role === 'caller') {
      clearTimeout(ringTimer); cur.state = 'connecting'; updateStatus('Connecting…');
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer); sendCall({ kind: 'offer', sdp: offer });
    } else if (p.kind === 'offer' && cur.role === 'callee') {
      await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); sendCall({ kind: 'answer', sdp: answer });
    } else if (p.kind === 'answer' && cur.role === 'caller') {
      await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
    } else if (p.kind === 'ice') {
      try { await pc.addIceCandidate(new RTCIceCandidate(p.candidate)); } catch (e) {}
    } else if (p.kind === 'hangup') {
      toast('Call ended'); endCall(false);
    }
  } catch (e) { /* ignore transient signalling errors */ }
}

function endCall(sendHangup) {
  if (sendHangup && cur) sendCall({ kind: 'hangup', callId: cur.callId });
  if (cur) setCallStatus(cur.callId, 'ended');
  stopRing();
  clearTimeout(ringTimer); clearInterval(tickTimer);
  if (pc) { try { pc.close(); } catch (e) {} pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (callCh) { try { S.client().removeChannel(callCh); } catch (e) {} callCh = null; }
  remoteStream = null; cur = null;
  hideCallUi();
}

/* ---------------- UI ---------------- */
let _css = false;
function injectCss() {
  if (_css) return; _css = true;
  const s = document.createElement('style');
  s.textContent = `
  .ptc-incoming{position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-30px);z-index:100001;display:flex;align-items:center;gap:12px;
    background:rgba(20,20,30,.96);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:12px 16px;
    box-shadow:0 18px 44px rgba(0,0,0,.55);opacity:0;transition:opacity .25s,transform .25s;font-family:'Segoe UI',system-ui,sans-serif;color:#f5f5fa;max-width:min(440px,94vw)}
  .ptc-incoming.show{opacity:1;transform:translateX(-50%) translateY(0)}
  .ptc-incoming .av{width:44px;height:44px;border-radius:50%;background:#20202c;display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0}
  .ptc-incoming .tt{font-weight:800;font-size:.9rem}.ptc-incoming .sb{color:#9a9aad;font-size:.76rem}
  .ptc-incoming button{border:none;border-radius:999px;font-weight:800;font-size:.82rem;padding:9px 15px;cursor:pointer}
  .ptc-acc{background:#22c55e;color:#04120a}.ptc-dec{background:#ef4444;color:#fff}
  .ptc-screen{position:fixed;inset:0;z-index:100000;background:#07070c;display:none;flex-direction:column;font-family:'Segoe UI',system-ui,sans-serif;color:#fff}
  .ptc-screen.on{display:flex}
  .ptc-stage{flex:1;position:relative;overflow:hidden;background:#0a0a12;display:flex;align-items:center;justify-content:center}
  #pt-call-remote{width:100%;height:100%;object-fit:cover;background:#0a0a12}
  .ptc-voice-face{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
  .ptc-voice-face .av{width:120px;height:120px;border-radius:50%;background:#20202c;display:flex;align-items:center;justify-content:center;font-size:4rem}
  #pt-call-local{position:absolute;right:14px;top:14px;width:104px;height:150px;object-fit:cover;border-radius:12px;border:2px solid rgba(255,255,255,.25);background:#111;transform:scaleX(-1)}
  .ptc-info{position:absolute;top:18px;left:18px;text-shadow:0 2px 8px rgba(0,0,0,.7)}
  .ptc-info .nm{font-weight:800;font-size:1.15rem}.ptc-info .st{color:#cfcfe0;font-size:.82rem;margin-top:2px}
  .ptc-controls{display:flex;align-items:center;justify-content:center;gap:22px;padding:22px 0 calc(22px + env(safe-area-inset-bottom))}
  .ptc-btn{width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.14);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;font-size:1.5rem;cursor:pointer;border:none;color:#fff}
  .ptc-btn.off{background:#fff;color:#0a0a12}
  .ptc-btn.end{background:#ef4444}`;
  document.head.appendChild(s);
}
function showIncomingUi(p) {
  hideIncomingUi();
  const el = document.createElement('div'); el.className = 'ptc-incoming'; el.id = 'ptc-incoming';
  el.innerHTML = `<div class="av">${p.fromAvatar || '👤'}</div>
    <div style="flex:1;min-width:0"><div class="tt">${(p.fromName || 'Someone')}</div><div class="sb">Incoming ${p.media === 'video' ? 'video' : 'voice'} call…</div></div>
    <button class="ptc-dec" id="ptc-decline">Decline</button><button class="ptc-acc" id="ptc-accept">Accept</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  document.getElementById('ptc-accept').onclick = accept;
  document.getElementById('ptc-decline').onclick = decline;
}
function hideIncomingUi() { const el = document.getElementById('ptc-incoming'); if (el) { el.classList.remove('show'); setTimeout(() => el.remove(), 250); } }

function showCallUi() {
  hideCallUi();
  const el = document.createElement('div'); el.className = 'ptc-screen on'; el.id = 'ptc-screen';
  const isVideo = cur.media === 'video';
  el.innerHTML = `
    <div class="ptc-stage">
      <video id="pt-call-remote" autoplay playsinline ${isVideo ? '' : 'style="display:none"'}></video>
      ${isVideo ? '' : `<div class="ptc-voice-face"><div class="av">${cur.peerAvatar || '👤'}</div></div>`}
      ${isVideo ? '<video id="pt-call-local" autoplay playsinline muted></video>' : ''}
      <div class="ptc-info"><div class="nm">${cur.peerName || 'Call'}</div><div class="st" id="ptc-status">${cur.role === 'caller' ? 'Calling…' : 'Connecting…'}</div></div>
    </div>
    <div class="ptc-controls">
      <button class="ptc-btn" id="ptc-mute" title="Mute">🎙️</button>
      ${isVideo ? '<button class="ptc-btn" id="ptc-cam" title="Camera">🎥</button>' : ''}
      <button class="ptc-btn end" id="ptc-end" title="Hang up">📵</button>
    </div>`;
  document.body.appendChild(el);
  if (isVideo) { const lv = document.getElementById('pt-call-local'); if (lv && localStream) { try { lv.srcObject = localStream; } catch (e) {} } }
  document.getElementById('ptc-end').onclick = () => { endCall(true); };
  document.getElementById('ptc-mute').onclick = e => { const on = toggleTrack('audio'); e.currentTarget.classList.toggle('off', !on); e.currentTarget.textContent = on ? '🎙️' : '🔇'; };
  const camBtn = document.getElementById('ptc-cam');
  if (camBtn) camBtn.onclick = e => { const on = toggleTrack('video'); e.currentTarget.classList.toggle('off', !on); e.currentTarget.textContent = on ? '🎥' : '🚫'; };
}
function hideCallUi() { const el = document.getElementById('ptc-screen'); if (el) el.remove(); }
function updateStatus(t) { const el = document.getElementById('ptc-status'); if (el) el.textContent = t; }
function setConnected() {
  if (!cur) return; stopRing(); cur.state = 'connected'; startedAt = Date.now();
  clearInterval(tickTimer);
  tickTimer = setInterval(() => { const s = Math.floor((Date.now() - startedAt) / 1000); updateStatus(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')); }, 1000);
  updateStatus('0:00');
}
function toggleTrack(kind) {
  if (!localStream) return true;
  const tracks = kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
  if (!tracks.length) return true;
  const on = !tracks[0].enabled; tracks.forEach(t => (t.enabled = on)); return on;
}
function toast(m) { if (S && S.showBanner) S.showBanner('📞', m, ''); }

/* simple ringtone (Web Audio) */
let ringCtx = null, ringInt = null;
function startRing() {
  stopRing();
  try {
    ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (ringCtx.state === 'suspended') ringCtx.resume().catch(() => {});
    const beep = () => {
      if (!ringCtx) return;
      const now = ringCtx.currentTime;
      [0, 0.35].forEach(off => {
        const o = ringCtx.createOscillator(), g = ringCtx.createGain();
        o.type = 'sine'; o.frequency.value = 470;
        g.gain.setValueAtTime(0.0001, now + off);
        g.gain.exponentialRampToValueAtTime(0.16, now + off + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.28);
        o.connect(g); g.connect(ringCtx.destination); o.start(now + off); o.stop(now + off + 0.3);
      });
    };
    beep(); ringInt = setInterval(beep, 2500);
  } catch (e) {}
}
function stopRing() { if (ringInt) { clearInterval(ringInt); ringInt = null; } if (ringCtx) { try { ringCtx.close(); } catch (e) {} ringCtx = null; } }

return { init, call, accept, decline, supported, _state: () => cur };
})();
