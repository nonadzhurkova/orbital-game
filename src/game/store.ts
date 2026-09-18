"use client";
import { create } from "zustand";
import { LEVELS } from "./levels";
import type { Phase } from "./engine";

export type SpeedMult = 1 | 10 | 100;

interface GameState {
  levelIndex: number;
  /** Bumped to tell the canvas to rebuild the engine (retry). */
  resetNonce: number;
  speed: SpeedMult;
  paused: boolean;
  soundOn: boolean;
  /** True while the player is dragging a burn aim on a paused, flying probe. */
  // -- mirrored from the engine by the render loop --
  phase: Phase;
  deltaVRemaining: number;
  budget: number;
  time: number;
  burnsLeft: number;
  winProgress: number;
  stars: number;
  lostReason: string | null;
  /** UI request: camera should re-follow the probe. */
  followNonce: number;

  setLevel: (i: number) => void;
  nextLevel: () => void;
  retry: () => void;
  setSpeed: (s: SpeedMult) => void;
  togglePause: () => void;
  setPaused: (p: boolean) => void;
  toggleSound: () => void;
  refollow: () => void;
  /** Called by the render loop to mirror engine state into React. */
  syncFromEngine: (s: Partial<GameState>) => void;
}

export const useGame = create<GameState>((set, get) => ({
  levelIndex: 0,
  resetNonce: 0,
  speed: 1,
  paused: false,
  soundOn: false,
  phase: "aiming",
  deltaVRemaining: 0,
  budget: 0,
  time: 0,
  burnsLeft: 1,
  winProgress: 0,
  stars: 0,
  lostReason: null,
  followNonce: 0,

  setLevel: (i) =>
    set((s) => ({
      levelIndex: Math.max(0, Math.min(LEVELS.length - 1, i)),
      resetNonce: s.resetNonce + 1,
      paused: false,
      speed: 1,
    })),
  nextLevel: () => {
    const { levelIndex, setLevel } = get();
    if (levelIndex < LEVELS.length - 1) setLevel(levelIndex + 1);
  },
  retry: () =>
    set((s) => ({ resetNonce: s.resetNonce + 1, paused: false, speed: 1 })),
  setSpeed: (speed) => set({ speed }),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  setPaused: (paused) => set({ paused }),
  toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
  refollow: () => set((s) => ({ followNonce: s.followNonce + 1 })),
  syncFromEngine: (s) => set(s),
}));
