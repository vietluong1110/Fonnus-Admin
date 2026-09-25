/*
 * "Reply latency" — the first thing the operator reads after a deploy: the two
 * headline P95s against their ADR 0007 targets, and the same `pipeline_ms` P95
 * one bar per bucket of the window (hour, day or week) so a change reads as a
 * step rather than as a single number.
 * Layout: `docs/design/Main-html` band 1, left card; the gauges are capsule
 * tracks (ADR 0014 decision 7) labelled by the glossary (ADR 0013).
 *
 * Every number here stands on consented calls only (trap 1); the page head
 * says so once, above every card it qualifies, rather than each card again.
 * The chart carries no sentence under it: the target names itself at the end
 * of its line and a partial edge column is keyed in the chart's legend.
 */

import { formatMs, formatNumber } from '@/calls';
import type { BucketUnit, Dashboard } from '@/dashboard';
import { TARGETS } from '@/latency';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import { Hint } from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import type { Term as GlossaryTerm } from '@/ui/glossary';
import HBar, { TrackRow } from '@/ui/hbar';
import Term from '@/ui/term';
import VBars, { hourLabelAt } from '@/ui/vbars';
import { P95_RULE, SPAN } from './overview';

/** How the chart title names one column of the per-bucket chart. */
const BY: Record<BucketUnit, string> = { hour: 'hour', day: 'day', week: 'week' };

/**
 * The axis a gauge is drawn on. The target sits at three quarters of it, so the
 * bar has room to overshoot and the notch lands in the same place on both
 * gauges; a P95 past that axis widens it rather than being clipped into a full
 * track that reads as "exactly at the top".
 */
export function gaugeScale(target: number, values: (number | null)[]): number {
  return Math.max(target / 0.75, ...values.map((value) => (value ?? 0) * 1.05));
}

export default function ReplyLatency({
  data,
  scales,
}: {
  data: Dashboard;
  /** The two axes, computed once by the page so the group gauges share them. */
  scales: { pipeline: number; perceived: number };
}) {
  const bars = data.latencyByBucket.map((bucket) => ({
    label: bucket.label,
    value: bucket.pipelineP95,
    partial: bucket.partial,
  }));
  const bucketScale = Math.max(
    TARGETS.pipelineP95Ms,
    ...data.latencyByBucket.map((bucket) => bucket.pipelineP95 ?? 0),
  );

  return (
    <Card title="Reply latency" sub="P95 over the window">
      {data.turns === 0 ? (
        <EmptyState title="No turns in this window.">
          Every call in the window is unconsented, still running, or has only turns without
          marks, so there is nothing to measure.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <Gauge
              term={SPAN.pipeline}
              p95={data.pipeline.p95}
              target={TARGETS.pipelineP95Ms}
              targetLabel="target"
              scale={scales.pipeline}
            />
            <Gauge
              term={SPAN.perceived}
              p95={data.perceived.p95}
              target={TARGETS.perceivedP95AlarmMs}
              targetLabel="alarm"
              scale={scales.perceived}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-border-hairline pt-3.5">
            <div className="mb-2 text-[13px] font-medium">
              {/* A bucket with no turn is a gap, never a zero bar (`VBars`);
                  its tooltip says "not measured". */}
              <Term
                term={{
                  name: `${SPAN.pipeline.name} by ${BY[data.bucketUnit]} (P95)`,
                  code: SPAN.pipeline.code,
                }}
                hint={P95_RULE}
              />
            </div>
            <VBars
              bars={bars}
              target={TARGETS.pipelineP95Ms}
              targetLabel={`${formatNumber(TARGETS.pipelineP95Ms)} ms`}
              scaleMax={bucketScale}
              valueLabel={formatNumber}
              unit={BY[data.bucketUnit]}
              {...(data.bucketUnit === 'hour' ? { labelAt: hourLabelAt } : {})}
            />
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * One headline span on its own axis, as a capsule track: the span's name over
 * its pipeline term, the P95, and under the track the verdict and the target's
 * number. Over the target is `error`, under it `success`; a window whose turns
 * stamped no `first_audio_out` has no P95 at all and gets no verdict, because
 * "not measured" is not "fast".
 */
/** The gauges' label column, shared by the track row and the verdict row under it. */
const LABEL_WIDTH = '14rem';

function Gauge({
  term,
  p95,
  target,
  targetLabel,
  scale,
}: {
  term: GlossaryTerm;
  p95: number | null;
  target: number;
  targetLabel: string;
  scale: number;
}) {
  const over = p95 !== null && p95 > target;

  return (
    <div className="flex flex-col gap-1">
      {/* 14rem, not the default 12: "Caller-perceived latency" stays on one line. */}
      <TrackRow
        term={term}
        labelWidth={LABEL_WIDTH}
        value={
          p95 === null ? (
            'not measured'
          ) : (
            <Hint hint={P95_RULE} align="end">
              {formatMs(p95)}
            </Hint>
          )
        }
      >
        <HBar
          thick
          from={0}
          to={p95 ?? 0}
          scaleMax={scale}
          tone={over ? 'var(--error)' : 'var(--chart-1)'}
          target={target}
        />
      </TrackRow>
      {/* The same three columns as `TrackRow`, so the notch's number sits under
          the notch and the verdict under the name. */}
      <div
        className="grid items-start gap-3"
        style={{ gridTemplateColumns: `${LABEL_WIDTH} minmax(0, 1fr) 5rem` }}
      >
        <span className="flex flex-wrap items-center gap-1.5 text-[length:var(--size-eyebrow)] text-text-muted">
          P95
          {p95 === null ? null : (
            <Badge tone={over ? 'error' : 'success'}>
              {over
                ? `+${formatNumber(p95 - target)} over`
                : `${formatNumber(target - p95)} under`}
            </Badge>
          )}
        </span>
        {/* The notch has to be readable as a number, not only as a position.
            The axis's end is not written: it is derived from the target
            (`gaugeScale`) and, on the narrow track, would collide with it. */}
        <div className="relative h-4">
          <span
            className="absolute -translate-x-1/2 font-num text-[length:var(--size-eyebrow)] whitespace-nowrap text-text-muted tabular-nums"
            style={{ left: `${String((target / scale) * 100)}%` }}
          >
            {targetLabel} {formatNumber(target)}
          </span>
        </div>
        <span />
      </div>
    </div>
  );
}
