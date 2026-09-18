"use client";
import { useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { SPRING, INSTANT, useFade } from "@/ui/motion";
import { IconX, IconOrbit, IconCrosshair, IconStar } from "@/ui/icons";

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-[11px] text-white/90">
      {children}
    </kbd>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-sky-400">{title}</h3>
      <div className="mt-1.5 space-y-1.5 text-sm leading-snug text-white/80">{children}</div>
    </div>
  );
}

export default function HelpOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const fade = useFade(0.2);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
              <h2 className="text-lg font-bold text-white">How to play</h2>
              <button
                onClick={onClose}
                aria-label="Close help"
                className="rounded-lg bg-white/10 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
              >
                <IconX />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <Section title="Goal">
                <p>
                  Launch your probe and settle into a <b>stable orbit</b> around the
                  target planet: complete one full loop that stays above the surface
                  and inside the green dashed ring (5 planet radii). Use as little
                  Δv as you can — crash or drift past the red map edge and you lose.
                </p>
              </Section>

              <Section title="Aim & launch">
                <p>
                  <b>Drag from the probe</b>: direction = launch direction, length =
                  Δv. Releasing <i>sets</i> the aim — nothing flies yet.
                </p>
                <p>
                  Adjust by dragging the arrow tip, or with <Key>←</Key>
                  <Key>→</Key> (rotate) and <Key>↑</Key>
                  <Key>↓</Key> (power); hold <Key>Shift</Key> for fine steps. Commit
                  with the <b>Launch</b> button or <Key>Enter</Key>; cancel with{" "}
                  <Key>Esc</Key> or right-click.
                </p>
              </Section>

              <Section title="Mid-course burn">
                <p>
                  Once per level, while flying: <b>pause</b>, then drag from the
                  probe to set a correction burn — same controls, same commit. Most
                  levels expect you to capture into orbit with it.
                </p>
              </Section>

              <Section title="Reading the map">
                <ul className="space-y-1.5">
                  <li className="flex gap-2">
                    <Dot className="bg-white/80" />
                    <span>White dashed line — predicted path for the next 60 s (red + ✕ = predicted crash).</span>
                  </li>
                  <li className="flex gap-2">
                    <Dot className="bg-sky-300" />
                    <span>Glowing line — your recent flight; the dim blue line is the whole attempt&apos;s path.</span>
                  </li>
                  <li className="flex gap-2">
                    <Dot className="bg-emerald-400" />
                    <span>Green dashed ring — the capture zone your final orbit must fit inside.</span>
                  </li>
                  <li className="flex gap-2">
                    <Dot className="bg-red-400" />
                    <span>Red dashed circle — the map edge. Crossing it loses the probe.</span>
                  </li>
                  <li className="flex gap-2">
                    <Dot className="bg-emerald-300" />
                    <span>Edge chevrons point to the target and probe when they&apos;re off-screen.</span>
                  </li>
                  <li className="flex gap-2">
                    <Dot className="bg-amber-300" />
                    <span>&quot;+x km/s&quot; flashes — a gravity slingshot changed your speed. Fly behind a moving planet to gain.</span>
                  </li>
                </ul>
              </Section>

              <Section title="Telemetry & log">
                <p>
                  The panel on the left shows live numbers once you&apos;re
                  flying: speed, speed relative to the target, distance, and
                  your instantaneous orbit — periapsis (lowest point),
                  apoapsis (highest point), eccentricity (0 = circle), and
                  whether you&apos;re gravitationally bound or escaping.
                </p>
                <p>
                  The bar at the very top is the <b>flight log</b> — every
                  launch, burn, and slingshot for this attempt, from you or
                  the autopilot, with the numbers behind each one. Tap it to
                  expand and scroll back through the whole attempt.
                </p>
              </Section>

              <Section title="Time & camera">
                <p>
                  <b>1x / 10x / 100x</b> speed and pause. Drag empty space to pan,
                  wheel or pinch to zoom, and the{" "}
                  <span className="inline-flex translate-y-0.5 text-white">
                    <IconCrosshair size={14} />
                  </span>{" "}
                  button re-centers on the probe.
                </p>
              </Section>

              <Section title="Autopilot">
                <p>
                  Stuck? Press{" "}
                  <span className="inline-flex translate-y-0.5 text-white">
                    <IconOrbit size={14} />
                  </span>{" "}
                  and watch the computer solve the level: it simulates candidate
                  launches, waits for a transfer window on moving levels, then
                  flies and circularizes with the mid-course burn. Press again to
                  take back control.
                </p>
              </Section>

              <Section title="Scoring">
                <p className="flex flex-wrap items-center gap-x-1">
                  Finish at or under <b>par</b> Δv for
                  <span className="inline-flex text-amber-400">
                    <IconStar size={13} />
                    <IconStar size={13} />
                    <IconStar size={13} />
                  </span>
                  , within 1.4× par for
                  <span className="inline-flex text-amber-400">
                    <IconStar size={13} />
                    <IconStar size={13} />
                  </span>
                  . The budget bar at the top is all the Δv you have.
                </p>
              </Section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
