"use client";
import { useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";

/**
 * The one spring used by every Motion transition in the UI.
 * Snappy but soft-landing; tuned for small cards and HUD chips.
 */
export const SPRING: Transition = {
  type: "spring",
  stiffness: 340,
  damping: 28,
  mass: 0.9,
};

/** Near-instant transition for prefers-reduced-motion users. */
export const INSTANT: Transition = { duration: 0.01 };

/**
 * The shared transition, respecting prefers-reduced-motion.
 * `delay` still applies (sequencing survives, movement doesn't).
 */
export function useAnim(delay = 0): Transition {
  const reduced = useReducedMotion();
  return reduced ? { ...INSTANT, delay: 0 } : { ...SPRING, delay };
}

/** Duration-based variant of useAnim for opacity-only fades. */
export function useFade(duration = 0.25, delay = 0): Transition {
  const reduced = useReducedMotion();
  return reduced ? INSTANT : { duration, delay };
}
