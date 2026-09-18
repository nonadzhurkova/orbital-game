import type { Graphics, StrokeInput } from "pixi.js";

/**
 * Dashed circle as arc subpaths (Pixi Graphics has no native line dashes).
 * Draw once into `g`, then rotate g's container for a spinning-dash effect.
 */
export function dashedCircle(
  g: Graphics,
  radius: number,
  dashLen: number,
  gapLen: number,
  stroke: StrokeInput,
): void {
  const circumference = 2 * Math.PI * radius;
  const n = Math.max(8, Math.round(circumference / (dashLen + gapLen)));
  const step = (2 * Math.PI) / n;
  const dashAngle = step * (dashLen / (dashLen + gapLen));
  for (let i = 0; i < n; i++) {
    const a0 = i * step;
    g.moveTo(Math.cos(a0) * radius, Math.sin(a0) * radius);
    g.arc(0, 0, radius, a0, a0 + dashAngle);
  }
  g.stroke(stroke);
}
