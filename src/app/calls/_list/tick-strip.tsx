/*
 * One call's turns, as the artboard draws them: a 3 px tick per turn on record,
 * the failed ones in --error (`docs/design/Calls-html`).
 * The rule it renders: `turnTicks` decides, not this file — a call with no turn
 * rows and no grant reads "none — not consented" and never zero ticks
 * (trap 1), and a failed tick is `failed_leg IS NOT NULL` (trap 7).
 */

import { NO_TURNS_LABEL, turnTicks } from '@/calls-stats';
import { formatNumber } from '@/calls';
import type { CallScopeRow } from '@/queries/calls';

export default function TickStrip({ call }: { call: CallScopeRow }) {
  const ticks = turnTicks(call);

  if (ticks === null) {
    return (
      <span
        className="text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted"
        title="an unconsented call's turns are never written (read contract trap 1)"
      >
        {NO_TURNS_LABEL}
      </span>
    );
  }

  const failed = ticks.filter(Boolean).length;

  return (
    <span
      className="flex flex-wrap items-center gap-x-[2px] gap-y-[3px]"
      title={
        failed === 0
          ? `${String(ticks.length)} turns on record`
          : `${String(ticks.length)} turns on record, ${String(failed)} failed`
      }
    >
      {ticks.map((isFailed, index) => (
        <i
          key={index}
          aria-hidden
          className={`h-[13px] w-[3px] rounded-xs ${
            isFailed ? 'bg-error' : 'bg-action-primary opacity-75'
          }`}
        />
      ))}
      <span className="ml-1.5 font-num text-[length:var(--size-eyebrow)] text-text-muted tabular-nums">
        {formatNumber(ticks.length)}
      </span>
    </span>
  );
}
