/*
 * One horizontal track carrying one span — a leg's P50→P95 range on the
 * Overview, a call's duration against the longest of its day band on the Calls
 * list (`docs/design/Main-html`, `docs/design/Calls-html`: 6 px track, pill
 * ends, the outlined variant for a leg outside the partition).
 *
 * `thick` is the capsule track of ADR 0014 decision 7, the one shape of every
 * horizontal measure since row A19: 10 px, fully rounded, on the page ground
 * inside a hairline, with a dashed `target` mark and a solid `playhead` mark
 * that stand a little proud of the track. `segments` lays several spans on one
 * track (the composition bar); `TrackRow` puts the label and the value beside
 * it.
 *
 * The rule it enforces: `from`, `to` and every mark are positions on a scale
 * the CALLER owns (`scaleMin` to `scaleMax`), so every track of a group shares
 * one scale and the bars are comparable; a span is never normalised to its own
 * row.
 * Colours come from the alias layer only (ADR 0003): `tone` is a custom
 * property such as `var(--chart-1)`, never a hex.
 */

import type { ReactNode } from 'react';
import type { Term as GlossaryTerm } from './glossary';
import Term from './term';

const TRACK_HEIGHT = 6;
const THICK_HEIGHT = 10;
/** How far a mark stands above and below a thick track, so it reads over the span. */
const MARK_PROUD = 3;

export default function HBar({
  from,
  to,
  scaleMax,
  scaleMin = 0,
  tone = 'var(--chart-1)',
  outlined = false,
  target,
  thick = false,
  playhead,
  segments,
}: {
  /** Where the span starts, in the caller's units. */
  from: number;
  /** Where it ends. A `to` at or below `from` draws a hairline, not a negative bar. */
  to: number;
  scaleMax: number;
  /** Where the scale starts; the selected turn's rows start at its earliest mark. */
  scaleMin?: number;
  tone?: string;
  /** Outlined = outside the partition: a measurement that does not tile the whole. */
  outlined?: boolean;
  /** A dashed mark on the track, in the same units — the leg's target. */
  target?: number;
  /** The capsule track (ADR 0014 decision 7). */
  thick?: boolean;
  /** A solid mark in `--action-primary`, in the same units — where the audio is. */
  playhead?: number;
  /** Several spans on one track, drawn instead of `from`–`to`. */
  segments?: readonly { from: number; to: number; tone: string }[];
}) {
  const range = scaleMax - scaleMin;
  const share = (value: number): number =>
    range <= 0 ? 0 : Math.max(0, Math.min(1, (value - scaleMin) / range)) * 100;

  const left = share(from);
  // A zero-width bar disappears; the minimum keeps an instant span visible as
  // the position it happened at.
  const width = Math.max(share(to) - left, 0.6);
  const proud = thick ? MARK_PROUD : 0;

  return (
    <div
      className="relative w-full"
      style={{ height: `${String(thick ? THICK_HEIGHT : TRACK_HEIGHT)}px` }}
    >
      <div
        className={`absolute inset-0 overflow-hidden rounded-pill ${
          thick ? 'border border-border-hairline bg-surface-page' : 'bg-[var(--action-ghost-hover)]'
        }`}
      >
        {segments === undefined ? (
          <div
            className="absolute top-0 bottom-0 rounded-pill"
            style={{
              left: `${String(left)}%`,
              width: `${String(width)}%`,
              ...(outlined
                ? { border: `1.5px solid ${tone}`, background: 'transparent' }
                : { background: tone }),
            }}
          />
        ) : (
          segments.map((segment, index) => {
            const start = share(segment.from);
            return (
              <div
                key={`${segment.tone}-${String(index)}`}
                className="absolute top-0 bottom-0"
                style={{
                  left: `${String(start)}%`,
                  width: `${String(Math.max(share(segment.to) - start, 0))}%`,
                  background: segment.tone,
                }}
              />
            );
          })
        )}
      </div>
      {target === undefined ? null : (
        <div
          className="absolute border-l border-dashed border-border-strong"
          style={{ left: `${String(share(target))}%`, top: -proud, bottom: -proud }}
          aria-hidden
        />
      )}
      {playhead === undefined ? null : (
        <div
          className="absolute w-[1.5px] -translate-x-1/2 bg-action-primary"
          style={{ left: `${String(share(playhead))}%`, top: -proud, bottom: -proud }}
          aria-hidden
        />
      )}
    </div>
  );
}

/**
 * One row of capsule tracks: the label as a `Term` (name over pipeline term),
 * the track, and the value right-aligned in the numeric face — so a stack of
 * rows reads down one scale (ADR 0014 decision 7). `beside` puts the label in
 * a fixed column left of the track; `above` gives it its own line, so a narrow
 * card leaves the track its whole width but the value's. Either way every
 * track of a stack has one width, so the target and playhead marks line up.
 */
export function TrackRow({
  term,
  value,
  labelWidth = '12rem',
  layout = 'beside',
  children,
}: {
  term: GlossaryTerm;
  /** The formatted value, or one that carries its own tooltip (a `Hint`). */
  value: ReactNode;
  /**
   * The label column, as a CSS length: narrower in a card that must leave the
   * track most of its width, wider where a name must stay on one line.
   */
  labelWidth?: string;
  /** `above`: the label on its own line over the track and value; `labelWidth` then has no use. */
  layout?: 'beside' | 'above';
  /** The track: an `HBar thick` on the group's shared scale. */
  children: ReactNode;
}) {
  if (layout === 'above') {
    return (
      <div className="flex flex-col gap-1.5">
        {/* A label at the card's left edge: its tooltip starts there. */}
        <Term term={term} layout="stacked" tipAlign="start" />
        <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
          <div className="min-w-0">{children}</div>
          <span className="text-right font-num text-[length:var(--size-ui)] tabular-nums">{value}</span>
        </div>
      </div>
    );
  }
  return (
    <div
      className="grid items-center gap-3"
      style={{ gridTemplateColumns: `${labelWidth} minmax(0, 1fr) 5rem` }}
    >
      <Term term={term} layout="stacked" />
      <div className="min-w-0">{children}</div>
      <span className="text-right font-num text-[length:var(--size-ui)] tabular-nums">{value}</span>
    </div>
  );
}
