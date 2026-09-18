/*
 * One horizontal 6 px track carrying one span — a leg's P50→P95 range on the
 * Overview, a call's duration against the longest of its day band on the Calls
 * list (`docs/design/Main-html`, `docs/design/Calls-html`: 6 px track, pill
 * ends, the outlined variant for a leg outside the partition).
 * The rule it enforces: `from` and `to` are positions on a scale the CALLER
 * owns, so every track of a group shares one scale and the bars are comparable;
 * a span is never normalised to its own row.
 * Colours come from the alias layer only (ADR 0003): `tone` is a custom
 * property such as `var(--chart-1)`, never a hex.
 */

const TRACK_HEIGHT = 6;

export default function HBar({
  from,
  to,
  scaleMax,
  tone = 'var(--chart-1)',
  outlined = false,
  target,
}: {
  /** Where the span starts, in the caller's units. */
  from: number;
  /** Where it ends. A `to` at or below `from` draws a hairline, not a negative bar. */
  to: number;
  scaleMax: number;
  tone?: string;
  /** Outlined = outside the partition: a measurement that does not tile the whole. */
  outlined?: boolean;
  /** A dashed mark on the track, in the same units — the leg's target. */
  target?: number;
}) {
  const share = (value: number): number =>
    scaleMax <= 0 ? 0 : Math.max(0, Math.min(1, value / scaleMax)) * 100;

  const left = share(from);
  // A zero-width bar disappears; the minimum keeps an instant span visible as
  // the position it happened at.
  const width = Math.max(share(to) - left, 0.6);

  return (
    <div
      className="relative w-full overflow-hidden rounded-pill bg-[var(--action-ghost-hover)]"
      style={{ height: `${String(TRACK_HEIGHT)}px` }}
    >
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
      {target === undefined ? null : (
        <div
          className="absolute top-0 bottom-0 border-l border-dashed border-border-strong"
          style={{ left: `${String(share(target))}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}
