import type { Vec2 } from "./vec";

/** A massive body (planet, moon, star) or the probe. */
export interface Body {
  id: string;
  pos: Vec2;
  vel: Vec2;
  mass: number;
  radius: number;
  /** If true, this body is integrated under gravity from the other bodies. */
  dynamic?: boolean;
}

/** The simulated world. Bodies attract each other (if dynamic) and the probe. */
export interface World {
  /** Gravitational constant for this world (game units). */
  G: number;
  bodies: Body[];
  /** The player's probe; massless test particle. Null before launch. */
  probe: Body | null;
}

export interface OrbitalElements {
  /** Semi-major axis (Infinity when unbound). */
  a: number;
  /** Eccentricity. */
  e: number;
  /** Specific orbital energy relative to the body. Negative = bound. */
  energy: number;
  periapsis: number;
  apoapsis: number;
  bound: boolean;
}

export interface TrajectoryResult {
  /** Sampled probe positions along the predicted path. */
  points: Vec2[];
  collided: boolean;
  collidedWith: string | null;
  /** Probe state at the end of the prediction (or at impact). */
  endState: { pos: Vec2; vel: Vec2 };
}
