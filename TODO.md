# Orbital Golf — TODO / stubs

## Stubbed or simplified
- **Par values for levels 2–5 are estimates.** Only level 1 has a
  test-verified solution cost (93.4 Δv vs par 100). Levels 2–5 have
  structural tests (orbit stability, no planet collisions) but no
  automated solvability search; pars need playtesting.
- **Sound** is a minimal WebAudio oscillator synth (launch, burn, flyby,
  win, lose). No volume control, no music.
- **No tutorial** beyond the intro card and hint lines.

## Progress persistence & level select
- `src/game/progress.ts`: a separate zustand `persist` store (key
  `orbital-golf-progress` in localStorage) holding `lastLevelIndex` and
  `bestStars` per level. Kept separate from the main `useGame` store
  because that store's whole shape gets bumped/reset constantly (retry,
  level change) and isn't meant to survive a reload wholesale.
- `src/components/ProgressGate.tsx` blocks mounting GameCanvas/HUD
  until the persisted level is restored (or a 300ms fallback fires),
  so a reload resumes on the right level instead of flashing level 1
  first. `useGame.setState` is used directly for the restore (not
  `setLevel`) to skip the resetNonce bump — nothing has mounted an
  engine yet.
- `unlockedThrough(bestStars)` in progress.ts is the single source of
  truth for "how far can the player jump" — level i+1 unlocks once
  level i has any stars. Both `LevelSelect.tsx` (new: a `?`-style
  overlay opened from the level name in the HUD, browsable any time)
  and `EndOverlay.tsx`'s dot row use it, so they can't disagree.
- Wins are recorded in `GameCanvas.tsx`'s phase-transition block (the
  same place that logs the win/loss outcome), via
  `useProgress.getState().recordWin(levelIndex, engine.stars())`.

## Aim snap dots
- Dragging to aim snaps the magnitude (not direction — direction stays
  precise, arrow keys already cover fine control) to DV_SNAP steps
  (0.5 km/s), applied once in `dvFromDrag` in GameCanvas.tsx so drag,
  tip-grab, and the eventual numeric burn panel all go through the same
  snap.
- Only snap steps that are actually *useful* are drawn as dots:
  `GameEngine.viableSnaps()` (engine.ts) runs a cheap short sim (2
  substeps, ≤60s, early-exit on collision/past-encounter) per candidate
  magnitude along the current drag direction and checks whether the
  closest approach to the target lands in the same 1.8R-4.5R band the
  autopilot's planner accepts a candidate on. This deliberately does
  NOT require the instantaneous trajectory to already be a bound
  orbit — a capture burn is the expected next step, same as for a real
  player. (First version wrongly required an already-bound orbit and
  found zero viable dots anywhere — see the two regression tests in
  levels.test.ts, one confirming a dead-center aim is never viable at
  any speed, since that's always a collision course.)
- Throttled independently from the prediction line: recomputed only
  when the drag direction turns >~1° and at most ~5x/second, capped at
  24 candidates per recompute. Verified to hold the existing per-level
  fps baseline (scripts/snap-perf.mjs) even on level 5.

## Renderer (PixiJS 8, migrated from canvas 2D)
- Scene renderer is `src/render/pixi/PixiScene.ts` behind the same
  GameCanvas interface; physics/camera/input untouched. Bloom
  (pixi-filters) on a glow layer holding the trail + probe.
- One shared `Application` per canvas: tearing down a WebGL context and
  re-initializing on the same canvas hangs the tab, so level switches
  rebuild the scene graph on the live app (see `acquireApp`).
- Bloom degradations: `?nobloom` URL flag, and the filter auto-drops
  after ~1.5 s of sustained sub-48 fps.
- Trail fade is approximated in chunks of 8 segments per stroke (~50
  strokes/frame) instead of 400 per-segment strokes.
- Starfield twinkle became a per-layer alpha "breath" (per-star twinkle
  would need a shader; baked brightness covers most of the effect).

## Performance notes (scripts/perf.mjs, 4x CPU throttle, headless
## Chrome 1280x800 — NOTE: headless uses SwiftShader, so all "GPU" work
## runs on the throttled CPU; real hardware GPUs render this scene and
## the bloom far cheaper)
- Pixi + bloom: level 1 ~55 idle / ~48 aim-drag; level 5 ~55 / ~40.
- Pixi without bloom (NOBLOOM=1): ~56/53 and ~56/50.
- Prediction tradeoffs (unchanged): 2 integrator substeps for the
  preview, adaptive recompute rate, horizon degrades 60→45→30 s.
- Particles: fixed pool of 500 pre-allocated sprites, SoA data, no
  allocations per frame. Trail/prediction point arrays still allocate
  (bounded), as before.
- Number tweens (Δv readout, score count-up) intentionally use a
  duration+easeOut tween, not the shared spring — springs overshoot,
  which reads badly on numeric text. All movement/scale transitions use
  the shared SPRING from src/ui/motion.ts.

## Autopilot (src/game/autopilot.ts)
- Simulates candidate launches (speed x aim-angle x wait-for-window),
  picks the cheapest that: (a) reaches a capture-radius encounter,
  (b) has the target's gravity dominate the differential tidal pull at
  that radius (else the orbit isn't stable in the target's Hill
  sphere), and (c) — critically — the circularized orbit is verified
  by simulating it forward ~1 orbit and re-checking bound/periapsis/
  apoapsis. Without step (c) the optimizer happily picks degenerate
  "cheap" trajectories (e.g. a barely-escaping crawl that transiently
  grazes the capture window then diverges) since a lower Δv total
  always wins on the instantaneous geometry alone.
- Two-stage search: coarse scan, then local refinement around the best
  near-misses if the coarse pass finds nothing outright (this is what
  makes level 2's narrow flyby-bent window findable).
- Verified end-to-end for all 5 levels in src/game/autopilot.test.ts
  (headless, no React/canvas) — this is the strongest regression net
  for level balance changes; re-run it after editing any level's
  bodies/masses/radii.
- UI: shows live ETA ("burn in 17s · solved in ~29s"), degrades
  gracefully to "no route found" rather than hanging.

## Telemetry & flight log
- Telemetry panel (src/components/Telemetry.tsx) reads
  orbitalElements() against the live target each sync tick — periapsis/
  apoapsis/eccentricity/bound are real physics, not display fakes.
- Flight log (src/components/FlightLog.tsx) is store-backed
  (game/store.ts `log`), capped at 80 entries, persists until retry —
  it does not fade or reset while the autopilot runs, unlike the
  transient on-canvas flyby flashes.

## Icons
- src/ui/icons.tsx: hand-drawn stroke SVGs (24x24, currentColor)
  replacing all emoji in the HUD/overlays — Fable 5 house style.

## Possible renderer follow-ups
- Trail as a MeshRope / custom mesh with per-vertex color: exact
  per-segment fade back, one draw call.
- Per-star twinkle via a small fragment shader on the tile textures.
- AdvancedBloomFilter (thresholded) would bloom only the bright core
  at slightly higher cost than the plain BloomFilter used now.

## Ideas / next
- Level select screen instead of the dots in the end-of-level dialog.
- Save best stars per level (localStorage).
- Touch-drag aim assist: magnify the aim vector on small screens.
