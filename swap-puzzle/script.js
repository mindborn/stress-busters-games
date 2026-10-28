'use strict';

/* ============================================================
   Swap Puzzle — game logic
   - Rectangular tiles shuffled into a grid (derangement: none start correct)
   - Tap tile A then tile B to swap; or drag a tile onto another slot
   - Win when every tile sits in its home slot; picture revealed seamlessly
   ============================================================ */

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const fmtTime = ms => {
  const s = Math.floor(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

/* ---------------- tiny sound engine ---------------- */
let actx = null;
let muted = false;
try { muted = localStorage.getItem('swapPuzzleMuted') === '1'; } catch (e) { /* storage unavailable */ }
function sound(kind) {
  if (muted) return;
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
    else if (kind === 'swap') { note(300, t0, 0.08, 0.14); note(460, t0 + 0.05, 0.09, 0.14); }
    else if (kind === 'deny') note(130, t0, 0.12, 0.07);
    else if (kind === 'bloom') { note(740, t0, 0.16, 0.06); note(1110, t0 + 0.08, 0.18, 0.05); }
    else if (kind === 'win') [523, 659, 784, 1047].forEach((f, i) => note(f, t0 + i * 0.13, 0.26, 0.15));
  } catch (e) { /* audio unavailable — fine */ }
}

/* ---------------- DOM refs ---------------- */
const els = {
  setup: $('#setup'), game: $('#game'), stage: $('.stage'),
  dropzone: $('#dropzone'), dzInner: $('#dzInner'), fileInput: $('#fileInput'), previewImg: $('#previewImg'),
  dzWrap: $('#dzWrap'), gridOverlay: $('#gridOverlay'),
  sizeGrid: $('#sizeGrid'), startBtn: $('#startBtn'), sampleBtn: $('#sampleBtn'),
  grayToggle: $('#grayToggle'),
  customPanel: $('#customPanel'), colsRange: $('#colsRange'), rowsRange: $('#rowsRange'),
  colsVal: $('#colsVal'), rowsVal: $('#rowsVal'), customInfo: $('#customInfo'),
  cropTools: $('#cropTools'), resetCropBtn: $('#resetCropBtn'), changePicBtn: $('#changePicBtn'),
  playfield: $('#playfield'), board: $('#board'), hint: $('#hint'),
  previewLayer: $('#previewLayer'), previewBig: $('#previewBig'), previewBtn: $('#previewBtn'),
  restartBtn: $('#restartBtn'), newBtn: $('#newBtn'), autoBtn: $('#autoBtn'), muteBtn: $('#muteBtn'),
  movesEl: $('#movesEl'), timeEl: $('#timeEl'), progressEl: $('#progressEl'),
  winBar: $('#winBar'), winStats: $('#winStats'), againBtn: $('#againBtn'), changeBtn: $('#changeBtn'),
};

let img = null;        // source image
let tileSize = 24;     // approximate number of tiles
let game = null;       // active game state
let zTop = 100;

const HINT_DEFAULT = els.hint.textContent;      // captured before any game changes it
const AUTO_HINT = '✨ Auto-solving — sit back, relax & watch…';
const AUTO_BTN_HTML = els.autoBtn.innerHTML;
let autoTimer = null;
let hintTimer = null;

/* show a bottom hint pill; hides itself after ms (ms=0 → stays until cleared) */
function showHint(text, ms) {
  els.hint.textContent = text;
  els.hint.classList.remove('gone');
  clearTimeout(hintTimer);
  if (ms) hintTimer = setTimeout(() => els.hint.classList.add('gone'), ms);
}

/* ============================================================
   SETUP SCREEN
   ============================================================ */
els.dropzone.addEventListener('click', e => {
  // with a picture loaded the preview area is the crop tool — changing the
  // picture goes through the dedicated 🖼 Change button instead
  if (els.dzWrap && !els.dzWrap.hidden) return;
  els.fileInput.click();
});
els.dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') els.fileInput.click(); });
els.fileInput.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) setPicture(URL.createObjectURL(f));
});
['dragenter', 'dragover'].forEach(ev =>
  els.dropzone.addEventListener(ev, e => { e.preventDefault(); els.dropzone.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev =>
  els.dropzone.addEventListener(ev, e => { e.preventDefault(); els.dropzone.classList.remove('over'); }));
els.dropzone.addEventListener('drop', e => {
  const f = [...(e.dataTransfer ? e.dataTransfer.files : [])].find(f => f.type.startsWith('image/'));
  if (f) setPicture(URL.createObjectURL(f));
});

function setPicture(src) {
  const im = new Image();
  im.onload = () => {
    img = im;
    els.previewImg.src = src;
    els.dzWrap.hidden = false;
    els.cropTools.hidden = false;
    els.dropzone.classList.add('has-img');
    els.startBtn.disabled = false;
    resetCrop();                                    // every new picture starts uncropped
    requestAnimationFrame(updateGridOverlay);
  };
  im.onerror = () => alert('Could not load that image — please try another file.');
  im.src = src;
}

/* the grid the CURRENT selection will produce (mirrors startGame) */
function currentGridDims() {
  if (!img) return { rows: 0, cols: 0 };
  const ar = img.naturalWidth / img.naturalHeight;
  if (tileSize === 'custom') {
    return { rows: clamp(customRows, 1, 100), cols: clamp(customCols, 1, 100) };
  }
  const rows = clamp(Math.round(Math.sqrt(tileSize / ar)), 3, 12);
  return { rows, cols: clamp(Math.round(tileSize / rows), 3, 14) };
}

/* live setup preview: dims everything outside the crop rect, draws the crop
   rectangle with resize handles, and the tile grid of the region that will be used */
function updateGridOverlay() {
  if (!img || !els.dzWrap || !els.gridOverlay || els.previewImg.clientWidth === 0) return;
  clampCropRect();
  const { rows, cols } = currentGridDims();
  if (!rows) return;
  const disp = els.previewImg;
  const w = disp.clientWidth, h = disp.clientHeight;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const cv = els.gridOverlay;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);

  // crop rect in display px
  const rx = cropRect.x * w, ry = cropRect.y * h, rw = cropRect.w * w, rh = cropRect.h * h;

  // dim what will be cropped away
  g.fillStyle = 'rgba(6, 12, 22, .55)';
  g.fillRect(0, 0, w, ry);
  g.fillRect(0, ry + rh, w, h - ry - rh);
  g.fillRect(0, ry, rx, rh);
  g.fillRect(rx + rw, ry, w - rx - rw, rh);

  // grid lines of the region actually kept after tile-boundary snapping
  const reg = cropRegionPx(img, cols, rows);
  const k = w / img.naturalWidth;
  const lx0 = reg.x * k, ly0 = reg.y * k, lw = reg.w * k, lh = reg.h * k;
  g.strokeStyle = 'rgba(255,255,255,.66)';
  g.lineWidth = 1;
  for (let i = 1; i < cols; i++) {
    const x = Math.round(lx0 + lw * i / cols) + 0.5;
    g.beginPath(); g.moveTo(x, ly0); g.lineTo(x, ly0 + lh); g.stroke();
  }
  for (let i = 1; i < rows; i++) {
    const y = Math.round(ly0 + lh * i / rows) + 0.5;
    g.beginPath(); g.moveTo(lx0, y); g.lineTo(lx0 + lw, y); g.stroke();
  }

  // crop rectangle border + corner resize handles
  g.strokeStyle = 'rgba(94, 234, 212, .95)';
  g.lineWidth = 1.5;
  g.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
  g.fillStyle = '#fff';
  for (const c of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]]) {
    g.beginPath();
    g.arc(c[0], c[1], 6, 0, 7);
    g.fill();
    g.strokeStyle = 'rgba(20,184,166,.95)';
    g.lineWidth = 2;
    g.stroke();
  }
}

/* --- crop tool: drag inside to move, drag corners to resize, double-tap resets --- */
let cropRect = { x: 0, y: 0, w: 1, h: 1 };   // fractions of the source image
let cropDrag = null;
const CROP_HANDLE = 18;                      // px hit radius for corner handles

function clampCropRect() {
  if (!img) return;
  const { rows, cols } = currentGridDims();
  const minW = Math.min(1, cols / img.naturalWidth);    // region must fit ≥1 px tile each way
  const minH = Math.min(1, rows / img.naturalHeight);
  cropRect.w = clamp(cropRect.w, minW, 1);
  cropRect.h = clamp(cropRect.h, minH, 1);
  cropRect.x = clamp(cropRect.x, 0, 1 - cropRect.w);
  cropRect.y = clamp(cropRect.y, 0, 1 - cropRect.h);
}

function resetCrop() {
  cropRect = { x: 0, y: 0, w: 1, h: 1 };
  updateGridOverlay();
}

function cropPointer(e) {
  const r = els.previewImg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

els.dzWrap.addEventListener('pointerdown', e => {
  if (!img || els.dzWrap.hidden) return;
  const p = cropPointer(e);
  const corners = [
    ['nw', cropRect.x * p.w, cropRect.y * p.h],
    ['ne', (cropRect.x + cropRect.w) * p.w, cropRect.y * p.h],
    ['sw', cropRect.x * p.w, (cropRect.y + cropRect.h) * p.h],
    ['se', (cropRect.x + cropRect.w) * p.w, (cropRect.y + cropRect.h) * p.h],
  ];
  let mode = null;
  for (const c of corners) {
    if (Math.abs(p.x - c[1]) <= CROP_HANDLE && Math.abs(p.y - c[2]) <= CROP_HANDLE) { mode = 'resize:' + c[0]; break; }
  }
  if (!mode) {
    const rx = cropRect.x * p.w, ry = cropRect.y * p.h;
    if (p.x >= rx && p.x <= rx + cropRect.w * p.w && p.y >= ry && p.y <= ry + cropRect.h * p.h) mode = 'move';
  }
  if (!mode) return;
  cropDrag = { mode, sx: p.x, sy: p.y, start: { ...cropRect } };
  try { els.dzWrap.setPointerCapture(e.pointerId); } catch (_) { /* mouse-out edge */ }
  e.preventDefault();
});

els.dzWrap.addEventListener('pointermove', e => {
  if (!cropDrag) return;
  const p = cropPointer(e);
  const dx = (p.x - cropDrag.sx) / p.w, dy = (p.y - cropDrag.sy) / p.h;
  const r = { ...cropDrag.start };
  const { rows, cols } = currentGridDims();
  const minW = Math.min(1, cols / img.naturalWidth), minH = Math.min(1, rows / img.naturalHeight);
  if (cropDrag.mode === 'move') {
    r.x = clamp(r.x + dx, 0, 1 - r.w);
    r.y = clamp(r.y + dy, 0, 1 - r.h);
  } else {
    const corner = cropDrag.mode.split(':')[1];
    if (corner.includes('e')) r.w = clamp(r.w + dx, minW, 1 - r.x);
    if (corner.includes('s')) r.h = clamp(r.h + dy, minH, 1 - r.y);
    if (corner.includes('w')) {
      const nx = clamp(r.x + dx, 0, r.x + r.w - minW);
      r.w += r.x - nx; r.x = nx;
    }
    if (corner.includes('n')) {
      const ny = clamp(r.y + dy, 0, r.y + r.h - minH);
      r.h += r.y - ny; r.y = ny;
    }
  }
  cropRect = r;
  updateGridOverlay();
});

window.addEventListener('pointerup', () => { cropDrag = null; });
els.dzWrap.addEventListener('dblclick', resetCrop);
els.resetCropBtn.addEventListener('click', resetCrop);
els.changePicBtn.addEventListener('click', () => els.fileInput.click());

/* the region the game will use for the CURRENT crop rect + grid, snapped to
   whole-tile source pixels. A full-image rect → the automatic centre region. */
function defaultCropRegion(source, cols, rows) {
  const iw = source.naturalWidth, ih = source.naturalHeight;
  const tw = Math.max(1, Math.floor(iw / cols)), th = Math.max(1, Math.floor(ih / rows));
  const w = Math.min(iw, tw * cols), h = Math.min(ih, th * rows);
  return { x: Math.round((iw - w) / 2), y: Math.round((ih - h) / 2), w, h };
}

function cropRegionPx(source, cols, rows) {
  const full = cropRect.x <= 0.001 && cropRect.y <= 0.001 &&
    cropRect.w >= 0.999 && cropRect.h >= 0.999;
  if (full) return defaultCropRegion(source, cols, rows);
  const iw = source.naturalWidth, ih = source.naturalHeight;
  const tw = Math.max(1, Math.floor(cropRect.w * iw / cols));
  const th = Math.max(1, Math.floor(cropRect.h * ih / rows));
  const w = Math.min(iw, tw * cols), h = Math.min(ih, th * rows);
  return {
    x: clamp(Math.round(cropRect.x * iw), 0, iw - w),
    y: clamp(Math.round(cropRect.y * ih), 0, ih - h),
    w, h,
  };
}

/* centre-crop the source on whole-pixel tile boundaries so every tile covers an
   exact integer pixel block — e.g. 100×100 with 3×3 → crop keeps 99×99 (33px tiles).
   `region` (optional) overrides the automatic centre crop with the user's crop-tool
   selection, re-snapped to tile boundaries. */
function makeCropped(source, cols, rows, region) {
  const iw = source.naturalWidth, ih = source.naturalHeight;
  let sx, sy, cw, chh;
  if (region) {
    sx = region.x; sy = region.y; cw = region.w; chh = region.h;
  } else {
    const tw = Math.max(1, Math.floor(iw / cols)), th = Math.max(1, Math.floor(ih / rows));
    cw = Math.min(iw, tw * cols); chh = Math.min(ih, th * rows);
    sx = Math.round((iw - cw) / 2); sy = Math.round((ih - chh) / 2);
  }
  let outW = Math.round(cw), outH = Math.round(chh);
  const k = Math.min(1, 2200 / Math.max(outW, outH));  // cap long side for memory
  outW = Math.max(1, Math.round(outW * k));
  outH = Math.max(1, Math.round(outH * k));
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';                                // flatten any transparency
  g.fillRect(0, 0, outW, outH);
  g.drawImage(source, sx, sy, cw, chh, 0, 0, outW, outH);
  return c;
}

els.sizeGrid.addEventListener('click', e => {
  const btn = e.target.closest('.size-btn');
  if (!btn) return;
  els.sizeGrid.querySelectorAll('.size-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  if (btn.dataset.n === 'custom') {
    tileSize = 'custom';
    els.customPanel.hidden = false;
  } else {
    tileSize = parseInt(btn.dataset.n, 10);
    els.customPanel.hidden = true;
  }
  sound('pick');
  updateGridOverlay();
});

/* --- custom grid (slider-chosen rows & cols) --- */
let customRows = 4, customCols = 6;
function updateCustomInfo() {
  els.colsVal.textContent = customCols;
  els.rowsVal.textContent = customRows;
  const n = customRows * customCols;
  els.customInfo.textContent = `${n} ${n === 1 ? 'tile' : 'tiles'}` +
    (n > 400 ? ' — may be slow on this device' : '');
  els.customInfo.classList.toggle('warn', n > 400);
  updateGridOverlay();
}
els.colsRange.addEventListener('input', () => { customCols = +els.colsRange.value; updateCustomInfo(); });
els.rowsRange.addEventListener('input', () => { customRows = +els.rowsRange.value; updateCustomInfo(); });

/* --- colour-reveal mode toggle (grayscale → bloom into colour) --- */
let grayMode = true;
els.grayToggle.addEventListener('click', () => {
  grayMode = !grayMode;
  els.grayToggle.classList.toggle('on', grayMode);
  els.grayToggle.setAttribute('aria-checked', String(grayMode));
  sound('pick');
});

/* --- generated sample picture (works fully offline) --- */
els.sampleBtn.addEventListener('click', () => {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 810;
  const g = c.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, 810);
  sky.addColorStop(0, '#0f3a45');
  sky.addColorStop(0.55, '#1d6a70');
  sky.addColorStop(1, '#f2c572');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1080, 810);

  // glow
  const glow = g.createRadialGradient(240, 620, 20, 240, 620, 260);
  glow.addColorStop(0, 'rgba(255,236,180,.8)');
  glow.addColorStop(1, 'rgba(255,220,150,0)');
  g.fillStyle = glow;
  g.fillRect(0, 360, 560, 450);
  g.fillStyle = '#ffe9b8';
  g.beginPath(); g.arc(240, 620, 64, 0, 7); g.fill();

  // balloons
  const colors = ['#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#577590', '#c47aa2', '#8f5aa8', '#5fa8d3'];
  for (let i = 0; i < 26; i++) {
    const x = rnd(60, 1020), y = rnd(90, 560), r = rnd(38, 88);
    const col = colors[i % colors.length];
    // string
    g.strokeStyle = 'rgba(20,20,30,.55)';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(x, y + r * 0.9);
    g.quadraticCurveTo(x + rnd(-40, 40), y + r + rnd(40, 110), x + rnd(-30, 30), y + r + rnd(130, 200));
    g.stroke();
    // balloon
    const bg = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.12, x, y, r);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.25, col);
    bg.addColorStop(1, col);
    g.fillStyle = bg;
    g.beginPath();
    g.ellipse(x, y, r * 0.82, r, rnd(-0.12, 0.12), 0, 7);
    g.fill();
    // knot triangle
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y + r);
    g.lineTo(x - 9, y + r + 12);
    g.lineTo(x + 9, y + r + 12);
    g.closePath();
    g.fill();
  }

  // soft vignette
  const vg = g.createRadialGradient(540, 405, 300, 540, 405, 780);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(6,16,22,.45)');
  g.fillStyle = vg;
  g.fillRect(0, 0, 1080, 810);

  setPicture(c.toDataURL('image/png'));
});

/* ============================================================
   GAME CREATION
   ============================================================ */
els.startBtn.addEventListener('click', startGame);
els.restartBtn.addEventListener('click', () => { if (game) restartGame(); });

/* --- mute toggle (persisted) --- */
function updateMuteBtn() {
  els.muteBtn.textContent = muted ? '🔇' : '🔊';
  els.muteBtn.classList.toggle('muted', muted);
}
els.muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('swapPuzzleMuted', muted ? '1' : '0'); } catch (e) { /* ok */ }
  updateMuteBtn();
  if (!muted) sound('pick');      // audible confirmation that sound is back
});
updateMuteBtn();
els.newBtn.addEventListener('click', backToSetup);
els.changeBtn.addEventListener('click', backToSetup);
els.againBtn.addEventListener('click', () => { els.winBar.classList.remove('show'); restartGame(); });
els.previewBtn.addEventListener('click', () => {
  els.previewLayer.classList.toggle('hidden');
  if (!els.previewLayer.classList.contains('hidden')) els.previewBig.src = img.src;
});
els.previewLayer.addEventListener('click', () => els.previewLayer.classList.add('hidden'));
els.autoBtn.addEventListener('click', autoSolve);

function backToSetup() {
  if (game && game.timerInt) clearInterval(game.timerInt);
  stopAuto();
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
  const ar = img.naturalWidth / img.naturalHeight;

  let rows, cols, minTile = 46;
  if (tileSize === 'custom') {
    rows = clamp(customRows, 1, 100);   // user's explicit slider choice — no clamping to presets
    cols = clamp(customCols, 1, 100);
    minTile = 0;                        // tiny tiles are allowed; it's the user's call
  } else {
    rows = clamp(Math.round(Math.sqrt(tileSize / ar)), 3, 12);
    cols = clamp(Math.round(tileSize / rows), 3, 14);
  }

  // centre-crop on whole-pixel tile boundaries — every tile covers an exact pixel block
  // (a user-drawn crop rectangle from the crop tool overrides the automatic centre crop)
  const region = cropRegionPx(img, cols, rows);
  const crop = makeCropped(img, cols, rows, region);
  const cw = crop.width, chh = crop.height;

  let scale = Math.min(pfW * 0.8 / cw, pfH * 0.8 / chh);
  if (minTile) scale = Math.max(scale, minTile * cols / cw, minTile * rows / chh);
  scale = Math.min(scale, pfW * 0.97 / cw, pfH * 0.97 / chh);   // 0.97: give custom grids room

  const dpr = Math.min(2.5, window.devicePixelRatio || 1);

  // snap tile sizes to whole DEVICE pixels — fractional tile geometry lands tile
  // edges mid-pixel, which the browser antialiases into visible hairline gaps
  const twDev = Math.max(1, Math.round(cw * scale / cols * dpr));   // device px per tile
  const thDev = Math.max(1, Math.round(chh * scale / rows * dpr));
  const tw = twDev / dpr, th = thDev / dpr;
  const boardW = tw * cols, boardH = th * rows;

  game = {
    rows, cols, tw, th, boardW, boardH, dpr, pfW, pfH,
    croppedURL: crop.toDataURL('image/jpeg', 0.92),
    cropW: cw, cropH: chh,                 // pixel-boundary crop size (for tests/debug)
    cropX: region ? region.x : 0, cropY: region ? region.y : 0,
    moves: 0, over: false, timerInt: null, t0: 0, grayMode,
    tiles: [], slotMap: [], selected: null, drag: null,
  };

  els.board.classList.toggle('gray', grayMode);   // colour-reveal mode

  els.movesEl.textContent = '0 moves';
  els.timeEl.textContent = '00:00';
  els.board.style.transform = '';               // undo any win-time shift from a previous game
  els.winBar.classList.remove('show');
  els.previewLayer.classList.add('hidden');
  showHint(HINT_DEFAULT, 2000);                 // fades after 2s, stays off the board
  els.board.classList.remove('win');

  buildBoard();
  shuffleIntoSlots();
  updateProgress();
  startTimer();
  sound('pick');
}

function restartGame() {
  if (!game) return;
  stopAuto();
  clearInterval(game.timerInt);
  game.moves = 0; game.over = false; game.selected = null; game.drag = null;
  els.movesEl.textContent = '0 moves';
  els.board.style.transform = '';               // undo the win-time upward shift
  els.winBar.classList.remove('show');
  els.board.classList.remove('win');
  showHint(HINT_DEFAULT, 2000);                 // hint re-shows briefly on reshuffle
  game.tiles.forEach(t => { t.el.classList.remove('placed', 'selected', 'dragging'); t.el.style.zIndex = ''; });
  shuffleIntoSlots();
  updateProgress();
  startTimer();
  sound('pick');
}

function startTimer() {
  game.t0 = performance.now();
  game.timerInt = setInterval(() => {
    els.timeEl.textContent = fmtTime(performance.now() - game.t0);
  }, 500);
}

/* ============================================================
   BOARD & TILES
   ============================================================ */
function buildBoard() {
  const { rows, cols, tw, th, boardW, boardH } = game;

  els.board.style.width = boardW + 'px';
  els.board.style.height = boardH + 'px';
  // paint the board itself with the cropped picture: any residual sub-pixel gap
  // between tiles then shows image content instead of the dark page background
  els.board.style.backgroundImage = `url(${game.croppedURL})`;
  els.board.style.backgroundSize = `${boardW}px ${boardH}px`;
  els.board.style.backgroundRepeat = 'no-repeat';
  els.board.replaceChildren();

  game.tiles = [];
  game.slotMap = new Array(rows * cols).fill(null);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const home = r * cols + c;
      const el = document.createElement('div');
      el.className = 'tile';
      el.style.width = tw + 'px';
      el.style.height = th + 'px';
      el.style.backgroundImage = `url(${game.croppedURL})`;
      el.style.backgroundSize = `${boardW}px ${boardH}px`;
      el.style.backgroundPosition = `-${c * tw}px -${r * th}px`;
      el.addEventListener('pointerdown', e => onDown(e, home));
      els.board.appendChild(el);

      const tile = { home, el, slot: null };
      game.tiles[home] = tile;
    }
  }
}

/* Derangement: shuffle so that NO tile starts on its home slot. */
function shuffledOrder(n) {
  const arr = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  for (let i = 0; i < n; i++) {
    if (arr[i] === i) {
      const j = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
      if (arr[j] !== j || i !== j) { [arr[i], arr[j]] = [arr[j], arr[i]]; }
    }
  }
  return arr;
}

function shuffleIntoSlots() {
  const { rows, cols } = game;
  const order = shuffledOrder(rows * cols);   // slot i gets tile `order[i]`
  game.tiles.forEach(t => { t.slot = null; });
  order.forEach((home, slot) => {
    const t = game.tiles[home];
    t.slot = slot;
    game.slotMap[slot] = t;
  });
  game.tiles.forEach(updateTile);
  game.tiles.forEach(t => {
    t.el.classList.toggle('placed', t.slot === t.home);
  });
  updateFuseAll();
}

function updateTile(t, opts = {}) {
  const { tw, th } = game;
  const s = opts.scale !== undefined ? opts.scale
    : game.over ? 1
    : (game.drag && game.drag.tile === t && game.drag.dragging) ? 1.08
    : (game.selected === t) ? 1.05
    : 1;                                   // gap 0: tiles sit edge-to-edge
  let x, y;
  if (opts.free) { x = opts.x; y = opts.y; }      // free drag position (board coords)
  else { x = (t.slot % game.cols) * tw; y = Math.floor(t.slot / game.cols) * th; }
  t.el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
}

function updateProgress() {
  const placed = game.tiles.filter(t => t.slot === t.home).length;
  els.progressEl.textContent = `${placed}/${game.tiles.length} placed`;
  return placed;
}

/* ============================================================
   FUSION (same logic as the jigsaw variation)
   A tile fuses with each home-neighbour that is ALSO correctly
   placed. Fused edges lose their seam hairline and corner radius,
   so the solved region knits together seamlessly as you play.
   ============================================================ */
function updateFuseAll() {
  const { rows, cols } = game;
  const OPEN = 'rgba(255,255,255,.14)';   // hairline on open (loose) edges
  const DONE = 'rgba(94,234,212,.6)';     // green edge when tile is placed
  const R = 3;

  for (const t of game.tiles) {
    const r = Math.floor(t.home / cols), c = t.home % cols;
    const here = t.slot === t.home;
    const line = here ? DONE : OPEN;

    // returns the inset shadow for an edge, or null when that edge is fused
    const side = (dr, dc, sh) => {
      const nr = r + dr, nc = c + dc;
      const inside = nr >= 0 && nr < rows && nc >= 0 && nc < cols;
      if (!inside) return game.over ? null : sh.replace('$L', line); // board frame: seam while playing, gone at win
      const n = game.tiles[nr * cols + nc];
      const fused = here && n.slot === n.home;
      return fused ? null : sh.replace('$L', line);
    };
    const sT = side(-1, 0, 'inset 0 2px 0 0 $L');
    const sB = side(1, 0, 'inset 0 -2px 0 0 $L');
    const sL = side(0, -1, 'inset 2px 0 0 0 $L');
    const sR = side(0, 1, 'inset -2px 0 0 0 $L');

    t.el.style.boxShadow = [sT, sB, sL, sR].filter(Boolean).join(', ') || 'none';

    // a corner stays rounded only when BOTH adjoining edges are still open
    const cr = (a, b) => (a && b) ? R : 0;
    t.el.style.borderRadius =
      `${cr(sT, sL)}px ${cr(sT, sR)}px ${cr(sB, sR)}px ${cr(sB, sL)}px`;
  }
}

/* ============================================================
   SWAPPING (tap-tap & drag)
   ============================================================ */
function doSwap(a, b) {
  // safety net: placed tiles are locked — no swap may move one
  if (a.slot === a.home || b.slot === b.home) return;
  const aSlot = a.slot, bSlot = b.slot;
  a.slot = bSlot; b.slot = aSlot;
  game.slotMap[bSlot] = a;
  game.slotMap[aSlot] = b;
  updateTile(a); updateTile(b);
  a.el.classList.toggle('placed', a.slot === a.home);
  b.el.classList.toggle('placed', b.slot === b.home);
  updateFuseAll();                          // fusion state may change on both sides
  game.moves++;
  els.movesEl.textContent = game.moves + (game.moves === 1 ? ' move' : ' moves');
  updateProgress();
  if (!game.over) sound('swap');
  if ((a.slot === a.home || b.slot === b.home) && game.grayMode) sound('bloom');   // colour-bloom chime
  // gap 0: the two travelling tiles glide over their neighbours — raise them
  // for the moment of the animation, then let the grid stack settle back
  a.el.style.zIndex = zTop + 1;
  b.el.style.zIndex = zTop + 2;
  zTop += 2;
  setTimeout(() => {
    if (!game.over) { a.el.style.zIndex = ''; b.el.style.zIndex = ''; }
  }, 300);
  checkWin();
}

function clearSelection() {
  if (game.selected) {
    game.selected.el.classList.remove('selected');
    updateTile(game.selected);
    game.selected.el.style.zIndex = '';
  }
  game.selected = null;
}

/* feedback when the player tries to move a locked (placed) tile */
function denyFx(t) {
  t.el.classList.remove('deny');
  void t.el.offsetWidth;              // restart the shake animation
  t.el.classList.add('deny');
  setTimeout(() => t.el.classList.remove('deny'), 400);
  sound('deny');
}

function onDown(e, home) {
  if (!game || game.over || game.drag || game.auto) return;   // auto-solving: hands off
  if (e.button !== undefined && e.button !== 0) return;
  const t = game.tiles[home];
  if (t.slot === t.home) {          // placed tiles are locked — immovable
    if (game.selected) clearSelection();
    denyFx(t);
    return;
  }
  e.preventDefault();
  game.drag = { tile: t, sx: e.clientX, sy: e.clientY, dragging: false, pid: e.pointerId };
  try { t.el.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
  t.el.addEventListener('pointermove', onMove);
  t.el.addEventListener('pointerup', onUp);
  t.el.addEventListener('pointercancel', onUp);
  zTop++;
  t.el.style.zIndex = zTop;
  sound('pick');
}

function onMove(e) {
  const d = game && game.drag;
  if (!d || e.pointerId !== d.pid) return;
  const { tw, th } = game;
  const rect = els.board.getBoundingClientRect();
  if (!d.dragging) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= 8) return;
    d.dragging = true;
    d.tile.el.classList.add('dragging');
    if (game.selected === d.tile) clearSelection();
    else clearSelection();
  }
  // follow pointer in board coordinates
  const x = e.clientX - rect.left - tw / 2;
  const y = e.clientY - rect.top - th / 2;
  const cx = clamp(x, -tw * 0.45, game.boardW - tw * 0.55);
  const cy = clamp(y, -th * 0.45, game.boardH - th * 0.55);
  updateTile(d.tile, { free: true, x: cx, y: cy, scale: 1.08 });
}

function slotFromEvent(e) {
  const { rows, cols, tw, th } = game;
  const rect = els.board.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  if (px < 0 || py < 0 || px >= game.boardW || py >= game.boardH) return null;
  const c = clamp(Math.floor(px / tw), 0, cols - 1);
  const r = clamp(Math.floor(py / th), 0, rows - 1);
  return r * cols + c;
}

function onUp(e) {
  const d = game && game.drag;
  if (!d || (e.pointerId !== undefined && e.pointerId !== d.pid)) return;
  const t = d.tile;
  const wasDragging = d.dragging;
  t.el.removeEventListener('pointermove', onMove);
  t.el.removeEventListener('pointerup', onUp);
  t.el.removeEventListener('pointercancel', onUp);
  game.drag = null;

  if (wasDragging) {
    const slot = slotFromEvent(e);
    t.el.classList.remove('dragging');
    const occupant = slot !== null ? game.slotMap[slot] : null;
    if (occupant && occupant !== t && occupant.slot !== occupant.home) {
      doSwap(t, occupant);            // landed on a loose tile → swap
      t.el.style.zIndex = zTop;       // keep the dropped tile above during animation
      setTimeout(() => { if (!game.over) t.el.style.zIndex = ''; }, 300);
    } else {
      updateTile(t);                  // snap back (empty drop or locked occupant)
      if (occupant && occupant !== t) denyFx(occupant);
      t.el.style.zIndex = '';
    }
    return;
  }

  // tap semantics
  if (game.selected === t) {
    clearSelection();                 // tapped the same tile → deselect
  } else if (game.selected) {
    const other = game.selected;
    clearSelection();
    doSwap(other, t);
  } else {
    game.selected = t;
    t.el.classList.add('selected');
    updateTile(t);
    t.el.style.zIndex = zTop;            // bump scale(1.05) above neighbours
  }
}

/* ============================================================
   AUTO-SOLVE (stress buster: watch the puzzle finish itself,
   one placement at a time, with full swap + bloom animations)
   ============================================================ */
function solveOneStep() {
  if (!game || game.over) return true;
  for (const t of game.tiles) {
    if (t.slot !== t.home) {
      const correct = game.tiles.find(q2 => q2.home === t.slot);   // tile that belongs in t's slot
      doSwap(t, correct);                                          // correct lands home; +1 placed
      return game.tiles.every(x => x.slot === x.home);
    }
  }
  return true;
}

function autoSolve() {
  if (!game || game.over) return;
  if (game.auto) { stopAuto(); return; }         // second tap = stop & hand back control
  game.auto = true;
  clearSelection();
  els.autoBtn.classList.add('active');
  els.autoBtn.innerHTML = '⏹<span class="btn-text"> Stop</span>';
  showHint(AUTO_HINT, 3500);                    // status flash; Stop button shows the ongoing state
  const delay = game.tiles.length <= 32 ? 550 : 320;   // watchable pace, faster on big boards
  const step = () => {
    if (!game || !game.auto || game.over) return;
    if (solveOneStep()) { stopAuto(); return; }    // final swap → checkWin fires the win flow
    autoTimer = setTimeout(step, delay);
  };
  autoTimer = setTimeout(step, 60);
}

function stopAuto() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  if (game) game.auto = false;
  els.autoBtn.classList.remove('active');
  els.autoBtn.innerHTML = AUTO_BTN_HTML;
  els.hint.textContent = HINT_DEFAULT;
  els.hint.classList.add('gone');
}

/* ============================================================
   WIN
   ============================================================ */
function checkWin() {
  if (game.over) return;
  if (updateProgress() === game.tiles.length) {
    game.over = true;
    clearInterval(game.timerInt);
    stopAuto();                       // restore button/hint if auto-solving finished it
    if (game.selected) clearSelection();
    setTimeout(finishWin, 450);
  }
}

function finishWin() {
  els.hint.classList.add('gone');
  els.board.classList.add('win');               // gaps & rings fade out
  game.tiles.forEach(t => updateTile(t));      // all tiles settle to scale 1
  updateFuseAll();                             // every edge fuses → fully seamless

  sound('win');
  els.winStats.textContent =
    `Restored in ${els.timeEl.textContent} · ${game.moves} ${game.moves === 1 ? 'move' : 'moves'} · ${game.tiles.length} tiles`;

  // same win-clearance logic as the jigsaw variation: slide the finished
  // board up so no rows hide behind the win bar (clamped to fit the stage).
  // Measured AFTER the stats text is set — flex-wrap can change the bar height.
  const pfR = els.playfield.getBoundingClientRect();
  const bR = els.board.getBoundingClientRect();
  const barZone = els.winBar.offsetHeight + 14 + 8;   // resting bar height + bottom gap
  const overflow = bR.bottom - (pfR.top + pfR.height - barZone);
  const shift = clamp(overflow, 0, Math.max(0, bR.top - pfR.top - 6));
  els.board.style.transform = shift > 0 ? `translateY(${-shift}px)` : '';

  els.winBar.classList.add('show');
  confettiBurst();
}

function confettiBurst() {
  const colors = ['#5eead4', '#fbbf24', '#fb7185', '#60a5fa', '#a78bfa', '#ffffff'];
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

/* keep board centred/usable on resize */
window.addEventListener('resize', () => {
  if (!game) return;
  const rect = els.playfield.getBoundingClientRect();
  game.pfW = rect.width; game.pfH = rect.height;
  updateGridOverlay();               // setup preview follows window resizes too
});

/* debug hook (handy for tinkering/testing): window.__api */
window.__api = {
  game: () => game,
  tiles: () => game.tiles,
  centerOfSlot: slot => {
    if (!game || !game.slotMap[slot]) return null;
    const r = game.slotMap[slot].el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },
  solveStep: () => solveOneStep(),
  crop: () => ({ ...cropRect }),
  setCrop: (x, y, w, h) => { cropRect = { x, y, w, h }; updateGridOverlay(); },
};
