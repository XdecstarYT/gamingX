/* ============================================================================
   GX BLOCKS — the "GamX Lite" visual block model.
   Each block is data: { id, type, inputs:{...}, body:[...] (C-blocks only) }.
   BLOCKS below is the palette + how each block renders (tokens) + its category
   colour. The engine (engine.js) interprets these; the editor (editor.js)
   renders them from the same token spec.
   ========================================================================== */
window.GXBlocks = (() => {
'use strict';

const CATS = {
  events:  { label: 'Events',  color: '#f5b301' },
  motion:  { label: 'Motion',  color: '#4c97ff' },
  looks:   { label: 'Looks',   color: '#9966ff' },
  control: { label: 'Control', color: '#ff9a1f' },
  game:    { label: 'Game',    color: '#e5679a' },
};

/* token: a plain string (literal) OR an input {s:slot, k:kind, d:default, opts?} */
const BLOCKS = {
  // events (hats)
  start: { cat: 'events', hat: true, tokens: ['when ▶ clicked'] },
  frame: { cat: 'events', hat: true, tokens: ['every frame'] },
  key:   { cat: 'events', hat: true, tokens: ['when', { s: 'key', k: 'key', d: 'Space' }, 'pressed'] },
  // motion
  changeX: { cat: 'motion', tokens: ['change x by', { s: 'n', k: 'num', d: 10 }] },
  changeY: { cat: 'motion', tokens: ['change y by', { s: 'n', k: 'num', d: 10 }] },
  setX:    { cat: 'motion', tokens: ['set x to', { s: 'n', k: 'num', d: 0 }] },
  setY:    { cat: 'motion', tokens: ['set y to', { s: 'n', k: 'num', d: 0 }] },
  bounce:  { cat: 'motion', tokens: ['bounce on edges'] },
  // looks
  setColor:   { cat: 'looks', tokens: ['set colour to', { s: 'color', k: 'color', d: '#ff5470' }] },
  changeSize: { cat: 'looks', tokens: ['change size by', { s: 'n', k: 'num', d: 10 }] },
  setSize:    { cat: 'looks', tokens: ['set size to', { s: 'n', k: 'num', d: 40 }] },
  show:       { cat: 'looks', tokens: ['show'] },
  hide:       { cat: 'looks', tokens: ['hide'] },
  say:        { cat: 'looks', tokens: ['say', { s: 'text', k: 'text', d: 'Hi!' }] },
  // control (C-blocks have body)
  if:     { cat: 'control', c: true, tokens: ['if', { s: 'cond', k: 'cond' }] },
  repeat: { cat: 'control', c: true, tokens: ['repeat', { s: 'n', k: 'num', d: 10 }, 'times'] },
  // game
  addScore: { cat: 'game', tokens: ['add', { s: 'n', k: 'num', d: 1 }, 'to score'] },
  win:      { cat: 'game', tokens: ['win the game'] },
  lose:     { cat: 'game', tokens: ['lose the game'] },
  destroy:  { cat: 'game', tokens: ['destroy me'] },
};

/* palette layout (order shown in the picker) */
const PALETTE = {
  events:  ['start', 'frame', 'key'],
  motion:  ['changeX', 'changeY', 'setX', 'setY', 'bounce'],
  looks:   ['setColor', 'changeSize', 'setSize', 'show', 'hide', 'say'],
  control: ['if', 'repeat'],
  game:    ['addScore', 'win', 'lose', 'destroy'],
};

const KEYS = ['Space', 'Up', 'Down', 'Left', 'Right', 'W', 'A', 'S', 'D', 'E', 'F', 'Q'];
function keyCode(k) {
  const map = { Space: 'Space', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };
  if (map[k]) return map[k];
  return 'Key' + String(k || '').toUpperCase();
}

let n = 1;
const uid = () => 'b' + (n++) + Math.random().toString(36).slice(2, 5);

function defaultCond() { return { kind: 'key', key: 'Space', target: 'edge', n: 10 }; }
function newBlock(type) {
  const def = BLOCKS[type];
  const b = { id: uid(), type, inputs: {} };
  for (const tok of def.tokens) {
    if (typeof tok === 'object') {
      if (tok.k === 'cond') b.inputs[tok.s] = defaultCond();
      else b.inputs[tok.s] = tok.d;
    }
  }
  if (def.c) b.body = [];
  return b;
}

return { CATS, BLOCKS, PALETTE, KEYS, keyCode, newBlock, uid };
})();
