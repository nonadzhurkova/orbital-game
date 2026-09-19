"use client";
import { useEffect, useRef } from "react";
import { GameEngine } from "@/game/engine";
import { Autopilot } from "@/game/autopilot";
import { makeLevel, KMS } from "@/game/levels";
import { useGame } from "@/game/store";
import { useProgress } from "@/game/progress";
import { sound } from "@/game/sound";
import { DT, orbitalElements } from "@/physics/engine";
import { Vec2, sub, scale, len, dist, norm } from "@/physics/vec";
import { Camera } from "./camera";
import { AimState, DV_PER_PX, DV_SNAP } from "./types";
import type { PixiScene, FrameInput } from "./pixi/PixiScene";

/** Max fixed steps per rendered frame (keeps 100x from freezing the tab). */
const MAX_STEPS_PER_FRAME = 480;
const PREDICT_SECONDS = 60;

/** Live perf/debug data read by ProfileHUD and the smoke test. */
export interface OrbitalDebug {
  fps: number;
  bodies: number;
  particles: number;
  phase: string;
  /** Current aim magnitude in engine units, or null if not aiming. Test hook. */
  aimMag: number | null;
  /** Number of coast checkpoints currently available. Test hook. */
  checkpointCount: number;
  /** Whether a checkpoint is currently armed. Test hook. */
  checkpointArmed: boolean;
}
declare global {
  interface Window {
    __orbitalDebug?: OrbitalDebug;
  }
}

interface DragState {
  pointerId: number;
  mode: "aim" | "burn" | "pan";
  last: Vec2;
  current: Vec2;
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelIndex = useGame((s) => s.levelIndex);
  const resetNonce = useGame((s) => s.resetNonce);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(makeLevel(levelIndex));
    const cam = new Camera();
    let scene: PixiScene | null = null;
    let shakeFrames = 0;
    let winWallStart = 0;
    const pointers = new Map<number, Vec2>();
    let drag: DragState | null = null;
    let pinchDist = 0;
    let aim: AimState | null = null;
    // Two-step aiming: a released drag *sets* the aim; the player can then
    // re-drag the arrow tip or nudge with arrow keys, and commits with the
    // Launch button / Enter. Esc or right-click cancels.
    let pendingAim: { dv: Vec2; isBurn: boolean } | null = null;
    let aimDirty = false;
    let autopilot: Autopilot | null = null;
    let lastCommitNonce = useGame.getState().commitNonce;
    let lastClearNonce = useGame.getState().clearNonce;
    // Selectable auto-pause points along the current coast (see
    // "Select a burn point" below); recomputed periodically while flying.
    let coastCheckpoints: { t: number; pos: Vec2; dist: number }[] = [];
    let lastCheckpointRecompute = 0;
    // Wall time coastCheckpoints() last returned a non-empty result. Near a
    // close flyby (a moon, a flyby giant) the predicted closest-approach
    // point is sensitive to tiny timing differences between recomputes, so a
    // real checkpoint can vanish for one or two 400ms ticks and reappear —
    // hold the last dots briefly instead of blinking them out immediately.
    let lastCheckpointsFoundAt = 0;
    const CHECKPOINT_HOLD_MS = 1200;
    let lastSelectedCheckpointT = useGame.getState().selectedCheckpointT;
    let armedCheckpointT: number | null = null;
    let raf = 0;
    let lastT = performance.now();
    let accumulator = 0;
    let lastSync = 0;
    let lastFollowNonce = useGame.getState().followNonce;
    let prevPhase = engine.phase;
    let seenEventId = 0;
    let predictSkip = 0;
    let predictCost = 0;
    // Snap-dot viability is expensive (a short sim per candidate magnitude),
    // so it's recomputed far less often than the prediction line: only when
    // the aim direction actually changes, and throttled by wall time.
    let snapDots: { mag: number; viable: boolean }[] = [];
    let lastSnapDir: Vec2 | null = null;
    let lastSnapWallT = 0;
    let disposed = false;
    let fpsSmoothed = 60;
    // One shared debug object, mutated in place (no per-frame allocation).
    const debug: OrbitalDebug = {
      fps: 60,
      bodies: 0,
      particles: 0,
      phase: "aiming",
      aimMag: null,
      checkpointCount: 0,
      checkpointArmed: false,
    };
    window.__orbitalDebug = debug;

    const host = canvas.parentElement ?? canvas;
    const resize = () => {
      const w = host.clientWidth || canvas.clientWidth || 800;
      const h = host.clientHeight || canvas.clientHeight || 600;
      cam.viewportW = w;
      cam.viewportH = h;
      scene?.resize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // Initial camera: over the start body, level zoom scaled for small screens.
    cam.zoom = engine.level.zoom * Math.min(1, cam.viewportW / 900);
    cam.minZoom = Math.min(0.04, engine.level.zoom * 0.3);
    cam.follow(engine.probe.pos, true);

    useGame.getState().syncFromEngine({
      phase: engine.phase,
      deltaVRemaining: engine.deltaVRemaining,
      budget: engine.level.budget,
      time: 0,
      burnsLeft: engine.burnsLeft,
      winProgress: 0,
      stars: 0,
      lostReason: null,
      aimReady: false,
      aimIsBurn: false,
    });

    const screenOfProbe = () => cam.toScreen(engine.probe.pos);

    const syncAim = () =>
      useGame.getState().syncFromEngine({
        aimReady: !!pendingAim,
        aimIsBurn: !!pendingAim?.isBurn,
      });

    /** Screen position of the pending aim arrow's tip (matches the arrow). */
    const aimTipScreen = (): Vec2 | null => {
      if (!pendingAim) return null;
      const dv = engine.clampDv(pendingAim.dv);
      const l = len(dv);
      if (l < 0.5) return null;
      const p = screenOfProbe();
      const px = l / DV_PER_PX;
      return { x: p.x + (dv.x / l) * px, y: p.y + (dv.y / l) * px };
    };

    /** Log a maneuver with its vector, heading, and resulting speed. */
    const logManeuver = (source: "you" | "auto", kind: string, dv: Vec2) => {
      const heading = ((Math.atan2(dv.y, dv.x) * 180) / Math.PI + 360) % 360;
      const speed = len(engine.probe.vel);
      useGame
        .getState()
        .pushLog(
          engine.time,
          source,
          `${kind}: ${(len(dv) * KMS).toFixed(2)} km/s at ${heading.toFixed(0)}° · speed now ${(
            speed * KMS
          ).toFixed(2)} km/s · Δv left ${(engine.deltaVRemaining * KMS).toFixed(1)} km/s`,
        );
    };

    const commitPending = () => {
      if (!pendingAim) return;
      const dv = engine.clampDv(pendingAim.dv);
      if (len(dv) >= 1.5) {
        if (!pendingAim.isBurn && engine.phase === "aiming") {
          if (engine.launch(dv)) {
            sound.launch();
            cam.following = true;
            scene?.burst(engine.probe.pos, norm(dv), 50, 55);
            logManeuver("you", "Launch", dv);
          }
        } else if (pendingAim.isBurn && engine.phase === "flying" && engine.burnsLeft > 0) {
          if (engine.burn(dv)) {
            sound.burn();
            useGame.getState().setPaused(false);
            scene?.burst(engine.probe.pos, norm(dv), 36, 45);
            logManeuver("you", "Mid-course burn", dv);
          }
        }
      }
      pendingAim = null;
      aim = null;
      syncAim();
    };

    /** Raw (unsnapped) drag vector: direction = launch direction, length = delta-v. */
    const rawDvFromDrag = (d: DragState): Vec2 => {
      const p = screenOfProbe();
      return scale(sub(d.current, p), DV_PER_PX);
    };

    /**
     * Snapped drag vector for aiming/prediction. Magnitude snaps to the
     * nearest VIABLE dot (a magnitude that actually reaches a usable close
     * approach on this heading — see snapDots below) within catch range;
     * direction is never snapped — arrow keys cover fine angle control, and
     * orbital timing rewards a precise heading. Away from any viable dot the
     * drag still snaps to the plain 0.5 km/s grid, so it stays predictable
     * rather than going loose. snapDots is computed from the RAW direction
     * each frame (see below) so this snap can't feed back on itself.
     */
    const dvFromDrag = (d: DragState): Vec2 => {
      const raw = rawDvFromDrag(d);
      const mag = len(raw);
      if (mag < 1e-6) return raw;
      let snapped = Math.round(mag / DV_SNAP) * DV_SNAP;
      // Catch radius: pulls the drag onto a nearby viable dot rather than
      // requiring pixel-perfect placement on it.
      const CATCH = DV_SNAP * 1.5;
      let bestDist = CATCH;
      for (const dot of snapDots) {
        if (!dot.viable) continue;
        const dd = Math.abs(dot.mag - mag);
        if (dd < bestDist) {
          bestDist = dd;
          snapped = dot.mag;
        }
      }
      return engine.clampDv(scale(raw, snapped / mag));
    };

    const canvasPos = (e: PointerEvent): Vec2 => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = canvasPos(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        // Second finger: switch to pinch, cancel any drag except aim.
        const [a, b] = [...pointers.values()];
        pinchDist = dist(a, b);
        if (drag?.mode === "pan") drag = null;
        return;
      }
      const st = useGame.getState();

      // Select-a-burn-point: tapping a checkpoint marker (while coasting,
      // burn still available, not already paused for a manual burn) arms
      // an auto-pause instead of starting a drag.
      if (engine.phase === "flying" && !st.paused && engine.burnsLeft > 0 && scene) {
        for (const cp of scene.lastCheckpointScreens) {
          if (dist(p, cp.screen) < 16) {
            const already =
              st.selectedCheckpointT !== null &&
              Math.abs(cp.t - st.selectedCheckpointT) < 1e-6;
            useGame.getState().selectCheckpoint(already ? null : cp.t);
            return;
          }
        }
      }

      const nearProbe = dist(p, screenOfProbe()) < 48;
      const tip = aimTipScreen();
      const nearTip = tip !== null && dist(p, tip) < 32;
      const canAim = engine.phase === "aiming";
      const canBurn = engine.phase === "flying" && st.paused && engine.burnsLeft > 0;
      if ((canAim || canBurn) && (nearProbe || nearTip)) {
        drag = {
          pointerId: e.pointerId,
          mode: canAim ? "aim" : "burn",
          last: p,
          current: p,
        };
      } else {
        drag = { pointerId: e.pointerId, mode: "pan", last: p, current: p };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = canvasPos(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = dist(a, b);
        if (pinchDist > 0) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          cam.zoomAt(mid, d / pinchDist);
        }
        pinchDist = d;
        return;
      }
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.mode === "pan") {
        cam.panByScreen(p.x - drag.last.x, p.y - drag.last.y);
      }
      drag.last = drag.current;
      drag.current = p;
    };

    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.mode === "aim" || drag.mode === "burn") {
        const dv = dvFromDrag(drag);
        // Release SETS the aim (it doesn't launch) — commit is a separate
        // button/Enter press. A tiny drag is a tap: keep any existing aim.
        if (len(dv) >= 1.5) {
          pendingAim = { dv, isBurn: drag.mode === "burn" };
          aimDirty = true;
          syncAim();
        }
      }
      drag = null;
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (pendingAim) {
        pendingAim = null;
        aim = null;
        syncAim();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && pendingAim) {
        e.preventDefault();
        commitPending();
        return;
      }
      if (e.key === "Escape" && pendingAim) {
        pendingAim = null;
        aim = null;
        syncAim();
        return;
      }
      if (!pendingAim) return;
      // Arrow keys fine-tune: left/right rotate, up/down change delta-v.
      // Shift makes the step 10x finer.
      const rotStep = (e.shiftKey ? 0.2 : 2) * (Math.PI / 180);
      const magStep = e.shiftKey ? 0.3 : 3;
      const dv = pendingAim.dv;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const a = e.key === "ArrowLeft" ? -rotStep : rotStep;
        const c = Math.cos(a);
        const s = Math.sin(a);
        pendingAim.dv = { x: dv.x * c - dv.y * s, y: dv.x * s + dv.y * c };
        aimDirty = true;
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const m = len(dv);
        if (m > 0) {
          const target = Math.max(1.5, m + (e.key === "ArrowUp" ? magStep : -magStep));
          const k = target / m;
          pendingAim.dv = { x: dv.x * k, y: dv.y * k };
          aimDirty = true;
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.zoomAt(canvasPos(e as unknown as PointerEvent), Math.exp(-e.deltaY * 0.0012));
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);

    // One FrameInput object, mutated in place each frame.
    const frameInput: FrameInput = {
      cam,
      engine,
      wallTime: 0,
      dt: 0,
      aim: null,
      winT: 0,
      shake: 0,
      checkpoints: [],
      selectedCheckpointT: null,
    };

    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const st = useGame.getState();
      const dtReal = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;

      // Camera re-follow request from the HUD.
      if (st.followNonce !== lastFollowNonce) {
        lastFollowNonce = st.followNonce;
        cam.following = true;
      }
      // Commit / clear requests from the HUD buttons.
      if (st.commitNonce !== lastCommitNonce) {
        lastCommitNonce = st.commitNonce;
        commitPending();
      }
      if (st.clearNonce !== lastClearNonce) {
        lastClearNonce = st.clearNonce;
        if (pendingAim) {
          pendingAim = null;
          aim = null;
          syncAim();
        }
      }

      // Autopilot lifecycle: the store flag turns it on/off; it drives the
      // engine through the same public API a player uses.
      if (st.autoPilot) {
        if (!autopilot && (engine.phase === "aiming" || engine.phase === "flying")) {
          autopilot = new Autopilot(engine, {
            pause: (p) => useGame.getState().setPaused(p),
            setSpeed: (sp) => {
              if (useGame.getState().speed !== sp) useGame.getState().setSpeed(sp);
            },
            onLaunch: (dv) => {
              pendingAim = null;
              syncAim();
              sound.launch();
              cam.following = true;
              scene?.burst(engine.probe.pos, norm(dv), 50, 55);
              logManeuver("auto", "Launch", dv);
            },
            onBurn: (dv) => {
              sound.burn();
              scene?.burst(engine.probe.pos, norm(dv), 36, 45);
            },
            log: (text) => useGame.getState().pushLog(engine.time, "auto", text),
          });
        }
        if (autopilot) {
          autopilot.update();
          if (autopilot.done) {
            autopilot = null;
            useGame.getState().syncFromEngine({ autoPilot: false });
          }
        }
      } else if (autopilot) {
        autopilot.dispose();
        autopilot = null;
      }

      // "Select a burn point" dots: shown as a preview along the predicted
      // path from the moment the player starts aiming (so they can be seen
      // before committing the launch), and remain selectable to auto-pause
      // once actually flying. Not selectable during aiming — the trajectory
      // is still hypothetical and changes on every drag, so any "armed"
      // pick would be meaningless until the launch is real.
      let checkpointSource: Vec2 | undefined | "flying" = undefined;
      if (engine.phase === "flying" && engine.burnsLeft > 0 && !pendingAim) {
        checkpointSource = "flying";
      } else if (engine.phase === "aiming") {
        const previewDv = pendingAim?.dv ?? (drag && drag.mode === "aim" ? dvFromDrag(drag) : null);
        if (previewDv && len(previewDv) > 1) checkpointSource = engine.clampDv(previewDv);
      }
      if (checkpointSource !== undefined && now - lastCheckpointRecompute > 400) {
        lastCheckpointRecompute = now;
        const found =
          checkpointSource === "flying"
            ? engine.coastCheckpoints()
            : engine.coastCheckpoints(checkpointSource);
        if (found.length > 0) {
          lastCheckpointsFoundAt = now;
          coastCheckpoints = found;
          useGame.getState().syncFromEngine({ coastCheckpoints });
        } else if (
          coastCheckpoints.length > 0 &&
          now - lastCheckpointsFoundAt > CHECKPOINT_HOLD_MS
        ) {
          coastCheckpoints = [];
          useGame.getState().syncFromEngine({ coastCheckpoints: [] });
        }
      } else if (checkpointSource === undefined && coastCheckpoints.length > 0) {
        coastCheckpoints = [];
        useGame.getState().syncFromEngine({ coastCheckpoints: [] });
      }
      // Only a live "flying" scan can be armed for auto-pause — see above.
      if (engine.phase !== "flying" && st.selectedCheckpointT !== null) {
        useGame.getState().selectCheckpoint(null);
      }
      if (st.selectedCheckpointT !== lastSelectedCheckpointT) {
        lastSelectedCheckpointT = st.selectedCheckpointT;
        // selectedCheckpointT is already an absolute engine.time (see
        // GameEngine.coastCheckpoints) — no need to offset by "now".
        armedCheckpointT = st.selectedCheckpointT;
      }

      // Fixed-timestep accumulator, scaled by the speed multiplier. If a
      // checkpoint is armed, step only up to it this frame and pause there
      // instead of overshooting past the chosen burn point.
      if (!st.paused) {
        accumulator += dtReal * st.speed;
        let steps = 0;
        while (accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
          if (armedCheckpointT !== null && engine.time + DT / 2 >= armedCheckpointT) {
            armedCheckpointT = null;
            useGame.getState().selectCheckpoint(null);
            useGame.getState().setPaused(true);
            useGame
              .getState()
              .pushLog(engine.time, "sys", "Reached the selected point — paused for the burn");
            accumulator = 0;
            break;
          }
          engine.step();
          accumulator -= DT;
          steps++;
        }
        if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0; // can't keep up; drop time
      }

      // Sounds and effects for phase transitions and flyby flashes.
      if (engine.phase !== prevPhase) {
        if (engine.phase === "won") {
          sound.win();
          winWallStart = now;
          useProgress.getState().recordWin(levelIndex, engine.stars());
        }
        if (engine.phase === "lost") sound.lose();
        if (engine.phase === "won" || engine.phase === "lost") {
          pendingAim = null; // a pending burn dies with the attempt
          syncAim();
          useGame
            .getState()
            .pushLog(
              engine.time,
              "sys",
              engine.phase === "won"
                ? `Stable orbit achieved around ${engine.targetBody.name} — ${(
                    engine.deltaVUsed * KMS
                  ).toFixed(1)} km/s used, ${engine.stars()} stars`
                : `Mission lost: ${engine.lostReason}`,
            );
        }
        prevPhase = engine.phase;
      }
      for (const ev of engine.events) {
        if (ev.id > seenEventId) {
          seenEventId = ev.id;
          sound.flyby(ev.gain);
          shakeFrames = 6; // slingshot kick
          useGame
            .getState()
            .pushLog(
              engine.time,
              "sys",
              `Gravity assist: ${ev.gain ? "gained" : "lost"} ${ev.text.replace(/[+−]/, "")} — now ${(
                len(engine.probe.vel) * KMS
              ).toFixed(2)} km/s`,
            );
        }
      }

      // Snap-dot ladder: recomputed from the RAW (unsnapped) drag direction
      // so it can't feed back on its own output (dvFromDrag below reads
      // whatever snapDots this produces to decide the actual snapped
      // magnitude). Only when the raw direction has turned meaningfully and
      // at most a few times a second — each dot is a real short simulation,
      // unlike the single cached prediction line.
      const isAimDrag = drag !== null && drag.mode !== "pan";
      if (isAimDrag) {
        const raw = rawDvFromDrag(drag!);
        const mag = len(raw);
        if (mag > 1e-6 && now - lastSnapWallT > 180) {
          const dir = { x: raw.x / mag, y: raw.y / mag };
          const turned =
            !lastSnapDir || Math.hypot(dir.x - lastSnapDir.x, dir.y - lastSnapDir.y) > 0.02;
          if (turned) {
            lastSnapWallT = now;
            lastSnapDir = dir;
            // Cap the scan: each candidate is a real short sim, so bound the
            // per-recompute cost regardless of how large the budget is.
            const MAX_DOTS = 24;
            const mags: number[] = [];
            for (
              let m = DV_SNAP;
              m <= engine.deltaVRemaining && mags.length < MAX_DOTS;
              m += DV_SNAP
            )
              mags.push(m);
            const viable = engine.viableSnaps(dir, mags);
            snapDots = mags.map((m, i) => ({ mag: m, viable: viable[i] }));
          }
        }
      } else {
        lastSnapDir = null;
      }

      // Live prediction for the active drag or the pending (set) aim.
      // Recompute rate adapts to the last prediction's cost so heavy levels
      // stay at 60 fps; a frozen world reuses the cached prediction.
      const source = isAimDrag
        ? { dv: dvFromDrag(drag!), isBurn: drag!.mode === "burn" }
        : pendingAim
          ? { dv: engine.clampDv(pendingAim.dv), isBurn: pendingAim.isBurn }
          : null;
      if (source) {
        const skip = predictCost > 6 ? 4 : predictCost > 3 ? 3 : 2;
        // Degrade the horizon on slow CPUs instead of dropping frames.
        // (Rises fast on a slow prediction, recovers slowly to avoid flicker.)
        const horizon = predictCost > 9 ? 30 : predictCost > 5 ? 45 : PREDICT_SECONDS;
        const worldMoves =
          !st.paused && (engine.phase === "flying" || engine.level.bodies.some((b) => b.dynamic));
        if (!aim || aimDirty || ((isAimDrag || worldMoves) && predictSkip++ % skip === 0)) {
          const t0 = performance.now();
          aim = {
            dv: source.dv,
            prediction: engine.predict(source.dv, horizon),
            isBurn: source.isBurn,
            snapDots,
          };
          const cost = performance.now() - t0;
          predictCost = cost > predictCost ? cost : predictCost * 0.98 + cost * 0.02;
          aimDirty = false;
        } else {
          aim = { ...aim, dv: source.dv, isBurn: source.isBurn, snapDots };
        }
      } else {
        aim = null;
      }

      cam.follow(engine.probe.pos);

      // Hand the frame to the Pixi scene (shake decays over 6 frames).
      frameInput.wallTime = now / 1000;
      frameInput.dt = dtReal;
      frameInput.aim = aim;
      frameInput.winT = winWallStart > 0 ? (now - winWallStart) / 1000 : 0;
      frameInput.shake = shakeFrames > 0 ? 10 * (shakeFrames / 6) : 0;
      frameInput.checkpoints = coastCheckpoints;
      frameInput.selectedCheckpointT = armedCheckpointT !== null ? st.selectedCheckpointT : null;
      if (shakeFrames > 0) shakeFrames--;
      scene?.render(frameInput);

      if (dtReal > 0) fpsSmoothed += (1 / dtReal - fpsSmoothed) * 0.05;
      debug.fps = fpsSmoothed;
      debug.bodies = engine.level.bodies.length;
      debug.particles = scene?.particleCount ?? 0;
      debug.phase = engine.phase;
      debug.aimMag = aim ? len(aim.dv) : null;
      debug.checkpointCount = coastCheckpoints.length;
      debug.checkpointArmed = armedCheckpointT !== null;

      // Mirror engine state into the store for the HUD (throttled).
      if (now - lastSync > 120) {
        lastSync = now;
        const t = engine.targetBody;
        const el = orbitalElements(engine.probe, t, engine.level.G);
        useGame.getState().syncFromEngine({
          telemetry: {
            speed: len(engine.probe.vel),
            relSpeed: len(sub(engine.probe.vel, t.vel)),
            targetDist: dist(engine.probe.pos, t.pos),
            periapsis: el.periapsis,
            apoapsis: el.apoapsis,
            ecc: el.e,
            bound: el.bound,
          },
          phase: engine.phase,
          deltaVRemaining: engine.deltaVRemaining,
          budget: engine.level.budget,
          time: engine.time,
          burnsLeft: engine.burnsLeft,
          winProgress: engine.winProgress,
          stars: engine.phase === "won" ? engine.stars() : 0,
          lostReason: engine.lostReason,
          autoStatus: autopilot?.status ?? "",
        });
      }
    };

    // PixiJS 8 init is async; the render loop starts once the scene is up.
    // (Import is dynamic so pixi.js never loads during SSR.)
    (async () => {
      const { PixiScene } = await import("./pixi/PixiScene");
      const s = new PixiScene();
      await s.init(canvas, engine.level, 7 + levelIndex);
      if (disposed) {
        s.destroy();
        return;
      }
      scene = s;
      s.resize(cam.viewportW, cam.viewportH);
      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      scene?.destroy();
      scene = null;
    };
  }, [levelIndex, resetNonce]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full touch-none select-none"
      style={{ touchAction: "none" }}
    />
  );
}
