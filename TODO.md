# Orbital Golf — TODO / stubs

## Stubbed or simplified
- **Par values for levels 2–5 are estimates.** Only level 1 has a
  test-verified solution cost (93.4 Δv vs par 100). Levels 2–5 have
  structural tests (orbit stability, no planet collisions) but no
  automated solvability search; pars need playtesting.
- **Score persistence**: best stars per level are not saved to
  localStorage yet — finishing a level and reloading forgets progress.
- **Sound** is a minimal WebAudio oscillator synth (launch, burn, flyby,
  win, lose). No volume control, no music.
- **No tutorial** beyond the intro card and hint lines.

## Performance notes (measured under devtools-style 4x CPU throttle,
## headless Chrome 1280x800, scripts/perf.mjs)
- Level 1: 60 fps idle and while aim-dragging. ✓ target met.
- Level 5 (binary star, 4 dynamic bodies): 60 fps idle, ~51 fps while
  holding an aim drag. Tradeoffs taken:
  - Prediction runs at 2 integrator substeps (live sim uses 4) — a
    dashed preview does not need full accuracy.
  - Prediction recompute rate adapts (every 2nd–4th frame) to its own
    measured cost, and the horizon degrades 60 s → 45 s → 30 s on slow
    CPUs rather than dropping render frames.
- Particles: fixed pool of 500, structure-of-arrays, zero allocations
  per frame in update/draw. Trail points and prediction point arrays DO
  allocate (bounded: ≤400 trail points at 30 Hz, prediction only while
  dragging); acceptable in profiling, noted for a future pass.
- Number tweens (Δv readout, score count-up) intentionally use a
  duration+easeOut tween, not the shared spring — springs overshoot,
  which reads badly on numeric text. All movement/scale transitions use
  the shared SPRING from src/ui/motion.ts.

## What would benefit from PixiJS / three.js (not migrating yet)
- **Trail rendering**: 400 individual stroked segments per frame is the
  biggest canvas cost; a PixiJS mesh/rope or a single WebGL line strip
  with per-vertex color would make it near-free.
- **Additive particle glow**: `globalCompositeOperation = "lighter"`
  forces canvas state changes; WebGL blend modes + a texture atlas
  would allow thousands of particles.
- **Starfield twinkle** currently draws each star as a rect per frame;
  a shader would do the whole field in one draw call.
- Planet art, HUD, prediction dashes are cheap; no need.

## Ideas / next
- Level select screen instead of the dots in the end-of-level dialog.
- Save best stars per level (localStorage).
- Touch-drag aim assist: magnify the aim vector on small screens.
