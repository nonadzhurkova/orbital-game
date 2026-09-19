"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LEVELS } from "./levels";

interface ProgressState {
  /** Last level index the player was on; restored on reload. */
  lastLevelIndex: number;
  /** Best stars (1-3) earned per level index; absent = never won. */
  bestStars: Record<number, number>;
  setLastLevel: (i: number) => void;
  recordWin: (levelIndex: number, stars: number) => void;
}

/** Highest level index the player has unlocked (won the one before it, or level 0). */
export function unlockedThrough(bestStars: Record<number, number>): number {
  let i = 0;
  while (i < LEVELS.length - 1 && bestStars[i] > 0) i++;
  return i;
}

export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      lastLevelIndex: 0,
      bestStars: {},
      setLastLevel: (i) => set({ lastLevelIndex: i }),
      recordWin: (levelIndex, stars) =>
        set((s) => ({
          bestStars: {
            ...s.bestStars,
            [levelIndex]: Math.max(s.bestStars[levelIndex] ?? 0, stars),
          },
        })),
    }),
    { name: "orbital-golf-progress" },
  ),
);
