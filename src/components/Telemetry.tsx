"use client";
import { motion } from "motion/react";
import { useGame } from "@/game/store";
import { KMS } from "@/game/levels";
import { useAnim } from "@/ui/motion";
import TweenNumber from "@/ui/TweenNumber";

const row = "flex items-baseline justify-between gap-2 tabular-nums whitespace-nowrap";
const label = "text-[9px] uppercase tracking-wider text-white/40 sm:text-[10px] sm:text-white/45";
const value = "text-[11px] font-semibold text-white/80 sm:text-xs sm:text-white/90";

export default function Telemetry() {
  const t = useGame((s) => s.telemetry);
  const phase = useGame((s) => s.phase);
  const anim = useAnim(0.15);
  if (!t || phase === "aiming") return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={anim}
      className="pointer-events-none w-36 rounded-xl bg-black/25 px-2.5 py-2 backdrop-blur-sm sm:w-44 sm:bg-black/45 sm:px-3 sm:py-2.5"
    >
      <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-sky-400/80 sm:mb-1.5 sm:text-[10px] sm:text-sky-400">
        Telemetry
      </div>
      <div className="space-y-0.5 sm:space-y-1">
        <div className={row}>
          <span className={label}>Speed</span>
          <span className={value}>
            <TweenNumber value={t.speed * KMS} format={(v) => v.toFixed(2)} duration={0.3} /> km/s
          </span>
        </div>
        <div className={row}>
          <span className={label}>Rel. speed</span>
          <span className={value}>
            <TweenNumber value={t.relSpeed * KMS} format={(v) => v.toFixed(2)} duration={0.3} /> km/s
          </span>
        </div>
        <div className={row}>
          <span className={label}>Target dist</span>
          <span className={value}>
            <TweenNumber value={t.targetDist / 100} format={(v) => v.toFixed(1)} duration={0.3} /> Mm
          </span>
        </div>
        <div className="my-1 h-px bg-white/5 sm:my-1.5 sm:bg-white/10" />
        <div className={row}>
          <span className={label}>Periapsis</span>
          <span className={value}>
            {t.bound ? (t.periapsis / 100).toFixed(1) : "—"} Mm
          </span>
        </div>
        <div className={row}>
          <span className={label}>Apoapsis</span>
          <span className={value}>
            {t.bound && t.apoapsis < 1e6 ? (t.apoapsis / 100).toFixed(1) : "∞"} Mm
          </span>
        </div>
        <div className={row}>
          <span className={label}>Eccentricity</span>
          <span className={value}>{t.ecc.toFixed(2)}</span>
        </div>
        <div className={row}>
          <span className={label}>Orbit</span>
          <span className={`${value} ${t.bound ? "text-emerald-300" : "text-amber-300"}`}>
            {t.bound ? "bound" : "escaping"}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
