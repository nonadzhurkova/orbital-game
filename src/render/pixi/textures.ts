import { Texture } from "pixi.js";

/** Deterministic PRNG (same as the old canvas starfield). */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const glowCache = new Map<string, Texture>();

/** Soft radial glow: `color` (CSS) at the core fading to transparent. */
export function radialGlowTexture(color: string, radius = 64): Texture {
  const cached = glowCache.get(color);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = radius * 2;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(radius, radius, radius * 0.15, radius, radius, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, radius * 2, radius * 2);
  const tex = Texture.from(c);
  glowCache.set(color, tex);
  return tex;
}

export const STAR_TILE = 1024;

/**
 * One starfield layer tile with brightness baked in (twinkle is approximated
 * by a slow per-layer alpha breath in the scene).
 */
export function starTileTexture(seed: number, count: number, sizeScale: number): Texture {
  const rnd = mulberry32(seed);
  const c = document.createElement("canvas");
  c.width = c.height = STAR_TILE;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  for (let i = 0; i < count; i++) {
    const x = rnd() * STAR_TILE;
    const y = rnd() * STAR_TILE;
    const size = (0.5 + rnd() * 1.1) * sizeScale;
    ctx.globalAlpha = 0.3 + rnd() * 0.7;
    ctx.fillRect(x, y, size, size);
    rnd(); // consume the twinklePhase draw to keep layouts stable
  }
  return Texture.from(c);
}
