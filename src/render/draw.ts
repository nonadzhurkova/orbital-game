import type { Camera } from "./camera";
import type { GameEngine } from "@/game/engine";
import { LevelBody, PROBE_RADIUS, KMS } from "@/game/levels";
import { Vec2, len } from "@/physics/vec";
import type { TrajectoryResult } from "@/physics/types";

export interface AimState {
  /** Requested delta-v vector (world units), already clamped by the engine. */
  dv: Vec2;
  prediction: TrajectoryResult;
  /** True when aiming a mid-course burn rather than the launch. */
  isBurn: boolean;
}

/** Deterministic per-body detail positions (craters, band offsets). */
function hashish(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  body: LevelBody,
  time: number,
  isTarget: boolean,
) {
  const s = cam.toScreen(body.pos);
  const r = body.radius * cam.zoom;
  if (s.x < -r * 6 || s.x > cam.viewportW + r * 6 || s.y < -r * 6 || s.y > cam.viewportH + r * 6)
    return;

  const rot = time * body.style.rotSpeed + hashish(body.id) * Math.PI * 2;

  // Star glow (drawn unrotated, before the disc).
  if (body.style.kind === "star") {
    const glow = ctx.createRadialGradient(s.x, s.y, r * 0.6, s.x, s.y, r * 3);
    glow.addColorStop(0, body.style.accent + "66");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(rot);

  // Base disc.
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = body.style.base;
  ctx.fill();

  // Details, clipped to the disc.
  ctx.save();
  ctx.clip();
  const seed = hashish(body.id + "d");
  if (body.style.kind === "gas" || body.style.kind === "star") {
    // Horizontal bands.
    ctx.fillStyle = body.style.accent;
    const bands = 3;
    for (let i = 0; i < bands; i++) {
      const y = ((seed + i / bands) % 1) * 2 * r - r;
      const bh = r * (0.12 + 0.1 * ((seed * 7 + i) % 1));
      ctx.globalAlpha = body.style.kind === "star" ? 0.35 : 0.55;
      ctx.beginPath();
      ctx.ellipse(0, y, r * 1.1, bh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Craters / patches.
    ctx.fillStyle = body.style.accent;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 4; i++) {
      const a = ((seed * 13 + i * 0.61) % 1) * Math.PI * 2;
      const d = ((seed * 29 + i * 0.37) % 1) * r * 0.75;
      const cr = r * (0.12 + 0.14 * ((seed * 5 + i * 0.83) % 1));
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, cr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Simple terminator shading for non-stars.
  if (body.style.kind !== "star") {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(r * 0.35, r * 0.2, r * 1.05, 0, Math.PI * 2);
    ctx.rect(-r * 2, -r * 2, r * 4, r * 4);
    ctx.fill("evenodd");
  }
  ctx.restore(); // un-clip
  ctx.globalAlpha = 1;
  ctx.restore(); // un-rotate

  if (isTarget) {
    // Capture zone ring: orbits must fit under 5 radii.
    ctx.strokeStyle = "rgba(120, 255, 180, 0.35)";
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, body.radius * 5 * cam.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, cam: Camera, trail: Vec2[]) {
  if (trail.length < 2) return;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    const a = cam.toScreen(trail[i - 1]);
    const b = cam.toScreen(trail[i]);
    ctx.strokeStyle = `rgba(140, 200, 255, ${(0.6 * i) / trail.length})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function drawPrediction(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  pred: TrajectoryResult,
) {
  const pts = pred.points;
  if (pts.length < 2) return;
  ctx.setLineDash([4, 6]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pred.collided ? "rgba(255, 120, 110, 0.9)" : "rgba(255, 255, 255, 0.7)";
  ctx.beginPath();
  const p0 = cam.toScreen(pts[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const p = cam.toScreen(pts[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (pred.collided) {
    const last = cam.toScreen(pts[pts.length - 1]);
    ctx.strokeStyle = "rgba(255, 120, 110, 1)";
    ctx.lineWidth = 2;
    const x = 6;
    ctx.beginPath();
    ctx.moveTo(last.x - x, last.y - x);
    ctx.lineTo(last.x + x, last.y + x);
    ctx.moveTo(last.x + x, last.y - x);
    ctx.lineTo(last.x - x, last.y + x);
    ctx.stroke();
  }
}

function drawProbe(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  engine: GameEngine,
  pulse: number,
) {
  const p = engine.probe;
  const s = cam.toScreen(p.pos);
  const size = Math.max(PROBE_RADIUS * cam.zoom, 5);
  const v = p.vel;
  const heading = len(v) > 0.5 ? Math.atan2(v.y, v.x) : engine.level.startAngle;

  // Soft halo so the probe is findable when zoomed out.
  ctx.fillStyle = `rgba(160, 220, 255, ${0.12 + 0.08 * Math.sin(pulse * 4)})`;
  ctx.beginPath();
  ctx.arc(s.x, s.y, size * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(heading);
  ctx.fillStyle = "#e8f4ff";
  ctx.strokeStyle = "#7fb8e8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size * 1.6, 0);
  ctx.lineTo(-size, size * 0.9);
  ctx.lineTo(-size * 0.5, 0);
  ctx.lineTo(-size, -size * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawAim(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  engine: GameEngine,
  aim: AimState,
) {
  const from = cam.toScreen(engine.probe.pos);
  const dvLen = len(aim.dv);
  if (dvLen < 0.5) return;
  // Arrow points along the launch direction; length ~ delta-v.
  const dir = { x: aim.dv.x / dvLen, y: aim.dv.y / dvLen };
  const px = Math.min(dvLen, engine.deltaVRemaining) * 1.1 + 24;
  const tip = { x: from.x + dir.x * px, y: from.y + dir.y * px };
  ctx.strokeStyle = aim.isBurn ? "rgba(255, 200, 90, 0.95)" : "rgba(120, 255, 180, 0.95)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  // Arrowhead.
  const a = Math.atan2(dir.y, dir.x);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - Math.cos(a - 0.4) * 10, tip.y - Math.sin(a - 0.4) * 10);
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - Math.cos(a + 0.4) * 10, tip.y - Math.sin(a + 0.4) * 10);
  ctx.stroke();
  // Delta-v readout near the arrow tip.
  const clamped = Math.min(dvLen, engine.deltaVRemaining);
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(`${(clamped * KMS).toFixed(1)} km/s`, tip.x, tip.y - 12);
}

function drawFlashes(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  engine: GameEngine,
) {
  for (const e of engine.events) {
    const age = engine.time - e.t;
    const alpha = Math.max(0, 1 - age / 2);
    const s = cam.toScreen(e.pos);
    ctx.font = "700 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = e.gain
      ? `rgba(120, 255, 160, ${alpha})`
      : `rgba(255, 150, 130, ${alpha})`;
    ctx.fillText(e.text, s.x, s.y - 14 - age * 18);
  }
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  engine: GameEngine,
  wallTime: number,
  aim: AimState | null,
) {
  const lvl = engine.level;
  // Map boundary.
  const c = cam.toScreen({ x: 0, y: 0 });
  ctx.strokeStyle = "rgba(255, 100, 100, 0.18)";
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 14]);
  ctx.beginPath();
  ctx.arc(c.x, c.y, lvl.mapRadius * cam.zoom, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  drawTrail(ctx, cam, engine.trail);
  for (const b of lvl.bodies) {
    drawBody(ctx, cam, b, engine.time, b.id === lvl.targetBodyId);
  }
  if (aim) drawPrediction(ctx, cam, aim.prediction);
  drawProbe(ctx, cam, engine, wallTime);
  if (aim) drawAim(ctx, cam, engine, aim);
  drawFlashes(ctx, cam, engine);
}
