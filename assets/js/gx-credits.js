/* ============================================================================
   GX Credits — the usage-limit / credits layer for GamingX's most powerful
   engine (GX Studio Pro's particle & glow FX).

   HOW IT WORKS
   - The powerful engine is FREE, but metered. Everyone gets a monthly credit
     allowance. Using Pro FX (adding a particle emitter / particles) spends
     credits.
   - Run out? Email the dev (decmar098@gmail.com). The dev mints a redeem code
     in the "Dev Hub" and sends it back. Paste it in to top up.

   HONEST NOTE (also shown to users): this is all client-side (localStorage),
   so it's an honour-system meter with light friction, not real security. A
   technical user could read the secret from this file or edit their balance in
   devtools. Real metering would need a backend that owns the balance and
   verifies codes server-side.
   ========================================================================== */
window.GXCredits = (() => {
'use strict';

const KEY = 'gamingx.credits';
const EMAIL = 'decmar098@gmail.com';
const FREE_MONTHLY = 100;   // free floor topped up at the start of each month
const CAP = 100000;

/* Dev Hub passcode — CHANGE THIS to your own secret. Anyone with it can mint
   credit codes. Keep it off the public internet / don't paste it in chats. */
const DEV_KEY = 'decstar-gamingx-devhub-2026';
/* Secret used to sign redeem codes. CHANGE THIS too (must match on all copies
   of the site). If you change it, previously issued codes stop validating. */
const CODE_SECRET = 'gx-credit-sig-a7Kd93QpZ-2026';

/* ---- storage ---- */
function monthTag() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); }
function load() {
  let s; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
  if (!s || typeof s.balance !== 'number') s = { balance: FREE_MONTHLY, month: monthTag(), redeemed: [], total: 0 };
  if (!Array.isArray(s.redeemed)) s.redeemed = [];
  // monthly free top-up (raises to the free floor; never lowers a bigger balance)
  if (s.month !== monthTag()) { s.month = monthTag(); if (s.balance < FREE_MONTHLY) s.balance = FREE_MONTHLY; }
  return s;
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }

function balance() { const s = load(); save(s); return s.balance; }
function canAfford(cost) { return balance() >= cost; }
function add(amount) { const s = load(); s.balance = Math.min(CAP, s.balance + Math.max(0, Math.round(amount))); s.total = (s.total || 0) + amount; save(s); return s.balance; }
/* spend(cost): deduct if affordable, return true; else return false (no change) */
function spend(cost) { const s = load(); if (s.balance < cost) { save(s); return false; } s.balance -= cost; save(s); return true; }

/* ---- redeem codes: GX-<amount>-<nonce>-<sig> ---- */
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
/* redeem(code) -> {ok, amount, balance} | {ok:false, error} */
function redeem(code) {
  if (!code) return { ok: false, error: 'Enter a code.' };
  const parts = String(code).trim().toUpperCase().replace(/\s+/g, '').split('-');
  if (parts.length !== 4 || parts[0] !== 'GX') return { ok: false, error: 'That doesn’t look like a GamingX code.' };
  const amount = parseInt(parts[1], 10), nonce = parts[2], sig = parts[3];
  if (!(amount > 0)) return { ok: false, error: 'Invalid amount in code.' };
  if (sigFor(amount, nonce) !== sig) return { ok: false, error: 'This code isn’t valid.' };
  const s = load();
  if (s.redeemed.indexOf(nonce) !== -1) return { ok: false, error: 'This code was already used.' };
  s.redeemed.push(nonce); s.balance = Math.min(CAP, s.balance + amount); s.total = (s.total || 0) + amount; save(s);
  return { ok: true, amount, balance: s.balance };
}

function checkDevKey(key) { return String(key || '').trim() === DEV_KEY; }

/* ---- UI ---- */
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
  .gxc-bal{font-weight:800;color:#f5b301;margin-bottom:14px;font-size:1.05rem}
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
    font-weight:900;font-size:.62rem;letter-spacing:.4px;padding:3px 8px;border-radius:999px;cursor:pointer}`;
  document.head.appendChild(s);
}

function redeemRow(onDone) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="gxc-status" id="gxc-st"></div>
    <div class="gxc-redeem"><input class="gxc-input" id="gxc-code" placeholder="Paste credit code (GX-...)" spellcheck="false"><button class="gxc-btn" id="gxc-redeem">Redeem</button></div>`;
  const st = wrap.querySelector('#gxc-st');
  wrap.querySelector('#gxc-redeem').onclick = () => {
    const r = redeem(wrap.querySelector('#gxc-code').value);
    if (r.ok) { st.className = 'gxc-status ok'; st.textContent = `+${r.amount} credits! New balance: ${r.balance}.`; wrap.querySelector('#gxc-code').value = ''; onDone && onDone(r.balance); }
    else { st.className = 'gxc-status err'; st.textContent = r.error; }
  };
  return wrap;
}

/* modal({icon,title,message,onClose,onChange}) */
function modal(opts) {
  opts = opts || {}; injectCss();
  const ov = document.createElement('div'); ov.className = 'gxc-ov';
  ov.innerHTML = `<div class="gxc-box">
    <div class="gxc-ic">${opts.icon || '⚡'}</div>
    <div class="gxc-title">${opts.title || 'GX Credits'}</div>
    <div class="gxc-bal" id="gxc-bal">${balance()} credits left</div>
    ${opts.message ? `<div class="gxc-msg">${opts.message}</div>` : ''}
    <a class="gxc-email" href="mailto:${EMAIL}?subject=GamingX%20extra%20credits">${EMAIL}</a>
    <div id="gxc-redeem-slot"></div>
    <button class="gxc-btn2" id="gxc-close">Close</button>
    <div class="gxc-note">⚠️ Credits are stored on this device only. Emailing for more is the real way to top up — the dev sends back a code you paste above. This meter is honour-system, not hard security.</div>
  </div>`;
  const box = ov.querySelector('.gxc-box');
  box.querySelector('#gxc-redeem-slot').appendChild(redeemRow(b => {
    box.querySelector('#gxc-bal').textContent = b + ' credits left';
    opts.onChange && opts.onChange(b);
  }));
  document.body.appendChild(ov);
  const close = () => { ov.remove(); opts.onClose && opts.onClose(); };
  box.querySelector('#gxc-close').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  return ov;
}

function showOutOfCredits(opts) {
  opts = opts || {};
  return modal({
    icon: '🔋', title: 'Out of credits',
    message: `${opts.feature ? '<b>' + opts.feature + '</b> costs ' + (opts.cost || 0) + ' credits, and you’re out. ' : ''}Email for extra credits — I’ll send a code you paste in below.`,
    onChange: opts.onChange,
  });
}
function showWallet(opts) {
  opts = opts || {};
  return modal({
    icon: '⚡', title: 'Your GamingX credits',
    message: 'Use them on the most powerful engine (particle &amp; glow FX). Need more? Email me for a top-up code.',
    onChange: opts.onChange,
  });
}

/* try to spend; if not enough, pop the out-of-credits modal. returns true on spend. */
function trySpend(cost, feature, onChange) {
  if (spend(cost)) return true;
  showOutOfCredits({ feature, cost, onChange });
  return false;
}

function badgeHTML() { return `<span class="gxc-badge" title="Your credits — click for wallet">⚡ ${balance()}</span>`; }

return { balance, canAfford, add, spend, trySpend, redeem, makeCode, checkDevKey,
         showOutOfCredits, showWallet, badgeHTML, injectCss, EMAIL, FREE_MONTHLY, DEV_KEY_HINT: 'set in gx-credits.js' };
})();
