/* ============================================================================
   GX SOCIAL — shared backend layer for GamingX's social apps
   (Penfrank, PenShare, PenTalk). One GamingX account signs you into all
   three. Wraps Supabase (auth + Postgres + Storage) behind a small API,
   and ships a reusable, themable login/sign-up gate.

   Requires the Supabase UMD bundle to be loaded first:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
     <script src="../../assets/js/gx-social.js"></script>

   NOTE: the anon/publishable key below is meant to be public — security is
   enforced by row-level-security rules in the database, not by hiding it.
   ========================================================================== */
window.GXSocial = (() => {
'use strict';

const SUPABASE_URL = 'https://kzopigkgsurktoccnxbc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6b3BpZ2tnc3Vya3RvY2NueGJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMzg5ODMsImV4cCI6MjA5OTkxNDk4M30.GfVpaV7GKNz72y6nqEm8L4hB2mPkJ4R2XQ6HV5szBOM';
const EMAIL_DOMAIN = 'gamingx.app'; // synthetic email domain for username-based login

let _client = null;
let _profileCache = null;

function available() { return typeof window.supabase !== 'undefined'; }

function client() {
  if (!_client) {
    if (!available()) throw new Error('Supabase library not loaded (need network access).');
    _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gamingx-auth', detectSessionInUrl: false },
    });
  }
  return _client;
}

/* ------------------------------------------------------------------ */
/* auth                                                                 */
/* ------------------------------------------------------------------ */
function cleanUsername(u) { return String(u || '').toLowerCase().replace(/[^a-z0-9_]/g, ''); }
function emailFor(username) { return cleanUsername(username) + '@' + EMAIL_DOMAIN; }

async function signUp({ username, password, displayName, avatar }) {
  const uname = cleanUsername(username);
  if (uname.length < 3) throw new Error('Username must be at least 3 characters (letters, numbers, underscore).');
  if (String(password).length < 6) throw new Error('Password must be at least 6 characters.');
  const c = client();

  const { data, error } = await c.auth.signUp({ email: emailFor(uname), password });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) throw new Error('That username is taken.');
    throw error;
  }
  // With email confirmation enabled server-side, signUp may not return a session;
  // our DB trigger auto-confirms, so a direct sign-in will succeed.
  if (!data.session) {
    const { error: sErr } = await c.auth.signInWithPassword({ email: emailFor(uname), password });
    if (sErr) throw new Error('Account created but sign-in failed: ' + sErr.message);
  }
  const { data: userData } = await c.auth.getUser();
  const uid = userData.user.id;
  const { error: pErr } = await c.from('profiles').insert({
    id: uid, username: uname, display_name: displayName || uname, avatar: avatar || '🦊',
  });
  if (pErr && !/duplicate|unique/i.test(pErr.message)) throw pErr;
  _profileCache = null;
  return currentProfile();
}

async function signIn({ username, password }) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email: emailFor(username), password });
  if (error) {
    if (/invalid login/i.test(error.message)) throw new Error('Wrong username or password.');
    throw error;
  }
  _profileCache = null;
  return currentProfile();
}

async function signOut() { _profileCache = null; await client().auth.signOut(); }

async function currentUser() {
  if (!available()) return null;
  try { const { data } = await client().auth.getUser(); return data.user || null; } catch (e) { return null; }
}

async function currentProfile() {
  if (_profileCache) return _profileCache;
  const user = await currentUser();
  if (!user) return null;
  const { data } = await client().from('profiles').select('*').eq('id', user.id).maybeSingle();
  _profileCache = data || null;
  return _profileCache;
}

function onAuthChange(cb) {
  if (!available()) return;
  client().auth.onAuthStateChange((_ev, session) => { _profileCache = null; cb(session); });
}

/* ------------------------------------------------------------------ */
/* profiles + follows                                                  */
/* ------------------------------------------------------------------ */
async function getProfile(userId) {
  const { data } = await client().from('profiles').select('*').eq('id', userId).maybeSingle();
  return data;
}
async function getProfileByUsername(username) {
  const { data } = await client().from('profiles').select('*').eq('username', cleanUsername(username)).maybeSingle();
  return data;
}
async function updateProfile(fields) {
  const user = await currentUser(); if (!user) throw new Error('Not signed in.');
  const { data, error } = await client().from('profiles').update(fields).eq('id', user.id).select().maybeSingle();
  if (error) throw error;
  _profileCache = data;
  return data;
}
async function searchProfiles(query, limit = 20) {
  const q = String(query || '').trim();
  let sel = client().from('profiles').select('*').limit(limit);
  if (q) sel = sel.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
  const { data } = await sel;
  return data || [];
}

async function follow(userId) {
  const user = await currentUser(); if (!user) throw new Error('Not signed in.');
  await client().from('follows').insert({ follower_id: user.id, following_id: userId });
}
async function unfollow(userId) {
  const user = await currentUser(); if (!user) throw new Error('Not signed in.');
  await client().from('follows').delete().eq('follower_id', user.id).eq('following_id', userId);
}
async function isFollowing(userId) {
  const user = await currentUser(); if (!user) return false;
  const { count } = await client().from('follows').select('*', { count: 'exact', head: true })
    .eq('follower_id', user.id).eq('following_id', userId);
  return (count || 0) > 0;
}
async function followingIds() {
  const user = await currentUser(); if (!user) return [];
  const { data } = await client().from('follows').select('following_id').eq('follower_id', user.id);
  return (data || []).map(r => r.following_id);
}
async function followCounts(userId) {
  const c = client();
  const [{ count: followers }, { count: following }] = await Promise.all([
    c.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId),
    c.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  return { followers: followers || 0, following: following || 0 };
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */
async function uploadFile(bucket, file, ext) {
  const user = await currentUser(); if (!user) throw new Error('Not signed in.');
  const name = user.id + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.' + (ext || 'bin');
  const { error } = await client().storage.from(bucket).upload(name, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return name;
}
function publicUrl(bucket, path) {
  return client().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
async function signedUrl(bucket, path, expiresIn = 3600) {
  const { data, error } = await client().storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
async function removeFile(bucket, path) {
  try { await client().storage.from(bucket).remove([path]); } catch (e) {}
}

/* ------------------------------------------------------------------ */
/* reusable, themable auth gate                                        */
/* ------------------------------------------------------------------ */
const AVATARS = ['🦊', '🐼', '🐸', '🐵', '🦄', '🐙', '🐧', '🐯', '👾', '🎭', '🐨', '🦁'];
let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return; _cssInjected = true;
  const s = document.createElement('style');
  s.textContent = `
  .gxs-gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;overflow:auto;
    background:radial-gradient(900px 600px at 80% -10%,var(--gxs-glow,rgba(255,84,112,.15)),transparent 60%),#0a0a12;
    font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;color:#f2f2f7}
  .gxs-box{width:min(420px,92vw);padding:34px;text-align:center;background:rgba(21,21,31,.94);
    border:1px solid rgba(255,255,255,.08);border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.6);margin:24px}
  .gxs-back{display:inline-block;margin-bottom:14px;color:#8b8b9e;text-decoration:none;font-weight:800;font-size:.74rem;letter-spacing:1px}
  .gxs-logo{font-size:1.6rem;font-weight:900;margin-bottom:6px}
  .gxs-logo span{background:linear-gradient(90deg,var(--gxs-accent,#ff5470),var(--gxs-accent2,#2dd4bf));-webkit-background-clip:text;background-clip:text;color:transparent}
  .gxs-tag{color:#8b8b9e;font-size:.84rem;margin-bottom:20px}
  .gxs-field{text-align:left;margin-bottom:13px}
  .gxs-field label{display:block;font-size:.66rem;font-weight:800;color:#8b8b9e;letter-spacing:1.4px;margin-bottom:6px}
  .gxs-field input{width:100%;background:#0d0d15;border:1px solid rgba(255,255,255,.14);border-radius:9px;color:#f2f2f7;font-size:.9rem;padding:10px 12px;outline:none}
  .gxs-field input:focus{border-color:var(--gxs-accent,#ff5470)}
  .gxs-avatars{display:flex;flex-wrap:wrap;gap:7px}
  .gxs-av{width:40px;height:40px;border-radius:50%;background:#0d0d15;border:2px solid rgba(255,255,255,.1);font-size:1.2rem;display:flex;align-items:center;justify-content:center;cursor:pointer}
  .gxs-av.on{border-color:var(--gxs-accent,#ff5470);background:rgba(255,84,112,.15)}
  .gxs-btn{width:100%;padding:12px;border-radius:11px;font-weight:800;font-size:.9rem;cursor:pointer;border:none;
    background:linear-gradient(90deg,var(--gxs-accent,#ff5470),var(--gxs-accent2,#2dd4bf));color:#0a0a12;margin-top:4px}
  .gxs-btn:disabled{opacity:.5;cursor:not-allowed}
  .gxs-toggle{margin-top:16px;font-size:.8rem;color:#8b8b9e}
  .gxs-toggle a{color:var(--gxs-accent2,#2dd4bf);font-weight:800;cursor:pointer}
  .gxs-err{color:#f87171;font-size:.78rem;font-weight:700;margin:8px 0;min-height:1em}
  .gxs-note{margin-top:16px;font-size:.66rem;line-height:1.5;color:#8b8b9e;text-align:left;background:rgba(45,212,191,.06);border:1px dashed rgba(45,212,191,.25);border-radius:10px;padding:9px 11px}
  .gxs-offline{color:#f2b03d;font-size:.8rem;margin-top:10px}`;
  document.head.appendChild(s);
}

/* mountAuthGate({ appName, tagline, emoji, accent, accent2, onAuthed })
   Renders a full-screen login/sign-up gate. Resolves by calling onAuthed(profile)
   once the user is signed in (immediately if already signed in). */
async function mountAuthGate(opts) {
  injectCss();
  const { appName = 'GamingX', tagline = '', emoji = '📱', accent = '#ff5470', accent2 = '#2dd4bf', onAuthed } = opts;

  const existing = await currentProfile().catch(() => null);
  if (existing) { onAuthed(existing); return; }

  const gate = document.createElement('div');
  gate.className = 'gxs-gate';
  gate.style.setProperty('--gxs-accent', accent);
  gate.style.setProperty('--gxs-accent2', accent2);
  gate.style.setProperty('--gxs-glow', accent.replace(')', ',.15)').replace('rgb', 'rgba'));
  document.body.appendChild(gate);

  let mode = 'login'; // 'login' | 'signup'
  let avatar = AVATARS[0];

  function render() {
    const signup = mode === 'signup';
    gate.innerHTML = `
      <div class="gxs-box">
        <a class="gxs-back" href="../../index.html">← GamingX Hub</a>
        <div class="gxs-logo">${emoji} <span>${appName}</span></div>
        <div class="gxs-tag">${tagline}</div>
        <div class="gxs-field"><label>USERNAME</label><input id="gxs-user" autocomplete="off" spellcheck="false" maxlength="20" placeholder="letters, numbers, _"></div>
        ${signup ? `<div class="gxs-field"><label>DISPLAY NAME</label><input id="gxs-display" autocomplete="off" maxlength="24" placeholder="shown on your profile"></div>` : ''}
        <div class="gxs-field"><label>PASSWORD</label><input id="gxs-pass" type="password" autocomplete="off" placeholder="at least 6 characters"></div>
        ${signup ? `<div class="gxs-field"><label>PICK AN AVATAR</label><div class="gxs-avatars" id="gxs-avs"></div></div>` : ''}
        <div class="gxs-err" id="gxs-err"></div>
        <button class="gxs-btn" id="gxs-submit">${signup ? 'CREATE GAMINGX ACCOUNT' : 'LOG IN'}</button>
        <div class="gxs-toggle">${signup ? 'Already have a GamingX account?' : 'New to GamingX?'} <a id="gxs-switch">${signup ? 'Log in' : 'Create one'}</a></div>
        <div class="gxs-note">🔗 One GamingX account works across <b>Penfrank</b>, <b>PenShare</b> and <b>PenTalk</b>. This is a real cloud backend — accounts and posts are shared with anyone else using GamingX. It's a hobby project, not a company: don't post anything you wouldn't want public, and don't reuse an important password.</div>
      </div>`;
    if (signup) {
      const avs = gate.querySelector('#gxs-avs');
      AVATARS.forEach(a => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'gxs-av' + (a === avatar ? ' on' : ''); b.textContent = a;
        b.onclick = () => { avatar = a; render(); };
        avs.appendChild(b);
      });
    }
    gate.querySelector('#gxs-switch').onclick = () => { mode = signup ? 'login' : 'signup'; render(); };
    gate.querySelector('#gxs-submit').onclick = submit;
    gate.querySelector('#gxs-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  async function submit() {
    const errEl = gate.querySelector('#gxs-err');
    const btn = gate.querySelector('#gxs-submit');
    errEl.textContent = '';
    const username = gate.querySelector('#gxs-user').value.trim();
    const password = gate.querySelector('#gxs-pass').value;
    const displayName = mode === 'signup' ? (gate.querySelector('#gxs-display').value.trim() || username) : '';
    btn.disabled = true; btn.textContent = 'Please wait…';
    try {
      const profile = mode === 'signup'
        ? await signUp({ username, password, displayName, avatar })
        : await signIn({ username, password });
      gate.remove();
      onAuthed(profile);
    } catch (e) {
      errEl.textContent = e.message || 'Something went wrong.';
      btn.disabled = false;
      btn.textContent = mode === 'signup' ? 'CREATE GAMINGX ACCOUNT' : 'LOG IN';
    }
  }

  if (!available()) {
    gate.innerHTML = `<div class="gxs-box"><a class="gxs-back" href="../../index.html">← GamingX Hub</a>
      <div class="gxs-logo">${emoji} <span>${appName}</span></div>
      <div class="gxs-offline">⚠️ Couldn't reach the GamingX backend.<br>These social apps need an internet connection — please check your network and reload.</div></div>`;
    return;
  }
  render();
}

return {
  available, client, SUPABASE_URL,
  signUp, signIn, signOut, currentUser, currentProfile, onAuthChange,
  getProfile, getProfileByUsername, updateProfile, searchProfiles,
  follow, unfollow, isFollowing, followingIds, followCounts,
  uploadFile, publicUrl, signedUrl, removeFile,
  mountAuthGate, AVATARS, cleanUsername,
};
})();
