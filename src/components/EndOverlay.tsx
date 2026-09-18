"use client";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useGame } from "@/game/store";
import { makeLevel, LEVELS, KMS } from "@/game/levels";
import { SPRING, INSTANT, useFade } from "@/ui/motion";
import TweenNumber from "@/ui/TweenNumber";

const btn =
  "pointer-events-auto rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white active:bg-white/25 hover:bg-white/20 transition-colors";

function Stars({ count }: { count: number }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex justify-center gap-1 text-4xl">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={reduced ? INSTANT : { ...SPRING, delay: 0.25 + i * 0.18 }}
          className={i < count ? "" : "opacity-20 grayscale"}
        >
          ⭐
        </motion.span>
      ))}
    </div>
  );
}

export default function EndOverlay() {
  const s = useGame();
  const reduced = useReducedMotion();
  const fade = useFade(0.3);
  const level = makeLevel(s.levelIndex);
  const open = s.phase === "won" || s.phase === "lost";
  const won = s.phase === "won";
  const usedDv = s.budget - s.deltaVRemaining;

  const pop = (delay: number) =>
    reduced ? INSTANT : { ...SPRING, delay };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key={`end-${s.levelIndex}-${s.resetNonce}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
          className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/55"
        >
          {/* Lose: red vignette pulse behind the card */}
          {!won && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: reduced ? 0.35 : [0, 0.8, 0.35] }}
              transition={reduced ? INSTANT : { duration: 0.9, times: [0, 0.3, 1] }}
              className="pointer-events-none absolute inset-0"
              style={{ boxShadow: "inset 0 0 140px 50px rgba(220, 50, 40, 0.55)" }}
            />
          )}
          <motion.div
            initial={{ y: reduced ? 0 : 46, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={pop(won ? 0.05 : 0.35)}
            className="relative mx-4 w-full max-w-sm rounded-2xl bg-slate-900/95 p-6 text-center shadow-2xl ring-1 ring-white/10"
          >
            {won ? (
              <>
                <Stars count={s.stars} />
                <motion.h2
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={reduced ? INSTANT : { delay: 0.15 }}
                  className="mt-2 text-xl font-bold text-white"
                >
                  Stable orbit!
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={reduced ? INSTANT : { delay: 0.7 }}
                  className="mt-1 text-sm tabular-nums text-white/70"
                >
                  Used{" "}
                  <TweenNumber
                    value={usedDv * KMS}
                    format={(v) => v.toFixed(1)}
                    duration={reduced ? 0 : 0.9}
                  />{" "}
                  km/s · par {(level.par * KMS).toFixed(1)} km/s
                </motion.p>
                <div className="mt-4 flex justify-center gap-2">
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={reduced ? INSTANT : { delay: 0.9 }}
                    className={btn}
                    onClick={s.retry}
                  >
                    ↺ Retry
                  </motion.button>
                  {s.levelIndex < LEVELS.length - 1 ? (
                    <motion.button
                      initial={{ x: reduced ? 0 : 60, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={pop(1.15)}
                      className={`${btn} !bg-emerald-500/60`}
                      onClick={s.nextLevel}
                    >
                      Next level →
                    </motion.button>
                  ) : (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={reduced ? INSTANT : { delay: 1.15 }}
                      className="self-center text-sm text-emerald-300"
                    >
                      All levels complete!
                    </motion.span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="text-3xl">💥</div>
                <h2 className="mt-2 text-xl font-bold text-white">
                  {s.lostReason ?? "Mission failed"}
                </h2>
                <div className="mt-4 flex justify-center gap-2">
                  <button className={`${btn} !bg-sky-500/60`} onClick={s.retry}>
                    ↺ Try again
                  </button>
                </div>
              </>
            )}
            <div className="mt-5 flex justify-center gap-1.5">
              {LEVELS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => s.setLevel(i)}
                  className={`h-8 w-8 rounded-full text-xs font-bold transition-colors ${
                    i === s.levelIndex
                      ? "bg-sky-500 text-white"
                      : "bg-white/10 text-white/70 hover:bg-white/20"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
