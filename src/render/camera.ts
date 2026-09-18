import type { Vec2 } from "@/physics/vec";

/** World -> screen transform: screen = (world - center) * zoom + viewport/2. */
export class Camera {
  center: Vec2 = { x: 0, y: 0 };
  zoom = 1;
  viewportW = 1;
  viewportH = 1;
  /** While true, center tracks the follow target every frame. */
  following = true;

  minZoom = 0.05;
  maxZoom = 4;

  toScreen(w: Vec2): Vec2 {
    return {
      x: (w.x - this.center.x) * this.zoom + this.viewportW / 2,
      y: (w.y - this.center.y) * this.zoom + this.viewportH / 2,
    };
  }

  toWorld(s: Vec2): Vec2 {
    return {
      x: (s.x - this.viewportW / 2) / this.zoom + this.center.x,
      y: (s.y - this.viewportH / 2) / this.zoom + this.center.y,
    };
  }

  panByScreen(dx: number, dy: number) {
    this.center.x -= dx / this.zoom;
    this.center.y -= dy / this.zoom;
    this.following = false;
  }

  /** Zoom by `factor`, keeping the world point under `screenPoint` fixed. */
  zoomAt(screenPoint: Vec2, factor: number) {
    const before = this.toWorld(screenPoint);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.toWorld(screenPoint);
    this.center.x += before.x - after.x;
    this.center.y += before.y - after.y;
  }

  /** Smoothly track a target (called once per rendered frame). */
  follow(target: Vec2, snap = false) {
    if (!this.following) return;
    if (snap) {
      this.center.x = target.x;
      this.center.y = target.y;
      return;
    }
    const k = 0.12;
    this.center.x += (target.x - this.center.x) * k;
    this.center.y += (target.y - this.center.y) * k;
  }
}
