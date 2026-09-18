/*
 * "How calls ended" — the two fixed vocabularies of contract §3.1 as a share
 * bar each, with the calls that have no `consent_record` row counted beside
 * both rather than inside either. Layout: `docs/design/Main-html` band 3, left.
 *
 * Trap 2 is the whole point of the card: a missing consent row is a state of
 * the call — in progress, or the finish transaction failed — and is never a
 * refusal, so it never appears as an outcome value.
 */

import {
  CALL_STATE_LABEL,
  consentOutcomeTone,
  endReasonTone,
  formatNumber,
  isKnownConsentOutcome,
  isKnownEndReason,
} from '@/calls';
import type { ReactNode } from 'react';
import type { Dashboard } from '@/dashboard';
import type { BadgeTone } from '@/ui/badge';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import Vocabulary from '@/ui/vocabulary';

/**
 * A vocabulary tone as a chart colour. The tones themselves are `src/calls.ts`'s
 * — the same decision the pills on the call list render — so a value that reads
 * ordinary there reads ordinary here.
 */
const TONE_COLOR: Record<BadgeTone, string> = {
  neutral: 'var(--border-strong)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--error)',
  info: 'var(--info)',
  terracotta: 'var(--chart-1)',
  lemongrass: 'var(--chart-2)',
};

/** The state that is not a value of either vocabulary (trap 2). */
const NOT_FINALIZED = 'var(--border-strong)';

interface Segment {
  key: string;
  label: ReactNode;
  calls: number;
  tone: string;
}

export default function HowCallsEnded({ data }: { data: Dashboard }) {
  const endReasons: Segment[] = [
    ...data.endReasons.map((row) => ({
      key: row.value,
      label: <Vocabulary value={row.value} known={isKnownEndReason(row.value)} />,
      calls: row.calls,
      tone: TONE_COLOR[endReasonTone(row.value)],
    })),
    ...(data.notFinalized === 0
      ? []
      : [
          {
            key: 'not-finalized',
            // The phrase is `src/calls.ts`'s, so this card and the call list
            // cannot drift apart on what a missing consent row is called.
            label: CALL_STATE_LABEL.not_finalized,
            calls: data.notFinalized,
            tone: NOT_FINALIZED,
          },
        ]),
  ];

  const outcomes: Segment[] = [
    ...data.outcomes.map((row) => ({
      key: row.value,
      label: <Vocabulary value={row.value} known={isKnownConsentOutcome(row.value)} />,
      calls: row.calls,
      tone: TONE_COLOR[consentOutcomeTone(row.value)],
    })),
    ...(data.noRow === 0
      ? []
      : [
          {
            key: 'no-row',
            label: 'no consent row yet',
            calls: data.noRow,
            tone: NOT_FINALIZED,
          },
        ]),
  ];

  return (
    <Card title="How calls ended" sub="Every call in the window, ordinary endings kept quiet">
      {data.calls === 0 ? (
        <EmptyState title="No calls in this window.">
          Nothing was answered in the window, so there is nothing to distribute.
        </EmptyState>
      ) : (
        <>
          <Distribution caption="call_log.end_reason" segments={endReasons} />
          <Distribution caption="consent_record.outcome" segments={outcomes} />
        </>
      )}
      <Caveat>
        A call with no consent row is a state of the call, never a refusal: the row is written
        at finalize. Those calls carry no end reason either, so they are counted beside both
        bars rather than inside them.
      </Caveat>
    </Card>
  );
}

/** One share bar and its legend; the bar is the listed values and nothing else. */
function Distribution({ caption, segments }: { caption: string; segments: Segment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.calls, 0);
  if (total === 0) {
    return (
      <div>
        <Caveat>
          <code className="font-num">{caption}</code> — nothing on record
        </Caveat>
      </div>
    );
  }

  return (
    <div>
      <Caveat>
        <code className="font-num">{caption}</code>
      </Caveat>
      <div className="mt-1.5 flex h-[22px] overflow-hidden rounded-sm">
        {segments.map((segment) => (
          <div
            key={segment.key}
            title={`${formatNumber(segment.calls)} calls`}
            style={{
              width: `${String((segment.calls / total) * 100)}%`,
              background: segment.tone,
            }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-2">
        {segments.map((segment) => (
          <span
            key={segment.key}
            className="flex items-center gap-[7px] text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted"
          >
            <span className="size-[7px] rounded-full" style={{ background: segment.tone }} />
            {segment.label}
            <span className="font-num font-semibold text-text-body tabular-nums">
              {formatNumber(segment.calls)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
