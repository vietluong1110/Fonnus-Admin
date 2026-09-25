/*
 * "Turn failures" — the window's turns by `failed_leg · failed_stage`, the pair
 * the contract identifies a failure with. Layout: `docs/design/Main-html`
 * band 3, right; each pair is one row of capsule tracks (ADR 0014 decision 7)
 * labelled as one chip from the glossary (`failureChip`, ADR 0013).
 *
 * Trap 7: `failed_leg IS NOT NULL` is the one test — `interrupted` alone does
 * not separate a barge-in from a mid-reply failure — and a null stage under a
 * set leg is a provider error, which had no deadline to trip (contract §3.1).
 */

import { formatNumber, isKnownFailedLeg, isKnownFailedStage } from '@/calls';
import type { Dashboard } from '@/dashboard';
import Card from '@/ui/card';
import Caveat, { Hint } from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import { failureChip } from '@/ui/glossary';
import HBar from '@/ui/hbar';
import Term from '@/ui/term';
import Vocabulary from '@/ui/vocabulary';

export default function TurnFailures({ data }: { data: Dashboard }) {
  const worst = Math.max(1, ...data.turnFailures.map((row) => row.turns));
  const share = data.turns === 0 ? null : (data.failedTurns / data.turns) * 100;

  return (
    // The two columns the rows count, as the title's tooltip.
    <Card
      title={<Hint hint="counted by turn.failed_leg · turn.failed_stage">Turn failures</Hint>}
    >
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
              of {formatNumber(data.turns)} turns with marks
              {share === null ? '' : ` · ${share.toFixed(1)}%`}
            </Caveat>
          </div>

          {data.turnFailures.length === 0 ? (
            <Caveat>No turn in this window carries a failed leg.</Caveat>
          ) : (
            <div className="flex flex-col gap-3">
              {data.turnFailures.map((row) => (
                // `TrackRow`'s columns, with a label `TrackRow` cannot take:
                // a leg or stage outside the contract keeps its ⚠ badge.
                <div
                  key={`${row.leg}-${row.stage ?? 'provider'}`}
                  className="grid grid-cols-[12rem_1fr_3rem] items-center gap-3"
                >
                  <FailureLabel leg={row.leg} stage={row.stage} />
                  <HBar thick from={0} to={row.turns} scaleMax={worst} tone="var(--error)" />
                  <span className="text-right font-num text-[length:var(--size-ui)] font-semibold tabular-nums">
                    {formatNumber(row.turns)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * The pair as one chip name over its pipeline term ("LLM · provider error" over
 * `llm`), or — when the leg or the stage is outside the contract's list — the
 * stored values with the ⚠ badge on the one the contract does not know.
 */
function FailureLabel({ leg, stage }: { leg: string; stage: string | null }) {
  const legKnown = isKnownFailedLeg(leg);
  const stageKnown = stage === null || isKnownFailedStage(stage);
  const chip = failureChip(leg, stage);
  if (legKnown && stageKnown && chip !== null) {
    return (
      <span className="text-[13px]">
        <Term term={chip} />
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1 text-[13px]">
      <Vocabulary value={leg} known={legKnown} of="failedLeg" />
      <span className="text-text-muted">·</span>
      {/* §3.1: a null stage under a set leg is a provider error, never a dash. */}
      {stage === null ? (
        <span className="text-text-muted">provider error</span>
      ) : (
        <Vocabulary value={stage} known={stageKnown} of="failedStage" />
      )}
    </span>
  );
}
