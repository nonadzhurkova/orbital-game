"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { useGame, SpeedMult } from "@/game/store";
import { makeLevel, KMS } from "@/game/levels";
import { sound } from "@/game/sound";
import { useAnim } from "@/ui/motion";
import TweenNumber from "@/ui/TweenNumber";
import IntroCard from "./IntroCard";
import EndOverlay from "./EndOverlay";
import HelpOverlay from "./HelpOverlay";
import LevelSelect from "./LevelSelect";
import FlightLog from "./FlightLog";
import Telemetry from "./Telemetry";
import {
  IconPlay,
  IconPause,
  IconRetry,
  IconCrosshair,
  IconSoundOn,
  IconSoundOff,
  IconHelp,
  IconOrbit,
  IconRocket,
  IconX,
  IconGrid,
} from "@/ui/icons";

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const btn =
  "pointer-events-auto rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white backdrop-blur-sm active:bg-white/25 hover:bg-white/20 transition-colors";

export default function HUD() {
  const s = useGame();
  const level = makeLevel(s.levelIndex);
  const dvFrac = s.budget > 0 ? s.deltaVRemaining / s.budget : 0;
  const slideDown = useAnim();
  const slideUp = useAnim(0.1);
  const commitPop = useAnim();
  const [helpOpen, setHelpOpen] = useState(false);
  const [levelSelectOpen, setLevelSelectOpen] = useState(false);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-4">
      <div className="flex flex-col gap-2">
        {/* Flight log: persistent record of every maneuver, always at the top */}
        <div className="flex justify-center">
          <FlightLog />
        </div>

        {/* Top bar */}
        <motion.div
          initial={{ y: -56, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={slideDown}
          className="flex items-start justify-between gap-3"
        >
          <div className="rounded-xl bg-black/45 px-4 py-2.5 backdrop-blur-sm">
            <button
              className="pointer-events-auto flex items-center gap-1.5 text-sm font-bold text-white hover:text-sky-300 sm:text-base"
              onClick={() => {
                setLevelSelectOpen(true);
                s.setPaused(true);
              }}
              aria-label="Change level"
            >
              {s.levelIndex + 1}. {level.name}
              <IconGrid size={13} className="text-white/40" />
            </button>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2 w-28 overflow-hidden rounded-full bg-white/15 sm:w-40">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${dvFrac > 0.35 ? "bg-emerald-400" : dvFrac > 0.15 ? "bg-amber-400" : "bg-red-400"}`}
                  style={{ width: `${dvFrac * 100}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-white/90">
                Δv{" "}
                <TweenNumber
                  value={s.deltaVRemaining * KMS}
                  format={(v) => v.toFixed(1)}
                />{" "}
                km/s
              </span>
            </div>
            {s.winProgress > 0 && s.phase === "flying" && (
              <div className="mt-1 text-xs text-emerald-300">
                Orbit {Math.round(s.winProgress * 100)}%
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-xl bg-black/45 px-3 py-2 text-sm tabular-nums text-white backdrop-blur-sm">
              {fmtTime(s.time)}
            </div>
            <button
              className={btn}
              onClick={() => {
                sound.setEnabled(!s.soundOn);
                s.toggleSound();
              }}
              aria-label="Toggle sound"
            >
              {s.soundOn ? <IconSoundOn /> : <IconSoundOff />}
            </button>
            <button
              className={btn}
              onClick={() => {
                setHelpOpen(true);
                s.setPaused(true);
              }}
              aria-label="How to play"
            >
              <IconHelp />
            </button>
          </div>
        </motion.div>

        {/* Telemetry: live orbital metrics, below the top bar */}
        <div className="pointer-events-none flex">
          <Telemetry />
        </div>
      </div>

      {/* Bottom: hints above the control bar so they never cover the probe */}
      <motion.div
        initial={{ y: 56, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={slideUp}
        className="flex flex-col gap-2"
      >
        <div className="flex justify-center">
          {s.aimReady ? (
            <div className="pointer-events-auto flex items-center gap-2">
              <motion.button
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={commitPop}
                className="flex items-center gap-2 rounded-xl bg-emerald-500/80 px-6 py-3 text-base font-bold text-white shadow-lg backdrop-blur-sm hover:bg-emerald-400/80 active:bg-emerald-300/80"
                onClick={s.commitAim}
              >
                <IconRocket size={20} /> {s.aimIsBurn ? "Burn" : "Launch"}
              </motion.button>
              <button
                className={btn}
                onClick={s.clearAim}
                aria-label="Cancel aim"
              >
                <IconX />
              </button>
              <span className="hidden text-xs text-white/50 sm:block">
                Enter to go · arrows fine-tune · Esc cancels
              </span>
            </div>
          ) : s.autoPilot && s.autoStatus ? (
            <div className="flex items-center gap-1.5 rounded-xl bg-purple-400/20 px-4 py-2 text-center text-xs text-purple-100 backdrop-blur-sm sm:text-sm">
              <IconOrbit /> Autopilot: {s.autoStatus}
            </div>
          ) : s.phase === "flying" && s.paused && s.burnsLeft > 0 ? (
            <div className="rounded-xl bg-amber-400/20 px-4 py-2 text-center text-xs text-amber-100 backdrop-blur-sm sm:text-sm">
              Paused — drag from the probe to set your one mid-course burn.
            </div>
          ) : null}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex gap-1.5">
            {([1, 10, 100] as SpeedMult[]).map((sp) => (
              <button
                key={sp}
                className={`${btn} ${s.speed === sp ? "!bg-sky-500/60" : ""}`}
                onClick={() => s.setSpeed(sp)}
              >
                {sp}x
              </button>
            ))}
            <button
              className={btn}
              onClick={s.togglePause}
              aria-label={s.paused ? "Resume" : "Pause"}
            >
              {s.paused ? <IconPlay /> : <IconPause />}
            </button>
            <button
              className={`${btn} ${s.autoPilot ? "!bg-purple-500/60" : ""}`}
              onClick={s.toggleAutoPilot}
              aria-label="Toggle autopilot"
              title="Autopilot: watch the computer solve the level"
            >
              <IconOrbit />
            </button>
          </div>
          <div className="flex gap-1.5">
            <button className={btn} onClick={s.refollow} aria-label="Recenter on probe">
              <IconCrosshair />
            </button>
            <button className={`${btn} flex items-center gap-1.5`} onClick={s.retry}>
              <IconRetry /> Retry
            </button>
          </div>
        </div>
      </motion.div>

      <IntroCard />
      <EndOverlay />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <LevelSelect open={levelSelectOpen} onClose={() => setLevelSelectOpen(false)} />
    </div>
  );
}
