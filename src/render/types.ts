import type { Vec2 } from "@/physics/vec";
import type { TrajectoryResult } from "@/physics/types";

/**
 * Delta-v units gained per screen pixel of drag. Also fixes the aim arrow's
 * on-screen length (dv / DV_PER_PX) so the arrow tip sits exactly where the
 * drag ended and can be grabbed to adjust.
 */
export const DV_PER_PX = 0.7;

export interface AimState {
  /** Requested delta-v vector (world units), already clamped by the engine. */
  dv: Vec2;
  prediction: TrajectoryResult;
  /** True when aiming a mid-course burn rather than the launch. */
  isBurn: boolean;
}
