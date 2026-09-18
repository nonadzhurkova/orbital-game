import type { SVGProps } from "react";

/**
 * Hand-drawn stroke icons (24x24 grid, currentColor) so the HUD reads as one
 * crisp system instead of mixed emoji.
 */
function Base({
  size = 16,
  children,
  filled = false,
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement> & { size?: number };

export const IconPlay = (p: P) => (
  <Base {...p} filled>
    <path d="M7 4.8a1 1 0 0 1 1.5-.86l11 6.2a1 1 0 0 1 0 1.74l-11 6.2A1 1 0 0 1 7 17.2Z" />
  </Base>
);

export const IconPause = (p: P) => (
  <Base {...p} filled>
    <rect x={6} y={4} width={4} height={16} rx={1.2} />
    <rect x={14} y={4} width={4} height={16} rx={1.2} />
  </Base>
);

export const IconRetry = (p: P) => (
  <Base {...p}>
    <path d="M3 12a9 9 0 1 0 2.6-6.3" />
    <path d="M5.5 2.5v3.5H9" />
  </Base>
);

export const IconCrosshair = (p: P) => (
  <Base {...p}>
    <circle cx={12} cy={12} r={6.5} />
    <path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" />
    <circle cx={12} cy={12} r={0.5} fill="currentColor" stroke="none" />
  </Base>
);

export const IconSoundOn = (p: P) => (
  <Base {...p}>
    <path d="M11 5.5 6.8 9H3.5v6h3.3L11 18.5Z" />
    <path d="M15 9a4.2 4.2 0 0 1 0 6" />
    <path d="M17.7 6.3a8 8 0 0 1 0 11.4" />
  </Base>
);

export const IconSoundOff = (p: P) => (
  <Base {...p}>
    <path d="M11 5.5 6.8 9H3.5v6h3.3L11 18.5Z" />
    <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
  </Base>
);

export const IconHelp = (p: P) => (
  <Base {...p}>
    <circle cx={12} cy={12} r={9} />
    <path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.2-2.8 4" />
    <circle cx={12} cy={17.3} r={0.6} fill="currentColor" stroke="none" />
  </Base>
);

/** Autopilot: a small body with an orbiting satellite. */
export const IconOrbit = (p: P) => (
  <Base {...p}>
    <circle cx={12} cy={12} r={3.2} />
    <path d="M19.3 8.1c1.6 1 2.4 2.1 2.1 3.1-.6 1.9-5.2 2.4-10.3 1S2.1 8.3 2.7 6.4c.3-1 1.6-1.5 3.5-1.5" />
    <circle cx={19} cy={16.5} r={1.6} fill="currentColor" stroke="none" />
  </Base>
);

export const IconRocket = (p: P) => (
  <Base {...p}>
    <path d="M12 2.5c2.8 2.3 4.2 5.6 4.2 9l-1.7 4H9.5l-1.7-4c0-3.4 1.4-6.7 4.2-9Z" />
    <circle cx={12} cy={9.5} r={1.6} />
    <path d="M8.2 13.5 5.5 16l2.5 1M15.8 13.5 18.5 16 16 17" />
    <path d="M12 18v3.5" />
  </Base>
);

export const IconX = (p: P) => (
  <Base {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Base>
);

export const IconStar = (p: P & { dim?: boolean }) => {
  const { dim, ...rest } = p;
  return (
    <Base {...rest} filled>
      <path
        d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95Z"
        opacity={dim ? 0.18 : 1}
      />
    </Base>
  );
};

/** Impact burst for the lose screen. */
export const IconBurst = (p: P) => (
  <Base {...p}>
    <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M18 6l-2.1 2.1M6 18l2.1-2.1M18 18l-2.1-2.1" />
    <circle cx={12} cy={12} r={3.4} />
  </Base>
);
