# 🎨 Image-Based Stress-Buster Games — Backlog

> Ideas for building from scratch. All games share the same DNA as the two existing
> implementations in this repo:
>
> - `jigsaw-game/` — bezier-edge jigsaw, drag + snap-fuse groups, seamless win reveal
> - `swap-puzzle/` — rectangular tiles in a grid, tap-tap or drag to swap, edge-fusion (seams
>   dissolve as neighbours lock), placed tiles lock immovably, win-bar clearance logic
>
> **Shared conventions already proven in this repo (reuse these):**
> - Fully offline, no external dependencies, works from `file://`
> - Setup screen: upload / drag-drop a picture, or a generated canvas sample scene
> - Tile size presets (~12 / ~24 / ~48 / ~96 tiles), board auto-fit to viewport, 46px min tile
> - Glass HUD (chips: progress / moves / timer), Preview overlay, Shuffle, New
> - Bottom win-bar (never a popup) + board shifts up to clear the bar (`finishWin` measurement
>   **after** stats text is set — flex-wrap changes bar height)
> - Confetti in `.stage`, WebAudio sound engine (`pick` / `swap` / `deny` / `win`)
> - Pointer Events + `setPointerCapture` (wrapped in try/catch), `touch-action: none`
> - Zero-gap tiles: per-edge computed `box-shadow` + per-corner `border-radius` in JS
>   (see `updateFuseAll` in `swap-puzzle/script.js`); class-based visuals need `!important`
>   to override inline styles; locked-tile shake uses the standalone `translate` property
> - Debug hook for testing: `window.__api = { game, centerOfSlot, solveStep, ... }`
> - E2E via Playwright in `C:\Users\manoj\AppData\Local\Temp\opencode\jigsaw-e2e\`
>   (`node e2e-swap.js`; wait ~300-400ms after any programmatic swap before measuring
>   tile rects — tiles animate for 220ms)

---

## 🧩 Tier 1 — Direct siblings (lowest effort, reuse most code)

### 1. Mosaic Restore (zen mode)  ⭐ top pick
- **Mechanic:** picture broken into tiles but *nothing is scrambled* — or tiles wait in a
  tray; user places each tile at their own pace. No timer, no move counter, no fail state.
- **Stress-buster factor:** highest — zero pressure, pure placement dopamine.
- **Extras:** hover glow on the target slot, soft chime per placement, slow-motion confetti.
- **Reuse:** swap-puzzle grid + rendering; delete shuffle/swap/timer logic; add a tray sidebar
  (scrollable on mobile).
- **Effort:** ~3-4h.

### 2. Jigsaw Drag Tray
- **Mechanic:** the existing jigsaw, but pieces wait in a side tray / bottom drawer instead of
  scattering across the field — nothing is ever "lost".
- **Reuse:** jigsaw-game wholesale; add tray UI + spawn-from-tray logic.
- **Effort:** ~4h.

### 3. Slice & Slide (15-puzzle with your photo)
- **Mechanic:** grid with ONE empty slot; tiles slide into it (tap a tile adjacent to the gap,
  or drag). Shuffle guarantees solvability (random valid walks from solved state).
- **Reuse:** swap-puzzle board/rendering/fusion; replace swap logic with slide-into-gap +
  solvable shuffle; win reveal already exists.
- **Note:** moves counter meaningful here; consider a move-par display.
- **Effort:** ~3-4h.

### 4. Rotation Puzzle  ⭐ top pick (quickest)
- **Mechanic:** tiles are in the CORRECT positions but each rotated a random multiple of 90°
  (or 45° for hard mode); tap to rotate 90° CW (long-press/shift for CCW). Tile is solved when
  rotation === 0; fuse neighbours exactly like swap-puzzle once both are solved.
- **Reuse:** swap-puzzle grid, fusion, locking (a rotation-0 tile locks), win flow.
  Add `rot` to tile state + `rotate()` in the transform chain; store per-tile rotation in
  CSS var (`--rot`) so `translate(x,y) rotate(var(--rot))` transitions cleanly.
- **Effort:** ~2-3h. Best effort/reward ratio.

### 5. Mirror / Flip Puzzle
- **Mechanic:** tiles in correct positions, but some are mirrored (scaleX -1) and/or flipped
  (scaleY -1); tap cycles states (normal → mirrored → flipped → both). Same structure as #4.
- **Reuse:** identical to Rotation Puzzle; different transform vars.
- **Effort:** ~2h after #4 exists.

---

## 🌊 Tier 2 — Flow / trace mechanics

### 6. Color Flood / Fill
- **Mechanic:** quantize the image into color regions (posterize + connected components);
  flood-fill one region at a time with a "water spreading" reveal animation. Optional goal:
  restore N regions to finish.
- **Reuse:** image canvas; new region-segmentation util; BFS fill animation.
- **Effort:** ~6h.

### 7. Hidden Picture Sweep (loupe game)
- **Mechanic:** the picture shown through a small magnifier window; drag the viewport around
  to find N marked sparkle spots. Optional timer or pure zen.
- **Reuse:** image canvas + clip-path/viewport div; sparkle markers.
- **Effort:** ~4h.

### 8. Picross / Nonogram-by-Image
- **Mechanic:** derive row/column hint numbers from a small grid (e.g. 10×10) sampled from the
  image's brightness; fill cells to reveal the picture. Needs hint generation + validation.
- **Reuse:** image canvas; new clue generator (thresholding per cell).
- **Effort:** ~8h (clue gen is the tricky part).

---

## 🫧 Tier 3 — Toys (more fidget than game)

### 9. Scratch Reveal  ⭐ top pick (most novel feel)
- **Mechanic:** the picture hides under a frosted/noise layer drawn on an overlay canvas;
  rub with finger/mouse to wipe it away (destination-out compositing). Progress = % wiped;
  optional "reveal complete" moment when > 95%. Optionally auto-reveal a soft glow of the
  target underneath (like a heat hint).
- **Reuse:** image loading + setup screen only; rest is one canvas + pointermove.
- **Polish:** scratch sound (filtered noise), sparkle particles at the brush, brush size choice.
- **Effort:** ~3h.

### 10. Sand / Tile Fall
- **Mechanic:** the picture is cut into hundreds of tiny tiles that behave like sand; drag to
  stir, shake device (or button) to settle tiles back to home positions.
- **Reuse:** image canvas; needs a light physics step (verlet or simple grid fall).
- **Effort:** ~8h.

### 11. Pop & Sort Blobs
- **Mechanic:** image shatters into a few large irregular blobs (Voronoi or random polygons
  clipped from the image) that drift around slowly; drag each blob home — magnetic snap when
  close. Zero time pressure.
- **Reuse:** jigsaw-game's clip + drag + snap ideas with much simpler edges (2-3 bezier
  control points per edge).
- **Effort:** ~5h.

### 12. Breathing Focus Board (not a puzzle)
- **Mechanic:** tiles slowly drift/swirl in gentle orbits; a breathing guide (inhale 4s,
  hold 4s, exhale 4s) pulses a ring; tapping gently "breathes" tiles back toward the picture.
  No win — or a soft "restored" moment after N cycles.
- **Reuse:** tile rendering + win bar; add rAF drift loop + breathing ring.
- **Effort:** ~5h.

---

## Build order suggestion

1. **Rotation Puzzle** — fastest to ship, natural sibling of swap-puzzle
2. **Scratch Reveal** — completely different feel; great variety in the collection
3. **Mosaic Restore** — the flagship zen game
4. **Slice & Slide** — classic; closes the puzzle family
5. Then pick from Tier 2/3 based on mood.

## Conventions for every new game

- Own folder: `rotation-puzzle/`, `scratch-reveal/`, `mosaic-restore/`, …
- Three files only: `index.html`, `styles.css`, `script.js`
- Copy the setup-screen pattern (upload + generated sample + size presets) and theme with a
  distinct accent color per game so they feel like a family but not clones
- Keep everything offline (`file://`-safe), pointer-event based, safe-area aware
- Expose a `window.__api` debug hook + keep a Playwright e2e script per game
