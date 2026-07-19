/* ============================================================================
   Gam+ — GamingX's premium tier.

   HONEST NOTE (shown to users too): this platform can't take real payments,
   and $0.10/month isn't chargeable by real card processors anyway (they have
   ~$0.50 minimums and per-transaction fees larger than a dime). So "upgrading"
   here is a local DEMO activation — it flips a flag on this device, no money
   changes hands, and it is NOT real access control. Real billing would need a
   payment processor + backend and a viable price.
   ========================================================================== */
window.GXPlus = (() => {
'use strict';
const KEY = 'gamingx.plus';
const PRICE = '$0.10 / month';

function state() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
function isActive() { const s = state(); return !!(s && s.active); }
function activateDemo() { try { localStorage.setItem(KEY, JSON.stringify({ active: true, since: Date.now(), demo: true })); } catch (e) {} }
function deactivate() { try { localStorage.removeItem(KEY); } catch (e) {} }

let _css = false;
function injectCss() {
  if (_css) return; _css = true;
  const s = document.createElement('style');
  s.textContent = `
  .gxp-ov{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;
    background:rgba(6,8,14,.72);backdrop-filter:blur(6px);font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif}
  .gxp-box{width:min(440px,94vw);background:#121627;border:1px solid rgba(255,255,255,.1);border-radius:20px;
    padding:26px;color:#eef1fa;box-shadow:0 30px 80px rgba(0,0,0,.6);text-align:center}
  .gxp-crown{font-size:2.6rem}
  .gxp-title{font-size:1.5rem;font-weight:900;margin:6px 0 2px}
  .gxp-title span{background:linear-gradient(90deg,#f5b301,#ff8a3c);-webkit-background-clip:text;background-clip:text;color:transparent}
  .gxp-price{font-weight:800;color:#f5b301;margin-bottom:14px}
  .gxp-feats{text-align:left;margin:0 auto 16px;max-width:320px;display:flex;flex-direction:column;gap:9px}
  .gxp-feat{display:flex;gap:10px;align-items:flex-start;font-size:.88rem}
  .gxp-feat .ic{color:#f5b301}
  .gxp-btn{width:100%;padding:13px;border-radius:12px;font-weight:800;font-size:.95rem;border:none;cursor:pointer;
    background:linear-gradient(90deg,#f5b301,#ff8a3c);color:#241a00;margin-top:4px}
  .gxp-btn2{width:100%;padding:11px;border-radius:12px;font-weight:800;font-size:.85rem;cursor:pointer;margin-top:8px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#eef1fa}
  .gxp-note{margin-top:16px;font-size:.66rem;line-height:1.5;color:#9aa3bd;text-align:left;
    background:rgba(245,179,1,.06);border:1px dashed rgba(245,179,1,.3);border-radius:10px;padding:9px 11px}
  .gxp-badge{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(90deg,#f5b301,#ff8a3c);color:#241a00;
    font-weight:900;font-size:.62rem;letter-spacing:.5px;padding:3px 8px;border-radius:999px}`;
  document.head.appendChild(s);
}

/* showUpgrade({ feature, features[], onActivate, onClose }) */
function showUpgrade(opts) {
  opts = opts || {};
  injectCss();
  const feats = opts.features || [
    'The most powerful engine — <b>GX Studio Pro</b>',
    'Real particle &amp; glow FX systems',
    'No limits — build as big as you want',
    'A Gam+ badge across GamingX',
  ];
  const ov = document.createElement('div'); ov.className = 'gxp-ov';
  ov.innerHTML = `<div class="gxp-box">
    <div class="gxp-crown">👑</div>
    <div class="gxp-title">Gam<span>+</span></div>
    <div class="gxp-price">${PRICE}</div>
    ${opts.feature ? `<div style="color:#9aa3bd;font-size:.86rem;margin-bottom:12px">${opts.feature} is a Gam+ feature.</div>` : ''}
    <div class="gxp-feats">${feats.map(f => `<div class="gxp-feat"><span class="ic">✦</span><span>${f}</span></div>`).join('')}</div>
    <button class="gxp-btn" id="gxp-go">Activate Gam+ (demo)</button>
    <button class="gxp-btn2" id="gxp-no">Maybe later</button>
    <div class="gxp-note">⚠️ <b>This is a demo, not a real purchase.</b> GamingX can't take payments, and $0.10/month isn't something real card processors can charge (they have ~$0.50 minimums and fees bigger than a dime). Tapping “Activate” just turns Gam+ on locally on this device — no money is taken, and it isn't real access control.</div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('#gxp-no').onclick = () => { close(); opts.onClose && opts.onClose(false); };
  ov.querySelector('#gxp-go').onclick = () => { activateDemo(); close(); opts.onActivate && opts.onActivate(); };
  ov.addEventListener('click', e => { if (e.target === ov) { close(); opts.onClose && opts.onClose(false); } });
}

/* gate(onOk, opts): run onOk if Gam+ is active, else show the upgrade modal
   (and run onOk after a successful demo activation). */
function gate(onOk, opts) {
  if (isActive()) { onOk(); return; }
  showUpgrade(Object.assign({}, opts, { onActivate: () => onOk() }));
}

function badgeHTML() { return '<span class="gxp-badge">👑 GAM+</span>'; }

return { isActive, activateDemo, deactivate, showUpgrade, gate, badgeHTML, PRICE };
})();
