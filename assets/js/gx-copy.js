/* ============================================================================
   GX Copy — a clipboard helper that tells the truth.

   The bug this fixes: several "Copy code" buttons called
   navigator.clipboard.writeText(...).catch(() => {}) and then unconditionally
   showed "Copied to clipboard" — even when the write silently failed (no
   secure context, no permission, no navigator.clipboard at all on an older
   mobile browser). With no real feedback, the only way left to grab the code
   was to manually select the tiny text by hand, which is exactly what forces
   pinch-zooming in on a phone.

   copy(text) resolves to the REAL outcome:
     { ok: true }                      — clipboard write succeeded
     { ok: false, manual: true, el }    — clipboard failed; el is a visible,
                                          already-selected input the user can
                                          long-press → Copy on
   ========================================================================== */
window.GXCopy = (() => {
'use strict';

async function viaClipboardApi(text) {
  if (!window.isSecureContext || !navigator.clipboard || !navigator.clipboard.writeText) return false;
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}

/* Legacy fallback: a visible (not display:none — iOS refuses to select
   invisible nodes), off-screen textarea, select + execCommand('copy'). */
function viaExecCommand(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0.01;font-size:16px';
  document.body.appendChild(ta);
  const prevFocus = document.activeElement;
  ta.focus({ preventScroll: true });
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS Safari needs this even after select()
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (e) {}
  return ok;
}

/* copy(text) -> Promise<{ok:boolean}> */
async function copy(text) {
  if (await viaClipboardApi(text)) return { ok: true };
  if (viaExecCommand(text)) return { ok: true };
  return { ok: false };
}

/* copyFromField(el) — el is a visible <input>/<textarea> already holding the
   text on-screen. Tries the clipboard API first; if that fails, selects the
   field's contents so the user has one clean tap-and-hold target instead of
   having to zoom in to find the start/end of a selection themselves. */
async function copyFromField(el) {
  const text = el.value;
  if (await viaClipboardApi(text)) return { ok: true };
  el.focus({ preventScroll: true });
  el.select();
  try { el.setSelectionRange(0, text.length); } catch (e) {}
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  return { ok, manual: !ok, el };
}

return { copy, copyFromField };
})();
