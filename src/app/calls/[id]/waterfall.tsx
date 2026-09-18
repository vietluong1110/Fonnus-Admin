'use client';

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { formatMs, formatNumber } from '@/calls';
import type { EndOfTurnRow, HeadPairRow, Stage, WaterfallRow } from '@/latency';

/*
 * Recharts takes colours as values, not as classes or as `var(--x)` on an SVG
 * attribute it re-reads, so the three the chart needs are read off the document
 * once after mount (ADR 0003 point 6 — no hex in a component). Before that
 * effect runs the bars inherit the text colour, which is legible on the card
 * rather than invisible.
 */
const FALLBACK = 'currentColor';

/**
 * `--chart-1` the partition legs, `--chart-3` the ones outside it, muted axes,
 * `--action-primary` the playhead — it is the one thing on the chart the
 * operator is driving, and the accent is for what is acted on (ADR 0003).
 */
function useChartColours(): {
  partition: string;
  outside: string;
  axis: string;
  playhead: string;
} {
  const [colours, setColours] = useState({
    partition: FALLBACK,
    outside: FALLBACK,
    axis: FALLBACK,
    playhead: FALLBACK,
  });

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;
    // Recharts writes `fill` as an SVG attribute, where `var()` does not
    // substitute, so the values have to be resolved in JS — which means one
    // extra render on mount. That is what the rule below is warning about, and
    // it is the price of not writing the palette out as hex in a component.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setColours({
      partition: read('--chart-1', FALLBACK),
      outside: read('--chart-3', FALLBACK),
      axis: read('--text-muted', FALLBACK),
      playhead: read('--action-primary', FALLBACK),
    });
  }, []);

  return colours;
}

/**
 * One row of either chart. The end-of-turn marks have no leg name — the
 * pipeline names no leg for them (`../Fonnus/docs/read-contract.md` §3.2) — so
 * a row is identified by a label that is either a leg name or the mark pair
 * itself, and never by a name this console invented.
 */
interface SpanRow {
  label: string;
  from: Stage;
  to: Stage;
  offsetMs: number | null;
  spanMs: number | null;
  partition: boolean;
}

/** The label of an end-of-turn row: its two marks, verbatim. */
function pairLabel(row: EndOfTurnRow): string {
  return `${row.from} → ${row.to}`;
}

/**
 * One turn's legs on a single axis whose origin is `speech_end`: a transparent
 * bar carries each leg out to where it starts, the visible bar is its span. A
 * leg with no span draws nothing at all — a zero-width bar would read as an
 * instant stage, and the read contract's rule is "not measured" (§3.2). A leg
 * with a span but no place on the axis (no `speech_end`, or a start before it)
 * draws nothing either: drawn from 0 it would read as running in parallel with
 * the legs before it. Both are named under the chart instead.
 *
 * Under the legs, the three end-of-turn spans on the same axis and the same
 * scale, so the eye reads them as the tail of the same turn. They sit outside
 * the partition, like `stt_emit` and `playback`, and wear the muted colour.
 */
export default function Waterfall({
  rows,
  tail,
  head,
  playheadMs,
}: {
  rows: WaterfallRow[];
  tail: EndOfTurnRow[];
  /**
   * The head pairs this turn has both marks for (`headPairRows`,
   * `src/latency.ts`) — today only `llm_first_reasoning → llm_first_token`, the
   * thinking span of a reasoning model. Empty on a model that emits no
   * reasoning, and then the row is absent rather than "not measured": no
   * measurement was ever due.
   */
  head: HeadPairRow[];
  /**
   * Where the recording's playhead falls on this turn's axis, in ms from
   * `speech_end` (`waterfallPlayheadMs`, `src/playback.ts`). Null or absent —
   * no `speech_end` mark to place it from, or no player at all — draws no
   * line, and a value outside the shared domain is discarded by the chart
   * rather than pinned to an edge it does not mean.
   */
  playheadMs?: number | null;
}) {
  const colours = useChartColours();
  const legRows: SpanRow[] = rows.map((row) => ({
    label: row.leg,
    from: row.from,
    to: row.to,
    offsetMs: row.offsetMs,
    spanMs: row.spanMs,
    partition: row.partition,
  }));
  const tailRows: SpanRow[] = tail.map((row) => ({
    label: pairLabel(row),
    from: row.from,
    to: row.to,
    offsetMs: row.offsetMs,
    spanMs: row.spanMs,
    partition: false,
  }));
  const headRows: SpanRow[] = head.map((row) => ({
    label: row.label,
    from: row.from,
    to: row.to,
    offsetMs: row.offsetMs,
    spanMs: row.spanMs,
    partition: false,
  }));
  const all = [...legRows, ...headRows, ...tailRows];
  const notMeasured = all.filter((row) => row.spanMs === null);
  const notPlaced = all.filter((row) => row.spanMs !== null && row.offsetMs === null);

  // Both charts share one x domain, because they share one axis: a tail span
  // scaled to its own chart would read as shorter than a leg it dwarfs.
  const ends = all
    .filter((row) => row.offsetMs !== null && row.spanMs !== null)
    .map((row) => (row.offsetMs ?? 0) + (row.spanMs ?? 0));
  const domainMax: number | 'auto' = ends.length === 0 ? 'auto' : Math.max(...ends);

  return (
    <div className="flex flex-col gap-1">
      <SpanChart
        rows={legRows}
        colours={colours}
        domainMax={domainMax}
        height="h-56"
        playheadMs={playheadMs ?? null}
      />
      {headRows.length === 0 ? null : (
        <>
          {/* Under the six legs, on the same axis: the pair is a second reading
              of `llm_ttft`, which the row above already draws whole — never a
              seventh leg (`docs/upstream.md` §The waterfall). */}
          <SpanChart
            rows={headRows}
            colours={colours}
            domainMax={domainMax}
            height="h-16"
            playheadMs={playheadMs ?? null}
          />
          <p className="mb-0 text-[length:var(--size-eyebrow)] text-text-muted">
            {headRows.map((row) => `${row.label}: ${row.from} → ${row.to}`).join(' · ')} — the span
            may contain an LLM failover: the first mark is the primary model&rsquo;s, the second
            the fallback&rsquo;s. The record that proves one is in <code>call_event</code>.
          </p>
        </>
      )}
      <div className="mt-2 text-[length:var(--size-eyebrow)] text-text-muted">
        End-of-turn marks
      </div>
      <SpanChart
        rows={tailRows}
        colours={colours}
        domainMax={domainMax}
        height="h-28"
        playheadMs={playheadMs ?? null}
      />
      <p className="mb-0 text-[length:var(--size-eyebrow)] text-text-muted">
        Milliseconds from <code>speech_end</code>. Muted bars sit outside the partition:{' '}
        <code>stt_emit</code> overlaps <code>endpoint_wait</code>; <code>playback</code> is
        advisory; the end-of-turn marks are spans the pipeline names no leg for.{' '}
        <code>tts_ttfb</code> is the first sentence of the reply only.
      </p>
      {notMeasured.length > 0 ? (
        <p className="mb-0 text-[length:var(--size-eyebrow)] text-text-muted">
          not measured: {notMeasured.map((row) => row.label).join(', ')}
        </p>
      ) : null}
      {notPlaced.length > 0 ? (
        <p className="mb-0 text-[length:var(--size-eyebrow)] text-text-muted">
          measured but not placed — no <code>speech_end</code> to place it from, or a start
          before it: {notPlaced.map((row) => `${row.label} ${formatMs(row.spanMs)}`).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

/** The bars themselves; the legs and the end-of-turn marks differ only in data. */
function SpanChart({
  rows,
  colours,
  domainMax,
  height,
  playheadMs,
}: {
  rows: SpanRow[];
  colours: { partition: string; outside: string; axis: string; playhead: string };
  domainMax: number | 'auto';
  height: string;
  playheadMs: number | null;
}) {
  // The span is split across two series rather than coloured cell by cell: one
  // of the two is always null for a given row, so the stack is still the span.
  const data = rows.map((row) => {
    const span = row.offsetMs === null ? null : row.spanMs;
    return {
      label: row.label,
      offsetMs: span === null ? null : row.offsetMs,
      partitionMs: row.partition ? span : null,
      outsideMs: row.partition ? null : span,
    };
  });

  return (
    <div className={`${height} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <XAxis
            type="number"
            domain={[0, domainMax]}
            tick={{ fill: colours.axis, fontSize: 12 }}
            tickFormatter={(value: number) => formatNumber(value)}
            stroke={colours.axis}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={200}
            tick={{ fill: colours.axis, fontSize: 12 }}
            stroke={colours.axis}
          />
          <Tooltip content={<SpanTooltip rows={rows} />} cursor={false} />
          {typeof playheadMs === 'number' ? (
            <ReferenceLine
              x={playheadMs}
              // Both charts share one domain, so a playhead before this turn's
              // `speech_end` or past its last mark simply is not drawn — never
              // clamped to an edge, which would read as "the audio is here".
              ifOverflow="discard"
              stroke={colours.playhead}
              strokeDasharray="4 4"
            />
          ) : null}
          <Bar dataKey="offsetMs" stackId="span" fill="transparent" isAnimationActive={false} />
          <Bar
            dataKey="partitionMs"
            stackId="span"
            fill={colours.partition}
            isAnimationActive={false}
          />
          <Bar dataKey="outsideMs" stackId="span" fill={colours.outside} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The row's own marks and its span — the axis alone does not name them. */
function SpanTooltip({
  rows,
  active,
  label,
}: Partial<TooltipContentProps<number, string>> & { rows: SpanRow[] }) {
  const row = rows.find((candidate) => candidate.label === label);
  if (active !== true || row === undefined) return null;
  return (
    <div className="rounded-sm border border-border-hairline bg-surface-card px-3 py-2 text-[length:var(--size-eyebrow)] text-text-body shadow-raise">
      <div className="font-semibold">{row.label}</div>
      {row.label === `${row.from} → ${row.to}` ? null : (
        <div className="text-text-muted">
          {row.from} → {row.to}
        </div>
      )}
      <div>{formatMs(row.spanMs)}</div>
    </div>
  );
}
