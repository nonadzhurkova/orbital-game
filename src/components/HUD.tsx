"use client";
import { useGame, SpeedMult } from "@/game/store";
import { makeLevel, LEVELS, KMS } from "@/game/levels";
import { sound } from "@/game/sound";

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

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-4">
      {/* Top bar */}
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl bg-black/45 px-4 py-2.5 backdrop-blur-sm">
          <div className="text-sm font-bold text-white sm:text-base">
            {s.levelIndex + 1}. {level.name}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 w-28 overflow-hidden rounded-full bg-white/15 sm:w-40">
              <div
                className={`h-full rounded-full transition-all ${dvFrac > 0.35 ? "bg-emerald-400" : dvFrac > 0.15 ? "bg-amber-400" : "bg-red-400"}`}
                style={{ width: `${dvFrac * 100}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-white/90">
              Δv {(s.deltaVRemaining * KMS).toFixed(1)} km/s
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
            {s.soundOn ? "🔊" : "🔇"}
          </button>
        </div>
      </div>

      {/* Bottom: hints above the control bar so they never cover the probe */}
      <div className="flex flex-col gap-2">
        <div className="flex justify-center">
          {s.phase === "aiming" && (
            <div className="rounded-xl bg-black/45 px-4 py-2 text-center text-xs text-white/85 backdrop-blur-sm sm:text-sm">
              <span className="font-semibold">{level.subtitle}</span>
              <br />
              Drag from the probe to aim — drag length sets Δv.
            </div>
          )}
          {s.phase === "flying" && s.paused && s.burnsLeft > 0 && (
            <div className="rounded-xl bg-amber-400/20 px-4 py-2 text-center text-xs text-amber-100 backdrop-blur-sm sm:text-sm">
              Paused — drag from the probe for your one mid-course burn.
            </div>
          )}
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
          <button className={btn} onClick={s.togglePause}>
            {s.paused ? "▶" : "⏸"}
          </button>
        </div>
        <div className="flex gap-1.5">
          <button className={btn} onClick={s.refollow} aria-label="Recenter on probe">
            ⌖
          </button>
          <button className={btn} onClick={s.retry}>
            ↺ Retry
          </button>
        </div>
        </div>
      </div>

      {/* Win / lose overlays */}
      {(s.phase === "won" || s.phase === "lost") && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/55">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-slate-900/95 p-6 text-center shadow-2xl ring-1 ring-white/10">
            {s.phase === "won" ? (
              <>
                <div className="text-3xl">
                  {["", "⭐", "⭐⭐", "⭐⭐⭐"][s.stars]}
                </div>
                <h2 className="mt-2 text-xl font-bold text-white">Stable orbit!</h2>
                <p className="mt-1 text-sm text-white/70">
                  Used {((s.budget - s.deltaVRemaining) * KMS).toFixed(1)} km/s · par{" "}
                  {(level.par * KMS).toFixed(1)} km/s
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <button className={btn} onClick={s.retry}>
                    ↺ Retry
                  </button>
                  {s.levelIndex < LEVELS.length - 1 ? (
                    <button className={`${btn} !bg-emerald-500/60`} onClick={s.nextLevel}>
                      Next level →
                    </button>
                  ) : (
                    <span className="self-center text-sm text-emerald-300">
                      All levels complete!
                    </span>
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
            {/* Level picker */}
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
          </div>
        </div>
      )}
    </div>
  );
}
