/*
 * "When calls come in" — the hour-of-day histogram of the artboard
 * (`docs/design/Calls-html`), drawn with the shared `VBars`.
 * The rule it renders: the hours are the clinic's zone, pinned in code
 * (`callHour`), so the box and a laptop show the same day; and the bars count
 * the SCOPE, not the chip intersection (ADR 0006).
 */

import { CALL_TIME_ZONE } from '@/calls';
import VBars from '@/ui/vbars';
import Card from '@/ui/card';

export default function Histogram({ counts, scope }: { counts: number[]; scope: string }) {
  const scaleMax = Math.max(...counts, 1);

  return (
    <Card title="When calls come in" sub={`by hour of day · ${scope} · ${CALL_TIME_ZONE}`}>
      <VBars
        bars={counts.map((count, hour) => ({
          label: String(hour).padStart(2, '0'),
          // A zero here is a real zero — no call came in that hour — unlike the
          // Overview's per-day P95, where a gap means "not measured".
          value: count,
        }))}
        scaleMax={scaleMax}
      />
    </Card>
  );
}
