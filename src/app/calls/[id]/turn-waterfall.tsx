'use client';

/*
 * The waterfall of the one turn being read: the turn under the playhead, else
 * the turn last clicked in the transcript, else the first turn on record
 * (`currentTurnIdx`, `src/playback.ts`). The chart itself is the existing
 * island; what this file adds is the choice of turn and the playhead line's
 * place on that turn's axis.
 */

import { formatMs, formatNumber } from '@/calls';
import type { EndOfTurnRow, WaterfallRow } from '@/latency';
import { TARGETS } from '@/latency';
import { currentTurnIdx, turnAt, waterfallPlayheadMs, type TurnSpan } from '@/playback';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import { usePlayback } from './playback-provider';
import Waterfall from './waterfall';

/** One turn's chart, prepared on the server: no marks object crosses the boundary. */
export interface TurnChartView {
  idx: number;
  rows: WaterfallRow[];
  tail: EndOfTurnRow[];
  perceivedMs: number | null;
  pipelineMs: number | null;
  interrupted: boolean;
  /** `turn.source === 'reopen'`: head marks are the first generation's. */
  reopened: boolean;
  /** The `marks` column itself is null or `{}` — a pipeline write to look at. */
  noMarksStored: boolean;
  /** Marks were stored but no key of contract §3.2 carried a number. */
  noMarksReadable: boolean;
}

export default function TurnWaterfall({
  turns,
  spans,
}: {
  turns: TurnChartView[];
  spans: TurnSpan[];
}) {
  const { playheadMs, selectedIdx } = usePlayback();
  // The turn the playhead is inside, on `currentTurnIdx`'s own reading of
  // "the playhead has moved" (`playheadMs > 0`), so the chart, its line and its
  // caveat never disagree about where the audio is. The chart may be showing
  // another turn (a selection, or the first on record) and then carries no line.
  const span = playheadMs > 0 ? turnAt(spans, playheadMs) : null;
  const currentIdx = currentTurnIdx(spans, playheadMs, selectedIdx, turns[0]?.idx ?? null);
  const current = turns.find((turn) => turn.idx === currentIdx) ?? turns[0];

  if (current === undefined) {
    return (
      <EmptyState title="No turns on record.">
        The waterfall is drawn per turn; this call has none.
      </EmptyState>
    );
  }

  // The line is only meaningful on the turn it was measured against: when the
  // playhead sits on another turn, or before the first placed one, the chart
  // shown is a turn the playhead is not inside, and it draws no line.
  const line =
    span === null || span.idx !== current.idx ? null : waterfallPlayheadMs(playheadMs, span);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="mb-0 font-display text-[17px] leading-[1.3] font-semibold text-text-heading">
          Turn {formatNumber(current.idx)}
        </h3>
        {spans.length === 0 ? (
          <Caveat as="span">
            no turn can be placed on the recording (no <code>recording_started_at</code>, or no
            speech offsets) — the turn shown is the one selected in the transcript
          </Caveat>
        ) : span === null ? (
          <Caveat as="span">
            the playhead is before the first placed turn — the{' '}
            {selectedIdx === null ? 'first turn on record' : 'selected turn'} is shown
          </Caveat>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-[length:var(--size-eyebrow)] text-text-muted">
            caller-perceived silence (<code>speech_end</code> → <code>first_audio_out</code>)
          </div>
          <div className="mt-0.5 font-num tabular-nums">{formatMs(current.perceivedMs)}</div>
          <Caveat>
            target P95 &lt; {formatNumber(TARGETS.perceivedP95AlarmMs)} ms (aspirational)
            {current.perceivedMs !== null && current.perceivedMs > TARGETS.perceivedP95AlarmMs
              ? ' · over the P95 target'
              : ''}
          </Caveat>
        </div>
        <div>
          <div className="text-[length:var(--size-eyebrow)] text-text-muted">
            pipeline (<code>endpoint_decision</code> → <code>first_audio_out</code>)
          </div>
          <div className="mt-0.5 font-num tabular-nums">{formatMs(current.pipelineMs)}</div>
          <Caveat>
            target P95 &lt; {formatNumber(TARGETS.pipelineP95Ms)} ms
            {current.pipelineMs !== null && current.pipelineMs > TARGETS.pipelineP95Ms
              ? ' · over the P95 target'
              : ''}
          </Caveat>
        </div>
      </div>

      {current.noMarksStored ? (
        <EmptyState title="No marks recorded." />
      ) : current.noMarksReadable ? (
        <EmptyState title="Marks recorded but none readable.">
          No key of contract §3.2 carries a number.
        </EmptyState>
      ) : (
        <>
          <Waterfall rows={current.rows} tail={current.tail} playheadMs={line} />
          {line === null && spans.some((each) => each.idx === current.idx) ? (
            <Caveat>
              no playhead line: this turn has no <code>speech_end</code> mark to place the
              audio against, or the playhead is on another turn
            </Caveat>
          ) : null}
          {current.interrupted ? (
            <Caveat>
              <code>playback_end</code> is the last lull before the barge-in, not the end of the
              reply
            </Caveat>
          ) : null}
          {current.reopened ? (
            <Caveat>
              head marks are the first generation&rsquo;s, end-of-turn marks the last&rsquo;s
            </Caveat>
          ) : null}
        </>
      )}
    </div>
  );
}
