import { Vec2, sub, len, len2, dot, cross, clone } from "./vec";
import type { Body, World, OrbitalElements, TrajectoryResult } from "./types";

/** Canonical fixed timestep of the simulation, in seconds. */
export const DT = 1 / 120;
/** Substeps per fixed step; the integrator runs at DT / SUBSTEPS. */
export const SUBSTEPS = 4;

/** Gravitational acceleration at `pos` from all bodies (except `excludeId`). */
export function accelAt(world: World, pos: Vec2, excludeId?: string): Vec2 {
  let ax = 0;
  let ay = 0;
  for (const b of world.bodies) {
    if (b.id === excludeId || b.mass === 0) continue;
    const dx = b.pos.x - pos.x;
    const dy = b.pos.y - pos.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-12) continue;
    const r = Math.sqrt(r2);
    // a = G*m/r^2, direction (dx, dy)/r  =>  G*m/(r^2 * r) * (dx, dy)
    const s = (world.G * b.mass) / (r2 * r);
    ax += s * dx;
    ay += s * dy;
  }
  return { x: ax, y: ay };
}

/**
 * Advance the world by `dt` seconds with semi-implicit (symplectic) Euler:
 * velocities are updated from accelerations at the current positions, then
 * positions are updated with the *new* velocities. `dt` is internally divided
 * into `substeps` for stability near massive bodies.
 * Mutates the world in place.
 */
export function step(world: World, dt: number, substeps: number = SUBSTEPS): void {
  const h = dt / substeps;
  const dynamic = world.bodies.filter((b) => b.dynamic);
  for (let s = 0; s < substeps; s++) {
    // Accelerations for dynamic bodies from current positions.
    if (dynamic.length > 0) {
      const accels: Vec2[] = dynamic.map((b) => accelAt(world, b.pos, b.id));
      for (let i = 0; i < dynamic.length; i++) {
        dynamic[i].vel.x += accels[i].x * h;
        dynamic[i].vel.y += accels[i].y * h;
      }
    }
    if (world.probe) {
      const a = accelAt(world, world.probe.pos);
      world.probe.vel.x += a.x * h;
      world.probe.vel.y += a.y * h;
    }
    // Positions move with the updated velocities (semi-implicit).
    for (const b of dynamic) {
      b.pos.x += b.vel.x * h;
      b.pos.y += b.vel.y * h;
    }
    if (world.probe) {
      world.probe.pos.x += world.probe.vel.x * h;
      world.probe.pos.y += world.probe.vel.y * h;
    }
  }
}

/** The body the probe is currently intersecting, or null. */
export function findCollision(world: World): Body | null {
  const p = world.probe;
  if (!p) return null;
  for (const b of world.bodies) {
    if (len2(sub(p.pos, b.pos)) < (b.radius + p.radius) ** 2) return b;
  }
  return null;
}

function cloneBody(b: Body): Body {
  return { ...b, pos: clone(b.pos), vel: clone(b.vel) };
}

/** Deep-copy a world so it can be simulated without touching the original. */
export function cloneWorld(world: World): World {
  return {
    G: world.G,
    bodies: world.bodies.map(cloneBody),
    probe: world.probe ? cloneBody(world.probe) : null,
  };
}

/**
 * Predict the probe's path for `seconds` of sim time from the given state.
 * Simulates a cloned world (moving planets included) at the canonical DT.
 * Stops early on collision. Returns positions sampled every `sampleEvery`
 * steps.
 */
export function predictTrajectory(
  world: World,
  probe: Body,
  seconds: number,
  sampleEvery = 2,
  substeps: number = SUBSTEPS,
): TrajectoryResult {
  const sim = cloneWorld(world);
  sim.probe = cloneBody(probe);
  const points: Vec2[] = [clone(sim.probe.pos)];
  const steps = Math.ceil(seconds / DT);
  let collided = false;
  let collidedWith: string | null = null;
  for (let i = 0; i < steps; i++) {
    step(sim, DT, substeps);
    const hit = findCollision(sim);
    if (hit) {
      collided = true;
      collidedWith = hit.id;
      points.push(clone(sim.probe.pos));
      break;
    }
    if (i % sampleEvery === 0) points.push(clone(sim.probe.pos));
  }
  return {
    points,
    collided,
    collidedWith,
    endState: { pos: clone(sim.probe.pos), vel: clone(sim.probe.vel) },
  };
}

/**
 * Keplerian elements of the probe's instantaneous orbit relative to `body`
 * (two-body approximation using their relative position and velocity).
 */
export function orbitalElements(probe: Body, body: Body, G: number): OrbitalElements {
  const mu = G * body.mass;
  const r = sub(probe.pos, body.pos);
  const v = sub(probe.vel, body.vel);
  const rlen = len(r);
  const v2 = len2(v);
  const energy = v2 / 2 - mu / rlen;
  const h = cross(r, v); // specific angular momentum (z-component)
  const rv = dot(r, v);
  // Eccentricity vector: e = ((v^2 - mu/r) r - (r.v) v) / mu
  const ex = ((v2 - mu / rlen) * r.x - rv * v.x) / mu;
  const ey = ((v2 - mu / rlen) * r.y - rv * v.y) / mu;
  const e = Math.hypot(ex, ey);
  const bound = energy < 0;
  const a = bound ? -mu / (2 * energy) : Infinity;
  const semiLatus = (h * h) / mu;
  const periapsis = semiLatus / (1 + e);
  const apoapsis = bound ? a * (1 + e) : Infinity;
  return { a, e, energy, periapsis, apoapsis, bound };
}

export interface OrbitalShape {
  /** World-space center of the ellipse (NOT the focus — bodies orbit the focus). */
  center: Vec2;
  semiMajor: number;
  semiMinor: number;
  /** Rotation of the ellipse's major axis, radians. */
  rotation: number;
  bound: boolean;
}

/**
 * Full ellipse geometry of `body`'s orbit around `focus` (two-body,
 * instantaneous) — for drawing a static orbit-path ring, unlike
 * orbitalElements() which only reports scalar periapsis/apoapsis/etc.
 * Unbound (hyperbolic/parabolic) orbits return bound: false; the caller
 * should skip drawing a ring in that case.
 */
export function orbitalShape(body: Body, focus: Body, G: number): OrbitalShape {
  const mu = G * focus.mass;
  const r = sub(body.pos, focus.pos);
  const v = sub(body.vel, focus.vel);
  const rlen = len(r);
  const v2 = len2(v);
  const energy = v2 / 2 - mu / rlen;
  const h = cross(r, v);
  const rv = dot(r, v);
  const ex = ((v2 - mu / rlen) * r.x - rv * v.x) / mu;
  const ey = ((v2 - mu / rlen) * r.y - rv * v.y) / mu;
  const e = Math.hypot(ex, ey);
  const bound = energy < 0;
  if (!bound) {
    return { center: focus.pos, semiMajor: 0, semiMinor: 0, rotation: 0, bound: false };
  }
  const a = -mu / (2 * energy);
  const c = a * e; // focus-to-center distance
  const semiMinor = a * Math.sqrt(Math.max(0, 1 - e * e));
  const periapsisAngle = e > 1e-6 ? Math.atan2(ey, ex) : 0;
  // Center sits on the far side of the focus from periapsis, at distance c.
  const center = {
    x: focus.pos.x - Math.cos(periapsisAngle) * c,
    y: focus.pos.y - Math.sin(periapsisAngle) * c,
  };
  return { center, semiMajor: a, semiMinor, rotation: periapsisAngle, bound: true };
}

/** Speed of a circular orbit of radius `r` around a mass `m`. */
export function circularOrbitSpeed(G: number, m: number, r: number): number {
  return Math.sqrt((G * m) / r);
}

/** Escape speed at distance `r` from a mass `m`. */
export function escapeSpeed(G: number, m: number, r: number): number {
  return Math.sqrt((2 * G * m) / r);
}

/**
 * Velocities for two bodies in a mutual circular orbit, separated by `d`,
 * about their barycenter. Returns the speed of each (perpendicular to the
 * separation line, opposite directions).
 */
export function binaryOrbitSpeeds(
  G: number,
  m1: number,
  m2: number,
  d: number,
): { v1: number; v2: number } {
  const total = m1 + m2;
  const v1 = m2 * Math.sqrt(G / (d * total));
  const v2 = m1 * Math.sqrt(G / (d * total));
  return { v1, v2 };
}
