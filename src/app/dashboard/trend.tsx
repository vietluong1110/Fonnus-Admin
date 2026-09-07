'use client';

import { useEffect, useState } from 'react';
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { formatMs, formatNumber } from '@/calls';
import type { DashboardDay } from '@/dashboard';
import { TARGETS } from '@/latency';

/*
 * Recharts takes colours as values, not as classes or as `var(--x)` on an SVG
 * attribute it re-reads, so the three the chart needs are read off the document
 * once after mount (ADR 0003 point 6 — no hex in a component). Before that
 * effect runs the lines inherit the text colour, which is legible on the card
 * rather than invisible. Same pattern as `src/app/calls/[id]/waterfall.tsx`.
 */
const FALLBACK = 'currentColor';

/** `--chart-1` the caller-perceived line, `--chart-2` the pipeline one, muted axes. */
function useChartColours(): { perceived: string; pipeline: string; axis: string } {
  const [colours, setColours] = useState({
    perceived: FALLBACK,
    pipeline: FALLBACK,
    axis: FALLBACK,
  });

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;
    // Recharts writes `stroke` as an SVG attribute, where `var()` does not
    // substitute, so the values have to be resolved in JS — which means one
    // extra render on mount. That is what the rule below is warning about, and
    // it is the price of not writing the palette out as hex in a component.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setColours({
      perceived: read('--chart-1', FALLBACK),
      pipeline: read('--chart-2', FALLBACK),
      axis: read('--text-muted', FALLBACK),
    });
  }, []);

  return colours;
}

/**
 * P95 by day for the two headline spans, against their ADR 0007 targets. A day
 * whose turns stamped neither span has a null there and the line breaks rather
 * than sloping through it — a drawn-through gap would read as a measurement.
 * The x axis is the day in `Asia/Ho_Chi_Minh`, the zone every screen here uses.
 */
export default function Trend({ days }: { days: DashboardDay[] }) {
  const colours = useChartColours();

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={days} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <XAxis
            dataKey="day"
            tick={{ fill: colours.axis, fontSize: 12 }}
            stroke={colours.axis}
          />
          <YAxis
            tick={{ fill: colours.axis, fontSize: 12 }}
            tickFormatter={(value: number) => formatNumber(value)}
            stroke={colours.axis}
          />
          {/* `discard` is Recharts' default: a target above every plotted P95
              would fall outside the y domain and simply not be drawn — losing
              the line the day is read against. `extendDomain` grows the axis
              to hold it. */}
          <ReferenceLine
            y={TARGETS.perceivedP95AlarmMs}
            ifOverflow="extendDomain"
            stroke={colours.axis}
            strokeDasharray="4 4"
            label={{
              value: `caller-perceived alarm ${formatNumber(TARGETS.perceivedP95AlarmMs)}`,
              position: 'insideTopLeft',
              fill: colours.axis,
              fontSize: 11,
            }}
          />
          <ReferenceLine
            y={TARGETS.pipelineP95Ms}
            ifOverflow="extendDomain"
            stroke={colours.axis}
            strokeDasharray="4 4"
            label={{
              value: `pipeline target ${formatNumber(TARGETS.pipelineP95Ms)}`,
              position: 'insideTopLeft',
              fill: colours.axis,
              fontSize: 11,
            }}
          />
          <Tooltip content={<DayTooltip days={days} />} cursor={false} />
          <Line
            type="linear"
            dataKey="perceivedP95"
            name="caller_perceived_ms P95"
            stroke={colours.perceived}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="pipelineP95"
            name="pipeline_ms P95"
            stroke={colours.pipeline}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The day, both P95s and how many turns they stand on. */
function DayTooltip({
  days,
  active,
  label,
}: Partial<TooltipContentProps<number, string>> & { days: DashboardDay[] }) {
  const day = days.find((candidate) => candidate.day === label);
  if (active !== true || day === undefined) return null;
  return (
    <div className="rounded-sm border border-border-hairline bg-surface-card px-3 py-2 text-[length:var(--size-eyebrow)] text-text-body shadow-raise">
      <div className="font-semibold">{day.day}</div>
      <div>
        <code>caller_perceived_ms</code> P95 {formatMs(day.perceivedP95)}
      </div>
      <div>
        <code>pipeline_ms</code> P95 {formatMs(day.pipelineP95)}
      </div>
      <div className="text-text-muted">{formatNumber(day.turns)} turns</div>
    </div>
  );
}
