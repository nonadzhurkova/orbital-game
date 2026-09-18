import { describe, it, expect } from "vitest";
import {
  DT,
  accelAt,
  step,
  findCollision,
  predictTrajectory,
  orbitalElements,
  circularOrbitSpeed,
  escapeSpeed,
  binaryOrbitSpeeds,
  cloneWorld,
} from "./engine";
import { vec, len, dist, sub } from "./vec";
import type { Body, World } from "./types";

const planet = (over: Partial<Body> = {}): Body => ({
  id: "planet",
  pos: vec(0, 0),
  vel: vec(0, 0),
  mass: 1e6,
  radius: 30,
  ...over,
});

const probe = (over: Partial<Body> = {}): Body => ({
  id: "probe",
  pos: vec(100, 0),
  vel: vec(0, 0),
  mass: 0,
  radius: 2,
  ...over,
});

const world = (bodies: Body[], p: Body | null = null): World => ({
  G: 1,
  bodies,
  probe: p,
});

describe("accelAt", () => {
  it("has magnitude G*m/r^2 pointing at the body", () => {
    const w = world([planet()]);
    const a = accelAt(w, vec(100, 0));
    expect(a.x).toBeCloseTo(-1e6 / 100 ** 2, 6); // toward the origin
    expect(a.y).toBeCloseTo(0, 10);
  });

  it("sums contributions from multiple bodies", () => {
    const w = world([
      planet({ id: "a", pos: vec(-100, 0) }),
      planet({ id: "b", pos: vec(100, 0) }),
    ]);
    const a = accelAt(w, vec(0, 0));
    expect(a.x).toBeCloseTo(0, 8); // symmetric pulls cancel
    expect(a.y).toBeCloseTo(0, 8);
  });

  it("ignores the excluded body", () => {
    const w = world([planet({ id: "a" }), planet({ id: "b", pos: vec(200, 0) })]);
    const a = accelAt(w, vec(100, 0), "a");
    expect(a.x).toBeGreaterThan(0); // only pulled toward b at x=200
  });
});

describe("step (semi-implicit Euler)", () => {
  it("keeps a circular orbit stable for one period", () => {
    const r = 100;
    const v = circularOrbitSpeed(1, 1e6, r); // 100
    const w = world([planet()], probe({ pos: vec(r, 0), vel: vec(0, v) }));
    const period = (2 * Math.PI * r) / v; // ~6.28 s
    const steps = Math.ceil(period / DT);
    for (let i = 0; i < steps; i++) step(w, DT);
    const rEnd = len(w.probe!.pos);
    expect(Math.abs(rEnd - r) / r).toBeLessThan(0.01);
  });

  it("approximately conserves energy on an elliptical orbit", () => {
    const w = world(
      [planet()],
      probe({ pos: vec(150, 0), vel: vec(0, circularOrbitSpeed(1, 1e6, 150) * 0.8) }),
    );
    const energyOf = (ww: World) => {
      const p = ww.probe!;
      const speed2 = p.vel.x ** 2 + p.vel.y ** 2;
      return speed2 / 2 - (1e6 * 1) / len(p.pos);
    };
    const e0 = energyOf(w);
    for (let i = 0; i < 2400; i++) step(w, DT); // 20 s
    const e1 = energyOf(w);
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(0.01);
  });

  it("moves dynamic bodies under mutual gravity", () => {
    const d = 200;
    const { v1, v2 } = binaryOrbitSpeeds(1, 1e6, 1e6, d);
    const w = world([
      planet({ id: "s1", pos: vec(-d / 2, 0), vel: vec(0, v1), dynamic: true }),
      planet({ id: "s2", pos: vec(d / 2, 0), vel: vec(0, -v2), dynamic: true }),
    ]);
    for (let i = 0; i < Math.ceil(30 / DT); i++) step(w, DT); // 30 s
    const sep = dist(w.bodies[0].pos, w.bodies[1].pos);
    expect(Math.abs(sep - d) / d).toBeLessThan(0.05); // binary stays bound & circular
  });

  it("leaves non-dynamic bodies fixed", () => {
    const w = world([planet(), planet({ id: "other", pos: vec(300, 0) })]);
    step(w, DT);
    expect(w.bodies[0].pos).toEqual(vec(0, 0));
    expect(w.bodies[1].pos).toEqual(vec(300, 0));
  });
});

describe("flyby energy behaviour", () => {
  it("a hyperbolic pass by a STATIC body gives no net speed change", () => {
    const w = world([planet()], probe({ pos: vec(-500, 60), vel: vec(150, 0) }));
    const vIn = len(w.probe!.vel);
    const rIn = len(w.probe!.pos);
    for (let i = 0; i < Math.ceil(10 / DT); i++) step(w, DT);
    const rEnd = len(w.probe!.pos);
    expect(rEnd).toBeGreaterThan(400); // pass is over, probe is far away again
    // Vis-viva: speed depends only on distance, so no net energy was gained.
    const vTheory = Math.sqrt(vIn * vIn + 2 * 1e6 * (1 / rEnd - 1 / rIn));
    expect(len(w.probe!.vel)).toBeCloseTo(vTheory, 1);
  });

  it("a pass behind a MOVING body increases heliocentric speed (slingshot)", () => {
    // Massive planet moving +y; probe crosses behind it.
    const w = world(
      [planet({ pos: vec(0, -400), vel: vec(0, 60), dynamic: true })],
      probe({ pos: vec(-400, 0), vel: vec(60, 0) }),
    );
    const vIn = len(w.probe!.vel);
    let vMaxAfterExit = 0;
    for (let i = 0; i < Math.ceil(30 / DT); i++) {
      step(w, DT);
      const d = dist(w.probe!.pos, w.bodies[0].pos);
      if (d > 600) {
        vMaxAfterExit = Math.max(vMaxAfterExit, len(w.probe!.vel));
      }
    }
    expect(vMaxAfterExit).toBeGreaterThan(vIn * 1.1); // visible gain
  });
});

describe("findCollision", () => {
  it("detects overlap with a body", () => {
    const w = world([planet()], probe({ pos: vec(31, 0) }));
    expect(findCollision(w)?.id).toBe("planet"); // 31 < 30 + 2
  });
  it("returns null when clear", () => {
    const w = world([planet()], probe({ pos: vec(100, 0) }));
    expect(findCollision(w)).toBeNull();
  });
});

describe("predictTrajectory", () => {
  it("returns sampled points for the requested duration", () => {
    const v = circularOrbitSpeed(1, 1e6, 100);
    const w = world([planet()]);
    const res = predictTrajectory(w, probe({ vel: vec(0, v) }), 10, 2);
    expect(res.collided).toBe(false);
    // 10 s at DT=1/120, sampled every 2 steps => ~600 points.
    expect(res.points.length).toBeGreaterThan(500);
    expect(res.points.length).toBeLessThan(700);
  });

  it("stops at a collision and reports the body", () => {
    const w = world([planet()]);
    const res = predictTrajectory(w, probe({ pos: vec(200, 0), vel: vec(-100, 0) }), 30);
    expect(res.collided).toBe(true);
    expect(res.collidedWith).toBe("planet");
    const last = res.points[res.points.length - 1];
    expect(len(last)).toBeLessThan(40); // ended near the surface
  });

  it("does not mutate the input world or probe", () => {
    const w = world([planet({ dynamic: true, vel: vec(0, 10) })]);
    const p = probe();
    const snapshot = JSON.stringify({ w, p });
    predictTrajectory(w, p, 5);
    expect(JSON.stringify({ w, p })).toBe(snapshot);
  });
});

describe("orbitalElements", () => {
  it("reports a circular orbit correctly", () => {
    const r = 120;
    const v = circularOrbitSpeed(1, 1e6, r);
    const el = orbitalElements(probe({ pos: vec(r, 0), vel: vec(0, v) }), planet(), 1);
    expect(el.bound).toBe(true);
    expect(el.e).toBeLessThan(1e-9);
    expect(el.a).toBeCloseTo(r, 6);
    expect(el.periapsis).toBeCloseTo(r, 6);
    expect(el.apoapsis).toBeCloseTo(r, 6);
  });

  it("reports an elliptical orbit's apsides", () => {
    const rp = 100;
    const vp = circularOrbitSpeed(1, 1e6, rp) * 1.2; // faster than circular at periapsis
    const el = orbitalElements(probe({ pos: vec(rp, 0), vel: vec(0, vp) }), planet(), 1);
    expect(el.bound).toBe(true);
    expect(el.periapsis).toBeCloseTo(rp, 4);
    expect(el.apoapsis).toBeGreaterThan(rp);
  });

  it("flags escape as unbound", () => {
    const vEsc = escapeSpeed(1, 1e6, 100);
    const el = orbitalElements(
      probe({ pos: vec(100, 0), vel: vec(0, vEsc * 1.01) }),
      planet(),
      1,
    );
    expect(el.bound).toBe(false);
    expect(el.apoapsis).toBe(Infinity);
  });

  it("uses velocity relative to a moving body", () => {
    const r = 120;
    const v = circularOrbitSpeed(1, 1e6, r);
    const drift = vec(500, -300);
    const el = orbitalElements(
      probe({ pos: vec(r, 0), vel: vec(drift.x, drift.y + v) }),
      planet({ vel: drift }),
      1,
    );
    expect(el.e).toBeLessThan(1e-9);
  });
});

describe("cloneWorld", () => {
  it("produces an independent copy", () => {
    const w = world([planet()], probe());
    const c = cloneWorld(w);
    c.bodies[0].pos.x = 999;
    c.probe!.vel.x = 999;
    expect(w.bodies[0].pos.x).toBe(0);
    expect(w.probe!.vel.x).toBe(0);
  });
});
