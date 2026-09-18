import { Container, Sprite, Texture } from "pixi.js";
import type { Vec2 } from "@/physics/vec";

export const MAX_PARTICLES = 500;

/**
 * Fixed pool of 500 sprites in a container (world space) — no allocations
 * after construction. Same simulation as the old canvas pool: bursts sprayed
 * opposite the thrust direction, mild drag, fade under ~0.6 s.
 */
export class PixiParticles {
  readonly container = new Container();
  private sprites: Sprite[] = [];
  private x = new Float32Array(MAX_PARTICLES);
  private y = new Float32Array(MAX_PARTICLES);
  private vx = new Float32Array(MAX_PARTICLES);
  private vy = new Float32Array(MAX_PARTICLES);
  private age = new Float32Array(MAX_PARTICLES);
  private life = new Float32Array(MAX_PARTICLES);
  private size = new Float32Array(MAX_PARTICLES);
  private kind = new Uint8Array(MAX_PARTICLES);
  private active = new Uint8Array(MAX_PARTICLES);
  private cursor = 0;
  count = 0;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const s = new Sprite(Texture.WHITE);
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.visible = false;
      this.sprites.push(s);
      this.container.addChild(s);
    }
  }

  burst(pos: Vec2, thrustDir: Vec2, count: number, baseSpeed: number, kind: 0 | 1 = 0) {
    const backAngle = Math.atan2(-thrustDir.y, -thrustDir.x);
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      if (!this.active[idx]) this.count++;
      this.active[idx] = 1;
      const a = backAngle + (Math.random() - 0.5) * 1.6;
      const sp = baseSpeed * (0.5 + Math.random() * 1.3);
      this.x[idx] = pos.x;
      this.y[idx] = pos.y;
      this.vx[idx] = Math.cos(a) * sp;
      this.vy[idx] = Math.sin(a) * sp;
      this.age[idx] = 0;
      this.life[idx] = 0.35 + Math.random() * 0.25;
      this.size[idx] = 2.5 + Math.random() * 3.5;
      this.kind[idx] = kind;
    }
  }

  /** Advance ages/positions by wall dt and push state into the sprites. */
  update(dt: number, zoom: number) {
    // Old canvas renderer drew in screen px with a minimum size; in world
    // space that means inflating sizes when zoomed far out.
    const minScale = Math.max(1, 0.6 / zoom);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const spr = this.sprites[i];
      if (!this.active[i]) {
        if (spr.visible) spr.visible = false;
        continue;
      }
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.active[i] = 0;
        this.count--;
        spr.visible = false;
        continue;
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.vx[i] *= 1 - 2.2 * dt;
      this.vy[i] *= 1 - 2.2 * dt;
      const t = this.age[i] / this.life[i];
      const s = this.size[i] * (1 - t * 0.5) * minScale;
      spr.visible = true;
      spr.position.set(this.x[i], this.y[i]);
      spr.width = s;
      spr.height = s;
      spr.alpha = (1 - t) * 0.9;
      if (this.kind[i] === 0) {
        const g = Math.round(200 - 120 * t);
        spr.tint = (255 << 16) | (g << 8) | 80;
      } else {
        spr.tint = 0xd2ebff;
      }
    }
  }
}
