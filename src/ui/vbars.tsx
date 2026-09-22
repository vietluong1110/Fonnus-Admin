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
 * labels are cells of ONE grid, so a label can never drift off its bar; a label
 * is centred on its column and may overflow it, never truncated to `2…`.
 *
 * The chart explains itself, so a card prints no sentence under it: the target
 * is named at the end of its own dashed line, and a partial edge column is
 * hatched and keyed in a legend that appears only when one is on screen.
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

/** The artboard's column width — a ceiling now, so 1–7 bars are not slabs. */
const MAX_COLUMN_PX = 40;

/** The artboard's plot height, now the floor a taller card grows from. */
const MIN_PLOT_PX = 104;

/**
 * How dense the label row may be. A label is `00` or `24/8`, about 30 px wide,
 * and a column of a 30-day window on the narrow card is barely 12 px — so the
 * answer is how many columns sit between two labels, decided from the count
 * alone because a server component cannot measure the box it will land in.
 * A month of days is labelled once a week; anything longer, about seven times.
 */
export function labelEvery(n: number): number {
  if (n <= 12) return 1;
  if (n <= 24) return 3;
  if (n <= 45) return 7;
  return Math.ceil(n / 7);
}

/**
 * Whether a column carries its label, counted back from the LAST column: the
 * newest bucket (today, this week) is the one always read, and the rest fall a
 * whole step apart from it, so two labels can never crowd each other at the
 * end. A chart whose columns are hours overrides this with `hourLabelAt`,
 * because there the label must follow the clock rather than the index.
 */
export function labelShown(index: number, n: number, every: number): boolean {
  return (n - 1 - index) % every === 0;
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
 * The hatch a partial column wears over its own colours — stripes of the card
 * ground, so it reads as "not all there" on any fill, stacked or not, and can
 * never be mistaken for a lighter segment of a stack.
 */
const HATCH =
  'repeating-linear-gradient(135deg, var(--surface-card) 0 1.5px, transparent 1.5px 5px)';

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
   * than its neighbours'. Drawn hatched, keyed in the legend and said in the
   * tooltip — NOT `dashed`, which means something else entirely.
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
  /** Written at the end of the dashed line, e.g. `1 200 ms` — the line's only key. */
  targetLabel?: string;
  /** The top of the axis; a caller that passes 0 gets flat bars, not a divide by zero. */
  scaleMax: number;
  valueLabel?: (value: number) => string;
  /** Override the computed label density — every `n`th column carries a label. */
  labelEvery?: number;
  /** Replaces the density rule entirely — the hour charts label by the clock. */
  labelAt?: (bar: VBar, index: number) => boolean;
  /** What one column is, for the partial tooltip and legend: `hour`, `day`, `week`. */
  unit?: string;
}) {
  const n = bars.length;
  const step = every ?? labelEvery(n);
  const shows = labelAt ?? ((_bar: VBar, index: number) => labelShown(index, n, step));
  const withValues = valuesShown(n);
  const anyPartial = bars.some((bar) => bar.partial === true);
  // The end of the dashed line gets a column of its own, so its label sits
  // beside the plot and no bar can be drawn over it.
  const gutter = target !== undefined && targetLabel !== undefined;

  /** A value as a share of the axis, in percent — the plot has no fixed height. */
  const percent = (value: number): number =>
    scaleMax <= 0 ? 0 : Math.max(0, Math.min(1, value / scaleMax)) * 100;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div
        className="grid min-h-0 min-w-0 flex-1 justify-start"
        style={{
          // A month of columns on the narrow card cannot spend 4 px on each gap.
          columnGap: n > 20 ? '2px' : '4px',
          rowGap: '4px',
          gridTemplateColumns: `repeat(${String(n)}, minmax(0, ${String(MAX_COLUMN_PX)}px))${
            gutter ? ' auto' : ''
          }`,
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
            and spans every bar column, which is what makes it an axis line. It
            stops short of the gutter, so its label reads as the line's end. */}
        {target === undefined ? null : (
          <div
            className="pointer-events-none relative"
            style={{ gridRow: 1, gridColumn: `1 / ${String(n + 1)}` }}
            aria-hidden
          >
            <div
              className="absolute right-0 left-0 border-t border-dashed border-text-muted"
              style={{ bottom: `${String(percent(target))}%` }}
            />
          </div>
        )}

        {!gutter ? null : (
          <div className="relative pl-1.5" style={{ gridRow: 1, gridColumn: n + 1 }}>
            {/* The invisible copy gives the `auto` column its width; the
                visible one rides the line's height. */}
            <span className={`invisible whitespace-nowrap ${AXIS_TEXT}`}>{targetLabel}</span>
            <span
              className={`absolute left-1.5 translate-y-1/2 whitespace-nowrap ${AXIS_TEXT}`}
              style={{ bottom: `${String(percent(target))}%` }}
            >
              {targetLabel}
            </span>
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
          // Centred by flex so a label wider than its column spills evenly to
          // both sides of it; the density rule keeps the spill clear of the
          // next label.
          <span
            key={`label-${bar.label}-${String(index)}`}
            className={`flex min-w-0 justify-center whitespace-nowrap ${AXIS_TEXT}`}
            style={{ gridRow: 3, gridColumn: index + 1 }}
          >
            {/* A skipped label is an empty cell, not a missing one: the row
                keeps its height and the columns keep their alignment. */}
            {shows(bar, index) ? bar.label : '\u00a0'}
          </span>
        ))}
      </div>

      {!anyPartial ? null : (
        <div className="flex justify-end">
          <span className={`flex items-center gap-1.5 ${AXIS_TEXT}`}>
            <span
              className="size-2.5 rounded-xs"
              style={{ background: `${HATCH}, var(--chart-1)` }}
              aria-hidden
            />
            partial {unit ?? 'column'}
          </span>
        </div>
      )}
    </div>
  );
}

/** The axis's own small type: the labels, the target's key, the legend. */
const AXIS_TEXT =
  'font-num text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted tabular-nums';

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

  if (bar.dashed) {
    return (
      <div
        className="w-full rounded-t-xs border border-dashed border-border-dashed"
        style={style}
      />
    );
  }

  return (
    <div className="relative w-full" style={style}>
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
      {/* A partial column is hatched over everything inside it: the segments
          and the overshoot cap are parts of a bar that stands on less time
          than its neighbours', not values of their own. */}
      {bar.partial === true ? (
        <div
          className="absolute inset-0 rounded-t-xs"
          style={{ background: HATCH }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
