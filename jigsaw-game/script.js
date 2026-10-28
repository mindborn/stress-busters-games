'use strict';

/* ============================================================
   Jigsaw Puzzle — game logic
   - Real jigsaw-shaped pieces (shared bezier edge between neighbours)
   - Drag a piece/group onto another: matching neighbours fuse & move as one
   - Win when every piece has been fused into a single group
   ============================================================ */

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const fmtTime = ms => {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};
const cubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/* ---------------- tiny sound engine ---------------- */
let actx = null;
function sound(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t0 = actx.currentTime;
    const note = (f, at, dur, vol) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, at);
      o.frequency.exponentialRampToValueAtTime(Math.max(50, f * 0.6), at + dur);
      g.gain.setValueAtTime(vol, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g).connect(actx.destination);
      o.start(at); o.stop(at + dur + 0.03);
    };
    if (kind === 'pick') note(340, t0, 0.06, 0.05);
    else if (kind === 'snap') { note(520, t0, 0.09, 0.16); note(780, t0 + 0.04, 0.08, 0.11); }
    else if (kind === 'win') [523, 659, 784, 1047].forEach((f, i) => note(f, t0 + i * 0.13, 0.26, 0.15));
  } catch (e) { /* audio unavailable — fine */ }
}

/* ---------------- DOM refs ---------------- */
const els = {
  setup: $('#setup'), game: $('#game'),
  dropzone: $('#dropzone'), dzInner: $('#dzInner'), fileInput: $('#fileInput'), previewImg: $('#previewImg'),
  sizeGrid: $('#sizeGrid'), startBtn: $('#startBtn'), sampleBtn: $('#sampleBtn'),
  playfield: $('#playfield'), hint: $('#hint'), stage: $('.stage'),
  previewLayer: $('#previewLayer'), previewBig: $('#previewBig'), previewBtn: $('#previewBtn'),
  restartBtn: $('#restartBtn'), newBtn: $('#newBtn'),
  movesEl: $('#movesEl'), timeEl: $('#timeEl'),
  winBar: $('#winBar'), winStats: $('#winStats'), againBtn: $('#againBtn'), changeBtn: $('#changeBtn'),
};

let img = null;        // source image
let tileSize = 24;     // approximate number of pieces
let game = null;       // active game state
let zTop = 10;

/* ============================================================
   SETUP SCREEN
   ============================================================ */
els.dropzone.addEventListener('click', () => els.fileInput.click());
els.dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') els.fileInput.click(); });
els.fileInput.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) loadFile(f);
});
['dragenter', 'dragover'].forEach(ev =>
  els.dropzone.addEventListener(ev, e => { e.preventDefault(); els.dropzone.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev =>
  els.dropzone.addEventListener(ev, e => { e.preventDefault(); els.dropzone.classList.remove('over'); }));
els.dropzone.addEventListener('drop', e => {
  const f = [...(e.dataTransfer ? e.dataTransfer.files : [])].find(f => f.type.startsWith('image/'));
  if (f) loadFile(f);
});

function loadFile(file) {
  setPicture(URL.createObjectURL(file));
}

function setPicture(src) {
  const im = new Image();
  im.onload = () => {
    img = im;
    els.previewImg.src = src;
    els.previewImg.hidden = false;
    els.dropzone.classList.add('has-img');
    els.startBtn.disabled = false;
  };
  im.onerror = () => alert('Could not load that image — please try another file.');
  im.src = src;
}

els.sizeGrid.addEventListener('click', e => {
  const btn = e.target.closest('.size-btn');
  if (!btn) return;
  els.sizeGrid.querySelectorAll('.size-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  tileSize = parseInt(btn.dataset.n, 10);
});

/* --- generated sample picture (works fully offline) --- */
els.sampleBtn.addEventListener('click', () => {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 810;
  const g = c.getContext('2d');

  // dusk sky
  const sky = g.createLinearGradient(0, 0, 0, 810);
  sky.addColorStop(0, '#101c4d');
  sky.addColorStop(0.45, '#6d2f84');
  sky.addColorStop(0.75, '#d95f76');
  sky.addColorStop(1, '#f7a76c');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1080, 810);

  // stars
  for (let i = 0; i < 140; i++) {
    g.globalAlpha = rnd(0.15, 0.9);
    g.fillStyle = '#fff';
    const r = rnd(0.8, 2.2);
    g.beginPath();
    g.arc(rnd(0, 1080), rnd(0, 400), r, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;

  // glowing sun
  const glow = g.createRadialGradient(540, 470, 20, 540, 470, 240);
  glow.addColorStop(0, 'rgba(255,236,170,.95)');
  glow.addColorStop(0.25, 'rgba(255,190,110,.55)');
  glow.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = glow;
  g.fillRect(240, 230, 600, 500);
  g.fillStyle = '#ffe9b8';
  g.beginPath(); g.arc(540, 470, 78, 0, 7); g.fill();

  // layered hills
  const hill = (color, peaks, base, amp) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 810);
    g.lineTo(0, base);
    peaks.forEach(([x, h]) => g.lineTo(x, base - h));
    g.lineTo(1080, base);
    g.lineTo(1080, 810);
    g.closePath();
    g.fill();
  };
  hill('rgba(38,20,74,.85)', [[180, 130], [420, 210], [760, 120], [980, 190]], 640, 0);
  hill('rgba(22,12,52,.95)', [[120, 90], [380, 150], [700, 80], [920, 130]], 720, 0);
  hill('#120a30', [[300, 60], [640, 110], [900, 40]], 790, 0);

  // sparkles on the dark hill
  g.fillStyle = 'rgba(255,255,255,.25)';
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.arc(rnd(0, 1080), rnd(760, 805), rnd(1, 2.6), 0, 7);
    g.fill();
  }

  setPicture(c.toDataURL('image/png'));
});

/* ============================================================
   GAME CREATION
   ============================================================ */
els.startBtn.addEventListener('click', startGame);
els.restartBtn.addEventListener('click', startGame);
els.newBtn.addEventListener('click', backToSetup);
els.changeBtn.addEventListener('click', backToSetup);
els.againBtn.addEventListener('click', () => { els.winBar.classList.remove('show'); startGame(); });
els.previewBtn.addEventListener('click', () => {
  els.previewLayer.classList.toggle('hidden');
  if (!els.previewLayer.classList.contains('hidden')) els.previewBig.src = img.src;
});
els.previewLayer.addEventListener('click', () => els.previewLayer.classList.add('hidden'));

function backToSetup() {
  if (game && game.timerInt) clearInterval(game.timerInt);
  els.winBar.classList.remove('show');
  els.previewLayer.classList.add('hidden');
  els.game.classList.add('hidden');
  els.setup.classList.remove('hidden');
  game = null;
}

function startGame() {
  if (!img) return;
  if (game && game.timerInt) clearInterval(game.timerInt);
  els.setup.classList.add('hidden');
  els.game.classList.remove('hidden');

  const rect = els.playfield.getBoundingClientRect();
  const pfW = rect.width, pfH = rect.height;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const ar = iw / ih;

  // grid that keeps tiles roughly square
  const rows = clamp(Math.round(Math.sqrt(tileSize / ar)), 3, 12);
  const cols = clamp(Math.round(tileSize / rows), 3, 14);

  // image scale: default ~62% of playfield, but never below a grab-able tile size
  let scale = Math.min(pfW * 0.62 / iw, pfH * 0.62 / ih);
  scale = Math.max(scale, 46 * cols / iw, 46 * rows / ih);
  scale = Math.min(scale, pfW * 0.97 / iw, pfH * 0.97 / ih);

  const boardW = iw * scale, boardH = ih * scale;
  const pw = boardW / cols, ph = boardH / rows;
  const pad = Math.round(Math.max(pw, ph) * 0.3) + 3;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);

  game = {
    rows, cols, pw, ph, pad, boardW, boardH, dpr,
    pfW, pfH, pieces: [], groups: [], cells: [],
    moves: 0, over: false, timerInt: null, t0: 0,
  };

  els.movesEl.textContent = '0 moves';
  els.timeEl.textContent = '00:00';
  els.winBar.classList.remove('show');
  els.previewLayer.classList.add('hidden');
  els.hint.classList.remove('gone');

  buildPieces();
  scatter();
  startTimer();
  sound('pick');

  clearTimeout(startGame._hintT);
  startGame._hintT = setTimeout(() => els.hint.classList.add('gone'), 5000);
}

function startTimer() {
  game.t0 = performance.now();
  game.timerInt = setInterval(() => {
    els.timeEl.textContent = fmtTime(performance.now() - game.t0);
  }, 500);
}

/* ============================================================
   JIGSAW EDGE GENERATION
   Every internal edge is generated once as a list of absolute
   points; both neighbouring pieces clip along that SAME curve,
   so tabs and blanks always match perfectly.
   ============================================================ */
function makeEdge(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L;   // along the edge
  const nx = -uy, ny = ux;          // perpendicular
  const sgn = Math.random() < 0.5 ? 1 : -1;  // which side the knob bulges
  const VS = 0.55;                  // knob height scale
  const jA = rnd(-0.035, 0.035), jB = rnd(-0.035, 0.035), jC = rnd(-0.03, 0.03);

  // cubic chain in normalized coords (u along edge 0..1, v perpendicular)
  const segs = [
    [0.20, 0.02,  0.30, 0.05,  0.38 + jA, 0.08 + jC],
    [0.28 + jA, 0.34,  0.33, 0.46 + jC,  0.50, 0.46 + jC],
    [0.67, 0.46 + jC,  0.72, 0.34,  0.62 + jB, 0.08 + jC],
    [0.68, 0.05,  0.78, 0.02,  1.00, 0.00],
  ];

  const pts = [{ x: x0, y: y0 }];
  let p0u = 0, p0v = 0;
  for (const [c1u, c1v, c2u, c2v, eu, ev] of segs) {
    for (let i = 1; i <= 14; i++) {
      const t = i / 14;
      const u = cubic(p0u, c1u, c2u, eu, t);
      const v = cubic(p0v, c1v, c2v, ev, t);
      const w = v * VS * L * sgn;
      pts.push({ x: x0 + ux * u * L + nx * w, y: y0 + uy * u * L + ny * w });
    }
    p0u = eu; p0v = ev;
  }
  return pts;
}

/* Build the four edges (T,R,B,L) of piece (r,c), in piece-local coords.
   Each edge list includes its two corner endpoints, so single edges can be
   stroked independently (used to drop seams between fused tiles). */
function pieceEdgePts(r, c) {
  const { rows, cols, pw, ph, pad } = game;
  const ox = c * pw - pad, oy = r * ph - pad;
  const M = p => ({ x: p.x - ox, y: p.y - oy });

  const top    = r > 0        ? game.H[r][c]
               : [{ x: c * pw, y: r * ph }, { x: (c + 1) * pw, y: r * ph }];
  const right  = c < cols - 1 ? game.V[r][c + 1]
               : [{ x: (c + 1) * pw, y: r * ph }, { x: (c + 1) * pw, y: (r + 1) * ph }];
  const bottom = r < rows - 1 ? game.H[r + 1][c].slice().reverse()
               : [{ x: (c + 1) * pw, y: (r + 1) * ph }, { x: c * pw, y: (r + 1) * ph }];
  const left   = c > 0        ? game.V[r][c].slice().reverse()
               : [{ x: c * pw, y: (r + 1) * ph }, { x: c * pw, y: r * ph }];
  return [top, right, bottom, left].map(list => list.map(M));
}

/* Which of a piece's edges are already fused to same-group neighbours */
function computeEdges(p) {
  const { rows, cols } = game;
  const fused = (r2, c2) => {
    if (r2 < 0 || c2 < 0 || r2 >= rows || c2 >= cols) return false;
    const cell = game.cells[r2 * cols + c2];
    return !!cell && !!cell.group && !!p.group && cell.group === p.group;
  };
  p.efused = [fused(p.r - 1, p.c), fused(p.r, p.c + 1), fused(p.r + 1, p.c), fused(p.r, p.c - 1)];
}

/* (Re)draw a piece: image through the clip, then bevel+seam strokes on the
   OPEN edges only. fullPhoto=true renders a clean borderless final picture. */
function renderPiece(p, fullPhoto = false) {
  const { pw, ph, pad, boardW, boardH, dpr } = game;
  const ctx = p.el.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, p.w, p.h);
  computeEdges(p);

  ctx.save();
  ctx.clip(p.path);
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight,
    pad - p.c * pw, pad - p.r * ph, boardW, boardH);
  ctx.restore();

  ctx.lineJoin = 'round';
  if (!fullPhoto) {
    p.edgePaths.forEach((ep, i) => {
      if (p.efused[i]) return;                    // seam already fused — skip
      ctx.save();
      ctx.translate(-0.9, -1.1);
      ctx.strokeStyle = 'rgba(255,255,255,.28)';
      ctx.lineWidth = 2;
      ctx.stroke(ep);
      ctx.restore();
      ctx.strokeStyle = 'rgba(15,10,35,.55)';
      ctx.lineWidth = 1.4;
      ctx.stroke(ep);
    });
  }
  // fused pieces lose the floating drop-shadow so seams don't reappear
  p.el.style.filter = (!fullPhoto && p.efused.some(f => !f))
    ? 'drop-shadow(0 3px 4px rgba(0,0,0,.45))'
    : 'none';
}

function buildPieces() {
  const { rows, cols, pw, ph, pad, dpr, boardW, boardH } = game;

  // shared internal edges: H between rows, V between columns
  game.H = [];
  game.V = [];
  for (let r = 1; r < rows; r++) {
    game.H[r] = [];
    for (let c = 0; c < cols; c++)
      game.H[r][c] = makeEdge(c * pw, r * ph, (c + 1) * pw, r * ph);
  }
  for (let r = 0; r < rows; r++) {
    game.V[r] = [];
    for (let c = 1; c < cols; c++)
      game.V[r][c] = makeEdge(c * pw, r * ph, c * pw, (r + 1) * ph);
  }

  game.cells = new Array(rows * cols).fill(null);
  els.playfield.replaceChildren();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const W = Math.ceil(pw + 2 * pad), Ht = Math.ceil(ph + 2 * pad);
      const cv = document.createElement('canvas');
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(Ht * dpr);
      cv.className = 'piece';
      cv.style.width = W + 'px';
      cv.style.height = Ht + 'px';

      const ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // cached outline + per-edge sub-paths (piece-local coordinates)
      const edgePts = pieceEdgePts(r, c);
      const path = new Path2D();
      edgePts.forEach((ep, i) =>
        ep.forEach((pt, j) =>
          (i === 0 && j === 0) ? path.moveTo(pt.x, pt.y) : path.lineTo(pt.x, pt.y)));
      path.closePath();
      const edgePaths = edgePts.map(ep => {
        const sp = new Path2D();
        ep.forEach((pt, j) => j ? sp.lineTo(pt.x, pt.y) : sp.moveTo(pt.x, pt.y));
        return sp;
      });

      const piece = { r, c, el: cv, x: 0, y: 0, w: W, h: Ht, group: null, path, edgePaths };
      cv.addEventListener('pointerdown', e => onDown(e, piece));
      game.cells[r * cols + c] = piece;
      game.pieces.push(piece);
      els.playfield.appendChild(cv);
    }
  }

  // every piece starts as its own fuse-group
  game.groups = game.pieces.map(p => {
    const g = { pieces: [p], z: 0 };
    p.group = g;
    return g;
  });
  applySizeOrder();

  // render once groups exist (edge-fused flags need group refs)
  game.pieces.forEach(p => renderPiece(p));
}

function scatter() {
  game.pieces.forEach(p => {
    setPos(p,
      rnd(4, Math.max(5, game.pfW - p.w - 4)),
      rnd(4, Math.max(5, game.pfH - p.h - 4)));
  });
}

/* ============================================================
   DRAG & SNAP
   ============================================================ */
let drag = null;

function setPos(p, x, y) {
  p.x = x; p.y = y;
  p.el.style.left = x + 'px';
  p.el.style.top = y + 'px';
}
function applyZ(g) { g.pieces.forEach(p => { p.el.style.zIndex = g.z; }); }
function bringToFront(g) { g.z = ++zTop; applyZ(g); }

/* Layer groups by size: the more tiles fused together, the LOWER the group
   sits, so small loose tiles are never hidden under big fused slabs.
   (During a drag the dragged group is still raised above everything.) */
function applySizeOrder() {
  const sorted = game.groups.slice().sort((a, b) => b.pieces.length - a.pieces.length);
  let z = 1;
  sorted.forEach(g => { g.z = z; applyZ(g); z++; });
}
function flash(pieces) {
  pieces.forEach(p => {
    p.el.classList.remove('fused');
    void p.el.offsetWidth;               // restart animation
    p.el.classList.add('fused');
  });
  setTimeout(() => pieces.forEach(p => p.el.classList.remove('fused')), 500);
}

function onDown(e, p) {
  if (!game || game.over || drag) return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();

  const g = p.group;
  drag = {
    g, pid: e.pointerId, sx: e.clientX, sy: e.clientY,
    orig: g.pieces.map(q => ({ q, x: q.x, y: q.y })),
    moved: false,
  };
  try {
    p.el.setPointerCapture(e.pointerId);
  } catch (err) { /* some browsers throw for stale pointer ids — dragging still works */ }
  p.el.addEventListener('pointermove', dragMove);
  p.el.addEventListener('pointerup', dragEnd);
  p.el.addEventListener('pointercancel', dragEnd);

  bringToFront(g);
  g.pieces.forEach(q => q.el.classList.add('dragging'));
  sound('pick');
}

function dragMove(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  applyDrag(drag, e.clientX, e.clientY);
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3) drag.moved = true;
  updateSnapHints();
}

/* live feedback: glow the neighbour tile that would fuse on release */
let hinted = [];
function updateSnapHints() {
  if (!drag || game.over) return;
  const best = findBestSnap(drag.g, true);
  if (best) {
    if (!hinted.includes(best.q)) {
      clearSnapHints();
      best.q.el.classList.add('snap-hint');
      hinted = [best.q];
    }
  } else {
    clearSnapHints();
  }
}
function clearSnapHints() {
  hinted.forEach(p => p.el.classList.remove('snap-hint'));
  hinted = [];
}

function applyDrag(d, cx, cy) {
  let dx = cx - d.sx, dy = cy - d.sy;
  const os = d.orig;
  const minX = Math.min(...os.map(o => o.x)), maxX = Math.max(...os.map(o => o.x + o.q.w));
  const minY = Math.min(...os.map(o => o.y)), maxY = Math.max(...os.map(o => o.y + o.q.h));
  // allow sliding up to ~a tile beyond the playfield edges so groups near
  // the border can always reach their snap position (never lost offscreen)
  const M = game.pw + game.pad + 10;
  dx = clamp(dx, 4 - M - minX, Math.max(4 - M - minX, game.pfW - 4 - maxX + M));
  dy = clamp(dy, 4 - M - minY, Math.max(4 - M - minY, game.pfH - 4 - maxY + M));
  os.forEach(o => setPos(o.q, o.x + dx, o.y + dy));
}

function dragEnd(e) {
  if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.pid)) return;
  const d = drag;
  const el = e.currentTarget;
  el.removeEventListener('pointermove', dragMove);
  el.removeEventListener('pointerup', dragEnd);
  el.removeEventListener('pointercancel', dragEnd);
  drag = null;

  // pointercancel can carry zero coordinates — keep the last valid position
  if (e.type !== 'pointercancel') applyDrag(d, e.clientX, e.clientY);
  clearSnapHints();
  d.g.pieces.forEach(q => q.el.classList.remove('dragging'));

  if (d.moved) {
    game.moves++;
    els.movesEl.textContent = game.moves + (game.moves === 1 ? ' move' : ' moves');
  }
  snapCascade(d.g);
  // released groups sink back into size-based layering
  applySizeOrder();
}

/* Find the closest compatible neighbour that the dragged group can fuse with.
   Two snap gestures are recognised:
   1. "near drop"     — piece lands within half a tile of its correct slot.
   2. "drop on top"   — piece is dropped right ON a grid-neighbour tile, and
                        magnetically slides one step into its correct position.
   `previewOnly` (used for the live drag hint) saturates at rule 1 so tiles
   don't flicker while flying over the board. */
function findBestSnap(g, previewOnly = false) {
  const minDim = Math.min(game.pw, game.ph);
  const nearTol = Math.max(26, 0.5 * minDim);   // half a tile
  const onTopTol = 0.62 * minDim;               // nearly-centred on the neighbour
  let best = null;
  for (const p of g.pieces) {
    const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = p.r + dr, c = p.c + dc;
      if (r < 0 || c < 0 || r >= game.rows || c >= game.cols) continue;
      const q = game.cells[r * game.cols + c];
      if (!q || q.group === g) continue;
      // where p would have to sit to be correctly aligned with q
      const tx = q.x - dc * game.pw;
      const ty = q.y - dr * game.ph;
      const ddx = tx - p.x, ddy = ty - p.y;
      let hit = false;
      if (Math.max(Math.abs(ddx), Math.abs(ddy)) <= nearTol) {
        hit = true;                                       // rule 1: near drop
      } else if (!previewOnly) {
        const qcx = q.x + q.w / 2, qcy = q.y + q.h / 2;
        if (Math.hypot(pcx - qcx, pcy - qcy) <= onTopTol) hit = true; // rule 2: on top
      }
      if (hit) {
        const d2 = ddx * ddx + ddy * ddy;
        if (!best || d2 < best.d2) best = { d2, ddx, ddy, q };
      }
    }
  }
  return best;
}

/* Snap & fuse repeatedly — a drop may complete several connections at once. */
function snapCascade(g) {
  let cur = g, fusedAny = false;
  while (true) {
    const best = findBestSnap(cur);
    if (!best) break;

    // slide the whole group into perfect alignment
    cur.pieces.forEach(q => {
      setPos(q, q.x + best.ddx, q.y + best.ddy);
      q.el.classList.add('snapping');
    });

    // merge groups
    const target = best.q.group;
    cur.pieces.forEach(q => { q.group = target; target.pieces.push(q); });
    target.z = Math.max(target.z, cur.z);
    applyZ(target);
    game.groups.splice(game.groups.indexOf(cur), 1);

    flash(target.pieces);
    sound('snap');
    setTimeout(() => target.pieces.forEach(q => q.el.classList.remove('snapping')), 260);
    fusedAny = true;
    cur = target;
  }
  if (fusedAny) {
    // re-render merged pieces so seams between fused tiles disappear
    cur.pieces.forEach(p => renderPiece(p));
    checkWin();
  }
}

/* ============================================================
   WIN
   ============================================================ */
function checkWin() {
  if (game.groups.length === 1 && !game.over) {
    game.over = true;
    clearInterval(game.timerInt);
    const elapsed = performance.now() - game.t0;
    setTimeout(() => finishWin(elapsed), 550);
  }
}

function finishWin(elapsed) {
  els.hint.classList.add('gone');

  // whole-photo look: no seams, no shadows, clean render of every tile
  game.pieces.forEach(p => renderPiece(p, true));

  // center the finished picture on the board (a bit higher to clear the bar)
  const g = game.groups[0];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  g.pieces.forEach(p => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.h);
  });
  const dx = game.pfW / 2 - (minX + maxX) / 2;
  const dy = (game.pfH - 90) / 2 - (minY + maxY) / 2;
  g.pieces.forEach(p => {
    p.el.classList.add('snapping');
    setPos(p, p.x + dx, p.y + dy);
  });
  setTimeout(() => g.pieces.forEach(p => p.el.classList.remove('snapping')), 300);

  sound('win');
  els.winStats.textContent =
    `Solved in ${els.timeEl.textContent} · ${game.moves} ${game.moves === 1 ? 'move' : 'moves'} · ${game.pieces.length} pieces`;
  els.winBar.classList.add('show');
  confettiBurst();
}

function confettiBurst() {
  const colors = ['#fbbf24', '#f472b6', '#8b5cf6', '#34d399', '#60a5fa', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('i');
    s.className = 'confetti';
    s.style.left = rnd(0, 100) + '%';
    s.style.background = colors[i % colors.length];
    const w = rnd(7, 13);
    s.style.width = w + 'px';
    s.style.height = w * 1.4 + 'px';
      if (Math.random() < 0.5) s.style.borderRadius = '50%';
    s.style.animationDuration = rnd(2.2, 4.6) + 's';
    s.style.animationDelay = rnd(0, 0.9) + 's';
    els.stage.appendChild(s);
    setTimeout(() => s.remove(), 6500);
  }
}

/* keep pieces inside the playfield if the window resizes */
window.addEventListener('resize', () => {
  if (!game) return;
  const rect = els.playfield.getBoundingClientRect();
  game.pfW = rect.width; game.pfH = rect.height;
  game.pieces.forEach(p => {
    setPos(p,
      clamp(p.x, 4, Math.max(4, game.pfW - p.w - 4)),
      clamp(p.y, 4, Math.max(4, game.pfH - p.h - 4)));
  });
});

/* debug hook (handy for tinkering/testing): window.__jigsaw() */
window.__jigsaw = () => game;
window.__els = els;
