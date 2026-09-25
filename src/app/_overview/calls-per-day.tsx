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

import type { ReactNode } from 'react';
import { formatNumber } from '@/calls';
import type { BucketUnit, Dashboard } from '@/dashboard';
import Card from '@/ui/card';
import Caveat, { Hint } from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import VBars, { hourLabelAt } from '@/ui/vbars';
import { floorMark } from '@/cost';
import { costTip } from './overview';

/** The faded half of the stack, derived from the chart alias (ADR 0003). */
const NOT_CONSENTED = 'color-mix(in srgb, var(--chart-1) 28%, transparent)';

/** What one column is, for the partial legend and the tooltips. */
const UNIT: Record<BucketUnit, string> = { hour: 'hour', day: 'day', week: 'week' };

const TITLE: Record<BucketUnit, string> = {
  hour: 'Calls per hour',
  day: 'Calls per day',
  week: 'Calls per week',
};

export default function CallsPerDay({
  data,
  unpriced,
}: {
  data: Dashboard;
  /** The models the window ran on with no price row (`unpricedInWindow`, ADR 0015). */
  unpriced: readonly string[];
}) {
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
        {/* Trap 3, ADR 0015 decision 7: the window's sum of the stored
            totals, whose tooltip says the pipeline computed them and which
            models the window ran on without a price row; while there is one,
            "floor" sits beside the number, so it reads as a floor exactly
            when it is one. The calls that carried no parseable figure
            are missing from it, counted directly under the number. It is the
            card's right edge, so the tooltip ends there. */}
        <div>
          <Figure
            label={
              <Hint hint={costTip(unpriced)} align="end">
                Cost (list price)
              </Hint>
            }
            value={
              data.costFloorVnd === null
                ? 'not on record'
                : formatNumber(Math.round(data.costFloorVnd))
            }
            {...(data.costFloorVnd === null ? {} : { unit: '₫' })}
            {...(data.costFloorVnd === null ? {} : { mark: floorMark(unpriced) })}
          />
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

function Figure({
  label,
  value,
  unit,
  mark = null,
}: {
  label: ReactNode;
  value: string;
  unit?: string;
  /** A caveat word the figure is never read without ("floor"), muted beside it. */
  mark?: string | null;
}) {
  return (
    <div>
      <div className="text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted">{label}</div>
      <div className="font-num text-[20px] leading-[1.35] font-semibold tabular-nums">
        {value}
        {unit === undefined ? null : (
          <span className="text-[13px] font-medium text-text-muted"> {unit}</span>
        )}
        {mark === null ? null : (
          <Caveat as="span" className="ml-1.5 font-ui">
            {mark}
          </Caveat>
        )}
      </div>
    </div>
  );
}
