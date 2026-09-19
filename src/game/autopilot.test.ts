import { describe, it, expect } from "vitest";
import { GameEngine } from "./engine";
import { Autopilot } from "./autopilot";
import { makeLevel } from "./levels";

/**
 * Drive the autopilot exactly like the render loop does: one update() per
 * "frame", stepping the engine whenever the autopilot hasn't paused it.
 * Speed multipliers only affect wall time, so they are ignored here.
 */
function runAutopilot(levelIndex: number, maxSimSeconds: number) {
  const engine = new GameEngine(makeLevel(levelIndex));
  let paused = false;
  const ap = new Autopilot(engine, {
    pause: (p) => (paused = p),
    setSpeed: () => {},
    onLaunch: () => {},
    onBurn: () => {},
    log: () => {},
  });
  const maxSteps = maxSimSeconds * 120;
  let steps = 0;
  // Cap update() calls too, so a stuck planner can't hang the test.
  for (let i = 0; i < 500000; i++) {
    ap.update();
    if (engine.phase === "won" || engine.phase === "lost") break;
    if (ap.done) break; // planner gave up
    if (!paused) {
      engine.step();
      if (++steps > maxSteps) break;
    }
  }
  return { engine, ap };
}

describe("autopilot", () => {
  it("solves level 1 (static, direct shot) within budget", () => {
    const { engine, ap } = runAutopilot(0, 300);
    expect(ap.plan, "planner found no route").toBeTruthy();
    expect(engine.phase).toBe("won");
    expect(engine.deltaVUsed).toBeLessThanOrEqual(engine.level.budget);
  });

  it("solves level 2 (heavy flyby body between start and target)", () => {
    const { engine, ap } = runAutopilot(1, 400);
    expect(ap.plan, "planner found no route").toBeTruthy();
    expect(engine.phase).toBe("won");
    expect(engine.deltaVUsed).toBeLessThanOrEqual(engine.level.budget);
  });

  it(
    "solves level 4 (moving start and target moons)",
    () => {
      const { engine, ap } = runAutopilot(3, 600);
      expect(ap.plan, "planner found no route").toBeTruthy();
      expect(engine.phase).toBe("won");
      expect(engine.deltaVUsed).toBeLessThanOrEqual(engine.level.budget);
    },
    20000,
  );

  it(
    "solves level 5 (binary stars)",
    () => {
      const { engine, ap } = runAutopilot(4, 900);
      expect(ap.plan, "planner found no route").toBeTruthy();
      expect(engine.phase).toBe("won");
      expect(engine.deltaVUsed).toBeLessThanOrEqual(engine.level.budget);
    },
    120000,
  );
});
