/* ============================================================================
   PENFRANK — built-in "demo creator" clips so the feed isn't empty on day
   one. These are NOT real people or real videos: each is a small canvas
   animation loop, clearly a placeholder, standing in for a short clip.
   ========================================================================== */
window.PFDemo = (() => {
'use strict';

const ACCOUNTS = [
  { style: 'wave', username: '@wave.lab', avatar: '🌊', caption: 'riding the frequency tonight ~', tags: ['wavey', 'synth', 'loop'] },
  { style: 'particles', username: '@glow.static', avatar: '✨', caption: 'a thousand little lights', tags: ['particles', 'glow', 'night'] },
  { style: 'bounce', username: '@bounce.house', avatar: '🏀', caption: 'physics but make it hypnotic', tags: ['bounce', 'loop', 'satisfying'] },
  { style: 'grid', username: '@pixel.parade', avatar: '🟪', caption: 'grid goes brrr', tags: ['grid', 'pixels', 'pulse'] },
  { style: 'spiral', username: '@spiral.zone', avatar: '🌀', caption: 'spinning into the weekend', tags: ['spiral', 'trippy', 'loop'] },
];

const COMMENT_POOL = [
  'this is so satisfying', 'need this on loop forever', 'okay but why is this so good',
  'the way it just keeps going...', "put this on a tv and i'd stare for hours",
  '10/10 no notes', 'why is this in my head now', 'the algorithm knew what it was doing',
];
function seedComments() {
  const n = 1 + Math.floor(Math.random() * 3);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: 'c' + Math.random().toString(36).slice(2),
      user: '@viewer' + (100 + Math.floor(Math.random() * 900)),
      avatar: ['👀', '🙂', '😮', '🔥', '👍'][Math.floor(Math.random() * 5)],
      text: COMMENT_POOL[Math.floor(Math.random() * COMMENT_POOL.length)],
      createdAt: Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 5),
    });
  }
  return out;
}

function makePosts() {
  return ACCOUNTS.map((a, i) => ({
    id: 'demo-' + a.style,
    kind: 'demo',
    demoStyle: a.style,
    username: a.username,
    avatar: a.avatar,
    caption: a.caption,
    tags: a.tags,
    mine: false,
    createdAt: Date.now() - (ACCOUNTS.length - i) * 1000 * 60 * 60 * 24,
    likes: 200 + Math.floor(Math.random() * 4000),
    likedByMe: false,
    saved: false,
    comments: seedComments(),
  }));
}

/* draw(ctx, w, h, t) — t is seconds elapsed; pure, stateless, deterministic. */
const DRAW = {
  wave(ctx, w, h, t) {
    ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, w, h);
    const bars = 40;
    for (let i = 0; i < bars; i++) {
      const x = (i / bars) * w;
      const y = h / 2 + Math.sin(t * 2 + i * 0.4) * h * 0.18 + Math.sin(t * 0.7 + i * 0.15) * h * 0.08;
      const grad = ctx.createLinearGradient(0, y - 40, 0, y + 40);
      grad.addColorStop(0, '#ff5470'); grad.addColorStop(1, '#2dd4bf');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y - 6, w / bars + 1, 12);
    }
  },
  particles(ctx, w, h, t) {
    ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, w, h);
    const n = 46;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i * 0.37 + t * 0.3;
      const r = (h * 0.4) * ((i % 7) / 7 + 0.3);
      const x = w / 2 + Math.cos(a + i) * r * 0.6 + Math.sin(t + i) * 20;
      const y = h / 2 + Math.sin(a * 1.3 + i) * r * 0.5 + Math.cos(t * 0.5 + i) * 20;
      pts.push([x, y]);
    }
    ctx.strokeStyle = 'rgba(45,212,191,0.25)'; ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1];
        if (dx * dx + dy * dy < 6000) { ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[j][0], pts[j][1]); ctx.stroke(); }
      }
    }
    ctx.fillStyle = '#ff5470';
    for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
  },
  bounce(ctx, w, h, t) {
    ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, w, h);
    const balls = 5;
    for (let i = 0; i < balls; i++) {
      const period = 1.2 + i * 0.15;
      const phase = t / period + i * 0.6;
      const bounceY = Math.abs(Math.sin(phase * Math.PI));
      const y = h * 0.15 + (h * 0.7) * (1 - bounceY);
      const x = w * (0.15 + i * 0.7 / (balls - 1));
      ctx.fillStyle = i % 2 ? '#ff5470' : '#2dd4bf';
      ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
    }
  },
  grid(ctx, w, h, t) {
    ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, w, h);
    const cols = 10, rows = 18;
    const cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pulse = (Math.sin(t * 2 + (r + c) * 0.5) + 1) / 2;
        ctx.fillStyle = `rgba(${Math.round(255 * pulse)},${Math.round(84 + 80 * (1 - pulse))},${Math.round(112 + 100 * pulse)},${0.15 + 0.5 * pulse})`;
        ctx.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4);
      }
    }
  },
  spiral(ctx, w, h, t) {
    ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2, h / 2);
    const arms = 3;
    for (let a = 0; a < arms; a++) {
      ctx.rotate(t * 0.3 + Math.PI * 2 / arms);
      ctx.strokeStyle = a % 2 ? '#ff5470' : '#2dd4bf'; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i < 200; i++) {
        const ang = i * 0.15;
        const r = i * 1.1;
        const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  },
};

return { ACCOUNTS, makePosts, DRAW };
})();
