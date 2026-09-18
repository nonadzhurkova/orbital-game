import type { Camera } from "./camera";

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
  twinklePhase: number;
}

/** Deterministic PRNG so the starfield is stable across resets. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TILE = 1024;

/**
 * Infinite tiled starfield with two parallax layers. Stars live in tile-local
 * coordinates; each visible tile is drawn with a deterministic per-tile seed.
 */
export class Starfield {
  private layers: { parallax: number; stars: Star[] }[];

  constructor(seed = 42) {
    this.layers = [
      { parallax: 0.2, stars: this.makeStars(seed, 34, 0.8) },
      { parallax: 0.5, stars: this.makeStars(seed + 1, 22, 1.2) },
      { parallax: 0.8, stars: this.makeStars(seed + 2, 12, 1.7) },
    ];
  }

  private makeStars(seed: number, count: number, sizeScale: number): Star[] {
    const rnd = mulberry32(seed);
    const stars: Star[] = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: rnd() * TILE,
        y: rnd() * TILE,
        size: (0.5 + rnd() * 1.1) * sizeScale,
        brightness: 0.3 + rnd() * 0.7,
        twinklePhase: rnd() * Math.PI * 2,
      });
    }
    return stars;
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const w = cam.viewportW;
    const h = cam.viewportH;
    for (const layer of this.layers) {
      // Parallax: stars translate slower than the world.
      const offX = cam.center.x * cam.zoom * layer.parallax;
      const offY = cam.center.y * cam.zoom * layer.parallax;
      const x0 = Math.floor(offX / TILE) * TILE;
      const y0 = Math.floor(offY / TILE) * TILE;
      ctx.fillStyle = "#fff";
      for (let ty = y0; ty < offY + h + TILE; ty += TILE) {
        for (let tx = x0; tx < offX + w + TILE; tx += TILE) {
          for (const s of layer.stars) {
            const sx = tx + s.x - offX;
            const sy = ty + s.y - offY;
            if (sx < -2 || sx > w + 2 || sy < -2 || sy > h + 2) continue;
            const tw = 0.75 + 0.25 * Math.sin(time * 1.3 + s.twinklePhase);
            ctx.globalAlpha = s.brightness * tw;
            ctx.fillRect(sx, sy, s.size, s.size);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
