/*
 * The Fonnus icon: inline SVG on the 24 grid, after
 * ../Fonnus-Web-UI/src/design-system/{Icon.tsx,icons.ts} @ 302e3e8.
 * The rule it carries: a glyph has exactly one terracotta part, and that part
 * is painted from `--icon-accent`, not from a hex — a surface that is itself
 * terracotta sets `--icon-accent: currentColor` and the glyph collapses to one
 * colour instead of losing its accent into the ground.
 * Only the two glyphs the sidebar uses are copied (ADR 0003 point 7).
 */

/** A stroked path on the 24 grid. `w` overrides the stroke width. */
interface PathPrim {
  d: string;
  accent?: boolean;
  w?: number;
}

/** The handset body shared by the call icons; heavier so it reads at 16px. */
const HANDSET: PathPrim = { d: 'M6 7.5A13 13 0 0 0 16.5 18', w: 3 };

export type IconName = 'answered' | 'report' | 'play' | 'pause';

const ICONS: Record<IconName, readonly PathPrim[]> = {
  /** Nghe máy — handset with the rising arc of a voice. */
  answered: [HANDSET, { d: 'M13 9A4.5 4.5 0 0 1 22 9', accent: true }],
  /** Báo cáo — three bars, the tallest one carrying the accent. */
  report: [
    { d: 'M5.5 19V13.4M18.5 19V10.4', w: 2.6 },
    { d: 'M12 19V6.6', accent: true, w: 2.6 },
  ],
  /*
   * Player controls, copied unchanged from the Web-UI's icons.ts. Both are
   * exceptions the source already makes to the one-accent rule: they carry NO
   * accent part, because a transport control is read as a whole shape and a
   * terracotta half would read as two glyphs at 16px.
   */
  play: [
    { d: 'M8.4 5.8v12.4a1 1 0 0 0 1.5.9l10-6.2a1 1 0 0 0 0-1.8l-10-6.2a1 1 0 0 0-1.5.9z', w: 2.2 },
  ],
  pause: [{ d: 'M8.6 6v12M15.4 6v12', w: 2.6 }],
};

/** Stroke compensates for size so the shape never changes, only the line. */
function baseStroke(size: number): number {
  if (size <= 16) return 2.2;
  if (size >= 32) return 1.8;
  return 2;
}

export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const base = baseStroke(size);
  const scale = base / 2;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={base}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block shrink-0"
    >
      {ICONS[name].map((prim, index) => (
        <path
          key={index}
          d={prim.d}
          stroke={prim.accent === true ? 'var(--icon-accent, currentColor)' : 'currentColor'}
          strokeWidth={prim.w === undefined ? undefined : prim.w * scale}
        />
      ))}
    </svg>
  );
}
