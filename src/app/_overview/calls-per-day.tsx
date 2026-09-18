/*
 * "Calls per day" — how much traffic the window holds and how much of it the
 * caller consented to, which is the same thing as how much of it the latency
 * numbers could be measured on (trap 1: an unconsented call has no turn rows).
 * Layout: `docs/design/Main-html` band 1, right card.
 */

import { formatNumber } from '@/calls';
import { type Dashboard, dayLabel } from '@/dashboard';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import VBars from '@/ui/vbars';

/** The faded half of the stack, derived from the chart alias (ADR 0003). */
const NOT_CONSENTED = 'color-mix(in srgb, var(--chart-1) 28%, transparent)';

export default function CallsPerDay({ data }: { data: Dashboard }) {
  const totals = data.callsByDay.map((day) => day.consented + day.notConsented);
  const share =
    data.calls === 0 ? null : Math.round((data.consentedCalls / data.calls) * 100);

  return (
    <Card
      title="Calls per day"
      sub="Asia/Ho_Chi_Minh"
      actions={
        <div className="flex flex-col items-end gap-1">
          <Legend tone="var(--chart-1)" label="consented" />
          <Legend tone={NOT_CONSENTED} label="not consented" />
        </div>
      }
    >
      {data.callsByDay.length === 0 ? (
        <EmptyState title="No calls in this window.">
          Nothing was answered in the window, so there is no day to count.
        </EmptyState>
      ) : (
        <VBars
          bars={data.callsByDay.map((day, index) => ({
            label: dayLabel(day.day),
            // A day with no call is a real zero here, not the gap the P95 chart
            // draws: nobody rang is a measurement.
            value: totals[index] ?? 0,
            segments: [
              { value: day.consented, tone: 'var(--chart-1)' },
              { value: day.notConsented, tone: NOT_CONSENTED },
            ],
          }))}
          scaleMax={Math.max(1, ...totals)}
          valueLabel={formatNumber}
        />
      )}

      <div className="mt-auto grid grid-cols-3 gap-2.5 border-t border-border-hairline pt-3.5">
        <Figure label="Calls" value={formatNumber(data.calls)} />
        <Figure label="Consented" value={share === null ? '—' : String(share)} unit="%" />
        {data.costFloorVnd === null ? (
          <Figure label="Cost floor" value="not on record" />
        ) : (
          <Figure
            label="Cost floor"
            value={formatNumber(Math.round(data.costFloorVnd))}
            unit="₫"
          />
        )}
      </div>
      {/* Trap 3: the figure is a floor while any model the calls ran on has no
          price row, and the calls that carried no parseable figure are missing
          from it — both said beside the number, never in a footnote. */}
      <Caveat>
        a floor while any model is unpriced
        {data.unpricedCalls > 0
          ? ` — ${formatNumber(data.unpricedCalls)} call${data.unpricedCalls === 1 ? '' : 's'} without a price`
          : ''}
      </Caveat>
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
