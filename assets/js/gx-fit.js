/* ============================================================================
   GX Fit — make full-screen game pages fit the *visible* viewport exactly.

   The problem: game pages set html,body{height:100%}. On mobile, 100% (and
   100vh) resolve to the LARGE viewport — the full screen including the strip
   behind the address/nav bar — so the bottom of the game hides behind the
   browser chrome and you have to scroll or pinch to reach it. And nothing
   re-fits when that bar shows/hides or the phone rotates.

   The fix: for pages that lock scrolling (body overflow hidden — i.e. games
   and app shells, never the scrolling hub), pin html+body to the real
   visible height (visualViewport) in pixels and fire a resize so each game's
   own canvas resize() recomputes. Self-scoping: on normal scrolling pages
   this does nothing.

   Loaded on every page; harmless where not needed.
   ========================================================================== */
(function () {
  'use strict';
  var locked = null;
  function isLocked() {
    try { return getComputedStyle(document.body).overflowY === 'hidden'; }
    catch (e) { return false; }
  }
  function visH() {
    return (window.visualViewport && Math.round(window.visualViewport.height)) || window.innerHeight;
  }
  function apply() {
    if (!document.body) return;
    if (locked === null) locked = isLocked();
    if (!locked) return;
    var h = visH() + 'px';
    document.documentElement.style.height = h;
    document.body.style.height = h;
  }
  function reflow() { apply(); try { window.dispatchEvent(new Event('resize')); } catch (e) {} }

  // bar show/hide → just re-pin the height (cheap; canvases read innerHeight live)
  if (window.visualViewport) window.visualViewport.addEventListener('resize', reflow);
  // rotation settles a beat after the event fires
  window.addEventListener('orientationchange', function () { setTimeout(reflow, 250); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  window.addEventListener('load', apply);
})();
