/* ============================================================================
   GamX — GamingX's plain-English scripting language ("dumb English").
   You write friendly lines like:

       when the game starts:
         say "hello!"
         make me blue

       every frame:
         spin 90
         if key "W" is down:
           move forward 6
         end
         if player is near 2:
           add 10 to score
           win

   GamX.toJS(source) transpiles that to plain JS that defines
   onStart/onUpdate/onCollide against the GX Studio script `api` — so GamX
   scripts run through the exact same engine as hand-written JS scripts.
   ========================================================================== */
window.GamX = (() => {
'use strict';

const COLORS = {
  red: '#e5484d', blue: '#3aa0ff', green: '#46c46a', yellow: '#f2c14e', orange: '#f2842b',
  purple: '#a855f7', pink: '#ff6ac1', cyan: '#22d3ee', white: '#ffffff', black: '#141414',
  gray: '#8a93ad', grey: '#8a93ad', brown: '#9b6a3a', lime: '#a3e635', gold: '#f5c542',
};
const NUMWORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const KEYWORDS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: 'Space', spacebar: 'Space' };

class GamXError extends Error {}

function numTok(t) {
  t = String(t).trim().toLowerCase();
  if (t in NUMWORDS) return NUMWORDS[t];
  const n = parseFloat(t);
  if (isNaN(n)) throw new GamXError('expected a number but got "' + t + '"');
  return n;
}
function keyCode(t) {
  t = String(t).replace(/["']/g, '').trim().toLowerCase();
  if (KEYWORDS[t]) return KEYWORDS[t];
  if (t.length === 1) return (t >= '0' && t <= '9') ? 'Digit' + t : 'Key' + t.toUpperCase();
  return 'Key' + t.toUpperCase();
}
/* a value: number, "string", color word, or a variable name */
function value(t, vars) {
  t = t.trim();
  const q = t.match(/^["'](.*)["']$/);
  if (q) return JSON.stringify(q[1]);
  if (/^-?[\d.]+$/.test(t)) return String(numTok(t));
  if (t.toLowerCase() in NUMWORDS) return String(NUMWORDS[t.toLowerCase()]);
  if (/^[a-zA-Z_]\w*$/.test(t)) { vars.add(t); return t; }
  // simple arithmetic like "speed + 1"
  const m = t.match(/^([a-zA-Z_]\w*)\s*([+\-*/])\s*(-?[\d.]+)$/);
  if (m) { vars.add(m[1]); return m[1] + ' ' + m[2] + ' ' + numTok(m[3]); }
  throw new GamXError('I don\'t understand the value "' + t + '"');
}
function colorHex(t) {
  t = t.replace(/["']/g, '').trim().toLowerCase();
  if (COLORS[t]) return JSON.stringify(COLORS[t]);
  if (/^#[0-9a-f]{6}$/i.test(t)) return JSON.stringify(t);
  throw new GamXError('"' + t + '" isn\'t a colour I know (try red, blue, green, …)');
}

/* ---- condition after `if` ---- */
function condition(text, vars) {
  const t = text.trim().replace(/:$/, '').trim();
  let m;
  if ((m = t.match(/^key\s+(.+?)\s+is\s+(down|pressed|held)$/i))) return "api.input.isDown('" + keyCode(m[1]) + "')";
  if ((m = t.match(/^(?:the\s+)?player\s+is\s+near(?:\s+me)?\s+([\w.]+)$/i)) || (m = t.match(/^near\s+player\s+([\w.]+)$/i)))
    return "(function(){var _p=api.find('Player');return _p&&api.distance(_p)<(" + numTok(m[1]) + ");})()";
  if ((m = t.match(/^([a-zA-Z_]\w*)\s+is\s+(?:more than|greater than|above|over)\s+(.+)$/i))) { vars.add(m[1]); return '(' + m[1] + ' > ' + value(m[2], vars) + ')'; }
  if ((m = t.match(/^([a-zA-Z_]\w*)\s+is\s+(?:less than|under|below)\s+(.+)$/i))) { vars.add(m[1]); return '(' + m[1] + ' < ' + value(m[2], vars) + ')'; }
  if ((m = t.match(/^([a-zA-Z_]\w*)\s+is\s+(.+?)\s+or\s+more$/i))) { vars.add(m[1]); return '(' + m[1] + ' >= ' + value(m[2], vars) + ')'; }
  if ((m = t.match(/^([a-zA-Z_]\w*)\s+is\s+(.+?)\s+or\s+less$/i))) { vars.add(m[1]); return '(' + m[1] + ' <= ' + value(m[2], vars) + ')'; }
  if ((m = t.match(/^([a-zA-Z_]\w*)\s+is\s+(.+)$/i))) { vars.add(m[1]); return '(' + m[1] + ' == ' + value(m[2], vars) + ')'; }
  throw new GamXError('I don\'t understand the "if" condition: "' + text + '"');
}

/* ---- one command line -> a JS statement ---- */
function command(line, vars) {
  const t = line.trim().replace(/[.:]$/, '').trim();
  const low = t.toLowerCase();
  let m;

  if ((m = low.match(/^move\s+(forward|forwards|back|backward|backwards|left|right|up|down)\s+(.+)$/))) {
    const amt = numTok(m[2]); const d = m[1];
    let dx = '0', dy = '0', dz = '0';
    if (d.startsWith('forward')) dz = '(' + (-amt) + ')*api.dt';
    else if (d.startsWith('back')) dz = '(' + amt + ')*api.dt';
    else if (d === 'left') dx = '(' + (-amt) + ')*api.dt';
    else if (d === 'right') dx = '(' + amt + ')*api.dt';
    else if (d === 'up') dy = '(' + amt + ')*api.dt';
    else if (d === 'down') dy = '(' + (-amt) + ')*api.dt';
    return '{var _p=api.entity.getPosition();api.entity.setPosition(_p.x+' + dx + ',_p.y+' + dy + ',_p.z+' + dz + ');}';
  }
  if ((m = low.match(/^(?:move|go|teleport)\s+to\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)$/)))
    return 'api.entity.setPosition(' + numTok(m[1]) + ',' + numTok(m[2]) + ',' + numTok(m[3]) + ');';
  if ((m = low.match(/^(?:spin|rotate|turn)\s+(.+)$/)))
    return 'api.entity.rotateY((' + numTok(m[1]) + ')*api.dt*0.0174533);';
  if ((m = t.match(/^say\s+(.+)$/i)))
    return 'api.log(' + value(m[1], vars) + ');';
  if ((m = low.match(/^add\s+(.+?)\s+to\s+score$/)))
    return 'api.score.add(' + value(m[1], vars) + ');';
  if (low === 'jump') return 'api.velocity.add(0,8,0);';
  if (/^(win|you win|level clear)$/.test(low)) return "api.end({win:true,message:'You win!'});";
  if (/^(lose|you lose|game over)$/.test(low)) return "api.end({win:false,message:'Game over!'});";
  if (/^(destroy|remove|delete)\s+(me|myself|this)$/.test(low)) return 'api.destroySelf();';
  if ((m = low.match(/^(?:make me|set my colou?r to|turn me)\s+(.+)$/)))
    return 'if(api.entity.setColor)api.entity.setColor(' + colorHex(m[1]) + ');';
  if ((m = low.match(/^set my position to\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)$/)))
    return 'api.entity.setPosition(' + numTok(m[1]) + ',' + numTok(m[2]) + ',' + numTok(m[3]) + ');';
  // variables:  let speed be 5   /   set speed to 6
  if ((m = t.match(/^let\s+([a-zA-Z_]\w*)\s+(?:be|=|is)\s+(.+)$/i))) { vars.add(m[1]); return m[1] + ' = ' + value(m[2], vars) + ';'; }
  if ((m = t.match(/^set\s+([a-zA-Z_]\w*)\s+to\s+(.+)$/i))) { vars.add(m[1]); return m[1] + ' = ' + value(m[2], vars) + ';'; }
  if ((m = t.match(/^(?:change|increase)\s+([a-zA-Z_]\w*)\s+by\s+(.+)$/i))) { vars.add(m[1]); return m[1] + ' = ' + m[1] + ' + ' + value(m[2], vars) + ';'; }

  throw new GamXError('I don\'t understand the line: "' + line.trim() + '"');
}

function toJS(src) {
  const lines = String(src || '').split('\n');
  const buffers = { start: [], update: [], collide: [] };
  const pre = [];
  const vars = new Set();
  const stack = []; // {type:'event'|'if', name?}
  const curBuf = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].type === 'event') return buffers[stack[i].name]; return pre; };
  const closeOpenEvent = () => { while (stack.length) { const b = stack[stack.length - 1]; if (b.type === 'if') { stack.pop(); curBuf().push('}'); } else { stack.pop(); break; } } };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/#.*/, '').replace(/\/\/.*/, '');
    if (!line.trim()) continue;
    const low = line.trim().toLowerCase().replace(/:$/, '').trim();
    try {
      if (/^(when (the )?(game|play) starts|on start|at the start|when i spawn)$/.test(low)) { closeOpenEvent(); stack.push({ type: 'event', name: 'start' }); continue; }
      if (/^(every frame|always|on update|each frame|repeat forever|forever)$/.test(low)) { closeOpenEvent(); stack.push({ type: 'event', name: 'update' }); continue; }
      if (/^(when touched|on touch|when i am touched|when hit)$/.test(low)) { closeOpenEvent(); stack.push({ type: 'event', name: 'collide' }); continue; }
      if (low === 'end' || low === 'end if') { const b = stack[stack.length - 1]; if (b && b.type === 'if') { stack.pop(); curBuf().push('}'); } else if (b) { stack.pop(); } continue; }
      if (/^if\s+/.test(low)) { curBuf().push('if(' + condition(low.replace(/^if\s+/, ''), vars) + '){'); stack.push({ type: 'if' }); continue; }
      if (/^(otherwise|else)$/.test(low)) { curBuf().push('} else {'); continue; }
      curBuf().push(command(line, vars));
    } catch (e) {
      throw new GamXError('GamX line ' + (i + 1) + ': ' + e.message);
    }
  }
  while (stack.length) { const b = stack.pop(); if (b.type === 'if') curBuf().push('}'); }

  const decl = vars.size ? 'var ' + [...vars].join(', ') + ';\n' : '';
  let js = decl + pre.join('\n') + '\n';
  js += 'function onStart(api){\n' + buffers.start.join('\n') + '\n}\n';
  js += 'function onUpdate(api){\n' + buffers.update.join('\n') + '\n}\n';
  if (buffers.collide.length) js += 'function onCollide(api, other){\n' + buffers.collide.join('\n') + '\n}\n';
  return js;
}

const SAMPLE =
`# GamX — plain-English code. Try pressing Play!
when the game starts:
  say "hi, I'm a GamX part!"
  make me purple

every frame:
  spin 90
  if key "W" is down:
    move forward 6
  end`;

return { toJS, SAMPLE, COLORS, GamXError };
})();
