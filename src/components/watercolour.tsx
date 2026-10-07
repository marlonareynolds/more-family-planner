import { useId, type CSSProperties } from "react";

/**
 * French watercolour, for the date night concierge only: pigment washes with
 * soft, bleeding edges and paper granulation, and pen lines over them. Every
 * shape is drawn from a seed so the same page always paints the same way.
 */

export const PIGMENT = {
  rose: "#c4566b",
  ultramarine: "#3d5a9e",
  sap: "#6f8f4e",
  ochre: "#d4a03c",
  sienna: "#b0603a",
  lavender: "#8c7bb8",
} as const;
export type Pigment = keyof typeof PIGMENT;

export const PAPER = "#fbf6ea";
export const SEPIA = "#3a2d27";
/** Sienna dark enough to read as text on the paper. */
export const SIENNA_INK = "#8a4224";

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (s % 10_000) / 10_000;
  };
}

/** A closed, irregular blob around (100, 100), as a smooth path. */
function blob(seed: number, radius = 70, wobble = 0.22, points = 9): string {
  const r = rand(seed);
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2 + r() * 0.3;
    const d = radius * (1 - wobble / 2 + r() * wobble);
    return [100 + Math.cos(a) * d, 100 + Math.sin(a) * d * (0.78 + r() * 0.2)];
  });
  // Catmull-Rom through every point, as cubic Béziers.
  let path = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < points; i++) {
    const [p0, p1, p2, p3] = [pts[(i - 1 + points) % points], pts[i], pts[(i + 1) % points], pts[(i + 2) % points]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    path += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${path}Z`;
}

/** One wash of pigment: a pale body, a darker drying edge, a second bloom. */
export function Wash({ pigment = "rose", seed = 1, className, style, strength = 1 }: { pigment?: Pigment; seed?: number; className?: string; style?: CSSProperties; strength?: number }) {
  const id = useId().replace(/:/g, "");
  const color = PIGMENT[pigment];
  return (
    <svg aria-hidden viewBox="0 0 200 200" className={className} style={{ pointerEvents: "none", ...style }}>
      <defs>
        <filter id={`wc${id}`} x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed={seed} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="18" xChannelSelector="R" yChannelSelector="G" result="shape" />
          <feGaussianBlur in="shape" stdDeviation="0.6" result="soft" />
          <feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="3" seed={seed + 7} result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.7 1.15" result="granulation" />
          <feComposite in="soft" in2="granulation" operator="in" />
        </filter>
      </defs>
      <g filter={`url(#wc${id})`} style={{ mixBlendMode: "multiply" }}>
        <path d={blob(seed)} fill={color} fillOpacity={0.3 * strength} stroke={color} strokeOpacity={0.45 * strength} strokeWidth={2.2} />
        <path d={blob(seed * 3 + 11, 44, 0.35, 7)} fill={color} fillOpacity={0.2 * strength} transform="translate(14 -8)" />
      </g>
    </svg>
  );
}

/** A dry-brush stroke, for dividing the courses. */
export function BrushStroke({ pigment = "sap", seed = 4, className }: { pigment?: Pigment; seed?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const color = PIGMENT[pigment];
  return (
    <svg aria-hidden viewBox="0 0 300 24" className={className} preserveAspectRatio="none">
      <defs>
        <filter id={`bs${id}`} x="-5%" y="-50%" width="110%" height="200%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04 0.4" numOctaves="2" seed={seed} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="6" />
        </filter>
      </defs>
      <path d="M6 13 C70 6 140 18 210 10 S290 12 294 11 L292 15 C230 19 150 13 90 17 S20 16 8 16 Z" fill={color} fillOpacity={0.45} filter={`url(#bs${id})`} style={{ mixBlendMode: "multiply" }} />
    </svg>
  );
}

/** Pen and wash: an olive sprig, the menu's flourish. */
export function Sprig({ className, flip = false }: { className?: string; flip?: boolean }) {
  const leaves = [
    [30, 22, -35], [48, 15, -20], [64, 20, 25], [80, 12, -15], [96, 18, 30], [112, 11, -10],
  ];
  return (
    <svg aria-hidden viewBox="0 0 130 34" className={className} style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M4 24 C30 22 60 18 124 14" fill="none" stroke={SEPIA} strokeWidth="1.1" strokeLinecap="round" />
      {leaves.map(([x, y, a], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${a})`}>
          <ellipse cx="0" cy={i % 2 ? 5 : -5} rx="8" ry="3.2" fill={PIGMENT.sap} fillOpacity="0.35" />
          <ellipse cx="0.8" cy={i % 2 ? 5.6 : -5.6} rx="8" ry="3.2" fill="none" stroke={SEPIA} strokeWidth="0.8" />
        </g>
      ))}
      <circle cx="122" cy="10" r="3" fill={PIGMENT.ultramarine} fillOpacity="0.5" />
      <circle cx="122.6" cy="10.4" r="3" fill="none" stroke={SEPIA} strokeWidth="0.7" />
    </svg>
  );
}

/** Pen and wash: two glasses meeting, for the top of the invitation. */
export function Glasses({ className }: { className?: string }) {
  const glass = "M0 0 C0 18 4 26 12 27 C20 26 24 18 24 0 Z";
  return (
    <svg aria-hidden viewBox="0 0 90 70" className={className}>
      <g transform="translate(18 8) rotate(-14 12 30)">
        <path d="M2 8 C2 18 5 25 12 26 C19 25 22 18 22 8 Z" fill={PIGMENT.rose} fillOpacity="0.45" />
        <path d={glass} fill="none" stroke={SEPIA} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M12 27 L12 50 M4 51 C8 49.5 16 49.5 20 51" fill="none" stroke={SEPIA} strokeWidth="1.2" strokeLinecap="round" />
      </g>
      <g transform="translate(46 8) rotate(14 12 30)">
        <path d="M2 10 C2 18 5 25 12 26 C19 25 22 18 22 10 Z" fill={PIGMENT.ochre} fillOpacity="0.45" />
        <path d={glass} fill="none" stroke={SEPIA} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M12 27 L12 50 M4 51 C8 49.5 16 49.5 20 51" fill="none" stroke={SEPIA} strokeWidth="1.2" strokeLinecap="round" />
      </g>
      <path d="M43 6 L45 1 M47 7 L51 3 M39 7 L36 3" stroke={SEPIA} strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}
