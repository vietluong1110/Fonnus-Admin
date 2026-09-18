/*
 * "Turn failures" — the window's turns by `failed_leg · failed_stage`, the pair
 * the contract identifies a failure with. Layout: `docs/design/Main-html`
 * band 3, right.
 *
 * Trap 7: `failed_leg IS NOT NULL` is the one test — `interrupted` alone does
 * not separate a barge-in from a mid-reply failure — and a null stage under a
 * set leg is a provider error, which had no deadline to trip (contract §3.1).
 */

import { formatNumber, isKnownFailedLeg, isKnownFailedStage } from '@/calls';
import type { Dashboard } from '@/dashboard';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import HBar from '@/ui/hbar';
import Vocabulary from '@/ui/vocabulary';

export default function TurnFailures({ data }: { data: Dashboard }) {
  const worst = Math.max(1, ...data.turnFailures.map((row) => row.turns));
  const share = data.turns === 0 ? null : (data.failedTurns / data.turns) * 100;

  return (
    <Card title="Turn failures" sub="turn.failed_leg · turn.failed_stage">
      {data.turns === 0 ? (
        <EmptyState title="No turns in this window.">
          Nothing was measured, so nothing can have failed.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className={`font-num text-[34px] leading-none font-semibold tabular-nums ${data.failedTurns > 0 ? 'text-error' : ''}`}
            >
              {formatNumber(data.failedTurns)}
            </span>
            <Caveat as="span">
              of {formatNumber(data.turns)} turns
              {share === null ? '' : ` · ${share.toFixed(1)}%`}
            </Caveat>
          </div>

          {data.turnFailures.length === 0 ? (
            <Caveat>No turn in this window carries a failed leg.</Caveat>
          ) : (
            <div className="flex flex-col gap-2.5">
              {data.turnFailures.map((row) => (
                <div
                  key={`${row.leg}-${row.stage ?? 'provider'}`}
                  className="grid grid-cols-[130px_minmax(0,1fr)_32px] items-center gap-2.5"
                >
                  <span className="font-num text-[13px]">
                    <Vocabulary value={row.leg} known={isKnownFailedLeg(row.leg)} />
                    {row.stage === null ? (
                      // §3.1: a provider error has no deadline stage — a dash
                      // would read as a missing measurement.
                      <span className="text-text-muted"> · provider error</span>
                    ) : (
                      <>
                        <span className="text-text-muted"> · </span>
                        <Vocabulary value={row.stage} known={isKnownFailedStage(row.stage)} />
                      </>
                    )}
                  </span>
                  <HBar from={0} to={row.turns} scaleMax={worst} tone="var(--error)" />
                  <span className="text-right font-num text-[length:var(--size-ui)] font-semibold tabular-nums">
                    {formatNumber(row.turns)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Caveat>
        A leg with no stage is a provider error — it had no deadline to trip. Counted over the
        turns with marks, the same population every number on this screen stands on.
      </Caveat>
    </Card>
  );
}
