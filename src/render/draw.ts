import type { Camera } from "./camera";
import type { GameEngine, TrailPoint } from "@/game/engine";
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

  // Soft atmosphere: two concentric rings in the body's own hue.
  if (body.style.kind !== "star") {
    ctx.strokeStyle = body.style.base;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = Math.max(r * 0.09, 1);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 1.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.09;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 1.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

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

/** Speed-mapped trail color: slow = blue, mid = white, fast = orange. */
function trailColor(speed: number, alpha: number): string {
  const t = Math.min(speed / 90, 1);
  let r: number, g: number, b: number;
  if (t < 0.55) {
    const u = t / 0.55;
    r = 110 + 145 * u;
    g = 170 + 85 * u;
    b = 255;
  } else {
    const u = (t - 0.55) / 0.45;
    r = 255;
    g = 255 - 95 * u;
    b = 255 - 185 * u;
  }
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
}

function drawTrail(ctx: CanvasRenderingContext2D, cam: Camera, trail: TrailPoint[]) {
  if (trail.length < 2) return;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    const a = cam.toScreen(trail[i - 1]);
    const b = cam.toScreen(trail[i]);
    // Alpha fades toward the tail; color follows the speed at that point.
    ctx.strokeStyle = trailColor(trail[i].speed, (0.65 * i) / trail.length);
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

/** Accelerating dashed "wormhole" rings around the target after a win. */
function drawWinRings(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  target: LevelBody,
  winT: number,
) {
  const s = cam.toScreen(target.pos);
  const R = target.radius * cam.zoom;
  const w = Math.min(winT / 1.5, 1); // ramp over 1.5 s
  const spin = winT * (0.6 + 4.5 * w); // spins faster as w grows
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const r = R * (1.7 + i * 0.65);
    const dir = i % 2 === 0 ? 1 : -1;
    ctx.strokeStyle = `rgba(140, 255, 200, ${0.25 + 0.45 * w - i * 0.08})`;
    ctx.setLineDash([10, 14]);
    ctx.lineDashOffset = dir * spin * r;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/** Edge chevron pointing at an off-screen world position. */
function drawOffscreenIndicator(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  pos: Vec2,
  color: string,
  label: string,
) {
  const s = cam.toScreen(pos);
  const m = 40;
  const W = cam.viewportW;
  const H = cam.viewportH;
  if (s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H) return;
  const cx = W / 2;
  const cy = H / 2;
  const dx = s.x - cx;
  const dy = s.y - cy;
  const k = Math.min(
    (W / 2 - m) / Math.max(Math.abs(dx), 1e-6),
    (H / 2 - m) / Math.max(Math.abs(dy), 1e-6),
  );
  const ex = cx + dx * k;
  const ey = cy + dy * k;
  const a = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-4, -7);
  ctx.lineTo(-4, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.fillText(label, ex - Math.cos(a) * 22, ey - Math.sin(a) * 22 + 4);
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  engine: GameEngine,
  wallTime: number,
  aim: AimState | null,
  winT: number,
) {
  const lvl = engine.level;
  // Map boundary — brightens as the probe gets close to it.
  const probeR = len(engine.probe.pos);
  const proximity = Math.max(0, Math.min(1, (probeR / lvl.mapRadius - 0.7) / 0.3));
  const c = cam.toScreen({ x: 0, y: 0 });
  ctx.strokeStyle = `rgba(255, 100, 100, ${0.18 + 0.5 * proximity})`;
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
  if (winT > 0) drawWinRings(ctx, cam, engine.targetBody, winT);
  if (aim) drawPrediction(ctx, cam, aim.prediction);
  drawProbe(ctx, cam, engine, wallTime);
  if (aim) drawAim(ctx, cam, engine, aim);
  drawFlashes(ctx, cam, engine);

  // "Where am I?" hints: edge chevrons for the target and the probe.
  if (engine.phase === "aiming" || engine.phase === "flying") {
    const t = engine.targetBody;
    const distToTarget = len({
      x: t.pos.x - engine.probe.pos.x,
      y: t.pos.y - engine.probe.pos.y,
    });
    drawOffscreenIndicator(
      ctx,
      cam,
      t.pos,
      "rgba(120, 255, 180, 0.95)",
      `${t.name} ${(distToTarget / 100).toFixed(1)}`,
    );
    drawOffscreenIndicator(ctx, cam, engine.probe.pos, "rgba(200, 230, 255, 0.95)", "probe");
  }

  // Boundary warning near the probe when drifting toward the void.
  if (engine.phase === "flying" && proximity > 0) {
    const ps = cam.toScreen(engine.probe.pos);
    const pulse = 0.6 + 0.4 * Math.sin(wallTime * 6);
    ctx.font = "700 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(255, 120, 110, ${proximity * pulse})`;
    ctx.fillText("⚠ leaving the map", ps.x, ps.y - 26);
  }
}
