/*
 * "Calls per day" — how much traffic the window holds and how much of it the
 * caller consented to, which is the same thing as how much of it the latency
 * numbers could be measured on (trap 1: an unconsented call has no turn rows).
 * Layout: `docs/design/Main-html` band 1, right card, with the figures moved
 * above the chart so the chart fills the height the band gives the card
 * instead of leaving blank space under a fixed plot.
 *
 * The columns are the window's own buckets, so the title says which unit is on
 * screen — hours for `24h`, days up to 45, weeks past that.
 */

import { formatNumber } from '@/calls';
import type { BucketUnit, Dashboard } from '@/dashboard';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import VBars, { hourLabelAt } from '@/ui/vbars';

/** The faded half of the stack, derived from the chart alias (ADR 0003). */
const NOT_CONSENTED = 'color-mix(in srgb, var(--chart-1) 28%, transparent)';

/** What one column is, for the partial legend and the tooltips. */
const UNIT: Record<BucketUnit, string> = { hour: 'hour', day: 'day', week: 'week' };

const TITLE: Record<BucketUnit, string> = {
  hour: 'Calls per hour',
  day: 'Calls per day',
  week: 'Calls per week',
};

export default function CallsPerDay({ data }: { data: Dashboard }) {
  const totals = data.callsByBucket.map((bucket) => bucket.consented + bucket.notConsented);
  const share = data.calls === 0 ? null : Math.round((data.consentedCalls / data.calls) * 100);
  const bars = data.callsByBucket.map((bucket, index) => ({
    label: bucket.label,
    // A bucket with no call is a real zero here, not the gap the P95
    // chart draws: nobody rang is a measurement.
    value: totals[index] ?? 0,
    partial: bucket.partial,
    segments: [
      { value: bucket.consented, tone: 'var(--chart-1)' },
      { value: bucket.notConsented, tone: NOT_CONSENTED },
    ],
  }));
  return (
    <Card
      title={TITLE[data.bucketUnit]}
      actions={
        <div className="flex flex-col items-end gap-1">
          <Legend tone="var(--chart-1)" label="consented" />
          <Legend tone={NOT_CONSENTED} label="not consented" />
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-2.5">
        <Figure label="Calls" value={formatNumber(data.calls)} />
        <Figure label="Consented" value={share === null ? '—' : String(share)} unit="%" />
        {/* Trap 3: the figure is a floor while any model the calls ran on has
            no price row — the label says "floor" and its tooltip says why —
            and the calls that carried no parseable figure are missing from it,
            which is counted directly under the number whenever there are any. */}
        <div title="a floor while any model is unpriced">
          {data.costFloorVnd === null ? (
            <Figure label="Cost floor" value="not on record" />
          ) : (
            <Figure
              label="Cost floor"
              value={formatNumber(Math.round(data.costFloorVnd))}
              unit="₫"
            />
          )}
          {data.unpricedCalls > 0 ? (
            <Caveat>
              {formatNumber(data.unpricedCalls)} call{data.unpricedCalls === 1 ? '' : 's'} without
              a price
            </Caveat>
          ) : null}
        </div>
      </div>

      {/* The buckets now cover the whole window, so an empty window still has
          columns; the empty state is decided by the calls, not by the axis. */}
      {data.calls === 0 ? (
        <EmptyState title="No calls in this window.">
          Nothing was answered in the window, so there is nothing to count.
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border-hairline pt-3.5">
          <VBars
            bars={bars}
            scaleMax={Math.max(1, ...totals)}
            valueLabel={formatNumber}
            unit={UNIT[data.bucketUnit]}
            {...(data.bucketUnit === 'hour' ? { labelAt: hourLabelAt } : {})}
          />
        </div>
      )}
    </Card>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted">
      <span className="size-2.5 rounded-xs" style={{ background: tone }} />
      {label}
    </span>
  );
}

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted">{label}</div>
      <div className="font-num text-[20px] leading-[1.35] font-semibold tabular-nums">
        {value}
        {unit === undefined ? null : (
          <span className="text-[13px] font-medium text-text-muted"> {unit}</span>
        )}
      </div>
    </div>
  );
}
