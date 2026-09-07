'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { formatMs, formatNumber } from '@/calls';
import type { WaterfallRow } from '@/latency';

// The palette of CONTEXT.md §Look and feel. Recharts takes colours as values,
// not as classes, so the two used here are written out.
const PARTITION_FILL = '#b85c2b'; // accent
const OUTSIDE_FILL = '#5c5249'; // muted
const AXIS_INK = '#5c5249';

/**
 * One turn's legs on a single axis whose origin is `speech_end`: a transparent
 * bar carries each leg out to where it starts, the visible bar is its span. A
 * leg with no span draws nothing at all — a zero-width bar would read as an
 * instant stage, and the read contract's rule is "not measured" (§3.2). A leg
 * with a span but no place on the axis (no `speech_end`, or a start before it)
 * draws nothing either: drawn from 0 it would read as running in parallel with
 * the legs before it. Both are named under the chart instead.
 */
export default function Waterfall({ rows }: { rows: WaterfallRow[] }) {
  const notMeasured = rows.filter((row) => row.spanMs === null);
  const notPlaced = rows.filter((row) => row.spanMs !== null && row.offsetMs === null);

  // The span is split across two series rather than coloured cell by cell: one
  // of the two is always null for a given leg, so the stack is still the span.
  const data = rows.map((row) => {
    const span = row.offsetMs === null ? null : row.spanMs;
    return {
      leg: row.leg,
      offsetMs: span === null ? null : row.offsetMs,
      partitionMs: row.partition ? span : null,
      outsideMs: row.partition ? null : span,
    };
  });

  return (
    <div className="mt-3">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <XAxis
              type="number"
              tick={{ fill: AXIS_INK, fontSize: 12 }}
              tickFormatter={(value: number) => formatNumber(value)}
              stroke={AXIS_INK}
            />
            <YAxis
              type="category"
              dataKey="leg"
              width={100}
              tick={{ fill: AXIS_INK, fontSize: 12 }}
              stroke={AXIS_INK}
            />
            <Tooltip content={<LegTooltip rows={rows} />} cursor={false} />
            <Bar dataKey="offsetMs" stackId="leg" fill="transparent" isAnimationActive={false} />
            <Bar
              dataKey="partitionMs"
              stackId="leg"
              fill={PARTITION_FILL}
              isAnimationActive={false}
            />
            <Bar
              dataKey="outsideMs"
              stackId="leg"
              fill={OUTSIDE_FILL}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted">
        Milliseconds from <code>speech_end</code>. Muted bars sit outside the partition:{' '}
        <code>stt_emit</code> overlaps <code>endpoint_wait</code>; <code>playback</code> is
        advisory. <code>tts_ttfb</code> is the first sentence of the reply only.
      </p>
      {notMeasured.length > 0 ? (
        <p className="mt-1 text-xs text-muted">
          not measured: {notMeasured.map((row) => row.leg).join(', ')}
        </p>
      ) : null}
      {notPlaced.length > 0 ? (
        <p className="mt-1 text-xs text-muted">
          measured but not placed — no <code>speech_end</code> to place it from, or a start
          before it: {notPlaced.map((row) => `${row.leg} ${formatMs(row.spanMs)}`).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

/** The leg's own marks and its span — the axis alone does not name them. */
function LegTooltip({
  rows,
  active,
  label,
}: Partial<TooltipContentProps<number, string>> & { rows: WaterfallRow[] }) {
  const row = rows.find((candidate) => candidate.leg === label);
  if (active !== true || row === undefined) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink shadow">
      <div className="font-semibold">{row.leg}</div>
      <div className="text-muted">
        {row.from} → {row.to}
      </div>
      <div>{formatMs(row.spanMs)}</div>
    </div>
  );
}
