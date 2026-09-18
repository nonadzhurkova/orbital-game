"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useGame } from "@/game/store";
import { useAnim } from "@/ui/motion";

const sourceStyle: Record<string, string> = {
  you: "text-sky-300",
  auto: "text-purple-300",
  sys: "text-emerald-300",
};
const sourceLabel: Record<string, string> = { you: "YOU", auto: "AUTO", sys: "SYS" };

function fmtT(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Persistent, scrollable log of every maneuver and calculation — from the
 * player or the autopilot — for the current attempt. Stays put and grows
 * (capped) rather than fading like the transient flyby flashes on the scene.
 */
export default function FlightLog() {
  const log = useGame((s) => s.log);
  const [open, setOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anim = useAnim();

  useEffect(() => {
    if (open && autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log, open, autoScroll]);

  const latest = log[log.length - 1];

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={anim}
      className="pointer-events-auto w-full max-w-md"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl bg-black/45 px-3 py-1.5 text-left backdrop-blur-sm"
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
          Log
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-white/75">
          {latest ? (
            <>
              <span className={sourceStyle[latest.source]}>{sourceLabel[latest.source]}</span>{" "}
              {latest.text}
            </>
          ) : (
            "No maneuvers yet"
          )}
        </span>
        <span className="text-white/40">{open ? "▲" : "▼"}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={anim}
            className="overflow-hidden"
          >
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
              }}
              className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-black/45 p-2.5 backdrop-blur-sm"
            >
              {log.length === 0 && (
                <div className="text-xs text-white/40">
                  Launches, burns, slingshots, and outcomes will appear here.
                </div>
              )}
              {log.map((e) => (
                <div key={e.id} className="flex gap-2 text-xs leading-snug">
                  <span className="shrink-0 tabular-nums text-white/35">{fmtT(e.t)}</span>
                  <span className={`shrink-0 font-bold ${sourceStyle[e.source]}`}>
                    {sourceLabel[e.source]}
                  </span>
                  <span className="text-white/80">{e.text}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
