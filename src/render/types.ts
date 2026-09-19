import type { Vec2 } from "@/physics/vec";
import type { TrajectoryResult } from "@/physics/types";

/**
 * Delta-v units gained per screen pixel of drag. Also fixes the aim arrow's
 * on-screen length (dv / DV_PER_PX) so the arrow tip sits exactly where the
 * drag ended and can be grabbed to adjust.
 */
export const DV_PER_PX = 0.7;

/**
 * Snap step for aim magnitude (engine units; KMS converts to displayed
 * km/s, so this is 0.5 km/s). Direction is never snapped — orbital timing
 * rewards precise angles, and arrow-key nudging already covers fine control.
 */
export const DV_SNAP = 5;

export interface AimState {
  /** Requested delta-v vector (world units), already clamped by the engine. */
  dv: Vec2;
  prediction: TrajectoryResult;
  /** True when aiming a mid-course burn rather than the launch. */
  isBurn: boolean;
  /**
   * Snap-dot magnitudes along the current direction that lead to a
   * plausible capture orbit (checked with GameEngine.viableSnaps), paired
   * with whether each one is viable. Recomputed less often than the drag
   * itself — a short list, not a continuous scan.
   */
  snapDots: { mag: number; viable: boolean }[];
}
