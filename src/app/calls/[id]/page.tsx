import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { annotationHistory } from '@/annotations';
import { RECORDING_REASON, isKnownArtifactState, recordingAccess } from '@/artifacts';
import { voiceFact } from '@/boot-report';
import { ranOnOf } from '@/call-config';
import {
  CALL_STATE_LABEL,
  CALL_STATE_TONE,
  callState,
  consentOutcomeTone,
  endReasonTone,
  failureLine,
  formatCount,
  formatDuration,
  formatNumber,
  formatWhen,
  isKnownConsentOutcome,
  isKnownEndReason,
  isUuid,
  maskPhone,
  meanPipelineMs,
  showCallerData,
} from '@/calls';
import { getConfig } from '@/config';
import { STORED_COST_TIP, callCostView, costCell, floorMark, floorSentence, formatVnd } from '@/cost';
import { configuredRouterOf, parseSnapshot, renderValue } from '@/dashboard';
import { heardNote, type LaneSegment } from '@/interval-lane';
import {
  callIntervals,
  intervalCells,
  parseEventRow,
  trailVerdict,
  type EventRow,
} from '@/intervals';
import { parseMarks, setApartSource } from '@/latency';
import {
  bubbleView,
  greetingSpan,
  recordingOffsetMs,
  parseTurnParam,
  turnBars,
  turnSpans,
  type GreetingSpan,
  type TurnBar,
  type TurnBubbleView,
  type TurnSpan,
} from '@/playback';
import {
  getCall,
  getCallAnnotations,
  getCallEvents,
  getTurns,
  type CallDetailRow,
  type TurnRow,
} from '@/queries/calls';
import { bootReportBefore } from '@/queries/boot-report';
import type { AnnotationCellItem } from '@/annotations';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import CopyButton from '@/ui/copy-button';
import EmptyState from '@/ui/empty-state';
import PageHead from '@/ui/page-head';
import Stat from '@/ui/stat';
import { failureChip } from '@/ui/glossary';
import Vocabulary from '@/ui/vocabulary';
import CallCard from './_detail/call-card';
import ConfigSnapshot from './_detail/config-snapshot';
import ConsentCard from './_detail/consent-card';
import RanOnStrip from './_detail/ran-on';
import TurnTable, { type TurnTableRow } from './_detail/turn-table';
import {
  selectedTurnView,
  TURN_COUNT_HINT,
  turnCostCells,
  turnCountView,
} from './_detail/turn-view';
import type { IntervalRow } from './interval-rows';
import IntervalsCard, { type CurrentAnnotation } from './intervals-card';
import PlaybackProvider from './playback-provider';
import Player from './player';
import SelectedTurn, { type SelectedTurnData } from './selected-turn';
import Transcript from './transcript';

// One call, as the database holds it right now.
export const dynamic = 'force-dynamic';

/**
 * One read per request, shared by the page and its `<title>`: Next renders
 * `generateMetadata` and the page in the same request, and a second `getCall`
 * would be a second round trip for the same row.
 */
const callOnce = cache(getCall);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: 'Call · Fonnus Admin' };
  const call = await callOnce(id);
  // The title is masked like the head (ADR 0008): it is read in a browser tab
  // over someone's shoulder and pasted into chat with the screenshot.
  const masked = call === null ? null : maskPhone(call.caller_phone_e164);
  return { title: `${masked === null ? 'Call' : `Call from ${masked}`} · Fonnus Admin` };
}

export default async function CallPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // Checked before any query: a malformed id names no call, so no SQL runs.
  if (!isUuid(id)) notFound();

  const call = await callOnce(id);
  if (call === null) notFound();

  const snapshot = parseSnapshot(call.config_snapshot);
  // Only a snapshot that carries a voice id (`voiceIdOf`, contract §3.4) has an
  // id to label, so only then is the one `boot_report` read issued (ADR 0012 D6).
  const hasVoice = voiceFact(snapshot, null) !== null;

  // Up to four independent statements on the one `console` pool, side by side:
  // the trail and the annotations need `recording_started_at` and `outcome`
  // from `getCall`, the voice's report its `tenant_id` and `started_at`, all
  // already returned, and nothing else (ADR 0010, "No shared transaction").
  const [turns, events, annotations, voiceReport] = await Promise.all([
    getTurns(id),
    getCallEvents(id),
    getCallAnnotations(id),
    hasVoice ? bootReportBefore(call.tenant_id, call.started_at) : null,
  ]);
  const voice = voiceFact(snapshot, voiceReport);
  const ran = ranOnOf(
    snapshot,
    call,
    turns.map((turn) => turn.llm_model),
  );
  const state = callState(call.ended_at, call.outcome);
  // Read once per render and passed down: the gate is deployment state, not
  // per-turn state (ADR 0005).
  const config = getConfig();
  const gate = config.consentGate;
  const showCaller = showCallerData(call.outcome, gate);
  const access = recordingAccess(call, config);
  const selectedIdx = parseTurnParam((await searchParams).turn, turns);

  // The call's event trail, verdict first (ADR 0010 decision 3): a row the
  // contract's shape does not fit is dropped here, at the one trust boundary,
  // and never reaches the derivation.
  const rows = events.map(parseEventRow).filter((row): row is EventRow => row !== null);
  // The `absent` verdict names this key, and only it (trap 8). An absent key is
  // not a null one (§3.4), which is why it is read the way the lede reads its
  // own facts rather than through a renderer that flattens the two.
  const recordCalls =
    snapshot !== null && Object.hasOwn(snapshot, 'RECORD_CALLS')
      ? renderValue(snapshot['RECORD_CALLS'])
      : null;
  const verdict = trailVerdict(rows, { recordCalls, ended: call.ended_at !== null });
  const intervals =
    verdict.kind === 'absent'
      ? null
      : callIntervals(rows, {
          recordingStartedAt: call.recording_started_at,
          holeFromSeq: verdict.holeFromSeq,
        });
  // The one place a recogniser text is resolved, through the one gate (ADR
  // 0005): the cells below carry strings, and the lane carries no text at all.
  const intervalRows: IntervalRow[] = intervalCells(intervals ?? [], rows, {
    outcome: call.outcome,
    gate,
    assistantText: new Map(turns.map((turn) => [turn.idx, turn.assistant_text])),
    annotations,
  }).map((cell, index) => {
    const interval = intervals?.[index];
    return {
      ...cell,
      fromMs: interval?.fromMs ?? 0,
      toMs: interval?.toMs ?? 0,
      heardNote: interval === undefined ? null : heardNote(interval, cell.callerLine),
    };
  });
  const currentAnnotations = overlapsOf(intervalRows);
  // Every annotation row of the call, current and history, with its texts
  // gated here on the server exactly as the cells' are (contract §3, trap 13).
  const annotationRows = annotationHistory(annotations, { outcome: call.outcome, gate });
  // A turn that failed mid-reply is the one being looked for (trap 7), so its
  // segment wears the error tone the turn block already wears.
  const failedTurns = new Set(
    turns.filter((turn) => turn.failed_leg !== null).map((turn) => turn.idx),
  );
  // No trail, or a trail with no clock to sit on: the lane falls back to the
  // turn blocks under the caveat that says why.
  const laneSegments: LaneSegment[] | null =
    intervals === null || intervals.length === 0
      ? null
      : intervals.map((interval) => ({
          fromMs: interval.fromMs,
          toMs: interval.toMs,
          kind: interval.holder.kind,
          label: interval.holder.label,
          turnIdx: interval.holder.turnIdx,
          unsupported: interval.unsupported,
          failed: interval.holder.turnIdx !== null && failedTurns.has(interval.holder.turnIdx),
        }));
  // The caveat shown only where it applies: a caller whose sound reached nobody.
  const anyUnheard = (intervals ?? []).some((interval) => interval.unheard);

  // The placement rules of `docs/upstream.md` §Artifacts, run once on the
  // server; the islands draw what this returns and re-derive nothing.
  const { placed, unplaced } = turnSpans(turns, call.recording_started_at);
  const greeting = greetingSpan(call.greeting_marks, call.recording_started_at);
  const bars = turnBars(turns);
  const fallbackEndMs = axisFallbackMs(call, placed, greeting);

  const selectedTurns: SelectedTurnData[] = turns.map((turn) => ({
    idx: turn.idx,
    view: selectedTurnView(
      {
        marks: parseMarks(turn.marks),
        pipeline_ms: turn.pipeline_ms,
        caller_perceived_ms: turn.caller_perceived_ms,
        interrupted: turn.interrupted,
        setApart: setApartSource(turn.source),
      },
      call.recording_started_at,
    ),
    // Decided on the stored value, not the parsed one: a `marks` object whose
    // every entry the parser refused is a pipeline write fault to surface,
    // not a turn that stamped nothing.
    noMarksStored: hasNoMarksStored(turn),
    interrupted: turn.interrupted,
    failure: failureChip(turn.failed_leg, turn.failed_stage),
    failureLine: failureLine(turn.failed_leg, turn.failed_stage, turn.failed_after_ms),
    costs: turnCostCells(turn, call.tts_model),
    tokensIn: turn.tokens_in,
    tokensOut: turn.tokens_out,
    tokensCached: turn.tokens_cached,
  }));

  // Every bubble, gate included, is built by the one pure function in
  // `src/playback.ts` — the consent decision is pinned by its tests, not by
  // reading this page (`src/playback.test.ts`).
  const bubbleTurns: TurnBubbleView[] = turns.map((turn) =>
    bubbleView(turn, {
      outcome: call.outcome,
      state,
      gate,
      recordingStartedAt: call.recording_started_at,
      span: placed.find((each) => each.idx === turn.idx),
    }),
  );

  // The table's rows take the gate's decision from the same bubble views, so
  // the transcript and the table can never disagree about what is withheld.
  const tableRows: TurnTableRow[] = turns.map((turn, index) => {
    const bubble = bubbleTurns[index];
    return {
      idx: turn.idx,
      interrupted: turn.interrupted,
      failure: failureChip(turn.failed_leg, turn.failed_stage),
      failureLine: failureLine(turn.failed_leg, turn.failed_stage, turn.failed_after_ms),
      preview: preview(bubble?.callerText ?? null, turn.assistant_text),
      callerWithheld: bubble?.callerWithheld ?? !showCaller,
      withheldReason: bubble?.withheldReason ?? '',
      withheldReasonKnown: bubble?.withheldReasonKnown ?? true,
      withheldByState: bubble?.withheldByState ?? false,
      costs: turnCostCells(turn, call.tts_model),
      tokensIn: turn.tokens_in,
      tokensOut: turn.tokens_out,
      tokensCached: turn.tokens_cached,
      perceivedMs: turn.caller_perceived_ms,
      pipelineMs: turn.pipeline_ms,
    };
  });

  // The stat strip's cost at list price (ADR 0015): while any model the call
  // used — its configured OPENROUTER_MODEL included, since an unconsented call
  // has no turn rows to name it (trap 1), and the router model of a shadow
  // call (trap 3) — has no price row, "floor" sits beside the stored figure, the strip
  // names those models and the tooltip ends on ADR 0015 D7's sentence.
  const cost = callCostView(call, turns, ran.llm.model, configuredRouterOf(call.config_snapshot));
  const costCaveat =
    cost.unpriced.length === 0 ? 'list price' : `list price · ${costCell(null, cost.unpriced)}`;
  const floor = floorSentence(cost.unpriced);
  const costTip = floor === null ? STORED_COST_TIP : `${STORED_COST_TIP}; ${floor}`;
  const turnCount = turnCountView(call.turn_count, turns.length, state);
  const latency = meanPipelineMs(turns);
  const stateLabel = CALL_STATE_LABEL[state];
  const stateTone = CALL_STATE_TONE[state];
  const maskedPhone = maskPhone(call.caller_phone_e164);

  return (
    <>
      <PageHead
        // Trap 5 and ADR 0008: a null number is age or a call that never
        // reached the column — "Call", never a blank — and a number that is on
        // record is masked here and raw only in the Call card below.
        title={maskedPhone === null ? 'Call' : `Call from ${maskedPhone}`}
        back={{ href: '/calls', label: 'Calls' }}
      >
        {call.end_reason === null ? (
          stateLabel === null || stateTone === null ? null : (
            <Badge tone={stateTone}>{stateLabel}</Badge>
          )
        ) : (
          <Vocabulary
            value={call.end_reason}
            known={isKnownEndReason(call.end_reason)}
            tone={endReasonTone(call.end_reason)}
            of="endReason"
          />
        )}
        {/* The id is pasted into a log search or a chat, never read, so it is
            one click here rather than a string to select in the Call card. */}
        <div className="ml-auto">
          <CopyButton value={call.id} label="Copy call id" />
        </div>
      </PageHead>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--size-ui)] text-text-muted">
        <span>{formatWhen(call.started_at)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatDuration(call.started_at, call.ended_at)}</span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-2">
          consent{' '}
          {call.outcome === null ? (
            // Trap 2: no consent row is a state of the call, never "no consent"
            // — and the state's wording lives in `CALL_STATE_LABEL` alone.
            <OutcomeText call={call} state={state} />
          ) : (
            <Vocabulary
              value={call.outcome}
              known={isKnownConsentOutcome(call.outcome)}
              tone={consentOutcomeTone(call.outcome)}
              of="consentOutcome"
            />
          )}
        </span>
        {/* `maskPhone` returns null only for a null column, so this is the
            caller number the row never carried or the sweep took (trap 5). */}
        {maskedPhone === null ? (
          <>
            <span aria-hidden="true">·</span>
            <span>caller number not on record</span>
          </>
        ) : null}
      </div>

      <RanOnStrip ran={ran} voice={voice} tenantId={call.tenant_id} />

      {/* One playhead for the player, the lanes, the transcript, the selected
          turn and the turn table; everything inside is rendered here and handed
          down as props, so no query result crosses the client boundary. */}
      <PlaybackProvider spans={placed} initialSelectedIdx={selectedIdx}>
        <Card title="The call">
          <RecordingBlock
            call={call}
            state={state}
            access={access}
            placed={placed}
            greeting={greeting}
            intervals={laneSegments}
            bars={bars}
            unplaced={unplaced}
            fallbackEndMs={fallbackEndMs}
          />

          <div className="grid grid-cols-2 gap-5 border-t border-border-hairline pt-4 md:grid-cols-3 lg:grid-cols-5">
            <Stat label="Call duration" value={formatDuration(call.started_at, call.ended_at)} />
            <Stat
              label="Number of turns"
              value={formatCount(call.turn_count)}
              hint={TURN_COUNT_HINT}
              note={turnCount.note}
            />
            <Stat
              label="Total cost"
              value={cost.totalVnd === null ? 'not reported' : formatVnd(cost.totalVnd)}
              caveat={costCaveat}
              hint={costTip}
              note={cost.totalVnd === null ? null : floorMark(cost.unpriced)}
            />
            <Stat
              label="Cost per minute"
              value={cost.perMinuteVnd === null ? 'not reported' : formatVnd(cost.perMinuteVnd)}
              caveat={costCaveat}
              hint={costTip}
              note={cost.perMinuteVnd === null ? null : floorMark(cost.unpriced)}
            />
            <Stat
              label="Average turn latency"
              value={
                latency.value === null ? 'not measured' : formatNumber(Math.round(latency.value))
              }
              {...(latency.value === null ? {} : { unit: 'ms' })}
              hint={`mean pipeline_ms over ${formatNumber(latency.over)} of ${formatNumber(turns.length)} turns; a turn with no measurement is left out${
                latency.setApart > 0
                  ? `, and so ${latency.setApart === 1 ? 'is 1 carry_over or reopen turn' : `are ${formatNumber(latency.setApart)} carry_over or reopen turns`}, whose span starts before the turn was committed`
                  : ''
              }`}
            />
          </div>
        </Card>

        <div className="grid gap-[18px] min-[1180px]:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Card title="Transcript">
            {bubbleTurns.length === 0 ? (
              <EmptyState title="No turns on record.">
                {showCaller ? (
                  <>
                    No turn completed, or a turn insert failed on the pipeline side (its{' '}
                    <code>/metrics</code> counter <code>db_write_failures_total</code> says which).
                    Consent outcome: <OutcomeText call={call} state={state} />.
                  </>
                ) : (
                  <>
                    The pipeline writes turns only after consent (trap 1). Consent outcome:{' '}
                    <OutcomeText call={call} state={state} />.
                  </>
                )}
              </EmptyState>
            ) : (
              <Transcript turns={bubbleTurns} spans={placed} playable={access === 'playable'} />
            )}
          </Card>

          <Card title="Selected turn">
            <SelectedTurn turns={selectedTurns} spans={placed} />
          </Card>
        </div>

        {/* A sibling of the recording block, never inside it (ADR 0010 decision
            6): a call whose recording is withheld, not archived or gone still
            has a trail, and this table is where it reads. */}
        <IntervalsCard
          verdict={verdict}
          rows={intervalRows}
          current={currentAnnotations}
          history={annotationRows}
          anyUnheard={anyUnheard}
        />

        <details>
          <summary className="cursor-pointer border-t border-border-hairline pt-3 font-display text-[17px] leading-[1.3] font-semibold text-text-heading">
            Pipeline detail
          </summary>

          <div className="mt-[18px] flex flex-col gap-[18px]">
            <Card title={`Turns on record (${formatNumber(turns.length)})`}>
              {tableRows.length === 0 ? (
                <EmptyState title="No turns on record." />
              ) : (
                <TurnTable rows={tableRows} spans={placed} />
              )}
            </Card>

            <Card title="Call">
              <CallCard call={call} />
            </Card>

            <Card title="Config snapshot">
              <ConfigSnapshot value={call.config_snapshot} voice={voice} />
            </Card>

            <Card title="Consent">
              <ConsentCard call={call} state={state} />
            </Card>
          </div>
        </details>
      </PlaybackProvider>
    </>
  );
}

/**
 * Each current annotation once, with the intervals it overlaps, for the
 * history block — the cells carry an annotation on every interval it touches.
 */
function overlapsOf(rows: IntervalRow[]): CurrentAnnotation[] {
  const byId = new Map<string, { item: AnnotationCellItem; overlaps: string[] }>();
  for (const row of rows) {
    for (const item of row.annotations) {
      const entry = byId.get(item.id) ?? { item, overlaps: [] };
      entry.overlaps.push(`${row.from}–${row.to}`);
      byId.set(item.id, entry);
    }
  }
  return [...byId.values()];
}

/** The first words of a turn, caller then assistant, for the table's one line. */
function preview(callerText: string | null, assistantText: string | null): string | null {
  const parts = [callerText, assistantText].filter((text): text is string => text !== null);
  return parts.length === 0 ? null : parts.join(' → ');
}

/**
 * The axis before the audio reports its own length, and when there is no player
 * at all: the last turn's end, the greeting's end, or the call's own length
 * measured on the recording clock, whichever is longest. Zero when none is
 * known — the axis guards against dividing by it.
 */
function axisFallbackMs(
  call: CallDetailRow,
  placed: TurnSpan[],
  greeting: GreetingSpan | null,
): number {
  const ends = placed.map((span) => span.endMs);
  if (greeting !== null) ends.push(greeting.endMs);
  if (call.recording_started_at !== null && call.ended_at !== null) {
    ends.push(recordingOffsetMs(call.ended_at.getTime(), call.recording_started_at.getTime()));
  }
  return ends.length === 0 ? 0 : Math.max(...ends);
}

/** A `marks` column that is null or an empty object — nothing was ever stamped. */
function hasNoMarksStored(turn: TurnRow): boolean {
  return (
    turn.marks === null || (typeof turn.marks === 'object' && Object.keys(turn.marks).length === 0)
  );
}

/** The consent outcome inline, with trap 2's state when there is no row. */
function OutcomeText({
  call,
  state,
}: {
  call: CallDetailRow;
  state: ReturnType<typeof callState>;
}) {
  // A state with no label is `finalized`, which this branch cannot reach: a
  // null outcome is exactly what makes the state one of the other two.
  if (call.outcome === null) return <>{CALL_STATE_LABEL[state] ?? ''}</>;
  return (
    <Vocabulary
      value={call.outcome}
      known={isKnownConsentOutcome(call.outcome)}
      of="consentOutcome"
    />
  );
}

/**
 * The recording, in one of the five states of `recordingAccess` (ADR 0004).
 * Only `playable` renders an `<audio>` and the two lanes — the lanes are the
 * recording's axis, and without audio there is nothing to scrub. Every other
 * state is said in a dashed box, which means "no content" and never a control
 * (§Look and feel); the turn table below still reads, because timings are not
 * caller speech.
 */
function RecordingBlock({
  call,
  state,
  access,
  placed,
  greeting,
  intervals,
  bars,
  unplaced,
  fallbackEndMs,
}: {
  call: CallDetailRow;
  state: ReturnType<typeof callState>;
  access: ReturnType<typeof recordingAccess>;
  placed: TurnSpan[];
  greeting: GreetingSpan | null;
  intervals: LaneSegment[] | null;
  bars: TurnBar[];
  unplaced: number[];
  fallbackEndMs: number;
}) {
  switch (access) {
    case 'not_configured':
      return (
        <EmptyState title={`${RECORDING_REASON.not_configured}.`}>
          The <code>S3_*</code> group is unset (<code>.env.example</code>, ADR 0004), so no
          call&rsquo;s recording can be reached from here. The rest of the page still renders.
        </EmptyState>
      );
    case 'not_archived':
      return (
        <EmptyState title={`${RECORDING_REASON.not_archived}.`}>
          <code>artifact_state</code>:{' '}
          <Vocabulary
            value={call.artifact_state}
            known={call.artifact_state !== null && isKnownArtifactState(call.artifact_state)}
          />
          . The uploader runs only while no call is active, so a call that just ended reaches the
          bucket seconds to minutes later.
        </EmptyState>
      );
    case 'gone':
      return (
        <EmptyState title={`${RECORDING_REASON.gone}.`}>
          <code>artifact_state</code> is <code>expired</code> and the row carries no{' '}
          <code>artifact_key_prefix</code>: the disk copy was swept and the bucket copy went with
          it.
        </EmptyState>
      );
    case 'withheld':
      return (
        <EmptyState title={`${RECORDING_REASON.withheld}.`}>
          {call.outcome === null ? (
            // Trap 2: no consent row is a state of the call, not a refusal —
            // the row is written in the finish transaction.
            <>the call is {CALL_STATE_LABEL[state] ?? ''}, so no consent outcome is on record yet</>
          ) : (
            <>
              consent:{' '}
              <Vocabulary
                value={call.outcome}
                known={isKnownConsentOutcome(call.outcome)}
                tone={consentOutcomeTone(call.outcome)}
                of="consentOutcome"
              />
            </>
          )}{' '}
          — <code>call.wav</code> carries the caller&rsquo;s channel, so it is withheld whole (trap
          4).
        </EmptyState>
      );
    case 'playable':
      return (
        <Player
          callId={call.id}
          spans={placed}
          greeting={greeting}
          intervals={intervals}
          bars={bars}
          unplaced={unplaced}
          fallbackEndMs={fallbackEndMs}
        />
      );
  }
}
