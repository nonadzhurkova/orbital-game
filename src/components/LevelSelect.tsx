"use client";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useGame } from "@/game/store";
import { useProgress, unlockedThrough } from "@/game/progress";
import { makeLevel, LEVELS } from "@/game/levels";
import { SPRING, INSTANT, useFade } from "@/ui/motion";
import { IconX, IconLock, IconStar } from "@/ui/icons";

export default function LevelSelect({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const levelIndex = useGame((s) => s.levelIndex);
  const setLevel = useGame((s) => s.setLevel);
  const bestStars = useProgress((s) => s.bestStars);
  const reduced = useReducedMotion();
  const fade = useFade(0.2);
  const unlocked = unlockedThrough(bestStars);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
          className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: reduced ? 0 : 36, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: reduced ? 0 : 24, opacity: 0 }}
            transition={reduced ? INSTANT : SPRING}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-slate-900/95 p-5 shadow-2xl ring-1 ring-white/10"
          >
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold text-white">Levels</h2>
              <button
                onClick={onClose}
                aria-label="Close level select"
                className="rounded-lg bg-white/10 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
              >
                <IconX />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {LEVELS.map((_, i) => {
                const level = makeLevel(i);
                const stars = bestStars[i] ?? 0;
                const locked = i > unlocked;
                const current = i === levelIndex;
                return (
                  <button
                    key={i}
                    disabled={locked}
                    onClick={() => {
                      setLevel(i);
                      onClose();
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${
                      locked
                        ? "cursor-not-allowed bg-white/5 opacity-50"
                        : current
                          ? "bg-sky-500/20 ring-1 ring-sky-400/50 hover:bg-sky-500/30"
                          : "bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        current ? "bg-sky-500 text-white" : "bg-white/10 text-white/70"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">
                        {level.name}
                      </span>
                      {!locked && (
                        <span className="block truncate text-xs text-white/50">
                          {level.subtitle}
                        </span>
                      )}
                    </span>
                    {locked ? (
                      <IconLock size={16} className="shrink-0 text-white/40" />
                    ) : (
                      <span className="flex shrink-0 gap-0.5 text-amber-400">
                        {[0, 1, 2].map((j) => (
                          <IconStar key={j} size={14} dim={j >= stars} />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
