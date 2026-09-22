/*
 * The scope's calls over time, in the window's own buckets (`callsTimeline`):
 * hours for `24h`, days up to 45, weeks past that — the same columns the
 * Overview draws, so a switch of window changes the chart the way it changes
 * the list under it. The bars count the SCOPE, not the chip intersection
 * (ADR 0006).
 */

import { formatNumber } from '@/calls';
import type { TimelineBar } from '@/calls-stats';
import type { BucketUnit } from '@/window';
import Card from '@/ui/card';
import VBars, { hourLabelAt } from '@/ui/vbars';

const TITLE: Record<BucketUnit, string> = {
  hour: 'Calls per hour',
  day: 'Calls per day',
  week: 'Calls per week',
};

export default function Timeline({ unit, bars }: { unit: BucketUnit; bars: TimelineBar[] }) {
  return (
    <Card title={TITLE[unit]}>
      <div className="flex min-h-0 flex-1 flex-col">
        <VBars
          // A zero here is a real zero — nobody rang — unlike the Overview's
          // per-day P95, where a gap means "not measured".
          bars={bars}
          scaleMax={Math.max(1, ...bars.map((bar) => bar.value))}
          valueLabel={formatNumber}
          unit={unit}
          {...(unit === 'hour' ? { labelAt: hourLabelAt } : {})}
        />
      </div>
    </Card>
  );
}
