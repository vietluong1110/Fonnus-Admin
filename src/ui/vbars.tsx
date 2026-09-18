/*
 * The vertical bar chart of the artboards: calls per day, the per-day P95, the
 * hour-of-day histogram (`docs/design/Main-html`, `docs/design/Calls-html` —
 * 22 px bars, the target as a dashed line, the overshoot above it in --error).
 * Plain flex boxes rather than Recharts: these are one-dimensional counts with
 * a written value, and an SVG chart library would add a client bundle for them.
 *
 * The rules it enforces, both from the data rather than the taste:
 *   - a null value is a GAP, never a zero bar (a day with no turn was not a day
 *     with a fast one — `docs/upstream.md` §Overview); the label stays, so the
 *     axis keeps its place;
 *   - the part of a bar above the target is drawn in --error, so an overshoot
 *     is read without comparing heights.
 * Colours come from the alias layer only (ADR 0003): a segment's `tone` is a
 * custom property such as `var(--chart-1)`, never a hex.
 */

import Caveat from './caveat';

/** The artboards' geometry. */
const BAR_WIDTH = 22;
const PLOT_HEIGHT = 104;

export interface VBar {
  label: string;
  /** Null = not measured: no bar at all, and the label kept (see above). */
  value: number | null;
  /** Stacked parts, bottom first; their sum should be `value`. */
  segments?: { value: number; tone: string }[];
  /** A dashed outline instead of a fill — "no content yet", never a button. */
  dashed?: boolean;
}

export default function VBars({
  bars,
  target,
  targetLabel,
  scaleMax,
  valueLabel = (value) => String(value),
}: {
  bars: VBar[];
  /** Drawn as a dashed line across the plot, in the same units as the values. */
  target?: number;
  targetLabel?: string;
  /** The top of the axis; a caller that passes 0 gets flat bars, not a divide by zero. */
  scaleMax: number;
  valueLabel?: (value: number) => string;
}) {
  const height = (value: number): number =>
    scaleMax <= 0 ? 0 : Math.max(0, Math.min(1, value / scaleMax)) * PLOT_HEIGHT;

  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex items-end gap-1" style={{ height: `${String(PLOT_HEIGHT)}px` }}>
        {target === undefined ? null : (
          <div
            className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-border-strong"
            style={{ bottom: `${String(height(target))}px` }}
            aria-hidden
          />
        )}
        {bars.map((bar, index) => (
          <div
            // The label is a day or an hour and can repeat across a window, so
            // the position is part of the key.
            key={`${bar.label}-${String(index)}`}
            className="flex flex-col items-center justify-end"
            style={{ width: `${String(BAR_WIDTH)}px`, height: '100%' }}
            title={bar.value === null ? `${bar.label}: not measured` : `${bar.label}: ${valueLabel(bar.value)}`}
          >
            {bar.value === null ? null : (
              <Bar bar={bar} height={height(bar.value)} target={target} heightOf={height} />
            )}
          </div>
        ))}
      </div>

      {/* The value under its bar, as the artboards write it: a chart read for a
          number must not be read off a height. A null is the same "not
          measured" the rest of the console says, never a dash on its own. */}
      <div className="flex gap-1">
        {bars.map((bar, index) => (
          <span
            key={`${bar.label}-${String(index)}`}
            className="text-center font-num text-[length:var(--size-eyebrow)] leading-[1.4] tabular-nums"
            style={{ width: `${String(BAR_WIDTH)}px` }}
          >
            {bar.value === null ? (
              <span className="text-text-muted" title="not measured">
                ·
              </span>
            ) : (
              valueLabel(bar.value)
            )}
          </span>
        ))}
      </div>

      <div className="flex gap-1">
        {bars.map((bar, index) => (
          <span
            key={`${bar.label}-${String(index)}`}
            className="text-center font-num text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted tabular-nums opacity-75"
            style={{ width: `${String(BAR_WIDTH)}px` }}
          >
            {bar.label}
          </span>
        ))}
      </div>

      {target === undefined || targetLabel === undefined ? null : (
        <Caveat>{targetLabel}</Caveat>
      )}
    </div>
  );
}

/** One bar: its segments if it has them, else one fill, plus the overshoot cap. */
function Bar({
  bar,
  height,
  target,
  heightOf,
}: {
  bar: VBar;
  height: number;
  target: number | undefined;
  heightOf: (value: number) => number;
}) {
  const overshoot =
    target === undefined || bar.value === null || bar.value <= target
      ? 0
      : height - heightOf(target);

  if (bar.dashed) {
    return (
      <div
        className="w-full rounded-t-xs border border-dashed border-border-dashed"
        style={{ height: `${String(Math.max(height, 2))}px` }}
      />
    );
  }

  return (
    <div className="relative w-full" style={{ height: `${String(Math.max(height, 2))}px` }}>
      {bar.segments === undefined ? (
        <div className="h-full w-full rounded-t-xs" style={{ background: 'var(--chart-1)' }} />
      ) : (
        <div className="flex h-full w-full flex-col-reverse overflow-hidden rounded-t-xs">
          {bar.segments.map((segment, index) => (
            <div
              key={`${segment.tone}-${String(index)}`}
              style={{ height: `${String(heightOf(segment.value))}px`, background: segment.tone }}
            />
          ))}
        </div>
      )}
      {overshoot > 0 ? (
        // The overshoot is drawn on top of the bar rather than beside it: the
        // bar's own height is still the value, and the red is the part of it
        // the target does not cover.
        <div
          className="absolute top-0 right-0 left-0 rounded-t-xs bg-error"
          style={{ height: `${String(overshoot)}px` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
