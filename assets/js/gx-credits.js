/* ============================================================================
   GX Credits — usage metering for GamingX's most powerful engine.

   TWO MODES, one API:
   • SERVER (you're signed in with a GamingX account + backend reachable):
     the balance lives in Supabase and is enforced server-side (RLS + SECURITY
     DEFINER functions). Spending, redeeming and pricing are all authoritative —
     you can't edit your own balance in devtools, and pricing is set by the dev.
   • LOCAL (offline / file:// / not signed in): an honour-system meter in
     localStorage, so the editor still works with sensible limits.

   The powerful engine (particle & glow FX) is FREE, with a monthly credit
   allowance. Out of credits? Email decmar098@gmail.com — the dev mints a code
   in the Dev Hub and sends it back to paste in.
   ========================================================================== */
window.GXCredits = (() => {
'use strict';

const EMAIL = 'decmar098@gmail.com';
const LKEY = 'gamingx.credits';          // local-mode wallet
const SEEN = 'gamingx.broadcast.seen';   // seen announcement ids
const FREE_MONTHLY = 100;
const DEFAULT_PRICE = 20;
const CAP = 1000000;

/* Local-mode signing (used only when there's no backend). CHANGE for your own. */
const DEV_KEY = 'decstar-gamingx-devhub-2026';
const CODE_SECRET = 'gx-credit-sig-a7Kd93QpZ-2026';

let _mode = 'local';       // 'server' | 'local'
let _bal = FREE_MONTHLY;   // cached balance
let _prices = {};          // key -> {label, credits}
let _admin = false;
let _ready = null;

function S() { return window.GXSocial; }
function hasBackend() { try { return !!(S() && S().available()); } catch (e) { return false; } }
async function client() { return S().client(); }

/* ---------------- local wallet ---------------- */
function monthTag() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); }
function lload() {
  let s; try { s = JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch (e) { s = null; }
  if (!s || typeof s.balance !== 'number') s = { balance: FREE_MONTHLY, month: monthTag(), redeemed: [] };
  if (!Array.isArray(s.redeemed)) s.redeemed = [];
  if (s.month !== monthTag()) { s.month = monthTag(); if (s.balance < FREE_MONTHLY) s.balance = FREE_MONTHLY; }
  return s;
}
function lsave(s) { try { localStorage.setItem(LKEY, JSON.stringify(s)); } catch (e) {} }

/* ---------------- code signing (local mode) ---------------- */
function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).toUpperCase();
}
function sigFor(amount, nonce) { return cyrb53(amount + '|' + nonce + '|' + CODE_SECRET, 0x9e37).slice(0, 8); }
function makeCode(amount) {
  amount = Math.max(1, Math.round(amount));
  const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
  return 'GX-' + amount + '-' + nonce + '-' + sigFor(amount, nonce);
}
function localRedeem(code) {
  if (!code) return { ok: false, error: 'Enter a code.' };
  const parts = String(code).trim().toUpperCase().replace(/\s+/g, '').split('-');
  if (parts.length !== 4 || parts[0] !== 'GX') return { ok: false, error: 'That doesn’t look like a GamingX code.' };
  const amount = parseInt(parts[1], 10), nonce = parts[2], sig = parts[3];
  if (!(amount > 0)) return { ok: false, error: 'Invalid amount in code.' };
  if (sigFor(amount, nonce) !== sig) return { ok: false, error: 'This code isn’t valid.' };
  const s = lload();
  if (s.redeemed.indexOf(nonce) !== -1) return { ok: false, error: 'This code was already used.' };
  s.redeemed.push(nonce); s.balance = Math.min(CAP, s.balance + amount); lsave(s);
  return { ok: true, amount, balance: s.balance };
}

/* ---------------- init / refresh ---------------- */
async function refresh() {
  if (_mode !== 'server') return _bal;
  try {
    const c = await client();
    const [{ data: w }, { data: pr }] = await Promise.all([
      c.rpc('gx_wallet'),
      c.from('gx_pricing').select('key,label,credits'),
    ]);
    if (w && typeof w.balance === 'number') _bal = w.balance;
    _prices = {}; (pr || []).forEach(r => { _prices[r.key] = { label: r.label, credits: r.credits }; });
    try { const { data: a } = await c.rpc('gx_is_admin'); _admin = !!a; } catch (e) {}
  } catch (e) {}
  return _bal;
}

function init() {
  if (_ready) return _ready;
  _ready = (async () => {
    let signedIn = false;
    if (hasBackend()) { try { signedIn = !!(await S().currentUser()); } catch (e) {} }
    if (signedIn) { _mode = 'server'; await refresh(); }
    else { _mode = 'local'; _bal = lload().balance; }
    return _mode;
  })();
  return _ready;
}

/* ---------------- reads ---------------- */
function mode() { return _mode; }
function isServer() { return _mode === 'server'; }
function isAdmin() { return _admin; }
function balance() { return _mode === 'server' ? _bal : lload().balance; }
function prices() { return _prices; }
function priceOf(key) {
  if (_prices[key]) return _prices[key].credits;
  return DEFAULT_PRICE;
}

/* ---------------- spend / redeem ---------------- */
async function spend(key) {
  if (_mode === 'server') {
    try {
      const c = await client();
      const { data, error } = await c.rpc('gx_spend', { p_key: key });
      if (error) return { ok: false, error: error.message };
      if (data && typeof data.balance === 'number') _bal = data.balance;
      return data;
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  const cost = priceOf(key), s = lload();
  if (s.balance < cost) return { ok: false, error: 'insufficient', balance: s.balance, need: cost };
  s.balance -= cost; lsave(s); _bal = s.balance;
  return { ok: true, balance: s.balance, spent: cost };
}

async function redeem(code) {
  if (_mode === 'server') {
    try {
      const c = await client();
      const { data, error } = await c.rpc('gx_redeem', { p_code: code });
      if (error) return { ok: false, error: error.message };
      if (data && typeof data.balance === 'number') _bal = data.balance;
      if (data && !data.ok) data.error = friendlyErr(data.error);
      return data;
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  return localRedeem(code);
}
function friendlyErr(code) {
  return ({ already_used: 'This code was already used.', invalid: 'This code isn’t valid.',
    not_signed_in: 'Sign in to redeem codes.', insufficient: 'Not enough credits.' })[code] || code;
}

/* try to spend key; if broke, pop the top-up modal. returns true on success. */
async function trySpend(key, feature, onChange) {
  const r = await spend(key);
  if (r && r.ok) { onChange && onChange(_bal); return true; }
  showOutOfCredits({ feature, cost: (r && r.need) || priceOf(key), onChange });
  return false;
}

/* ---------------- admin (server) ---------------- */
async function adminClaim(secret) { const c = await client(); const { data } = await c.rpc('gx_claim_admin', { p_secret: secret }); _admin = !!data; return _admin; }
async function adminSetPrice(key, label, credits) { const c = await client(); const { data } = await c.rpc('gx_admin_set_price', { p_key: key, p_label: label, p_credits: credits }); await refresh(); return data; }
async function adminGrant(username, credits, note) { const c = await client(); const { data } = await c.rpc('gx_admin_grant', { p_username: username, p_credits: credits, p_note: note || 'admin' }); return data; }
async function adminMintCode(credits, note) { const c = await client(); const { data } = await c.rpc('gx_admin_mint_code', { p_credits: credits, p_note: note || '' }); return data; }
async function adminBroadcast(title, body, kind) { const c = await client(); const { data } = await c.rpc('gx_admin_broadcast', { p_title: title, p_body: body || '', p_kind: kind || 'update' }); return data; }
async function adminStats() { const c = await client(); const { data } = await c.rpc('gx_admin_stats'); return data; }
async function sendPush(title, body, url) {
  const c = await client();
  const { data, error } = await c.functions.invoke('gx-broadcast-push', { body: { title, body, url } });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* ---------------- broadcasts (in-app updates) ---------------- */
async function broadcasts() {
  if (_mode !== 'server') return [];
  try { const c = await client(); const { data } = await c.from('gx_broadcasts').select('*').eq('active', true).order('created_at', { ascending: false }).limit(5); return data || []; }
  catch (e) { return []; }
}
function seenIds() { try { return JSON.parse(localStorage.getItem(SEEN) || '[]'); } catch (e) { return []; } }
function markSeen(id) { const s = seenIds(); if (s.indexOf(id) === -1) { s.push(id); try { localStorage.setItem(SEEN, JSON.stringify(s.slice(-100))); } catch (e) {} } }
async function showBroadcasts() {
  const list = await broadcasts();
  const seen = seenIds();
  const fresh = list.filter(b => seen.indexOf(b.id) === -1);
  if (!fresh.length) return;
  injectCss();
  const b = fresh[0];
  const icon = ({ update: '🚀', news: '📣', alert: '⚠️' })[b.kind] || '📣';
  const el = document.createElement('div'); el.className = 'gxc-cast';
  el.innerHTML = `<div class="ic">${icon}</div><div class="tx"><div class="t">${esc(b.title)}</div>${b.body ? `<div class="b">${esc(b.body)}</div>` : ''}</div><button class="x">✕</button>`;
  const dismiss = () => { markSeen(b.id); el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  el.querySelector('.x').onclick = dismiss;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(dismiss, 8000);   // auto-dismiss so it never sits over the toolbar
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function checkDevKey(key) { return String(key || '').trim() === DEV_KEY; }
/* local-only direct add (offline dev helper) */
function add(amount) { const s = lload(); s.balance = Math.min(CAP, s.balance + Math.max(0, Math.round(amount))); lsave(s); _bal = s.balance; return s.balance; }

/* ---------------- UI ---------------- */
let _css = false;
function injectCss() {
  if (_css) return; _css = true;
  const s = document.createElement('style');
  s.textContent = `
  .gxc-ov{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;
    background:rgba(6,8,14,.72);backdrop-filter:blur(6px);font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif}
  .gxc-box{width:min(460px,94vw);background:#121627;border:1px solid rgba(255,255,255,.1);border-radius:20px;
    padding:26px;color:#eef1fa;box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center}
  .gxc-ic{font-size:2.6rem}
  .gxc-title{font-size:1.4rem;font-weight:900;margin:6px 0 2px}
  .gxc-bal{font-weight:800;color:#f5b301;margin-bottom:6px;font-size:1.05rem}
  .gxc-modetag{font-size:.66rem;font-weight:800;letter-spacing:.5px;color:#9aa3bd;margin-bottom:12px}
  .gxc-msg{color:#c4cbe0;font-size:.9rem;line-height:1.5;margin-bottom:14px}
  .gxc-email{display:block;background:rgba(245,179,1,.1);border:1px solid rgba(245,179,1,.3);border-radius:10px;
    padding:10px;font-weight:800;color:#f5b301;text-decoration:none;margin-bottom:14px;word-break:break-all}
  .gxc-redeem{display:flex;gap:8px;margin-bottom:6px}
  .gxc-input{flex:1;min-width:0;padding:11px;border-radius:10px;border:1px solid rgba(255,255,255,.14);
    background:rgba(255,255,255,.05);color:#eef1fa;font-weight:700;font-size:.9rem}
  .gxc-btn{padding:11px 14px;border-radius:10px;font-weight:800;font-size:.9rem;border:none;cursor:pointer;
    background:linear-gradient(90deg,#f5b301,#ff8a3c);color:#241a00;white-space:nowrap}
  .gxc-btn2{width:100%;padding:11px;border-radius:12px;font-weight:800;font-size:.85rem;cursor:pointer;margin-top:10px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#eef1fa}
  .gxc-status{font-size:.8rem;font-weight:700;min-height:18px;margin-bottom:8px}
  .gxc-status.ok{color:#34d399}.gxc-status.err{color:#f87171}
  .gxc-note{margin-top:14px;font-size:.66rem;line-height:1.5;color:#9aa3bd;text-align:left;
    background:rgba(245,179,1,.06);border:1px dashed rgba(245,179,1,.3);border-radius:10px;padding:9px 11px}
  .gxc-badge{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(90deg,#f5b301,#ff8a3c);color:#241a00;
    font-weight:900;font-size:.62rem;letter-spacing:.4px;padding:3px 8px;border-radius:999px;cursor:pointer}
  .gxc-cast{position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-30px);z-index:99999;
    display:flex;align-items:center;gap:12px;max-width:min(460px,94vw);padding:13px 16px;border-radius:15px;
    background:rgba(18,22,39,.96);backdrop-filter:blur(18px);border:1px solid rgba(245,179,1,.35);
    box-shadow:0 18px 44px rgba(0,0,0,.5);color:#eef1fa;opacity:0;transition:opacity .3s,transform .3s;
    font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif}
  .gxc-cast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  .gxc-cast .ic{font-size:1.6rem}.gxc-cast .t{font-weight:800;font-size:.9rem}.gxc-cast .b{color:#b9c0d6;font-size:.8rem;margin-top:2px}
  .gxc-cast .x{background:none;border:none;color:#8a92ab;font-size:1rem;cursor:pointer;align-self:flex-start}`;
  document.head.appendChild(s);
}

function redeemRow(onDone) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="gxc-status" id="gxc-st"></div>
    <div class="gxc-redeem"><input class="gxc-input" id="gxc-code" placeholder="Paste credit code (GX-...)" spellcheck="false"><button class="gxc-btn" id="gxc-redeem">Redeem</button></div>`;
  const st = wrap.querySelector('#gxc-st');
  wrap.querySelector('#gxc-redeem').onclick = async () => {
    st.className = 'gxc-status'; st.textContent = 'Checking…';
    const r = await redeem(wrap.querySelector('#gxc-code').value);
    if (r && r.ok) { st.className = 'gxc-status ok'; st.textContent = `+${r.amount} credits! New balance: ${r.balance}.`; wrap.querySelector('#gxc-code').value = ''; onDone && onDone(r.balance); }
    else { st.className = 'gxc-status err'; st.textContent = (r && r.error) || 'Could not redeem.'; }
  };
  return wrap;
}

function modeTag() {
  if (_mode === 'server') return '☁️ Synced to your GamingX account' + (_admin ? ' · 🛠️ admin' : '');
  return hasBackend() ? '📴 Local credits — sign in to sync to your account' : '📴 Local credits (offline)';
}

function modal(opts) {
  opts = opts || {}; injectCss();
  const ov = document.createElement('div'); ov.className = 'gxc-ov';
  ov.innerHTML = `<div class="gxc-box">
    <div class="gxc-ic">${opts.icon || '⚡'}</div>
    <div class="gxc-title">${opts.title || 'GX Credits'}</div>
    <div class="gxc-bal" id="gxc-bal">${balance()} credits left</div>
    <div class="gxc-modetag">${modeTag()}</div>
    ${opts.message ? `<div class="gxc-msg">${opts.message}</div>` : ''}
    <a class="gxc-email" href="mailto:${EMAIL}?subject=GamingX%20extra%20credits">${EMAIL}</a>
    <div id="gxc-redeem-slot"></div>
    ${(_mode !== 'server' && hasBackend()) ? '<button class="gxc-btn2" id="gxc-signin">☁️ Sign in to sync credits</button>' : ''}
    <button class="gxc-btn2" id="gxc-close">Close</button>
    <div class="gxc-note">⚠️ ${_mode === 'server'
      ? 'Your balance is stored on your GamingX account and enforced by the server. Email for a top-up code and paste it above.'
      : 'These credits are on this device only. Sign in on a page with the GamingX backend to sync them to your account.'}</div>
  </div>`;
  const box = ov.querySelector('.gxc-box');
  box.querySelector('#gxc-redeem-slot').appendChild(redeemRow(b => { box.querySelector('#gxc-bal').textContent = b + ' credits left'; opts.onChange && opts.onChange(b); }));
  document.body.appendChild(ov);
  const close = () => { ov.remove(); opts.onClose && opts.onClose(); };
  box.querySelector('#gxc-close').onclick = close;
  const si = box.querySelector('#gxc-signin');
  if (si) si.onclick = () => {
    close();
    S().mountAuthGate({ appName: 'GamingX', tagline: 'Sign in to sync your GX credits', emoji: '⚡', accent: '#f5b301', accent2: '#ff8a3c',
      onAuthed: async () => { _ready = null; await init(); opts.onChange && opts.onChange(balance()); } });
  };
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  return ov;
}
function showOutOfCredits(opts) {
  opts = opts || {};
  return modal({ icon: '🔋', title: 'Out of credits',
    message: `${opts.feature ? '<b>' + opts.feature + '</b> costs ' + (opts.cost || 0) + ' credits, and you’re out. ' : ''}Email for extra credits — I’ll send a code you paste in below.`,
    onChange: opts.onChange });
}
function showWallet(opts) {
  opts = opts || {};
  return modal({ icon: '⚡', title: 'Your GamingX credits',
    message: 'Use them on the most powerful engine (particle &amp; glow FX). Need more? Email me for a top-up code.',
    onChange: opts.onChange });
}
function badgeHTML() { return `<span class="gxc-badge" title="Your credits — click for wallet">⚡ ${balance()}</span>`; }

return {
  init, refresh, mode, isServer, isAdmin, balance, prices, priceOf,
  spend, trySpend, redeem, add,
  adminClaim, adminSetPrice, adminGrant, adminMintCode, adminBroadcast, adminStats, sendPush,
  broadcasts, showBroadcasts,
  makeCode, checkDevKey, showWallet, showOutOfCredits, badgeHTML, injectCss,
  EMAIL, FREE_MONTHLY, DEFAULT_PRICE,
};
})();
