/*
 * "Reply latency" — the first thing the operator reads after a deploy: the two
 * headline P95s against their ADR 0007 targets, and the same `pipeline_ms` P95
 * one bar per bucket of the window (hour, day or week) so a change reads as a
 * step rather than as a single number.
 * Layout: `docs/design/Main-html` band 1, left card.
 *
 * Every number here stands on consented calls only (trap 1); the page head
 * says so once, above every card it qualifies, rather than each card again.
 * The chart carries no sentence under it: the target names itself at the end
 * of its line and a partial edge column is keyed in the chart's legend.
 */

import { formatNumber } from '@/calls';
import type { BucketUnit, Dashboard } from '@/dashboard';
import { TARGETS } from '@/latency';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import HBar from '@/ui/hbar';
import VBars, { hourLabelAt } from '@/ui/vbars';

/** How the caption names one column of the per-bucket chart. */
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
    <Card title="Reply latency" sub="P95 over the window, against the ADR 0007 targets">
      {data.turns === 0 ? (
        <EmptyState title="No turns in this window.">
          Every call in the window is unconsented, still running, or has only turns without
          marks, so there is nothing to measure.
        </EmptyState>
      ) : (
        <>
          <Gauge
            label="pipeline_ms"
            p95={data.pipeline.p95}
            target={TARGETS.pipelineP95Ms}
            targetLabel="target"
            scale={scales.pipeline}
          />
          <Gauge
            label="caller_perceived_ms"
            p95={data.perceived.p95}
            target={TARGETS.perceivedP95AlarmMs}
            targetLabel="alarm"
            scale={scales.perceived}
          />

          <div className="flex min-h-0 flex-1 flex-col border-t border-border-hairline pt-3.5">
            <div className="mb-2">
              {/* A bucket with no turn is a gap, never a zero bar (`VBars`);
                  its tooltip says "not measured". */}
              <Caveat as="span">
                <code className="font-num">pipeline_ms</code> P95 by {BY[data.bucketUnit]}
              </Caveat>
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
 * One headline span on its own axis. Over the target is `error`, under it
 * `success`; a window whose turns stamped no `first_audio_out` has no P95 at
 * all and gets no verdict, because "not measured" is not "fast".
 */
function Gauge({
  label,
  p95,
  target,
  targetLabel,
  scale,
}: {
  label: string;
  p95: number | null;
  target: number;
  targetLabel: string;
  scale: number;
}) {
  const over = p95 !== null && p95 > target;

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-3">
        <code className="font-num text-[13px]">{label}</code>
        {p95 === null ? (
          <span className="text-[length:var(--size-ui)] text-text-muted">not measured</span>
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span
              className={`font-num text-[26px] leading-[1.1] font-semibold tabular-nums ${over ? 'text-error' : ''}`}
            >
              {formatNumber(p95)}
            </span>
            <span className="font-num text-[length:var(--size-eyebrow)] text-text-muted">ms</span>
            <Badge tone={over ? 'error' : 'success'}>
              {over
                ? `+${formatNumber(p95 - target)} over`
                : `${formatNumber(target - p95)} under`}
            </Badge>
          </span>
        )}
      </div>
      <HBar
        from={0}
        to={p95 ?? 0}
        scaleMax={scale}
        tone={over ? 'var(--error)' : 'var(--chart-1)'}
        target={target}
      />
      {/* The notch has to be readable as a number, not only as a position. */}
      <div className="relative mt-1 h-4">
        <span
          className="absolute -translate-x-1/2 font-num text-[length:var(--size-eyebrow)] text-text-muted tabular-nums"
          style={{ left: `${String((target / scale) * 100)}%` }}
        >
          {targetLabel} {formatNumber(target)}
        </span>
        <span className="absolute right-0 font-num text-[length:var(--size-eyebrow)] text-text-muted tabular-nums">
          {formatNumber(Math.round(scale))}
        </span>
      </div>
    </div>
  );
}
