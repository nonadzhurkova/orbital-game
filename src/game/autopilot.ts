import type { World } from "@/physics/types";
import {
  DT,
  step,
  cloneWorld,
  findCollision,
  circularOrbitSpeed,
  escapeSpeed,
  accelAt,
  orbitalElements,
} from "@/physics/engine";
import {
  Vec2,
  add,
  sub,
  scale,
  norm,
  len,
  dist,
  dot,
  fromAngle,
  clone,
} from "@/physics/vec";
import { PROBE_RADIUS, KMS } from "./levels";
import type { GameEngine } from "./engine";
import type { SpeedMult } from "./store";

export interface AutopilotHooks {
  pause: (p: boolean) => void;
  setSpeed: (s: SpeedMult) => void;
  onLaunch: (dv: Vec2) => void;
  onBurn: (dv: Vec2) => void;
  /** Append a line to the flight log. */
  log: (text: string) => void;
}

interface Candidate {
  wait: number;
  speed: number;
  /**
   * Launch direction parameter. Static levels: lateral aim offset past the
   * target, in target radii. Moving levels: bearing in radians from the
   * start body's prograde direction (transfers burn near-prograde; aiming
   * "at" a moving target from an orbiting body misses wildly).
   */
  aim: number;
}

type Mode = "planning" | "waiting" | "cruise" | "orbiting" | "failed";

/** Max ms of planning work per frame — keeps the UI responsive. */
const PLAN_BUDGET_MS = 10;

/**
 * Demo autopilot. Plans a launch the same way the level-1 solvability test
 * does — scan waits (for phasing on moving levels), speeds, and lateral aim
 * offsets by simulating each candidate — then launches the cheapest feasible
 * one, coasts, and circularizes at closest approach with the mid-course burn.
 * Runs against the live GameEngine through its public API only.
 */
export class Autopilot {
  status = "planning…";
  done = false;
  private mode: Mode;
  private queue: Candidate[] = [];
  private idx = 0;
  private stage = 1;
  /** Coarse-scan candidates that got close but not captured — refined in stage 2. */
  private nearMisses: { cand: Candidate; closest: number }[] = [];
  private best: { cand: Candidate; total: number; tCp: number; closest: number } | null =
    null;
  private launchAt = 0;
  /** Sim time when the capture burn should fire (from the chosen plan). */
  private burnAt = 0;
  /** Estimated sim seconds for the final winning orbit sweep. */
  private orbitTime = 0;
  private chosen: Candidate | null = null;
  private prevD = Infinity;
  private burned = false;
  /** Bodies-only world at plan time zero; wait states derive from it. */
  private origin: World;
  private waitSnapshots = new Map<number, World>();

  private movingLevel: boolean;
  private coarseCount = 0;

  constructor(
    private engine: GameEngine,
    private hooks: AutopilotHooks,
  ) {
    this.movingLevel = engine.level.bodies.some((b) => b.dynamic);
    this.origin = cloneWorld(engine.world);
    this.origin.probe = null;
    if (engine.phase === "flying") {
      // Enabled mid-flight: just take over the capture burn.
      this.mode = "cruise";
      this.status = "coasting";
    } else {
      this.mode = "planning";
      this.queue = this.buildCandidates();
      this.coarseCount = this.queue.length;
      this.hooks.log(`Autopilot engaged — simulating ${this.queue.length} launch routes`);
      this.hooks.pause(true); // freeze the world so plans stay valid
    }
  }

  private buildCandidates(): Candidate[] {
    const level = this.engine.level;
    const startBody = this.engine.startBody;
    const G = level.G;
    const vEsc = escapeSpeed(G, startBody.mass, startBody.radius + PROBE_RADIUS + 2);
    // Launch speed must clear the start body. Two regimes need resolving:
    // a fine band just above escape (a circumbinary transfer costs only ~6
    // units more than escape — level 5) and a coarse sweep up toward the
    // budget for direct shots (levels 1-2). Scan both.
    const vFloor = vEsc * 1.01;
    const vMax = Math.min(level.budget * 0.85, vEsc * 2.2);
    const set = new Set<number>();
    // Coarse sweep across the whole usable range (direct shots, levels 1-2).
    const nCoarse = 10;
    for (let i = 0; i < nCoarse; i++)
      set.add(+(vFloor + ((vMax - vFloor) * i) / (nCoarse - 1)).toFixed(3));
    // Fine band just above escape, where transfers around a primary live
    // (level 5's circumbinary transfer is only ~6 units above escape).
    const margin = this.transferMargin();
    if (margin < (vMax - vFloor) * 0.6) {
      const nFine = 8;
      for (let i = 0; i < nFine; i++)
        set.add(+(vFloor + (margin * i) / (nFine - 1)).toFixed(3));
    }
    const speeds = [...set].sort((a, b) => a - b);
    // Waits must cover a meaningful fraction of the start body's orbital
    // period so every phase angle to the target is reachable.
    const waits = this.movingLevel ? this.waitGrid() : [0];
    // Static levels: lateral aim offsets in target radii (wide: a heavy body
    // in between — level 2 — bends shots far off the naive line). Moving
    // levels: bearings from prograde; the wait grid handles phasing.
    const aims = this.movingLevel
      ? [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((d) => (d * Math.PI) / 180)
      : [-8, -6, -4.5, -3, -2, -1.2, 0, 1.2, 2, 3, 4.5, 6, 8];
    const out: Candidate[] = [];
    for (const wait of waits)
      for (const speed of speeds)
        for (const aim of aims) out.push({ wait, speed, aim });
    return out;
  }

  /**
   * The body the start body orbits (heaviest other body), with the effective
   * central mass — for a binary, the pair acts as one mass at the barycenter.
   */
  private primary(): { mass: number; center: Vec2 } | null {
    const level = this.engine.level;
    const start = this.engine.startBody;
    const others = level.bodies.filter((b) => b.id !== start.id && b.mass > start.mass * 3);
    if (others.length === 0) return null;
    let mass = 0;
    let cx = 0;
    let cy = 0;
    for (const b of others) {
      mass += b.mass;
      cx += b.pos.x * b.mass;
      cy += b.pos.y * b.mass;
    }
    return { mass, center: { x: cx / mass, y: cy / mass } };
  }

  /**
   * Extra speed (beyond escaping the start body) worth scanning: the Hohmann
   * transfer cost from the start orbit to the target orbit, with headroom.
   */
  private transferMargin(): number {
    const level = this.engine.level;
    const p = this.primary();
    const startBody = this.engine.startBody;
    const vEsc = escapeSpeed(
      level.G,
      startBody.mass,
      startBody.radius + PROBE_RADIUS + 2,
    );
    if (!p) return vEsc * 1.2; // no primary: free flight, scan broadly
    const mu = level.G * p.mass;
    const r1 = dist(startBody.pos, p.center);
    const r2 = dist(this.engine.targetBody.pos, p.center);
    const a = (r1 + r2) / 2;
    const vC = Math.sqrt(mu / r1);
    const vT = Math.sqrt(mu * (2 / r1 - 1 / a));
    return Math.max(4, Math.abs(vT - vC) * 3.5);
  }

  /**
   * Wait offsets spanning the start body's orbital period (every phase angle
   * to the target is reachable), with extra resolution in the first stretch
   * where short-period levels find their windows.
   */
  private waitGrid(): number[] {
    const level = this.engine.level;
    const p = this.primary();
    const startBody = this.engine.startBody;
    let period = 48;
    if (p) {
      const r1 = dist(startBody.pos, p.center);
      period = 2 * Math.PI * Math.sqrt(r1 ** 3 / (level.G * p.mass));
    }
    const set = new Set<number>();
    for (let i = 0; i < 16; i++) set.add(Math.round((period * i) / 16));
    for (const w of [0, 4, 8, 12, 16, 20, 24, 28, 32, 40]) {
      if (w < period) set.add(w);
    }
    return [...set].sort((a, b) => a - b);
  }

  /**
   * World with bodies advanced `wait` seconds past the plan's start state.
   * Derives from the nearest earlier snapshot; substeps must match the live
   * engine exactly (phasing errors compound over long waits).
   */
  private worldAtWait(wait: number): World {
    const hit = this.waitSnapshots.get(wait);
    if (hit) return hit;
    let baseW = 0;
    let baseWorld = this.origin;
    for (const [w, s] of this.waitSnapshots) {
      if (w <= wait && w > baseW) {
        baseW = w;
        baseWorld = s;
      }
    }
    const world = cloneWorld(baseWorld);
    let t = baseW;
    while (t < wait - DT / 2) {
      step(world, DT, 4);
      t += DT;
    }
    this.waitSnapshots.set(wait, world);
    return world;
  }

  /** The launch dv for a candidate, given the world state at its wait. */
  private candidateDv(c: Candidate, world: World): { attach: Vec2; dv: Vec2 } {
    const level = this.engine.level;
    const start = world.bodies.find((b) => b.id === level.startBodyId)!;
    const target = world.bodies.find((b) => b.id === level.targetBodyId)!;
    const attach = add(
      start.pos,
      fromAngle(level.startAngle, start.radius + PROBE_RADIUS + 2),
    );
    if (this.movingLevel && len(start.vel) > 1) {
      // Bearing from the start body's prograde direction.
      const pro = norm(start.vel);
      const cos = Math.cos(c.aim);
      const sin = Math.sin(c.aim);
      const dir = { x: pro.x * cos - pro.y * sin, y: pro.x * sin + pro.y * cos };
      return { attach, dv: scale(dir, c.speed) };
    }
    // Lateral offset past the target, in target radii.
    const dir0 = norm(sub(target.pos, attach));
    const aimPoint = add(target.pos, {
      x: -dir0.y * c.aim * target.radius,
      y: dir0.x * c.aim * target.radius,
    });
    return { attach, dv: scale(norm(sub(aimPoint, attach)), c.speed) };
  }

  /**
   * Simulate one candidate. `total` is null when the pass isn't capturable
   * (but `closest` still reports how near it got, for refinement); the whole
   * result is null when the probe crashed or never approached.
   */
  private evaluate(c: Candidate): { total: number | null; tCp: number; closest: number } | null {
    const level = this.engine.level;
    const world = cloneWorld(this.worldAtWait(c.wait));
    const start = world.bodies.find((b) => b.id === level.startBodyId)!;
    const target = world.bodies.find((b) => b.id === level.targetBodyId)!;
    const { attach, dv } = this.candidateDv(c, world);
    world.probe = {
      id: "probe",
      pos: clone(attach),
      vel: add(start.vel, dv),
      mass: 0,
      radius: PROBE_RADIUS,
    };
    const R = target.radius;
    // Enough time for a slow transfer to arrive: a circumbinary Hohmann leg
    // runs >100 s, far longer than a straight-line estimate suggests.
    const travel = dist(attach, target.pos);
    const capSeconds = Math.min(320, 25 + (travel / Math.max(c.speed, 1)) * 2.5);
    let closest = Infinity;
    let cp: {
      rel: Vec2;
      relV: Vec2;
      probeVel: Vec2;
      tVel: Vec2;
      t: number;
      disturb: number;
      /** Full world state AT closest approach, so a burn can be applied here
       *  and the result simulated forward to verify the resulting orbit. */
      worldAtCp: World;
    } | null = null;
    const steps = Math.ceil(capSeconds / DT);
    for (let i = 0; i < steps; i++) {
      // Full substeps: the plan must match the live sim exactly — at 2
      // substeps a strong flyby (level 2's giant) bends measurably less.
      step(world, DT, 4);
      if (findCollision(world)) return null;
      const p = world.probe!;
      if (len(p.pos) > level.mapRadius) break;
      const d = dist(p.pos, target.pos);
      if (d < closest) {
        closest = d;
        // Disturbance is differential: a dynamic target free-falls with the
        // other bodies' pull, so only the tidal part perturbs the orbit. A
        // pinned target doesn't fall, so the full field applies.
        const aProbe = accelAt(world, p.pos, target.id);
        const aTgt = target.dynamic
          ? accelAt(world, target.pos, target.id)
          : { x: 0, y: 0 };
        cp = {
          rel: sub(p.pos, target.pos),
          relV: sub(p.vel, target.vel),
          probeVel: clone(p.vel),
          tVel: clone(target.vel),
          t: (i + 1) * DT,
          disturb: Math.hypot(aProbe.x - aTgt.x, aProbe.y - aTgt.y),
          worldAtCp: cloneWorld(world),
        };
      } else if (closest < R * 4 && d > closest * 3) {
        break; // encounter is over
      }
    }
    if (!cp) return null;
    const partial = { total: null, tCp: cp.t, closest };
    // Accept only comfortable capture altitudes: below ~1.8 R third-body
    // perturbation can push the circularized orbit into the surface.
    if (closest < R * 1.8 || closest > R * 4.5) return partial;
    // Stability: the target's own gravity must dominate the differential pull
    // at the capture radius, or the orbit drifts out of its Hill sphere.
    const aTarget = (level.G * target.mass) / (closest * closest);
    if (aTarget < 6 * cp.disturb) return partial;
    // Circularization estimate at closest approach.
    const vCirc = circularOrbitSpeed(level.G, target.mass, closest);
    const tangent = { x: -cp.rel.y / closest, y: cp.rel.x / closest };
    const sense = dot(tangent, cp.relV) >= 0 ? 1 : -1;
    const desired = add(cp.tVel, scale(tangent, vCirc * sense));
    const burn = len(sub(desired, cp.probeVel));
    const total = c.speed + burn;
    if (total > level.budget * 0.98) return partial;
    // Verify the circularized orbit actually survives: apply the burn to the
    // world exactly as it was at closest approach, then simulate one full
    // estimated period forward and require it to still qualify. This catches
    // degenerate "cheap" candidates (e.g. a barely-escaping crawl that
    // transiently passes near the target) that the instantaneous capture
    // geometry alone would otherwise accept.
    const verifyWorld = cp.worldAtCp;
    verifyWorld.probe!.vel = clone(desired);
    const orbitPeriod =
      2 * Math.PI * Math.sqrt(closest ** 3 / (level.G * target.mass));
    const verifySteps = Math.min(
      Math.ceil((orbitPeriod * 1.05) / DT),
      Math.ceil(200 / DT),
    );
    // 2 substeps here: this is a pass/fail stability check, not a plan the
    // live flight must reproduce exactly.
    for (let i = 0; i < verifySteps; i++) {
      step(verifyWorld, DT, 2);
      if (findCollision(verifyWorld)) return partial;
      if (len(verifyWorld.probe!.pos) > level.mapRadius) return partial;
    }
    const finalTarget = verifyWorld.bodies.find((b) => b.id === level.targetBodyId)!;
    const el = orbitalElements(verifyWorld.probe!, finalTarget, level.G);
    if (!el.bound || el.periapsis < R + PROBE_RADIUS || el.apoapsis > R * 5) {
      return partial;
    }
    return { total, tCp: cp.t, closest };
  }

  /** Local search around the most promising coarse near-misses. */
  private buildRefinement(): Candidate[] {
    const seeds = this.nearMisses
      .sort((a, b) => a.closest - b.closest)
      .slice(0, 6);
    const out: Candidate[] = [];
    const seen = new Set<string>();
    // Aim jitter: radians for moving levels, target radii for static ones.
    const dAims = this.movingLevel
      ? [-0.14, -0.07, 0, 0.07, 0.14]
      : [-0.8, -0.4, 0, 0.4, 0.8];
    for (const { cand } of seeds) {
      for (const dw of cand.wait > 0 ? [-2, -1, 0, 1, 2] : [0]) {
        for (const fs of [0.9, 0.95, 1, 1.05, 1.1]) {
          for (const dAim of dAims) {
            const c: Candidate = {
              wait: Math.max(0, cand.wait + dw),
              speed: cand.speed * fs,
              aim: cand.aim + dAim,
            };
            const key = `${c.wait}|${c.speed.toFixed(2)}|${c.aim.toFixed(3)}`;
            if (!seen.has(key)) {
              seen.add(key);
              out.push(c);
            }
          }
        }
      }
    }
    return out;
  }

  /** Called once per rendered frame by the game loop. */
  update() {
    const engine = this.engine;
    if (engine.phase === "won" || engine.phase === "lost") {
      this.done = true;
      return;
    }
    if (this.mode === "planning" && engine.phase === "flying") {
      // The player launched by hand mid-planning; assist the capture instead.
      this.hooks.pause(false);
      this.mode = "cruise";
      this.status = "coasting";
      return;
    }

    switch (this.mode) {
      case "planning": {
        const t0 = performance.now();
        while (this.idx < this.queue.length && performance.now() - t0 < PLAN_BUDGET_MS) {
          const c = this.queue[this.idx++];
          const res = this.evaluate(c);
          if (res === null) continue;
          if (res.total !== null && (!this.best || res.total < this.best.total)) {
            this.best = { cand: c, total: res.total, tCp: res.tCp, closest: res.closest };
          }
          if (this.stage === 1 && res.total === null && res.closest < 15 * this.engine.targetBody.radius) {
            this.nearMisses.push({ cand: c, closest: res.closest });
          }
        }
        if (this.idx < this.queue.length) {
          const pct = Math.round((100 * this.idx) / this.queue.length);
          this.status = this.stage === 1 ? `planning ${pct}%` : `refining ${pct}%`;
          return;
        }
        if (!this.best && this.stage === 1 && this.nearMisses.length > 0) {
          this.queue = this.buildRefinement();
          this.idx = 0;
          this.stage = 2;
          this.hooks.log(
            `Coarse scan: no capture in ${this.coarseCount} routes — refining ${this.queue.length} nearby variants`,
          );
          return;
        }
        if (!this.best) {
          this.status = "no route found";
          this.hooks.log("No route found within the Δv budget — autopilot standing down");
          this.mode = "failed";
          this.hooks.pause(false);
          this.done = true;
          return;
        }
        this.chosen = this.best.cand;
        this.launchAt = engine.time + this.chosen.wait;
        this.burnAt = this.launchAt + this.best.tCp;
        // Winning still takes one full orbit after capture.
        this.orbitTime =
          2 *
          Math.PI *
          Math.sqrt(this.best.closest ** 3 / (engine.level.G * engine.targetBody.mass));
        const aimTxt = this.movingLevel
          ? `${Math.round((this.chosen.aim * 180) / Math.PI)}° off prograde`
          : `${this.chosen.aim.toFixed(1)}R aim offset`;
        this.hooks.log(
          `Plan: ${this.chosen.wait > 0 ? `wait ${this.chosen.wait}s, ` : ""}launch ${(
            this.chosen.speed * KMS
          ).toFixed(1)} km/s ${aimTxt}; capture ≈ ${((this.best.total - this.chosen.speed) * KMS).toFixed(1)} km/s at r=${Math.round(
            this.best.closest,
          )}; total ${(this.best.total * KMS).toFixed(1)} km/s, solved in ~${Math.ceil(
            this.chosen.wait + this.best.tCp + this.orbitTime,
          )}s sim`,
        );
        this.mode = "waiting";
        this.hooks.pause(false);
        if (this.chosen.wait > 2) this.hooks.setSpeed(10);
        return;
      }
      case "waiting": {
        if (engine.phase !== "aiming") return;
        const eta = Math.ceil(this.burnAt - engine.time + this.orbitTime);
        const tMinus = Math.ceil(this.launchAt - engine.time);
        this.status =
          tMinus > 0 ? `launch in ${tMinus}s · solved in ~${eta}s` : "launching";
        if (engine.time + DT / 2 < this.launchAt) return;
        // Recompute the dv from the live state (deterministic sim: identical
        // to the planned one) and go.
        const { dv } = this.candidateDv(this.chosen!, engine.world);
        this.hooks.setSpeed(1);
        if (engine.launch(dv)) {
          this.hooks.onLaunch(dv);
          this.mode = "cruise";
          this.status = "coasting";
        } else {
          this.status = "launch refused";
          this.mode = "failed";
          this.done = true;
        }
        return;
      }
      case "cruise": {
        if (engine.phase !== "flying") return;
        const target = engine.targetBody;
        const d = dist(engine.probe.pos, target.pos);
        const R = target.radius;
        if (this.chosen) {
          // Planned flight: the burn is scheduled at the planned closest
          // approach (the live sim reproduces the plan deterministically).
          this.hooks.setSpeed(engine.time < this.burnAt - 4 ? 10 : 1);
          const toBurn = Math.ceil(this.burnAt - engine.time);
          if (toBurn > 0)
            this.status = `coasting · burn in ${toBurn}s · solved in ~${Math.ceil(
              this.burnAt - engine.time + this.orbitTime,
            )}s`;
          if (!this.burned && engine.time + DT / 2 >= this.burnAt) {
            if (d > R * 6) {
              // Reality diverged from the plan — bail rather than burn blind.
              this.status = "missed the window";
              this.hooks.log("Capture window missed — flight diverged from the plan");
              this.mode = "failed";
              return;
            }
            this.circularize(d);
          }
          return;
        }
        // Manual launch, autopilot only assists the capture: burn at the
        // first local minimum of target distance inside the capture range.
        if (d > R * 8) this.hooks.setSpeed(10);
        else this.hooks.setSpeed(1);
        if (!this.burned && engine.burnsLeft > 0 && d < R * 4.5 && d > this.prevD) {
          this.circularize(d);
        }
        this.prevD = d;
        return;
      }
      case "orbiting":
      case "failed":
        return;
    }
  }

  /** Match the target's velocity plus circular speed at distance `d`. */
  private circularize(d: number) {
    const engine = this.engine;
    const target = engine.targetBody;
    if (engine.burnsLeft <= 0) return;
    const rel = sub(engine.probe.pos, target.pos);
    const relV = sub(engine.probe.vel, target.vel);
    const vCirc = circularOrbitSpeed(engine.level.G, target.mass, d);
    const tangent = { x: -rel.y / d, y: rel.x / d };
    const sense = dot(tangent, relV) >= 0 ? 1 : -1;
    const desired = add(target.vel, scale(tangent, vCirc * sense));
    const dv = sub(desired, engine.probe.vel);
    if (engine.burn(dv)) {
      this.hooks.onBurn(dv);
      this.hooks.log(
        `Circularization burn: ${(len(dv) * KMS).toFixed(1)} km/s at r=${Math.round(d)} — matching ${engine.targetBody.name}'s orbit`,
      );
      this.burned = true;
      this.mode = "orbiting";
      this.status =
        this.orbitTime > 0
          ? `orbiting · one lap ≈ ${Math.ceil(this.orbitTime)}s to win`
          : "orbiting";
    }
  }

  /** User toggled autopilot off (or level ended) — release any pause. */
  dispose() {
    if (this.mode === "planning") this.hooks.pause(false);
  }

  /** True while the autopilot still intends to act. */
  get active(): boolean {
    return !this.done;
  }

  /** Needed by tests: the picked plan. */
  get plan(): { wait: number; speed: number; aim: number; total: number } | null {
    return this.best ? { ...this.best.cand, total: this.best.total } : null;
  }
}
