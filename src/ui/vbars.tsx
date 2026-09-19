/*
 * The vertical bar chart of the artboards: calls per day, the per-day P95, the
 * hour-of-day histogram (`docs/design/Main-html`, `docs/design/Calls-html` —
 * the target as a dashed line, the overshoot above it in --error).
 * Plain flex boxes rather than Recharts: these are one-dimensional counts with
 * a written value, and an SVG chart library would add a client bundle for them.
 *
 * It is FLUID, not the artboard's fixed geometry: the artboard draws one
 * window (7 columns), and the same chart has to carry 24 hours, 30 days or 53
 * weeks. So a column is at most the artboard's 40 px and shrinks to fit, the
 * plot fills the height the card gives it (percent heights, not pixels), and
 * the label row thins as the columns narrow (`labelEvery`). Bars, values and
 * labels are cells of ONE grid, so a label can never drift off its bar.
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

/** The artboard's column width — a ceiling now, so 1–7 bars are not slabs. */
const MAX_COLUMN_PX = 40;

/** The artboard's plot height, now the floor a taller card grows from. */
const MIN_PLOT_PX = 104;

/**
 * How dense the label row may be. A label is `00` or `5/9`, so a column under
 * roughly 24 px cannot carry one without colliding with its neighbour; the
 * answer is how many columns to skip, decided from the count alone because a
 * server component cannot measure the box it will land in.
 */
export function labelEvery(n: number): number {
  if (n <= 12) return 1;
  if (n <= 31) return 5;
  if (n <= 53) return 7;
  return Math.ceil(n / 8);
}

/**
 * Whether a column carries its label, counting columns. The last column is
 * always labelled when labels are thinned, so the axis says where it ends.
 * A chart whose columns are hours overrides this with `hourLabelAt`, because
 * there the label must follow the clock rather than the index.
 */
export function labelShown(index: number, n: number, every: number): boolean {
  if (index % every === 0) return true;
  return every !== 1 && index === n - 1;
}

/** The quarters of the day — the only labels an hour chart draws. */
const HOUR_LABELS = ['00', '06', '12', '18'];

/**
 * The `labelAt` rule for every chart whose columns are hours: the hour-of-day
 * histogram's 24 columns and the Overview's rolling 25-hour window alike. It
 * reads the clock, not the position, so a window that starts at 17:00 still
 * marks midnight, 06, noon and 18 where they really fall.
 */
export function hourLabelAt(bar: VBar): boolean {
  return HOUR_LABELS.includes(bar.label);
}

/**
 * The line a card prints under a chart whose edge columns are partial. Only an
 * edge can be one (`windowBuckets` in `src/dashboard.ts`), so the three cases
 * are the whole vocabulary.
 */
export function partialNote(bars: VBar[], unit: string): string | null {
  const first = bars[0]?.partial === true;
  const last = bars.length > 1 && bars[bars.length - 1]?.partial === true;
  if (first && last) return `first and last columns are partial ${unit}s`;
  if (first) return `first column is a partial ${unit}`;
  if (last) return `last column is a partial ${unit}`;
  return null;
}

/**
 * Whether the written values are drawn at all. Past 16 columns they no longer
 * fit their column, and a clipped or overlapping number is worse than none:
 * the `title` on every column already carries `label: value`.
 */
export function valuesShown(n: number): boolean {
  return n <= 16;
}

export interface VBar {
  label: string;
  /** Null = not measured: no bar at all, and the label kept (see above). */
  value: number | null;
  /** Stacked parts, bottom first; their sum should be `value`. */
  segments?: { value: number; tone: string }[];
  /** A dashed outline instead of a fill — "no content yet", never a button. */
  dashed?: boolean;
  /**
   * The window covers only part of this column, so its bar stands on less time
   * than its neighbours'. Drawn faded and said in the tooltip — NOT `dashed`,
   * which means something else entirely.
   */
  partial?: boolean;
}

export default function VBars({
  bars,
  target,
  targetLabel,
  scaleMax,
  valueLabel = (value) => String(value),
  labelEvery: every,
  labelAt,
  unit,
}: {
  bars: VBar[];
  /** Drawn as a dashed line across the plot, in the same units as the values. */
  target?: number;
  targetLabel?: string;
  /** The top of the axis; a caller that passes 0 gets flat bars, not a divide by zero. */
  scaleMax: number;
  valueLabel?: (value: number) => string;
  /** Override the computed label density — every `n`th column carries a label. */
  labelEvery?: number;
  /** Replaces the density rule entirely — the hour charts label by the clock. */
  labelAt?: (bar: VBar, index: number) => boolean;
  /** What one column is, for the partial tooltip: `hour`, `day`, `week`. */
  unit?: string;
}) {
  const n = bars.length;
  const step = every ?? labelEvery(n);
  const shows = labelAt ?? ((_bar: VBar, index: number) => labelShown(index, n, step));
  const withValues = valuesShown(n);

  /** A value as a share of the axis, in percent — the plot has no fixed height. */
  const percent = (value: number): number =>
    scaleMax <= 0 ? 0 : Math.max(0, Math.min(1, value / scaleMax)) * 100;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div
        className="grid min-w-0 justify-start gap-1"
        style={{
          gridTemplateColumns: `repeat(${String(n)}, minmax(0, ${String(MAX_COLUMN_PX)}px))`,
          // The plot takes whatever height the card has left, never less than
          // the artboard's; the value and label rows take what they need.
          gridTemplateRows: `minmax(${String(MIN_PLOT_PX)}px, 1fr) auto auto`,
        }}
      >
        {bars.map((bar, index) => (
          <div
            // The label is a day or an hour and can repeat across a window, so
            // the position is part of the key.
            key={`bar-${bar.label}-${String(index)}`}
            className="flex min-w-0 flex-col justify-end"
            style={{ gridRow: 1, gridColumn: index + 1 }}
            title={`${bar.label}: ${bar.value === null ? 'not measured' : valueLabel(bar.value)}${
              bar.partial === true ? ` (partial${unit === undefined ? '' : ` ${unit}`})` : ''
            }`}
          >
            {bar.value === null ? null : (
              <Bar bar={bar} percent={percent(bar.value)} target={target} scaleMax={scaleMax} />
            )}
          </div>
        ))}

        {/* Last in the DOM so it draws over the bars; it shares row 1 with them
            and spans every column, which is what makes it an axis line. */}
        {target === undefined ? null : (
          <div
            className="pointer-events-none relative"
            style={{ gridRow: 1, gridColumn: `1 / -1` }}
            aria-hidden
          >
            <div
              className="absolute right-0 left-0 border-t border-dashed border-border-strong"
              style={{ bottom: `${String(percent(target))}%` }}
            />
          </div>
        )}

        {/* The value under its bar, as the artboards write it: a chart read for
            a number must not be read off a height. A null is the same "not
            measured" the rest of the console says, never a dash on its own. */}
        {!withValues
          ? null
          : bars.map((bar, index) => (
              <span
                key={`value-${bar.label}-${String(index)}`}
                className="truncate text-center font-num text-[length:var(--size-eyebrow)] leading-[1.4] tabular-nums"
                style={{ gridRow: 2, gridColumn: index + 1 }}
              >
                {bar.value === null ? (
                  // Past 12 columns a bar with nothing in it says nothing: its
                  // tooltip still carries "not measured".
                  n <= 12 ? (
                    <span className="text-text-muted" title="not measured">
                      ·
                    </span>
                  ) : null
                ) : n <= 12 || bar.value > 0 ? (
                  valueLabel(bar.value)
                ) : null}
              </span>
            ))}

        {bars.map((bar, index) => (
          <span
            key={`label-${bar.label}-${String(index)}`}
            className="truncate text-center font-num text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted tabular-nums opacity-75"
            style={{ gridRow: 3, gridColumn: index + 1 }}
          >
            {/* A skipped label is an empty cell, not a missing one: the row
                keeps its height and the columns keep their alignment. */}
            {shows(bar, index) ? bar.label : ' '}
          </span>
        ))}
      </div>

      {target === undefined || targetLabel === undefined ? null : <Caveat>{targetLabel}</Caveat>}
    </div>
  );
}

/** One bar: its segments if it has them, else one fill, plus the overshoot cap. */
function Bar({
  bar,
  percent,
  target,
  scaleMax,
}: {
  bar: VBar;
  /** The bar's own height, as a share of the plot. */
  percent: number;
  target: number | undefined;
  scaleMax: number;
}) {
  const value = bar.value ?? 0;
  // A bar past the top of the axis is drawn at the top, so the overshoot is a
  // share of what is DRAWN rather than of a height nobody can see.
  const drawn = Math.min(value, scaleMax);
  const overshoot =
    target === undefined || drawn <= target || drawn <= 0 ? 0 : ((drawn - target) / drawn) * 100;

  // The floor keeps a tiny value visible as a bar rather than as nothing at all.
  const style = { height: `${String(percent)}%`, minHeight: '2px' };

  // A partial column is faded, and everything inside it inherits that: the
  // segments and the overshoot cap are parts of a bar that stands on less time
  // than its neighbours', not values of their own.
  const faded = bar.partial === true ? ' opacity-60' : '';

  if (bar.dashed) {
    return (
      <div
        className={`w-full rounded-t-xs border border-dashed border-border-dashed${faded}`}
        style={style}
      />
    );
  }

  return (
    <div className={`relative w-full${faded}`} style={style}>
      {bar.segments === undefined ? (
        <div className="h-full w-full rounded-t-xs" style={{ background: 'var(--chart-1)' }} />
      ) : (
        <div className="flex h-full w-full flex-col-reverse overflow-hidden rounded-t-xs">
          {bar.segments.map((segment, index) => (
            <div
              key={`${segment.tone}-${String(index)}`}
              // A segment is a share of ITS BAR, so the parts tile the bar
              // exactly however the bar itself was scaled or floored.
              style={{
                height: `${String(value <= 0 ? 0 : (segment.value / value) * 100)}%`,
                background: segment.tone,
              }}
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
          style={{ height: `${String(overshoot)}%` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
