"use client";
import { useEffect, useRef } from "react";
import { GameEngine } from "@/game/engine";
import { makeLevel } from "@/game/levels";
import { useGame } from "@/game/store";
import { sound } from "@/game/sound";
import { DT } from "@/physics/engine";
import { Vec2, sub, scale, len, dist } from "@/physics/vec";
import { Camera } from "./camera";
import { Starfield } from "./starfield";
import { ParticlePool } from "./particles";
import { drawScene, AimState } from "./draw";
import { norm } from "@/physics/vec";

/** Delta-v units gained per screen pixel of drag. */
const DV_PER_PX = 0.7;
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const engine = new GameEngine(makeLevel(levelIndex));
    const cam = new Camera();
    const starfield = new Starfield(7 + levelIndex);
    const particles = new ParticlePool();
    let shakeFrames = 0;
    let winWallStart = 0;
    const pointers = new Map<number, Vec2>();
    let drag: DragState | null = null;
    let pinchDist = 0;
    let aim: AimState | null = null;
    let raf = 0;
    let lastT = performance.now();
    let accumulator = 0;
    let lastSync = 0;
    let lastFollowNonce = useGame.getState().followNonce;
    let prevPhase = engine.phase;
    let seenEventId = 0;
    let predictSkip = 0;
    let disposed = false;
    let fpsSmoothed = 60;
    // One shared debug object, mutated in place (no per-frame allocation).
    const debug: OrbitalDebug = { fps: 60, bodies: 0, particles: 0, phase: "aiming" };
    window.__orbitalDebug = debug;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cam.viewportW = w;
      cam.viewportH = h;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

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
    });

    const screenOfProbe = () => cam.toScreen(engine.probe.pos);

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
      const nearProbe = dist(p, screenOfProbe()) < 44;
      if (engine.phase === "aiming" && nearProbe) {
        drag = { pointerId: e.pointerId, mode: "aim", last: p, current: p };
      } else if (
        engine.phase === "flying" &&
        st.paused &&
        engine.burnsLeft > 0 &&
        nearProbe
      ) {
        drag = { pointerId: e.pointerId, mode: "burn", last: p, current: p };
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
        if (len(dv) >= 1.5) {
          if (drag.mode === "aim") {
            if (engine.launch(dv)) {
              sound.launch();
              cam.following = true;
              particles.burst(engine.probe.pos, norm(dv), 50, 55);
            }
          } else {
            if (engine.burn(dv)) {
              sound.burn();
              useGame.getState().setPaused(false);
              particles.burst(engine.probe.pos, norm(dv), 36, 45);
            }
          }
        }
      }
      drag = null;
      aim = null;
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
        prevPhase = engine.phase;
      }
      for (const ev of engine.events) {
        if (ev.id > seenEventId) {
          seenEventId = ev.id;
          sound.flyby(ev.gain);
          shakeFrames = 6; // slingshot kick
        }
      }
      particles.update(dtReal);

      // Live prediction while dragging an aim (recomputed at ~30 Hz).
      if (drag && (drag.mode === "aim" || drag.mode === "burn")) {
        const dv = dvFromDrag(drag);
        if (!aim || predictSkip++ % 2 === 0) {
          aim = {
            dv,
            prediction: engine.predict(dv, PREDICT_SECONDS),
            isBurn: drag.mode === "burn",
          };
        } else {
          aim = { ...aim, dv };
        }
      } else {
        aim = null;
      }

      cam.follow(engine.probe.pos);

      // Draw (with a brief screen shake after slingshot kicks).
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#070b14";
      ctx.fillRect(0, 0, cam.viewportW, cam.viewportH);
      if (shakeFrames > 0) {
        const k = shakeFrames / 6;
        ctx.translate((Math.random() - 0.5) * 10 * k, (Math.random() - 0.5) * 10 * k);
        shakeFrames--;
      }
      starfield.draw(ctx, cam, now / 1000);
      const winT = winWallStart > 0 ? (now - winWallStart) / 1000 : 0;
      drawScene(ctx, cam, engine, now / 1000, aim, winT);
      particles.draw(ctx, cam);

      if (dtReal > 0) fpsSmoothed += (1 / dtReal - fpsSmoothed) * 0.05;
      debug.fps = fpsSmoothed;
      debug.bodies = engine.level.bodies.length;
      debug.particles = particles.count;
      debug.phase = engine.phase;

      // Mirror engine state into the store for the HUD (throttled).
      if (now - lastSync > 120) {
        lastSync = now;
        useGame.getState().syncFromEngine({
          phase: engine.phase,
          deltaVRemaining: engine.deltaVRemaining,
          budget: engine.level.budget,
          time: engine.time,
          burnsLeft: engine.burnsLeft,
          winProgress: engine.winProgress,
          stars: engine.phase === "won" ? engine.stars() : 0,
          lostReason: engine.lostReason,
        });
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
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
