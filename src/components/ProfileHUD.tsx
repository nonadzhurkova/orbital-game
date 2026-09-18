"use client";
import { useEffect, useState } from "react";
import type { OrbitalDebug } from "@/render/GameCanvas";
import { useGame } from "@/game/store";
import { LEVELS } from "@/game/levels";

/** Perf overlay, toggled with the P key. Reads window.__orbitalDebug. */
export default function ProfileHUD() {
  const [show, setShow] = useState(false);
  const [d, setD] = useState<OrbitalDebug | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "p" || e.key === "P") setShow((s) => !s);
      // Quick level switch (1-5) for testing.
      const n = Number(e.key);
      if (n >= 1 && n <= LEVELS.length) useGame.getState().setLevel(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => {
      setD(window.__orbitalDebug ? { ...window.__orbitalDebug } : null);
    }, 250);
    return () => clearInterval(id);
  }, [show]);

  if (!show || !d) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-lg bg-black/70 px-3 py-1.5 font-mono text-[11px] leading-tight text-emerald-300">
      <span className={d.fps < 55 ? "text-amber-300" : ""}>
        {d.fps.toFixed(0)} fps
      </span>
      {" · "}
      {d.bodies} bodies · {d.particles} particles · {d.phase}
    </div>
  );
}
