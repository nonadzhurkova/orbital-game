"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useGame } from "@/game/store";
import { makeLevel, KMS } from "@/game/levels";
import { useAnim } from "@/ui/motion";

/** Slide-up card shown at the start of each level; dismisses on tap. */
export default function IntroCard() {
  const levelIndex = useGame((s) => s.levelIndex);
  const phase = useGame((s) => s.phase);
  const [dismissed, setDismissed] = useState(false);
  const anim = useAnim();

  useEffect(() => {
    setDismissed(false);
  }, [levelIndex]);

  const level = makeLevel(levelIndex);
  const show = !dismissed && phase === "aiming";

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          key={`intro-${levelIndex}`}
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={anim}
          onClick={() => setDismissed(true)}
          className="pointer-events-auto absolute bottom-24 left-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 cursor-pointer rounded-2xl bg-slate-900/90 p-5 text-left shadow-2xl ring-1 ring-white/10 backdrop-blur-sm"
        >
          <div className="text-xs font-semibold uppercase tracking-widest text-sky-400">
            Level {levelIndex + 1}
          </div>
          <div className="mt-0.5 text-xl font-bold text-white">{level.name}</div>
          <p className="mt-1.5 text-sm leading-snug text-white/70">{level.subtitle}</p>
          <div className="mt-3 flex gap-4 text-sm">
            <span className="text-white/85">
              <span className="text-white/50">Budget</span>{" "}
              <b className="tabular-nums">{(level.budget * KMS).toFixed(1)} km/s</b>
            </span>
            <span className="text-white/85">
              <span className="text-white/50">Par</span>{" "}
              <b className="tabular-nums">{(level.par * KMS).toFixed(1)} km/s</b>
            </span>
          </div>
          <div className="mt-3 text-center text-xs text-white/40">tap to dismiss</div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
