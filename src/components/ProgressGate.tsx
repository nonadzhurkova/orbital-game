"use client";
import { useEffect, useState } from "react";
import { useGame } from "@/game/store";
import { useProgress } from "@/game/progress";

/**
 * Restores the last-played level from localStorage before the game mounts,
 * so a reload resumes where the player left off instead of flashing level 1.
 * Renders nothing itself — gates `children` until restore completes (or a
 * short timeout, in case persistence is unavailable).
 */
export default function ProgressGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const apply = () => {
      const saved = useProgress.getState().lastLevelIndex;
      if (saved > 0) {
        // Direct set: skip setLevel's resetNonce bump (nothing has mounted
        // yet, so there's no engine to reset).
        useGame.setState({ levelIndex: saved });
      }
      setReady(true);
    };
    if (useProgress.persist.hasHydrated()) {
      apply();
    } else {
      const unsub = useProgress.persist.onFinishHydration(apply);
      const fallback = setTimeout(apply, 300);
      return () => {
        unsub();
        clearTimeout(fallback);
      };
    }
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
