import type { Body, World } from "@/physics/types";
import {
  DT,
  step,
  findCollision,
  orbitalElements,
  predictTrajectory,
  cloneWorld,
} from "@/physics/engine";
import { Vec2, vec, add, sub, len, dist, fromAngle, clone } from "@/physics/vec";
import { Level, LevelBody, PROBE_RADIUS, KMS } from "./levels";
import type { TrajectoryResult } from "@/physics/types";

export type Phase = "aiming" | "flying" | "won" | "lost";

export interface FlashEvent {
  id: number;
  pos: Vec2;
  text: string;
  /** Positive = gained speed. */
  gain: boolean;
  /** Sim time when created. */
  t: number;
}

interface FlybyZone {
  inside: boolean;
  entrySpeed: number;
  /** Entry didn't happen by flight (launch/burn inside the zone) — no flash. */
  suppressed: boolean;
}

const WIN_APOAPSIS_RADII = 5;
const TRAIL_EVERY_STEPS = 4;
const TRAIL_MAX = 400;
const PATH_MAX = 3000;

export interface TrailPoint {
  x: number;
  y: number;
  speed: number;
}

let nextEventId = 1;

/**
 * Owns the live world and all game rules for one level attempt.
 * Pure TS — no React, no canvas. The render loop calls step() at a fixed
 * 1/120 s and reads state; the UI calls launch/burn/etc.
 */
export class GameEngine {
  readonly level: Level;
  world: World;
  phase: Phase = "aiming";
  time = 0;
  deltaVUsed = 0;
  burnsLeft = 1;
  lostReason: string | null = null;
  /** Accumulated sweep angle around the target while the orbit qualifies. */
  private winAngle = 0;
  private prevRelAngle: number | null = null;
  /** 0..1 progress toward the required full orbit. */
  winProgress = 0;
  trail: TrailPoint[] = [];
  /**
   * The full flown path for this attempt (kept until retry, unlike the
   * fading trail). Bounded: when it exceeds PATH_MAX points it is thinned
   * to every other point and the sampling interval doubles.
   */
  path: Vec2[] = [];
  private pathEvery = 8;
  events: FlashEvent[] = [];
  private flyby = new Map<string, FlybyZone>();
  private stepCount = 0;

  constructor(level: Level) {
    this.level = level;
    this.world = {
      G: level.G,
      bodies: level.bodies,
      probe: {
        id: "probe",
        pos: vec(0, 0),
        vel: vec(0, 0),
        mass: 0,
        radius: PROBE_RADIUS,
      },
    };
    for (const b of level.bodies) {
      this.flyby.set(b.id, { inside: false, entrySpeed: 0, suppressed: false });
    }
    this.attachProbe();
  }

  get startBody(): LevelBody {
    return this.level.bodies.find((b) => b.id === this.level.startBodyId)!;
  }
  get targetBody(): LevelBody {
    return this.level.bodies.find((b) => b.id === this.level.targetBodyId)!;
  }
  get probe(): Body {
    return this.world.probe!;
  }
  get deltaVRemaining(): number {
    return Math.max(0, this.level.budget - this.deltaVUsed);
  }

  /** 1-3 stars based on delta-v used vs par. */
  stars(): number {
    if (this.deltaVUsed <= this.level.par) return 3;
    if (this.deltaVUsed <= this.level.par * 1.4) return 2;
    return 1;
  }

  private attachProbe() {
    const b = this.startBody;
    const p = this.probe;
    p.pos = add(b.pos, fromAngle(this.level.startAngle, b.radius + PROBE_RADIUS + 2));
    p.vel = clone(b.vel);
  }

  /** Advance one fixed 1/120 s tick. */
  step() {
    if (this.phase === "won" || this.phase === "lost") return;
    if (this.phase === "aiming") {
      // The whole universe is frozen while aiming: planets don't move and
      // engine.time doesn't advance, so the player can take as long as they
      // like without the geometry (or any coast-checkpoint scan) going
      // stale mid-thought. Time resumes the instant they launch.
      return;
    }
    // flying
    step(this.world, DT);
    this.time += DT;
    this.stepCount++;
    if (this.stepCount % TRAIL_EVERY_STEPS === 0) {
      this.trail.push({
        x: this.probe.pos.x,
        y: this.probe.pos.y,
        speed: len(this.probe.vel),
      });
      if (this.trail.length > TRAIL_MAX) this.trail.shift();
    }
    if (this.stepCount % this.pathEvery === 0) {
      this.path.push({ x: this.probe.pos.x, y: this.probe.pos.y });
      if (this.path.length > PATH_MAX) {
        this.path = this.path.filter((_, i) => i % 2 === 0);
        this.pathEvery *= 2;
      }
    }
    const hit = findCollision(this.world);
    if (hit) {
      this.phase = "lost";
      this.lostReason = `Crashed into ${(hit as LevelBody).name ?? hit.id}`;
      return;
    }
    if (len(this.probe.pos) > this.level.mapRadius) {
      this.phase = "lost";
      this.lostReason = "Lost to deep space";
      return;
    }
    this.checkWin();
    this.checkFlybys();
    this.pruneEvents();
  }

  /**
   * Win when the probe sweeps one full revolution around the target while
   * its instantaneous orbit stays bound with periapsis above the surface and
   * apoapsis under 5 target radii.
   */
  private checkWin() {
    const t = this.targetBody;
    const rel = sub(this.probe.pos, t.pos);
    const angle = Math.atan2(rel.y, rel.x);
    const el = orbitalElements(this.probe, t, this.world.G);
    const qualifies =
      el.bound &&
      el.periapsis > t.radius + PROBE_RADIUS &&
      el.apoapsis < t.radius * WIN_APOAPSIS_RADII;
    if (!qualifies) {
      this.winAngle = 0;
      this.prevRelAngle = null;
      this.winProgress = 0;
      return;
    }
    if (this.prevRelAngle !== null) {
      let d = angle - this.prevRelAngle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.winAngle += d;
    }
    this.prevRelAngle = angle;
    this.winProgress = Math.min(1, Math.abs(this.winAngle) / (2 * Math.PI));
    if (Math.abs(this.winAngle) >= 2 * Math.PI) {
      this.phase = "won";
    }
  }

  /** Flash a label when a flyby changes speed by more than 20%. */
  private checkFlybys() {
    for (const b of this.level.bodies) {
      const zone = this.flyby.get(b.id)!;
      const influence = b.radius * 8;
      const d = len(sub(this.probe.pos, b.pos));
      const speed = len(this.probe.vel);
      if (!zone.inside && d < influence) {
        zone.inside = true;
        zone.entrySpeed = speed;
        zone.suppressed = false;
      } else if (zone.inside && d >= influence) {
        zone.inside = false;
        if (!zone.suppressed && zone.entrySpeed > 1) {
          const dv = speed - zone.entrySpeed;
          if (Math.abs(dv) / zone.entrySpeed > 0.2) {
            this.events.push({
              id: nextEventId++,
              pos: clone(this.probe.pos),
              text: `${dv > 0 ? "+" : "−"}${(Math.abs(dv) * KMS).toFixed(1)} km/s`,
              gain: dv > 0,
              t: this.time,
            });
          }
        }
      }
    }
  }

  private pruneEvents() {
    this.events = this.events.filter((e) => this.time - e.t < 2);
  }

  /** Mark zones the probe is currently inside so leaving them doesn't flash. */
  private suppressCurrentZones() {
    for (const b of this.level.bodies) {
      const zone = this.flyby.get(b.id)!;
      const d = len(sub(this.probe.pos, b.pos));
      if (d < b.radius * 8) {
        zone.inside = true;
        zone.suppressed = true;
      }
    }
  }

  /** Clamp a requested delta-v vector to the remaining budget. */
  clampDv(dv: Vec2): Vec2 {
    const l = len(dv);
    const budget = this.deltaVRemaining;
    if (l <= budget || l === 0) return dv;
    return { x: (dv.x / l) * budget, y: (dv.y / l) * budget };
  }

  /** Launch from the start body. `dv` is relative to the start body. */
  launch(dv: Vec2): boolean {
    if (this.phase !== "aiming") return false;
    const clamped = this.clampDv(dv);
    const l = len(clamped);
    if (l < 1) return false;
    this.probe.vel = add(this.startBody.vel, clamped);
    this.deltaVUsed += l;
    this.phase = "flying";
    this.path.push({ x: this.probe.pos.x, y: this.probe.pos.y });
    this.suppressCurrentZones();
    return true;
  }

  /** One mid-course burn per level; `dv` adds to the probe's velocity. */
  burn(dv: Vec2): boolean {
    if (this.phase !== "flying" || this.burnsLeft <= 0) return false;
    const clamped = this.clampDv(dv);
    const l = len(clamped);
    if (l < 1) return false;
    this.probe.vel = add(this.probe.vel, clamped);
    this.deltaVUsed += l;
    this.burnsLeft--;
    this.suppressCurrentZones();
    return true;
  }

  /**
   * Predicted path for the next `seconds` if the probe launches/burns with
   * `dv` now. During aiming, `dv` is relative to the start body.
   */
  predict(dv: Vec2, seconds = 60): TrajectoryResult {
    const clamped = this.clampDv(dv);
    const baseVel =
      this.phase === "aiming" ? add(this.startBody.vel, clamped) : add(this.probe.vel, clamped);
    const ghost: Body = { ...this.probe, pos: clone(this.probe.pos), vel: baseVel };
    // 2 substeps: half the cost of the live sim; plenty for a dashed preview.
    return predictTrajectory(this.world, ghost, seconds, 3, 2);
  }

  /**
   * Which magnitudes along `dir` (unit vector) lead to a close approach
   * worth landing on: the probe reaches the target without crashing en
   * route or leaving the map, and its closest approach falls inside the
   * band a circularization burn can turn into the winning orbit — the same
   * geometric window the autopilot's planner accepts a candidate on
   * (roughly 1.8-4.5 target radii; tighter risks a perturbed orbit clipping
   * the surface, wider misses the capture ring entirely). This does NOT
   * require the instantaneous trajectory to already be a bound orbit — a
   * burn is the expected next step, exactly as it is for the player.
   * Used to filter which snap dots are shown while aiming; a cheap
   * short-horizon sim per candidate, not the full 60s prediction.
   */
  viableSnaps(dir: Vec2, magnitudes: number[]): boolean[] {
    const t = this.targetBody;
    const R = t.radius;
    return magnitudes.map((mag) => {
      const sim = cloneWorld(this.world);
      const baseVel =
        this.phase === "aiming" ? this.startBody.vel : this.probe.vel;
      sim.probe = {
        id: "probe",
        pos: clone(this.probe.pos),
        vel: add(baseVel, { x: dir.x * mag, y: dir.y * mag }),
        mass: 0,
        radius: PROBE_RADIUS,
      };
      let closest = Infinity;
      const maxSeconds = 60;
      for (let i = 0; i < Math.ceil(maxSeconds / DT); i++) {
        step(sim, DT, 2);
        if (findCollision(sim)) return false;
        if (len(sim.probe.pos) > this.level.mapRadius) return false;
        const d = dist(sim.probe.pos, t.pos);
        if (d < closest) {
          closest = d;
        } else if (closest < R * 6 && d > closest * 2.5) {
          break; // past the encounter
        }
      }
      return closest > R * 1.8 && closest < R * 4.5;
    });
  }

  /**
   * Scans a coasting trajectory forward and returns each local minimum of
   * distance-to-target that falls in the same capture-eligible band
   * viableSnaps uses — the moments worth pausing at for the mid-course
   * burn: "next viable point along the projected orbit."
   *
   * Works in both aiming and flying phases:
   *  - Aiming: pass the pending launch `dv` (relative to the start body,
   *    same convention as predict()). The trajectory is a ghost from the
   *    probe's current (attached) position, exactly like the dashed
   *    prediction line — so these dots can be shown and picked BEFORE the
   *    player commits the launch.
   *  - Flying: omit `dv` to scan forward from the live probe state.
   *
   * `t` is an ABSOLUTE engine.time (this.time + offset), not a relative
   * offset — the caller (or player) may act on a result after more time has
   * passed, so a relative offset would silently go stale. If launched while
   * a checkpoint from the aiming-phase scan is still selected, engine.time
   * is 0 at commit, so the same absolute values remain valid landmarks
   * along the now-live trajectory.
   * Pure: simulates a clone, never touches the live world.
   */
  coastCheckpoints(dv?: Vec2, maxSeconds = 90): { t: number; pos: Vec2; dist: number }[] {
    if (this.phase !== "aiming" && this.phase !== "flying") return [];
    const t = this.targetBody;
    const R = t.radius;
    const sim = cloneWorld(this.world);
    if (dv !== undefined) {
      const clamped = this.clampDv(dv);
      sim.probe = {
        id: "probe",
        pos: clone(this.probe.pos),
        vel: add(this.startBody.vel, clamped),
        mass: 0,
        radius: PROBE_RADIUS,
      };
    }
    const out: { t: number; pos: Vec2; dist: number }[] = [];
    let prevD = dist(sim.probe!.pos, t.pos);
    let falling = false;
    const steps = Math.ceil(maxSeconds / DT);
    const startTime = this.time;
    for (let i = 0; i < steps; i++) {
      step(sim, DT, 2);
      if (findCollision(sim)) break;
      if (len(sim.probe!.pos) > this.level.mapRadius) break;
      const d = dist(sim.probe!.pos, t.pos);
      if (d < prevD) {
        falling = true;
      } else if (falling) {
        // Just passed a local minimum (prevD, one step back).
        falling = false;
        if (prevD > R * 1.8 && prevD < R * 4.5) {
          out.push({ t: startTime + i * DT, pos: clone(sim.probe!.pos), dist: prevD });
        }
      }
      prevD = d;
    }
    return out;
  }
}
