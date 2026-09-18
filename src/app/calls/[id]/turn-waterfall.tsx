'use client';

/*
 * The waterfall of the one turn being read: the turn under the playhead, else
 * the turn last clicked in the transcript, else the first turn on record
 * (`currentTurnIdx`, `src/playback.ts`). The chart itself is the existing
 * island; what this file adds is the choice of turn and the playhead line's
 * place on that turn's axis.
 */

import { formatCount, formatMs, formatNumber } from '@/calls';
import type { EndOfTurnRow, HeadPairRow, WaterfallRow } from '@/latency';
import { TARGETS } from '@/latency';
import { currentTurnIdx, turnAt, waterfallPlayheadMs, type TurnSpan } from '@/playback';
import Badge from '@/ui/badge';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import Field from '@/ui/field';
import HBar from '@/ui/hbar';
import { usePlayback } from './playback-provider';
import Waterfall from './waterfall';

/** One turn's chart, prepared on the server: no marks object crosses the boundary. */
export interface TurnChartView {
  idx: number;
  rows: WaterfallRow[];
  tail: EndOfTurnRow[];
  /** `headPairRows(marks)` — present only when the turn stamped both marks. */
  head: HeadPairRow[];
  perceivedMs: number | null;
  pipelineMs: number | null;
  interrupted: boolean;
  /** `failureLine(...)`, or null when `failed_leg` is null (trap 7). */
  failure: string | null;
  llmModel: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** A share of `tokens_in`, never on top of it (`docs/upstream.md`). */
  tokensCached: number | null;
  ttsChars: number | null;
  ttsBytes: number | null;
  /** Offsets into the recording; a null pair is a turn with no voice length. */
  speechStartMs: number | null;
  speechEndMs: number | null;
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
          Turn {formatNumber(current.idx)}{' '}
          <span className="text-[length:var(--size-eyebrow)] font-normal text-text-muted">
            of {formatNumber(turns.length)}
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {current.interrupted ? <Badge tone="terracotta">interrupted</Badge> : null}
          {current.failure === null ? null : (
            <Badge tone="warning" title={current.failure}>
              failed
            </Badge>
          )}
        </div>
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

      <div className="flex flex-col gap-3">
        <Headline
          name="pipeline_ms"
          marks="endpoint_decision → first_audio_out"
          valueMs={current.pipelineMs}
          targetMs={TARGETS.pipelineP95Ms}
          targetNote={`target P95 < ${formatNumber(TARGETS.pipelineP95Ms)} ms`}
        />
        <Headline
          name="caller_perceived_ms"
          marks="speech_end → first_audio_out"
          valueMs={current.perceivedMs}
          targetMs={TARGETS.perceivedP95AlarmMs}
          targetNote={`alarm at P95 ≥ ${formatNumber(TARGETS.perceivedP95AlarmMs)} ms (aspirational)`}
        />
      </div>

      {current.noMarksStored ? (
        <EmptyState title="No marks recorded." />
      ) : current.noMarksReadable ? (
        <EmptyState title="Marks recorded but none readable.">
          No key of contract §3.2 carries a number.
        </EmptyState>
      ) : (
        <>
          <Waterfall
            rows={current.rows}
            tail={current.tail}
            head={current.head}
            playheadMs={line}
          />
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

      {current.failure === null ? null : (
        <div>
          <p className="mb-0 text-[length:var(--size-ui)]">{current.failure}</p>
          <Caveat>
            elapsed since <code>endpoint_decision</code>, not the bound — the bound is{' '}
            <code>config_snapshot.LLM_TTFB_MS</code> and its siblings
          </Caveat>
        </div>
      )}

      {/* What the transcript above leaves out. The spoken text is not repeated
          here: it is the transcript's, and a second copy would be a second
          place the consent gate has to be right. */}
      <dl className="m-0 grid grid-cols-2 gap-4 border-t border-border-hairline pt-3.5">
        <Field label="LLM model">{current.llmModel ?? 'not reported'}</Field>
        <Field label="Tokens">
          {formatCount(current.tokensIn)} in · {formatCount(current.tokensOut)} out
          <Caveat>of which cached: {formatCount(current.tokensCached)}</Caveat>
        </Field>
        <Field label="TTS output">
          {formatCount(current.ttsChars)} chars · {formatCount(current.ttsBytes)} bytes
        </Field>
        <Field label="Caller audio">
          {current.speechStartMs === null || current.speechEndMs === null
            ? 'not reported'
            : `${formatMs(current.speechStartMs)} → ${formatMs(current.speechEndMs)}`}
          <Caveat>offset into the recording</Caveat>
        </Field>
      </dl>
    </div>
  );
}

/**
 * One headline span of the turn against its target (ADR 0007): the number, the
 * bar, and how far it sits from the target. Both targets are P95s over a call
 * set, so on a single turn they are a hint and the caveat says so.
 */
function Headline({
  name,
  marks,
  valueMs,
  targetMs,
  targetNote,
}: {
  name: string;
  marks: string;
  valueMs: number | null;
  targetMs: number;
  targetNote: string;
}) {
  const over = valueMs !== null && valueMs > targetMs;
  // The scale keeps the target on the track even when the turn beat it, so the
  // dashed mark is where the eye expects it on every turn of the call.
  const scaleMax = Math.max(targetMs, valueMs ?? 0) * 1.05;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <code className="text-[length:var(--size-ui)]">{name}</code>
        <span className={`font-num text-[19px] font-semibold tabular-nums${over ? ' text-error' : ''}`}>
          {formatMs(valueMs)}
        </span>
      </div>
      <div className="mt-1.5">
        {/* A turn with no number has no bar: "not measured" is the reading, and
            a track drawn to 0 would say the reply was instant. */}
        {valueMs === null ? null : (
          <HBar
            from={0}
            to={valueMs}
            scaleMax={scaleMax}
            tone={over ? 'var(--error)' : 'var(--chart-1)'}
            target={targetMs}
          />
        )}
      </div>
      <Caveat>
        {marks} · {targetNote}
        {over ? ` · ${formatNumber(valueMs - targetMs)} ms over` : ''}
      </Caveat>
    </div>
  );
}
