/*
 * One call's turns, as the artboard draws them: a 3 px tick per turn on record,
 * the failed ones in --error (`docs/design/Calls-html`).
 * The rule it renders: `turnTicks` decides, not this file — a call with no turn
 * rows and no grant reads "none — not consented" and never zero ticks
 * (trap 1), and a failed tick is `failed_leg IS NOT NULL` (trap 7).
 *
 * A failed tick names its failure in a drawn tooltip on hover (`failedTickTip`,
 * through the glossary); the tick is 3 px and not a control, so it is no tab
 * stop — the count beside the strip is, and its tooltip says every failure
 * again for the keyboard and a screen reader.
 */

import { NO_TURNS_LABEL, failedTickTip, turnTicks } from '@/calls-stats';
import { formatNumber } from '@/calls';
import type { CallScopeRow } from '@/queries/calls';
import Tooltip from '@/ui/tooltip';
import type { TipSide } from './call-table';

const TICK = 'h-[13px] w-[3px] rounded-xs';

export default function TickStrip({
  call,
  tipSide,
}: {
  call: CallScopeRow;
  /** `bottom` in the table's first rows, where an upward tooltip is clipped. */
  tipSide: TipSide;
}) {
  const ticks = turnTicks(call);

  if (ticks === null) {
    return (
      <Tooltip
        tip="an unconsented call's turns are never written (read contract trap 1)"
        side={tipSide}
      >
        <span className="text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted">
          {NO_TURNS_LABEL}
        </span>
      </Tooltip>
    );
  }

  const failures = ticks.filter((tick) => tick !== null);
  const summary =
    failures.length === 0
      ? `${String(ticks.length)} turns on record`
      : `${String(ticks.length)} turns on record, ${String(failures.length)} failed: ${failures
          .map(failedTickTip)
          .join('; ')}`;

  return (
    <span className="flex flex-wrap items-center gap-x-[2px] gap-y-[3px]">
      {ticks.map((failed, index) =>
        failed === null ? (
          <i key={index} aria-hidden className={`${TICK} bg-action-primary opacity-75`} />
        ) : (
          <Tooltip key={index} tip={failedTickTip(failed)} side={tipSide} asChild>
            <i aria-hidden className={`${TICK} bg-error`} />
          </Tooltip>
        ),
      )}
      <Tooltip tip={summary} side={tipSide}>
        <span className="ml-1.5 font-num text-[length:var(--size-eyebrow)] text-text-muted tabular-nums">
          {formatNumber(ticks.length)}
        </span>
      </Tooltip>
    </span>
  );
}
