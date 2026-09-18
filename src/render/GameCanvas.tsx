"use client";
import { useEffect, useRef } from "react";
import { GameEngine } from "@/game/engine";
import { Autopilot } from "@/game/autopilot";
import { makeLevel, KMS } from "@/game/levels";
import { useGame } from "@/game/store";
import { sound } from "@/game/sound";
import { DT, orbitalElements } from "@/physics/engine";
import { Vec2, sub, scale, len, dist, norm } from "@/physics/vec";
import { Camera } from "./camera";
import { AimState, DV_PER_PX } from "./types";
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
    let raf = 0;
    let lastT = performance.now();
    let accumulator = 0;
    let lastSync = 0;
    let lastFollowNonce = useGame.getState().followNonce;
    let prevPhase = engine.phase;
    let seenEventId = 0;
    let predictSkip = 0;
    let predictCost = 0;
    let disposed = false;
    let fpsSmoothed = 60;
    // One shared debug object, mutated in place (no per-frame allocation).
    const debug: OrbitalDebug = { fps: 60, bodies: 0, particles: 0, phase: "aiming" };
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

    const dvFromDrag = (d: DragState): Vec2 => {
      // Drag direction = launch direction; length = delta-v (clamped by engine).
      const p = screenOfProbe();
      const raw = scale(sub(d.current, p), DV_PER_PX);
      return engine.clampDv(raw);
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

      // Fixed-timestep accumulator, scaled by the speed multiplier.
      if (!st.paused) {
        accumulator += dtReal * st.speed;
        let steps = 0;
        while (accumulator >= DT && steps < MAX_STEPS_PER_FRAME) {
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

      // Live prediction for the active drag or the pending (set) aim.
      // Recompute rate adapts to the last prediction's cost so heavy levels
      // stay at 60 fps; a frozen world reuses the cached prediction.
      const isAimDrag = drag !== null && drag.mode !== "pan";
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
          };
          const cost = performance.now() - t0;
          predictCost = cost > predictCost ? cost : predictCost * 0.98 + cost * 0.02;
          aimDirty = false;
        } else {
          aim = { ...aim, dv: source.dv, isBurn: source.isBurn };
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
      if (shakeFrames > 0) shakeFrames--;
      scene?.render(frameInput);

      if (dtReal > 0) fpsSmoothed += (1 / dtReal - fpsSmoothed) * 0.05;
      debug.fps = fpsSmoothed;
      debug.bodies = engine.level.bodies.length;
      debug.particles = scene?.particleCount ?? 0;
      debug.phase = engine.phase;

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
