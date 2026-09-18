import type { Vec2 } from "@/physics/vec";
import type { Camera } from "./camera";

const MAX_PARTICLES = 500;

/**
 * Fixed-size particle pool — zero allocations per frame. Particles live in
 * world space and are drawn through the camera.
 */
export class ParticlePool {
  // Structure-of-arrays layout; preallocated once.
  private x = new Float32Array(MAX_PARTICLES);
  private y = new Float32Array(MAX_PARTICLES);
  private vx = new Float32Array(MAX_PARTICLES);
  private vy = new Float32Array(MAX_PARTICLES);
  private age = new Float32Array(MAX_PARTICLES);
  private life = new Float32Array(MAX_PARTICLES);
  private size = new Float32Array(MAX_PARTICLES);
  /** 0 = exhaust (amber), 1 = spark (white-blue). */
  private kind = new Uint8Array(MAX_PARTICLES);
  private active = new Uint8Array(MAX_PARTICLES);
  private cursor = 0;
  count = 0;

  /**
   * Burst of exhaust particles at `pos`, sprayed opposite `thrustDir`
   * (unit-ish vector), e.g. at launch and mid-course burns.
   */
  burst(pos: Vec2, thrustDir: Vec2, count: number, baseSpeed: number, kind: 0 | 1 = 0) {
    const backAngle = Math.atan2(-thrustDir.y, -thrustDir.x);
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      if (!this.active[idx]) this.count++;
      this.active[idx] = 1;
      const spread = (Math.random() - 0.5) * 1.6;
      const a = backAngle + spread;
      const sp = baseSpeed * (0.5 + Math.random() * 1.3);
      this.x[idx] = pos.x;
      this.y[idx] = pos.y;
      this.vx[idx] = Math.cos(a) * sp;
      this.vy[idx] = Math.sin(a) * sp;
      this.age[idx] = 0;
      this.life[idx] = 0.35 + Math.random() * 0.25; // fade over ~0.6 s max
      this.size[idx] = 2.5 + Math.random() * 3.5;
      this.kind[idx] = kind;
    }
  }

  /** Advance particle ages/positions by wall-clock dt (seconds). */
  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.active[i]) continue;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.active[i] = 0;
        this.count--;
        continue;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      // Mild drag so bursts bloom then hang.
      this.vx[i] *= 1 - 2.2 * dt;
      this.vy[i] *= 1 - 2.2 * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera) {
    ctx.globalCompositeOperation = "lighter"; // additive: bursts glow
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.active[i]) continue;
      const t = this.age[i] / this.life[i];
      const alpha = (1 - t) * 0.9;
      const sx = (this.x[i] - cam.center.x) * cam.zoom + cam.viewportW / 2;
      const sy = (this.y[i] - cam.center.y) * cam.zoom + cam.viewportH / 2;
      if (sx < -10 || sx > cam.viewportW + 10 || sy < -10 || sy > cam.viewportH + 10) continue;
      // Exhaust cools amber -> deep orange; sparks stay white-blue.
      if (this.kind[i] === 0) {
        const g = Math.round(200 - 120 * t);
        ctx.fillStyle = `rgba(255, ${g}, 80, ${alpha})`;
      } else {
        ctx.fillStyle = `rgba(210, 235, 255, ${alpha})`;
      }
      const s = this.size[i] * (1 - t * 0.5) * Math.max(cam.zoom, 0.6);
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}

export { MAX_PARTICLES };
