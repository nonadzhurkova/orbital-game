import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  TilingSprite,
} from "pixi.js";
import { BloomFilter } from "pixi-filters";
import type { Camera } from "../camera";
import type { GameEngine, FlashEvent } from "@/game/engine";
import type { AimState } from "../types";
import { DV_PER_PX, DV_SNAP } from "../types";
import { Level, LevelBody, PROBE_RADIUS, KMS } from "@/game/levels";
import { len } from "@/physics/vec";
import type { TrajectoryResult } from "@/physics/types";
import { PixiParticles } from "./particles";
import { dashedCircle } from "./shapes";
import { radialGlowTexture, starTileTexture, STAR_TILE } from "./textures";

/** Everything the scene needs to draw one frame. Mutated in place per frame. */
export interface FrameInput {
  cam: Camera;
  engine: GameEngine;
  wallTime: number;
  dt: number;
  aim: AimState | null;
  winT: number;
  /** Screen-shake magnitude in px (0 = none). */
  shake: number;
}

const cssHex = (s: string): number => parseInt(s.replace("#", ""), 16);

/** Same per-body hash the canvas renderer used, to keep the exact look. */
function hashish(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Speed-mapped trail color: slow = blue, mid = white, fast = orange. */
function trailColor(speed: number): number {
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
  return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
}

interface BodyView {
  body: LevelBody;
  root: Container;
  detail: Container;
  rotOffset: number;
  captureRing: Graphics | null;
}

// Serialize init/destroy across instances (React strict-mode double-mount
// would otherwise race two WebGL contexts on the same canvas).
let opChain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
  const p = opChain.then(fn);
  opChain = p.catch(() => undefined);
  return p;
}

// One Application per canvas, shared across scene instances. Tearing down a
// WebGL context and re-initializing on the same canvas hangs the tab (the
// old context is lost for good), so level changes rebuild the scene graph
// on the live app instead of recreating the renderer.
let sharedApp: Application | null = null;
async function acquireApp(canvas: HTMLCanvasElement): Promise<Application> {
  if (sharedApp && sharedApp.canvas === canvas) return sharedApp;
  if (sharedApp) {
    // The canvas element itself was replaced (full remount): drop the old app.
    sharedApp.destroy({ removeView: false }, { children: true });
    sharedApp = null;
  }
  const app = new Application();
  await app.init({
    canvas,
    width: canvas.clientWidth || 800,
    height: canvas.clientHeight || 600,
    backgroundColor: 0x070b14,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    autoStart: false,
    preference: "webgl",
  });
  sharedApp = app;
  return app;
}

const STARFIELD = [
  { parallax: 0.2, count: 34, sizeScale: 0.8 },
  { parallax: 0.5, count: 22, sizeScale: 1.2 },
  { parallax: 0.8, count: 12, sizeScale: 1.7 },
];

/**
 * PixiJS 8 scene renderer. Owns the whole scene graph; the game loop feeds it
 * a FrameInput once per rAF. Physics, camera math, and input live outside.
 */
export class PixiScene {
  private app!: Application;
  private level!: Level;
  private ready = false;
  private destroyed = false;
  private ownedTextures: Texture[] = [];

  // Scene graph.
  private shakeRoot = new Container();
  private starLayers: TilingSprite[] = [];
  private world = new Container();
  private boundary = new Graphics();
  private bodiesLayer = new Container();
  private bodyViews: BodyView[] = [];
  private winRings: Graphics[] = [];
  private winRingsRoot = new Container();
  private prediction = new Graphics();
  private flightPath = new Graphics();
  private glowLayer = new Container();
  private trail = new Graphics();
  private probeRoot = new Container();
  private probeShip = new Graphics();
  private probeHalo!: Sprite;
  private particles = new PixiParticles();
  private ui = new Container();
  private aimGfx = new Graphics();
  private aimLabel!: Text;
  private warnText!: Text;
  private flashTexts = new Map<number, Text>();
  private flashLayer = new Container();
  private indicatorTarget!: { root: Container; tri: Graphics; label: Text };
  private indicatorProbe!: { root: Container; tri: Graphics; label: Text };

  // Caches to avoid needless rebuilds.
  private zoomAtLastBuild = 0;
  private lastPrediction: TrajectoryResult | null = null;
  private lastAimLabel = "";
  private lastIndicatorLabel = "";
  private slowFrames = 0;
  private bloomDropped = false;
  private lastPathLen = 0;
  private lastPathBuild = 0;
  private pathDirty = false;

  get particleCount(): number {
    return this.particles.count;
  }

  async init(canvas: HTMLCanvasElement, level: Level, seed: number): Promise<void> {
    return enqueue(async () => {
      if (this.destroyed) return;
      this.level = level;
      this.app = await acquireApp(canvas);
      if (this.destroyed) return;
      this.buildScene(seed);
      this.ready = true;
    });
  }

  private buildScene(seed: number) {
    const stage = this.app.stage;
    stage.addChild(this.shakeRoot);

    for (let i = 0; i < STARFIELD.length; i++) {
      const cfg = STARFIELD[i];
      const tex = starTileTexture(seed + i, cfg.count, cfg.sizeScale);
      this.ownedTextures.push(tex);
      const sprite = new TilingSprite({ texture: tex, width: 100, height: 100 });
      this.starLayers.push(sprite);
      this.shakeRoot.addChild(sprite);
    }

    this.shakeRoot.addChild(this.world);
    this.world.addChild(this.boundary);
    this.world.addChild(this.flightPath);
    this.world.addChild(this.bodiesLayer);
    this.world.addChild(this.winRingsRoot);
    this.world.addChild(this.prediction);
    this.world.addChild(this.glowLayer);
    this.world.addChild(this.particles.container);

    for (const body of this.level.bodies) {
      this.bodyViews.push(this.buildBody(body));
    }

    // Win rings (hidden until a win).
    for (let i = 0; i < 3; i++) {
      const g = new Graphics();
      this.winRings.push(g);
      this.winRingsRoot.addChild(g);
    }
    this.winRingsRoot.visible = false;

    // Glow layer: trail + probe get the bloom.
    this.glowLayer.addChild(this.trail);
    this.probeHalo = new Sprite(radialGlowTexture("rgba(160,220,255,1)"));
    this.probeHalo.anchor.set(0.5);
    this.probeHalo.width = this.probeHalo.height = PROBE_RADIUS * 6;
    this.probeRoot.addChild(this.probeHalo);
    const s = PROBE_RADIUS;
    this.probeShip
      .poly([1.6 * s, 0, -s, 0.9 * s, -0.5 * s, 0, -s, -0.9 * s])
      .fill(0xe8f4ff);
    this.probeRoot.addChild(this.probeShip);
    this.glowLayer.addChild(this.probeRoot);
    // ?nobloom disables the filter (also auto-dropped if fps sags — see render).
    const noBloom =
      typeof location !== "undefined" && location.search.includes("nobloom");
    this.glowLayer.filters = noBloom
      ? []
      : [new BloomFilter({ strength: 2.5, quality: 2, kernelSize: 7 })];

    // Screen-space UI.
    stage.addChild(this.ui);
    this.ui.addChild(this.aimGfx);
    this.aimLabel = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        fontWeight: "600",
        fill: 0xffffff,
      },
      resolution: 2,
    });
    this.aimLabel.anchor.set(0.5, 1);
    this.ui.addChild(this.aimLabel);
    this.ui.addChild(this.flashLayer);
    this.indicatorTarget = this.buildIndicator(0x78ffb4);
    this.indicatorProbe = this.buildIndicator(0xc8e6ff);
    this.warnText = new Text({
      text: "⚠ leaving the map",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        fontWeight: "700",
        fill: 0xff786e,
      },
      resolution: 2,
    });
    this.warnText.anchor.set(0.5, 1);
    this.warnText.visible = false;
    this.ui.addChild(this.warnText);
  }

  private buildIndicator(color: number) {
    const root = new Container();
    const tri = new Graphics();
    tri.poly([12, 0, -4, -7, -4, 7]).fill(color);
    const label = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fontWeight: "600",
        fill: color,
      },
      resolution: 2,
    });
    label.anchor.set(0.5);
    root.addChild(tri);
    root.addChild(label);
    root.visible = false;
    this.ui.addChild(root);
    return { root, tri, label };
  }

  private buildBody(body: LevelBody): BodyView {
    const root = new Container();
    const r = body.radius;
    const base = cssHex(body.style.base);
    const accent = cssHex(body.style.accent);
    const seed = hashish(body.id + "d");

    if (body.style.kind === "star") {
      const glow = new Sprite(radialGlowTexture(body.style.accent + "66"));
      glow.anchor.set(0.5);
      glow.width = glow.height = r * 6;
      root.addChild(glow);
    }

    const disc = new Graphics().circle(0, 0, r).fill(base);
    root.addChild(disc);

    // Rotating detail, clipped to the disc.
    const detail = new Container();
    const mask = new Graphics().circle(0, 0, r).fill(0xffffff);
    root.addChild(mask);
    detail.mask = mask;
    const dg = new Graphics();
    if (body.style.kind === "gas" || body.style.kind === "star") {
      const alpha = body.style.kind === "star" ? 0.35 : 0.55;
      for (let i = 0; i < 3; i++) {
        const y = ((seed + i / 3) % 1) * 2 * r - r;
        const bh = r * (0.12 + 0.1 * ((seed * 7 + i) % 1));
        dg.ellipse(0, y, r * 1.1, bh).fill({ color: accent, alpha });
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const a = ((seed * 13 + i * 0.61) % 1) * Math.PI * 2;
        const d = ((seed * 29 + i * 0.37) % 1) * r * 0.75;
        const cr = r * (0.12 + 0.14 * ((seed * 5 + i * 0.83) % 1));
        dg.circle(Math.cos(a) * d, Math.sin(a) * d, cr).fill({ color: accent, alpha: 0.5 });
      }
    }
    if (body.style.kind !== "star") {
      // Terminator crescent: darken everything outside an offset bright circle.
      dg.rect(-2 * r, -2 * r, 4 * r, 4 * r)
        .circle(r * 0.35, r * 0.2, r * 1.05)
        .cut();
      dg.fill({ color: 0x000000, alpha: 0.18 });
    }
    detail.addChild(dg);
    root.addChild(detail);

    // Soft atmosphere rings (non-stars).
    if (body.style.kind !== "star") {
      const atmo = new Graphics();
      const w = Math.max(r * 0.09, 1);
      atmo.circle(0, 0, r * 1.12).stroke({ width: w, color: base, alpha: 0.22 });
      atmo.circle(0, 0, r * 1.28).stroke({ width: w, color: base, alpha: 0.09 });
      root.addChild(atmo);
    }

    let captureRing: Graphics | null = null;
    if (body.id === this.level.targetBodyId) {
      captureRing = new Graphics();
      root.addChild(captureRing);
    }

    this.bodiesLayer.addChild(root);
    return { body, root, detail, rotOffset: hashish(body.id) * Math.PI * 2, captureRing };
  }

  /** Rebuild the world-space dashed shapes whose stroke width tracks zoom. */
  private rebuildZoomDependent(zoom: number) {
    this.zoomAtLastBuild = zoom;
    this.pathDirty = true; // flight-path stroke width tracks zoom too
    const z = 1 / zoom;

    this.boundary.clear();
    dashedCircle(this.boundary, this.level.mapRadius, 12 * z, 14 * z, {
      width: 3 * z,
      color: 0xff6464,
    });

    for (const v of this.bodyViews) {
      if (!v.captureRing) continue;
      v.captureRing.clear();
      dashedCircle(v.captureRing, v.body.radius * 5, 6 * z, 8 * z, {
        width: 1.5 * z,
        color: 0x78ffb4,
        alpha: 0.35,
      });
    }

    const target = this.bodyViews.find((v) => v.body.id === this.level.targetBodyId)!;
    for (let i = 0; i < 3; i++) {
      const g = this.winRings[i];
      g.clear();
      dashedCircle(g, target.body.radius * (1.7 + i * 0.65), 10 * z, 14 * z, {
        width: 2 * z,
        color: 0x8cffc8,
      });
    }
  }

  resize(w: number, h: number) {
    if (!this.ready || this.destroyed) return;
    this.app.renderer.resize(w, h);
    for (const layer of this.starLayers) {
      layer.width = w;
      layer.height = h;
    }
  }

  burst(pos: { x: number; y: number }, dir: { x: number; y: number }, count: number, speed: number) {
    this.particles.burst(pos, dir, count, speed);
  }

  render(f: FrameInput) {
    if (!this.ready || this.destroyed) return;
    const { cam, engine, wallTime, aim } = f;
    const zoom = cam.zoom;

    // Graceful degradation: if the device can't hold ~50 fps for a sustained
    // stretch, drop the bloom filter for the rest of this attempt.
    if (!this.bloomDropped) {
      this.slowFrames = f.dt > 1 / 48 ? this.slowFrames + 1 : 0;
      if (this.slowFrames > 90) {
        this.bloomDropped = true;
        this.glowLayer.filters = [];
      }
    }

    // Screen shake moves the whole scene.
    if (f.shake > 0) {
      this.shakeRoot.position.set(
        (Math.random() - 0.5) * f.shake,
        (Math.random() - 0.5) * f.shake,
      );
    } else {
      this.shakeRoot.position.set(0, 0);
    }

    // Camera -> world transform.
    this.world.scale.set(zoom);
    this.world.position.set(
      cam.viewportW / 2 - cam.center.x * zoom,
      cam.viewportH / 2 - cam.center.y * zoom,
    );

    const ratio = zoom / (this.zoomAtLastBuild || 1e-9);
    if (this.zoomAtLastBuild === 0 || ratio > 1.2 || ratio < 0.83) {
      this.rebuildZoomDependent(zoom);
    }

    // Starfield parallax + slow breathing (stands in for per-star twinkle).
    for (let i = 0; i < this.starLayers.length; i++) {
      const layer = this.starLayers[i];
      const par = STARFIELD[i].parallax;
      layer.tilePosition.set(
        -cam.center.x * zoom * par,
        -cam.center.y * zoom * par,
      );
      layer.alpha = 0.85 + 0.15 * Math.sin(wallTime * 0.7 + i * 2.1);
    }

    // Map boundary brightens as the probe nears it.
    const probeR = len(engine.probe.pos);
    const proximity = Math.max(0, Math.min(1, (probeR / this.level.mapRadius - 0.7) / 0.3));
    this.boundary.alpha = 0.18 + 0.5 * proximity;

    // Bodies follow the sim; details rotate slowly.
    for (const v of this.bodyViews) {
      v.root.position.set(v.body.pos.x, v.body.pos.y);
      v.detail.rotation = engine.time * v.body.style.rotSpeed + v.rotOffset;
    }

    // Win rings spin up over 1.5 s after a win.
    if (f.winT > 0) {
      this.winRingsRoot.visible = true;
      const target = engine.targetBody;
      this.winRingsRoot.position.set(target.pos.x, target.pos.y);
      const w = Math.min(f.winT / 1.5, 1);
      const spin = f.winT * (0.6 + 4.5 * w);
      for (let i = 0; i < 3; i++) {
        this.winRings[i].rotation = (i % 2 === 0 ? 1 : -1) * spin;
        this.winRings[i].alpha = Math.max(0, 0.25 + 0.45 * w - i * 0.08);
      }
    } else {
      this.winRingsRoot.visible = false;
    }

    this.drawFlightPath(engine, zoom, wallTime);
    this.drawTrail(engine, zoom);
    this.drawPrediction(aim, zoom);
    this.drawProbe(engine, zoom, wallTime);
    this.particles.update(f.dt, zoom);
    this.drawAim(engine, cam, aim);
    this.drawFlashes(engine, cam);
    this.drawIndicators(engine, cam);
    this.drawBoundaryWarning(engine, cam, proximity, wallTime);

    this.app.render();
  }

  /**
   * The whole attempt's flown path: a dim single-color polyline that stays
   * on screen until retry (the glowing trail above it fades after ~13 s).
   * Rebuilt at most ~5x/s as points arrive, or when zoom buckets change.
   */
  private drawFlightPath(engine: GameEngine, zoom: number, wallTime: number) {
    const path = engine.path;
    const changed = path.length !== this.lastPathLen && wallTime - this.lastPathBuild > 0.2;
    if (!changed && !this.pathDirty) return;
    this.pathDirty = false;
    this.lastPathLen = path.length;
    this.lastPathBuild = wallTime;
    const g = this.flightPath;
    g.clear();
    if (path.length < 2) return;
    g.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
    g.stroke({ width: 1.2 / zoom, color: 0x7f9ac4, alpha: 0.3, join: "round" });
  }

  private drawTrail(engine: GameEngine, zoom: number) {
    const trail = engine.trail;
    const g = this.trail;
    g.clear();
    if (trail.length < 2) return;
    const width = 1.5 / zoom;
    const CHUNK = 8;
    // Chunked strokes: ~50 draw batches approximate the per-segment fade.
    for (let i = 1; i < trail.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, trail.length);
      const mid = trail[Math.min(i + (CHUNK >> 1), trail.length - 1)];
      g.moveTo(trail[i - 1].x, trail[i - 1].y);
      for (let j = i; j < end; j++) g.lineTo(trail[j].x, trail[j].y);
      g.stroke({
        width,
        color: trailColor(mid.speed),
        alpha: (0.65 * i) / trail.length,
        cap: "round",
      });
    }
  }

  private drawPrediction(aim: AimState | null, zoom: number) {
    const g = this.prediction;
    if (!aim) {
      if (this.lastPrediction) {
        g.clear();
        this.lastPrediction = null;
      }
      return;
    }
    if (aim.prediction === this.lastPrediction) return; // cached (also zoom-stable enough)
    this.lastPrediction = aim.prediction;
    g.clear();
    const pts = aim.prediction.points;
    if (pts.length < 2) return;
    const color = aim.prediction.collided ? 0xff786e : 0xffffff;
    const alpha = aim.prediction.collided ? 0.9 : 0.7;
    // Dashes: draw every other segment.
    for (let i = 0; i + 1 < pts.length; i += 2) {
      g.moveTo(pts[i].x, pts[i].y);
      g.lineTo(pts[i + 1].x, pts[i + 1].y);
    }
    g.stroke({ width: 1.5 / zoom, color, alpha });
    if (aim.prediction.collided) {
      const last = pts[pts.length - 1];
      const x = 6 / zoom;
      g.moveTo(last.x - x, last.y - x)
        .lineTo(last.x + x, last.y + x)
        .moveTo(last.x + x, last.y - x)
        .lineTo(last.x - x, last.y + x)
        .stroke({ width: 2 / zoom, color: 0xff786e });
    }
  }

  private drawProbe(engine: GameEngine, zoom: number, wallTime: number) {
    const p = engine.probe;
    this.probeRoot.position.set(p.pos.x, p.pos.y);
    const heading =
      len(p.vel) > 0.5 ? Math.atan2(p.vel.y, p.vel.x) : engine.level.startAngle;
    this.probeShip.rotation = heading;
    // Enforce a minimum on-screen size when zoomed far out.
    const screenSize = Math.max(PROBE_RADIUS * zoom, 5);
    this.probeRoot.scale.set(screenSize / (PROBE_RADIUS * zoom));
    this.probeHalo.alpha = 0.35 + 0.2 * Math.sin(wallTime * 4);
  }

  private drawAim(engine: GameEngine, cam: Camera, aim: AimState | null) {
    const g = this.aimGfx;
    g.clear();
    if (!aim) {
      this.aimLabel.visible = false;
      return;
    }
    const dvLen = len(aim.dv);
    if (dvLen < 0.5) {
      this.aimLabel.visible = false;
      return;
    }
    const from = cam.toScreen(engine.probe.pos);
    const dir = { x: aim.dv.x / dvLen, y: aim.dv.y / dvLen };
    const clamped = Math.min(dvLen, engine.deltaVRemaining);
    const px = clamped / DV_PER_PX;
    const tip = { x: from.x + dir.x * px, y: from.y + dir.y * px };
    const color = aim.isBurn ? 0xffc85a : 0x78ffb4;
    g.moveTo(from.x, from.y).lineTo(tip.x, tip.y).stroke({ width: 2.5, color, alpha: 0.95 });

    // Snap-step dots: the magnitude the drag/tip lands on is always a
    // multiple of DV_SNAP. Only magnitudes whose short-sim check says this
    // direction would bring the probe to a plausible capture distance are
    // shown — a stop that flies past the target or falls short isn't worth
    // landing on. The dot nearest the current drag length is lit brighter
    // with a ring around it; the probe's own halo covers anything closer
    // than ~14px, so skip drawing there to avoid a smudge.
    for (const { mag, viable } of aim.snapDots) {
      if (!viable) continue;
      const dotPx = mag / DV_PER_PX;
      if (dotPx < 14) continue;
      const dx = from.x + dir.x * dotPx;
      const dy = from.y + dir.y * dotPx;
      const isCurrent = Math.abs(mag - clamped) < DV_SNAP / 2;
      g.circle(dx, dy, isCurrent ? 4 : 2.4).fill({
        color: 0x78ffb4,
        alpha: isCurrent ? 1 : 0.7,
      });
      if (isCurrent) {
        g.circle(dx, dy, 8).stroke({ width: 1.4, color: 0x78ffb4, alpha: 0.7 });
      }
    }
    const a = Math.atan2(dir.y, dir.x);
    g.moveTo(tip.x, tip.y)
      .lineTo(tip.x - Math.cos(a - 0.4) * 10, tip.y - Math.sin(a - 0.4) * 10)
      .moveTo(tip.x, tip.y)
      .lineTo(tip.x - Math.cos(a + 0.4) * 10, tip.y - Math.sin(a + 0.4) * 10)
      .stroke({ width: 2.5, color, alpha: 0.95 });
    g.circle(tip.x, tip.y, 9).fill({ color, alpha: 0.35 });

    const label = `${(clamped * KMS).toFixed(1)} km/s`;
    if (label !== this.lastAimLabel) {
      this.lastAimLabel = label;
      this.aimLabel.text = label;
    }
    this.aimLabel.visible = true;
    this.aimLabel.position.set(tip.x, tip.y - 12);
  }

  private drawFlashes(engine: GameEngine, cam: Camera) {
    const seen = new Set<number>();
    for (const e of engine.events) {
      seen.add(e.id);
      let t = this.flashTexts.get(e.id);
      if (!t) {
        t = this.makeFlashText(e);
        this.flashTexts.set(e.id, t);
        this.flashLayer.addChild(t);
      }
      const age = engine.time - e.t;
      const s = cam.toScreen(e.pos);
      t.position.set(s.x, s.y - 14 - age * 18);
      t.alpha = Math.max(0, 1 - age / 2);
    }
    for (const [id, t] of this.flashTexts) {
      if (!seen.has(id)) {
        t.destroy();
        this.flashTexts.delete(id);
      }
    }
  }

  private makeFlashText(e: FlashEvent): Text {
    const t = new Text({
      text: e.text,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 15,
        fontWeight: "700",
        fill: e.gain ? 0x78ffa0 : 0xff9682,
      },
      resolution: 2,
    });
    t.anchor.set(0.5, 1);
    return t;
  }

  private drawIndicators(engine: GameEngine, cam: Camera) {
    const active = engine.phase === "aiming" || engine.phase === "flying";
    if (!active) {
      this.indicatorTarget.root.visible = false;
      this.indicatorProbe.root.visible = false;
      return;
    }
    const t = engine.targetBody;
    const d = Math.hypot(t.pos.x - engine.probe.pos.x, t.pos.y - engine.probe.pos.y);
    const label = `${t.name} ${(d / 100).toFixed(1)}`;
    if (label !== this.lastIndicatorLabel) {
      this.lastIndicatorLabel = label;
      this.indicatorTarget.label.text = label;
    }
    this.placeIndicator(this.indicatorTarget, cam, t.pos);
    this.placeIndicator(this.indicatorProbe, cam, engine.probe.pos);
    if (this.indicatorProbe.label.text !== "probe") this.indicatorProbe.label.text = "probe";
  }

  private placeIndicator(
    ind: { root: Container; tri: Graphics; label: Text },
    cam: Camera,
    pos: { x: number; y: number },
  ) {
    const s = cam.toScreen(pos);
    const m = 40;
    const W = cam.viewportW;
    const H = cam.viewportH;
    if (s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H) {
      ind.root.visible = false;
      return;
    }
    const cx = W / 2;
    const cy = H / 2;
    const dx = s.x - cx;
    const dy = s.y - cy;
    const k = Math.min(
      (W / 2 - m) / Math.max(Math.abs(dx), 1e-6),
      (H / 2 - m) / Math.max(Math.abs(dy), 1e-6),
    );
    const a = Math.atan2(dy, dx);
    ind.root.visible = true;
    ind.root.position.set(cx + dx * k, cy + dy * k);
    ind.tri.rotation = a;
    ind.label.position.set(-Math.cos(a) * 22, -Math.sin(a) * 22 + 4);
  }

  private drawBoundaryWarning(
    engine: GameEngine,
    cam: Camera,
    proximity: number,
    wallTime: number,
  ) {
    if (engine.phase !== "flying" || proximity <= 0) {
      this.warnText.visible = false;
      return;
    }
    const ps = cam.toScreen(engine.probe.pos);
    this.warnText.visible = true;
    this.warnText.position.set(ps.x, ps.y - 26);
    this.warnText.alpha = proximity * (0.6 + 0.4 * Math.sin(wallTime * 6));
  }

  destroy() {
    this.destroyed = true;
    void enqueue(() => {
      if (!this.ready) return;
      this.ready = false;
      // Tear down this scene's graph but keep the shared app/context alive —
      // the next scene reuses it (recreating WebGL on a canvas hangs the tab).
      this.app.stage.removeChild(this.shakeRoot, this.ui);
      this.shakeRoot.destroy({ children: true });
      this.ui.destroy({ children: true });
      for (const tex of this.ownedTextures) tex.destroy(true);
      this.ownedTextures = [];
    });
  }
}
