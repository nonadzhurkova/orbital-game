"use client";
import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useTransform, useReducedMotion } from "motion/react";

/**
 * Renders a number that tweens smoothly to each new value instead of jumping.
 * Updates go through a motion value, so no React re-renders per frame.
 */
export default function TweenNumber({
  value,
  format,
  duration = 0.5,
}: {
  value: number;
  format: (v: number) => string;
  duration?: number;
}) {
  const mv = useMotionValue(value);
  const reduced = useReducedMotion();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, reduced ? { duration: 0 } : { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [value, mv, reduced, duration]);
  const text = useTransform(mv, format);
  return <motion.span>{text}</motion.span>;
}
