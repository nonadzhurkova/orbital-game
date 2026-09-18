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
- **No tutorial** beyond the per-level hint line.

## Known rough edges
- Prediction recomputes at ~30 Hz while dragging; on the binary-star
  level (4 dynamic bodies) this is the most expensive per-frame work.
- The map boundary is centered on the origin, not the system barycenter;
  in the binary level the whole system wanders a little (momentum is
  zeroed, so it stays negligible over play timescales).
- 100x speed near a star surface can tunnel in extreme cases (substeps
  make it rare; no continuous collision detection).

## Ideas / next
- Off-screen target indicator + boundary warning ("lost in deep space"
  feedback) — requested, planned for the scene-polish pass.
- Level select screen instead of the dots in the end-of-level dialog.
