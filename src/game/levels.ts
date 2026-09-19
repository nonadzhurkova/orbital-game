import type { Body } from "@/physics/types";
import { vec, fromAngle, add, scale, Vec2 } from "@/physics/vec";
import { circularOrbitSpeed, binaryOrbitSpeeds } from "@/physics/engine";

export interface BodyStyle {
  /** Base fill color. */
  base: string;
  /** Accent color for bands / craters / highlights. */
  accent: string;
  kind: "rock" | "gas" | "ice" | "star";
  /** Visual rotation speed, rad/s. */
  rotSpeed: number;
}

export type LevelBody = Body & {
  name: string;
  style: BodyStyle;
  /**
   * What this body orbits, for drawing a static orbit-path ring: either the
   * id of a single real body, or (for a circumbinary orbit) the ids of the
   * two+ bodies whose combined mass/position forms the barycenter it
   * actually orbits.
   */
  orbits?: string | string[];
};

export interface Level {
  id: string;
  name: string;
  subtitle: string;
  G: number;
  bodies: LevelBody[];
  startBodyId: string;
  /** Angle (rad) on the start body's surface where the probe sits. */
  startAngle: number;
  targetBodyId: string;
  /** Total delta-v budget (game speed units). */
  budget: number;
  /** Par delta-v for a 3-star finish. */
  par: number;
  /** Losing boundary: probe farther than this from the origin is lost. */
  mapRadius: number;
  /** Initial camera zoom (world units -> screen px multiplier). */
  zoom: number;
}

export const PROBE_RADIUS = 3;
/** Display conversion: 1 speed unit shown as 0.1 km/s. */
export const KMS = 0.1;

/** Place a body on a circular counter-clockwise orbit around a parent. */
function onOrbit(
  parent: {
    id: string | string[];
    pos: Vec2;
    vel: Vec2;
    mass: number;
  },
  G: number,
  r: number,
  angle: number,
  body: Omit<LevelBody, "pos" | "vel" | "orbits">,
): LevelBody {
  const pos = add(parent.pos, fromAngle(angle, r));
  const speed = circularOrbitSpeed(G, parent.mass, r);
  // Velocity perpendicular to the radius (CCW), plus the parent's velocity.
  const vel = add(parent.vel, fromAngle(angle + Math.PI / 2, speed));
  return { ...body, pos, vel, dynamic: true, orbits: parent.id };
}

const rock = (base: string, accent: string, rotSpeed = 0.05): BodyStyle => ({
  base,
  accent,
  kind: "rock",
  rotSpeed,
});
const gas = (base: string, accent: string, rotSpeed = 0.12): BodyStyle => ({
  base,
  accent,
  kind: "gas",
  rotSpeed,
});
const star = (base: string, accent: string): BodyStyle => ({
  base,
  accent,
  kind: "star",
  rotSpeed: 0.02,
});

function level1(): Level {
  return {
    id: "first-hop",
    name: "First Hop",
    subtitle: "A straight shot to the neighbor. Launch, then burn to settle into orbit.",
    G: 1,
    bodies: [
      {
        id: "home",
        name: "Verda",
        pos: vec(-350, 0),
        vel: vec(0, 0),
        mass: 8e4,
        radius: 36,
        style: rock("#4caf7d", "#2e7d54"),
      },
      {
        id: "target",
        name: "Rustle",
        pos: vec(350, 0),
        vel: vec(0, 0),
        mass: 6e4,
        radius: 30,
        style: rock("#c96f4a", "#8f4a30"),
      },
    ],
    startBodyId: "home",
    startAngle: 0, // facing the target
    targetBodyId: "target",
    budget: 150,
    par: 100,
    mapRadius: 2600,
    zoom: 0.75,
  };
}

function level2(): Level {
  return {
    id: "one-flyby",
    name: "Threading the Needle",
    subtitle: "A heavy world sits in the way. Let it bend your path.",
    G: 1,
    bodies: [
      {
        id: "home",
        name: "Perch",
        pos: vec(-620, -120),
        vel: vec(0, 0),
        mass: 8e4,
        radius: 34,
        style: rock("#5b8dd6", "#38609e"),
      },
      {
        id: "giant",
        name: "Brute",
        // Static bodies don't free-fall, so a pinned giant's pull acts as a
        // uniform disturbance on orbits around the target. Kept light and
        // far enough from Haven that capture orbits survive (like level 1).
        pos: vec(-60, 130),
        vel: vec(0, 0),
        mass: 1.4e5,
        radius: 48,
        style: gas("#b48ede", "#8a5fc0"),
      },
      {
        id: "target",
        name: "Haven",
        pos: vec(640, -80),
        vel: vec(0, 0),
        mass: 9e4,
        radius: 30,
        style: rock("#d6b95b", "#a3893a"),
      },
    ],
    startBodyId: "home",
    startAngle: -0.3,
    targetBodyId: "target",
    budget: 180,
    par: 125,
    mapRadius: 3200,
    zoom: 0.62,
  };
}

function level3(): Level {
  const G = 1;
  const sun = {
    id: "sun",
    name: "Cinder",
    pos: vec(0, 0),
    vel: vec(0, 0),
    mass: 6e6,
    radius: 90,
    style: star("#ffb347", "#ff8c1a"),
  };
  return {
    id: "slingshot",
    name: "Slingshot",
    subtitle: "The outer world is out of reach — unless the gas giant throws you.",
    G,
    bodies: [
      sun,
      onOrbit(sun, G, 520, -0.4, {
        id: "home",
        name: "Ember",
        mass: 5e4,
        radius: 26,
        style: rock("#e0705a", "#a84a3a"),
      }),
      onOrbit(sun, G, 900, 0.55, {
        id: "giant",
        name: "Tempest",
        mass: 1.2e5, // heavy enough for a good throw, light enough not to wreck the other orbits
        radius: 56,
        style: gas("#6fc3c9", "#3f8f96"),
      }),
      onOrbit(sun, G, 2000, 2.4, {
        id: "target",
        name: "Frost",
        mass: 5e4,
        radius: 28,
        style: rock("#bcd8f0", "#7fa8cc", 0.03),
      }),
    ],
    startBodyId: "home",
    startAngle: 1.2,
    targetBodyId: "target",
    budget: 150,
    par: 105,
    mapRadius: 6200,
    zoom: 0.26,
  };
}

function level4(): Level {
  const G = 1;
  const gaia = {
    id: "gaia",
    name: "Gaia",
    pos: vec(0, 0),
    vel: vec(0, 0),
    mass: 5e5,
    radius: 60,
    style: gas("#4a90c9", "#2c6a9e"),
  };
  return {
    id: "two-body-dance",
    name: "Two-Body Dance",
    subtitle: "Two moons circle the blue giant. Time your transfer between them.",
    G,
    bodies: [
      gaia,
      onOrbit(gaia, G, 200, 0.2, {
        id: "home",
        name: "Skip",
        mass: 1e4,
        radius: 20,
        style: rock("#b8b2a8", "#8a8478", 0.1),
      }),
      // Far enough out that Hop's Hill sphere comfortably fits a capture
      // orbit (at 460 the stable zone was a sliver and captures drifted off).
      onOrbit(gaia, G, 700, 2.0, {
        id: "target",
        name: "Hop",
        mass: 1.5e4,
        radius: 22,
        style: rock("#d98cb3", "#a85f88", 0.08),
      }),
    ],
    startBodyId: "home",
    startAngle: 0.2, // outward-facing
    targetBodyId: "target",
    budget: 130,
    par: 75,
    mapRadius: 3600,
    zoom: 0.55,
  };
}

function level5(): Level {
  const G = 1;
  const m = 2e6;
  const d = 400;
  const { v1 } = binaryOrbitSpeeds(G, m, m, d);
  const starA: LevelBody = {
    id: "starA",
    name: "Castor",
    pos: vec(-d / 2, 0),
    vel: vec(0, v1),
    mass: m,
    radius: 66,
    dynamic: true,
    style: star("#ffd27a", "#ffab40"),
  };
  const starB: LevelBody = {
    id: "starB",
    name: "Pollux",
    pos: vec(d / 2, 0),
    vel: vec(0, -v1),
    mass: m,
    radius: 66,
    dynamic: true,
    style: star("#8ecbff", "#4a9fe8"),
  };
  // Circumbinary planets: treat the pair as one mass at the barycenter.
  const pair = { id: ["starA", "starB"], pos: vec(0, 0), vel: vec(0, 0), mass: 2 * m };
  const bodies = [
    starA,
    starB,
    onOrbit(pair, G, 1350, -1.1, {
      id: "home",
      name: "Ash",
      mass: 5e4,
      radius: 28,
      style: rock("#9e9689", "#6e675c"),
    }),
    // Phase chosen so a direct transfer window exists right away — aiming
    // is frozen (no "wait for the window"), so the launch has to work from
    // wherever the planets start.
    onOrbit(pair, G, 2100, 2.094, {
      id: "target",
      name: "Solace",
      mass: 5e4,
      radius: 26,
      style: rock("#8fd6a8", "#57a878", 0.04),
    }),
  ];
  // Zero the system's net momentum so the barycenter doesn't drift.
  let px = 0;
  let py = 0;
  let mTotal = 0;
  for (const b of bodies) {
    px += b.vel.x * b.mass;
    py += b.vel.y * b.mass;
    mTotal += b.mass;
  }
  for (const b of bodies) {
    b.vel.x -= px / mTotal;
    b.vel.y -= py / mTotal;
  }
  return {
    id: "binary",
    name: "Binary Hearts",
    subtitle: "Twin suns churn the middle. Cross the maelstrom to the far world.",
    G,
    bodies,
    startBodyId: "home",
    startAngle: -1.1,
    targetBodyId: "target",
    budget: 180,
    par: 120,
    mapRadius: 7000,
    zoom: 0.22,
  };
}

/** Level factories — call to get a fresh, unshared level instance. */
export const LEVELS: Array<() => Level> = [level1, level2, level3, level4, level5];

export function makeLevel(index: number): Level {
  const f = LEVELS[index];
  if (!f) throw new Error(`No level ${index}`);
  return f();
}
