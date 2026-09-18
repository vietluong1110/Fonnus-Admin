/*
 * The four facts about the scope, as the artboard's right-hand card draws them
 * (`docs/design/Calls-html`): calls, median duration, turns per consented call,
 * recordings in the bucket.
 * The rule it renders: these describe the SCOPE — the window or the search —
 * and never the chip intersection (ADR 0006), and each caveat travels with the
 * number it qualifies rather than sitting in a footnote (CLAUDE.md).
 */

import { formatClock, formatNumber } from '@/calls';
import type { CallStats } from '@/calls-stats';
import Card from '@/ui/card';
import Stat from '@/ui/stat';

/** A share as whole percent; the denominator is said in the caveat beside it. */
function percent(share: number): string {
  return `${String(Math.round(share * 100))}%`;
}

export default function StatRow({ stats }: { stats: CallStats }) {
  return (
    <Card>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5">
        <Stat label="Calls" value={formatNumber(stats.calls)} />

        <Stat
          label="Median duration"
          value={stats.medianDurationMs === null ? '—' : formatClock(stats.medianDurationMs)}
          caveat={
            stats.medianDurationMs === null
              ? 'no call of this scope has ended yet'
              : // A call still open has no duration at all, so it is left out
                // rather than counted short (`docs/upstream.md` §Call list).
                stats.openCalls === 0
                ? 'over the calls that ended'
                : `over the calls that ended; ${formatNumber(stats.openCalls)} still open, left out`
          }
        />

        <Stat
          label="Turns per consented call"
          value={
            stats.turnsPerConsentedCall === null
              ? '—'
              : stats.turnsPerConsentedCall.toFixed(1)
          }
          // Trap 1: `turn_count` is rows written, and an unconsented call has
          // none however much the caller spoke — so the denominator is said.
          caveat={
            stats.turnsPerConsentedCall === null
              ? 'no consented call in this scope'
              : `turns written, over the ${formatNumber(stats.consentedCalls)} consented calls of ${formatNumber(stats.calls)}`
          }
        />

        <Stat
          label="Recording in the bucket"
          value={formatNumber(stats.recordings)}
          // Spread, not `undefined`: `exactOptionalPropertyTypes` reads an
          // explicit undefined as a value, and a share of no calls has none.
          {...(stats.recordingShare === null ? {} : { unit: percent(stats.recordingShare) })}
          caveat="the uploader runs between calls, so a recent call arrives minutes later"
        />
      </div>
    </Card>
  );
}
