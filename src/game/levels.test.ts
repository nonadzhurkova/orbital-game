import { describe, it, expect } from "vitest";
import { makeLevel, LEVELS, PROBE_RADIUS } from "./levels";
import { GameEngine } from "./engine";
import { DT, step, circularOrbitSpeed, cloneWorld } from "@/physics/engine";
import { vec, sub, len, dist, norm, scale, add } from "@/physics/vec";
import type { World } from "@/physics/types";

describe("level definitions", () => {
  it("all levels have a start body, target body, and positive budget", () => {
    for (let i = 0; i < LEVELS.length; i++) {
      const lvl = makeLevel(i);
      expect(lvl.bodies.find((b) => b.id === lvl.startBodyId)).toBeTruthy();
      expect(lvl.bodies.find((b) => b.id === lvl.targetBodyId)).toBeTruthy();
      expect(lvl.budget).toBeGreaterThan(0);
      expect(lvl.par).toBeLessThanOrEqual(lvl.budget);
      // every body starts inside the map
      for (const b of lvl.bodies) {
        expect(len(b.pos) + b.radius).toBeLessThan(lvl.mapRadius);
      }
    }
  });

  it("planets never collide with each other for 180 s of sim", () => {
    for (let i = 0; i < LEVELS.length; i++) {
      const lvl = makeLevel(i);
      const world: World = { G: lvl.G, bodies: lvl.bodies, probe: null };
      const steps = Math.ceil(180 / DT);
      for (let s = 0; s < steps; s++) {
        step(world, DT);
        if (s % 60 !== 0) continue;
        for (let a = 0; a < world.bodies.length; a++) {
          for (let b = a + 1; b < world.bodies.length; b++) {
            const d = dist(world.bodies[a].pos, world.bodies[b].pos);
            const min = world.bodies[a].radius + world.bodies[b].radius;
            expect(d, `level ${lvl.id}: ${world.bodies[a].id} vs ${world.bodies[b].id} at t=${(s * DT).toFixed(0)}s`).toBeGreaterThan(min * 1.5);
          }
        }
      }
    }
  });

  it("orbiting bodies stay roughly on their orbits for 120 s", () => {
    for (let i = 0; i < LEVELS.length; i++) {
      const lvl = makeLevel(i);
      const world: World = { G: lvl.G, bodies: lvl.bodies, probe: null };
      const r0 = world.bodies.map((b) => len(b.pos));
      for (let s = 0; s < Math.ceil(120 / DT); s++) step(world, DT);
      world.bodies.forEach((b, j) => {
        if (!b.dynamic) return;
        const r1 = len(b.pos);
        // Distance from the system origin should not drift badly.
        expect(
          Math.abs(r1 - r0[j]) / Math.max(r0[j], 1),
          `level ${lvl.id}: ${b.id} radial drift`,
        ).toBeLessThan(0.25);
      });
    }
  });
});

describe("level 1 is winnable within budget (end-to-end through GameEngine)", () => {
  it("direct shot plus a circularization burn wins", () => {
    // Scan launch speeds along the line to the target; pick the closest
    // approach, then burn to circularize there — the way a player would.
    const probeFor = (speed: number, offset: number) => {
      const lvl = makeLevel(0);
      const eng = new GameEngine(lvl);
      // Aim slightly off-center so the approach is a near miss, not an impact.
      const t = eng.targetBody;
      const aimPoint = add(t.pos, vec(0, offset));
      const dir = norm(sub(aimPoint, eng.startBody.pos));
      expect(eng.launch(scale(dir, speed))).toBe(true);
      return eng;
    };

    let best: { speed: number; offset: number; closest: number } | null = null;
    for (const offMult of [1.5, 2.5, 3.5]) {
      for (let speed = 70; speed <= 130; speed += 5) {
        const offset = makeLevel(0).bodies[1].radius * offMult;
        const eng = probeFor(speed, offset);
        let closest = Infinity;
        for (let s = 0; s < Math.ceil(40 / DT) && eng.phase === "flying"; s++) {
          eng.step();
          const d = dist(eng.probe.pos, eng.targetBody.pos);
          if (d < closest) closest = d;
        }
        const R = eng.targetBody.radius;
        // Want a periapsis comfortably above the surface but inside 5 radii.
        if (closest > R + PROBE_RADIUS + 10 && closest < R * 4) {
          if (!best || closest < best.closest) best = { speed, offset, closest };
        }
      }
    }
    expect(best, "no launch speed produced a usable close approach").toBeTruthy();

    // Re-run the winning candidate and burn at closest approach.
    const eng = probeFor(best!.speed, best!.offset);
    let prevD = Infinity;
    let burned = false;
    for (let s = 0; s < Math.ceil(120 / DT); s++) {
      eng.step();
      if (eng.phase !== "flying") break;
      const t = eng.targetBody;
      const d = dist(eng.probe.pos, t.pos);
      if (!burned && d < t.radius * 4 && d > prevD) {
        // Passed periapsis: circularize. Desired velocity is tangential at
        // circular speed for the current radius.
        const rel = sub(eng.probe.pos, t.pos);
        const vCirc = circularOrbitSpeed(eng.level.G, t.mass, d);
        const relV = sub(eng.probe.vel, t.vel);
        // Tangential direction that keeps the current sense of motion.
        const tangent = { x: -rel.y / d, y: rel.x / d };
        const sense = tangent.x * relV.x + tangent.y * relV.y >= 0 ? 1 : -1;
        const desired = add(t.vel, scale(tangent, vCirc * sense));
        const dv = sub(desired, eng.probe.vel);
        expect(len(dv)).toBeLessThanOrEqual(eng.deltaVRemaining);
        expect(eng.burn(dv)).toBe(true);
        burned = true;
      }
      prevD = d;
    }
    expect(burned).toBe(true);
    expect(eng.phase).toBe("won");
    expect(eng.deltaVUsed).toBeLessThanOrEqual(eng.level.budget);
    // Log the actual cost so par can be sanity-checked against it.
    // eslint-disable-next-line no-console
    console.log(
      `level 1 solution: launch ${best!.speed}, total dv ${eng.deltaVUsed.toFixed(1)} (par ${eng.level.par}, budget ${eng.level.budget}), stars ${eng.stars()}`,
    );
  });
});

describe("GameEngine rules", () => {
  it("loses on collision with a body", () => {
    const eng = new GameEngine(makeLevel(0));
    // Launch hard, straight at the target.
    const dir = norm(sub(eng.targetBody.pos, eng.startBody.pos));
    eng.launch(scale(dir, 160));
    for (let s = 0; s < Math.ceil(60 / DT) && eng.phase === "flying"; s++) eng.step();
    expect(eng.phase).toBe("lost");
    expect(eng.lostReason).toMatch(/Crashed/);
  });

  it("loses when leaving the map", () => {
    const eng = new GameEngine(makeLevel(0));
    eng.launch(vec(0, 160)); // straight up, near-max
    for (let s = 0; s < Math.ceil(300 / DT) && eng.phase === "flying"; s++) eng.step();
    expect(eng.phase).toBe("lost");
    expect(eng.lostReason).toMatch(/deep space/);
  });

  it("caps launch delta-v at the budget", () => {
    const eng = new GameEngine(makeLevel(0));
    eng.launch(vec(9999, 0));
    expect(eng.deltaVUsed).toBeCloseTo(eng.level.budget, 6);
  });

  it("allows exactly one burn", () => {
    const eng = new GameEngine(makeLevel(0));
    eng.launch(vec(80, 0));
    expect(eng.burn(vec(0, 10))).toBe(true);
    expect(eng.burn(vec(0, 10))).toBe(false);
    expect(eng.burnsLeft).toBe(0);
  });

  it("keeps the probe attached to a moving start body while aiming", () => {
    const eng = new GameEngine(makeLevel(3)); // two-body dance: moving start moon
    const gap0 = dist(eng.probe.pos, eng.startBody.pos);
    for (let s = 0; s < 600; s++) eng.step(); // 5 s
    const gap1 = dist(eng.probe.pos, eng.startBody.pos);
    expect(eng.phase).toBe("aiming");
    expect(gap1).toBeCloseTo(gap0, 6);
    // ...and the start body actually moved.
    expect(len(eng.startBody.vel)).toBeGreaterThan(1);
  });

  it("prediction does not disturb the live world", () => {
    const eng = new GameEngine(makeLevel(2));
    const snap = JSON.stringify(cloneWorld(eng.world));
    eng.predict(vec(50, 10), 30);
    expect(JSON.stringify(cloneWorld(eng.world))).toBe(snap);
  });
});

describe("GameEngine.viableSnaps", () => {
  it("flags a dead-center aim as never viable (always a collision course)", () => {
    const eng = new GameEngine(makeLevel(0));
    const dir = norm(sub(eng.targetBody.pos, eng.probe.pos));
    const mags = [50, 70, 90, 110, 130];
    const viable = eng.viableSnaps(dir, mags);
    expect(viable.every((v) => v === false)).toBe(true);
  });

  it("flags viable magnitudes at a known-good lateral offset", () => {
    const eng = new GameEngine(makeLevel(0));
    const toTarget = norm(sub(eng.targetBody.pos, eng.probe.pos));
    const perp = { x: -toTarget.y, y: toTarget.x };
    const aimPoint = add(eng.targetBody.pos, scale(perp, -2 * eng.targetBody.radius));
    const dir = norm(sub(aimPoint, eng.probe.pos));
    const mags = [50, 65, 70, 90, 110, 130];
    const viable = eng.viableSnaps(dir, mags);
    // 70 and up should clear the capture band at this offset (verified
    // against the closest-approach distances directly during development).
    expect(viable.some((v) => v === true)).toBe(true);
    expect(viable[0]).toBe(false); // 50: too slow, falls short of the band
  });

  it("does not disturb the live world", () => {
    const eng = new GameEngine(makeLevel(0));
    const snap = JSON.stringify(cloneWorld(eng.world));
    eng.viableSnaps(norm(sub(eng.targetBody.pos, eng.probe.pos)), [50, 100]);
    expect(JSON.stringify(cloneWorld(eng.world))).toBe(snap);
  });
});
