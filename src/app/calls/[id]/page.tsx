import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { RECORDING_REASON, isKnownArtifactState, recordingAccess } from '@/artifacts';
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
  isKnownTurnSource,
  isUuid,
  maskPhone,
  parseCostVnd,
  shortSha,
  showCallerData,
} from '@/calls';
import { getConfig } from '@/config';
import { parseSnapshot, renderValue } from '@/dashboard';
import { endOfTurnRows, headPairRows, parseMarks, waterfallRows } from '@/latency';
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
import { getCall, getTurns, type CallDetailRow, type TurnRow } from '@/queries/calls';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import EmptyState from '@/ui/empty-state';
import PageHead from '@/ui/page-head';
import Stat from '@/ui/stat';
import Vocabulary from '@/ui/vocabulary';
import CallCard from './_detail/call-card';
import ConfigSnapshot from './_detail/config-snapshot';
import ConsentCard from './_detail/consent-card';
import TurnTable, { type TurnTableRow } from './_detail/turn-table';
import PlaybackProvider from './playback-provider';
import Player from './player';
import Transcript from './transcript';
import TurnWaterfall, { type TurnChartView } from './turn-waterfall';

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

  const turns = await getTurns(id);
  const state = callState(call.ended_at, call.outcome);
  // Read once per render and passed down: the gate is deployment state, not
  // per-turn state (ADR 0005).
  const config = getConfig();
  const gate = config.consentGate;
  const showCaller = showCallerData(call.outcome, gate);
  const access = recordingAccess(call, config);
  const snapshot = parseSnapshot(call.config_snapshot);
  const selectedIdx = parseTurnParam((await searchParams).turn, turns);

  // The placement rules of `docs/upstream.md` §Artifacts, run once on the
  // server; the islands draw what this returns and re-derive nothing.
  const { placed, unplaced } = turnSpans(turns, call.recording_started_at);
  const greeting = greetingSpan(call.greeting_marks, call.recording_started_at);
  const bars = turnBars(turns);
  const fallbackEndMs = axisFallbackMs(call, placed, greeting);

  const chartTurns: TurnChartView[] = turns.map((turn) => {
    const marks = parseMarks(turn.marks);
    return {
      idx: turn.idx,
      rows: waterfallRows(marks),
      tail: endOfTurnRows(marks),
      head: headPairRows(marks),
      perceivedMs: turn.caller_perceived_ms,
      pipelineMs: turn.pipeline_ms,
      interrupted: turn.interrupted,
      reopened: turn.source === 'reopen',
      failure: failureLine(turn.failed_leg, turn.failed_stage, turn.failed_after_ms),
      llmModel: turn.llm_model,
      tokensIn: turn.tokens_in,
      tokensOut: turn.tokens_out,
      tokensCached: turn.tokens_cached,
      ttsChars: turn.tts_chars,
      ttsBytes: turn.tts_bytes,
      speechStartMs: turn.speech_start_ms,
      speechEndMs: turn.speech_end_ms,
      // Decided on the stored value, not the parsed one: a `marks` object whose
      // every entry the parser refused is a pipeline write fault to surface,
      // not a turn that stamped nothing.
      noMarksStored: hasNoMarksStored(turn),
      noMarksReadable: !hasNoMarksStored(turn) && Object.keys(marks).length === 0,
    };
  });

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
      source: turn.source,
      sourceKnown: turn.source === null || isKnownTurnSource(turn.source),
      interrupted: turn.interrupted,
      failure: failureLine(turn.failed_leg, turn.failed_stage, turn.failed_after_ms),
      preview: preview(bubble?.callerText ?? null, turn.assistant_text),
      callerWithheld: bubble?.callerWithheld ?? !showCaller,
      withheldReason: bubble?.withheldReason ?? '',
      withheldReasonKnown: bubble?.withheldReasonKnown ?? true,
      withheldByState: bubble?.withheldByState ?? false,
      tokensIn: turn.tokens_in,
      tokensOut: turn.tokens_out,
      ttsChars: turn.tts_chars,
      ttsBytes: turn.tts_bytes,
      perceivedMs: turn.caller_perceived_ms,
      pipelineMs: turn.pipeline_ms,
    };
  });

  const cost = parseCostVnd(call.total_cost_vnd);
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
          />
        )}
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
            />
          )}
        </span>
        {/* The configured model and the image that answered, each omitted when
            the snapshot lacks it. A turn's own `llm_model` can differ on a
            fallback, which is why this is the snapshot's key and not a turn's. */}
        <SnapshotFact snapshot={snapshot} name="OPENROUTER_MODEL" />
        <SnapshotFact snapshot={snapshot} name="FONNUS_BUILD_SHA" label="build" short />
        {/* `maskPhone` returns null only for a null column, so this is the
            caller number the row never carried or the sweep took (trap 5). */}
        {maskedPhone === null ? (
          <>
            <span aria-hidden="true">·</span>
            <span>caller number not on record</span>
          </>
        ) : null}
      </div>

      {/* One playhead for the player, the axis, the waterfall, the transcript
          and the turn table; everything inside is rendered here and handed down
          as props, so no query result crosses the client boundary. */}
      <PlaybackProvider initialSelectedIdx={selectedIdx}>
        <Card title="The call" sub="One axis, two lanes: what was said, and how long each reply took">
          <RecordingBlock
            call={call}
            state={state}
            access={access}
            placed={placed}
            greeting={greeting}
            bars={bars}
            unplaced={unplaced}
            fallbackEndMs={fallbackEndMs}
          />

          <div className="grid grid-cols-2 gap-5 border-t border-border-hairline pt-4 md:grid-cols-4">
            <Stat label="Duration" value={formatDuration(call.started_at, call.ended_at)} />
            <Stat
              label="Turns on record"
              value={formatCount(call.turn_count)}
              caveat="turns written; an unconsented call has none"
            />
            <Stat
              label="Answered → first audio"
              value={
                call.greeting_first_audio_ms === null
                  ? 'not measured'
                  : formatNumber(call.greeting_first_audio_ms)
              }
              {...(call.greeting_first_audio_ms === null ? {} : { unit: 'ms' })}
              caveat="from the channel answer, not started_at"
            />
            <Stat
              label="Cost floor"
              value={cost === null ? 'unpriced' : formatNumber(cost)}
              {...(cost === null ? {} : { unit: '₫' })}
              caveat="a floor — a call on an unpriced model counts 0"
            />
          </div>
        </Card>

        <div className="grid gap-[18px] min-[1180px]:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Card title="Transcript" sub="follows the playhead · a bubble seeks">
            {bubbleTurns.length === 0 ? (
              <EmptyState title="No turns on record.">
                {showCaller ? (
                  <>
                    No turn completed, or a turn insert failed on the pipeline side (its{' '}
                    <code>/metrics</code> counter <code>db_write_failures_total</code> says
                    which). Consent outcome: <OutcomeText call={call} state={state} />.
                  </>
                ) : (
                  <>
                    The pipeline writes turns only after consent (trap 1). Consent outcome:{' '}
                    <OutcomeText call={call} state={state} />.
                  </>
                )}
              </EmptyState>
            ) : (
              <Transcript turns={bubbleTurns} spans={placed} />
            )}
          </Card>

          <Card title="The selected turn">
            <TurnWaterfall turns={chartTurns} spans={placed} />
          </Card>
        </div>

        <details>
          <summary className="cursor-pointer border-t border-border-hairline pt-3 font-display text-[17px] leading-[1.3] font-semibold text-text-heading">
            Pipeline detail
          </summary>

          <div className="mt-[18px] flex flex-col gap-[18px]">
            <Card
              title={`Turns on record (${formatNumber(turns.length)})`}
              sub="a row selects the turn above — one table, not one card per turn"
            >
              {tableRows.length === 0 ? (
                <EmptyState title="No turns on record." />
              ) : (
                <TurnTable rows={tableRows} spans={placed} />
              )}
            </Card>

            <Card title="Call">
              <CallCard call={call} />
            </Card>

            <Card
              title="Config snapshot"
              sub="the configuration the process booted with, written at call start"
            >
              <ConfigSnapshot value={call.config_snapshot} />
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
    turn.marks === null ||
    (typeof turn.marks === 'object' && Object.keys(turn.marks).length === 0)
  );
}

/**
 * One fact from the snapshot in the lede, omitted entirely when the snapshot
 * lacks it — a key the process had no value for is absent, never null (§3.4),
 * and an absent key is not a fact to state.
 */
function SnapshotFact({
  snapshot,
  name,
  label,
  short = false,
}: {
  snapshot: Record<string, unknown> | null;
  name: string;
  label?: string;
  short?: boolean;
}) {
  if (snapshot === null || !Object.hasOwn(snapshot, name)) return null;
  const value = renderValue(snapshot[name]);
  return (
    <>
      <span aria-hidden="true">·</span>
      <span>
        {label === undefined ? null : `${label} `}
        <code title={value}>{short ? shortSha(value) : value}</code>
      </span>
    </>
  );
}

/** The consent outcome inline, with trap 2's state when there is no row. */
function OutcomeText({ call, state }: { call: CallDetailRow; state: ReturnType<typeof callState> }) {
  // A state with no label is `finalized`, which this branch cannot reach: a
  // null outcome is exactly what makes the state one of the other two.
  if (call.outcome === null) return <>{CALL_STATE_LABEL[state] ?? ''}</>;
  return <Vocabulary value={call.outcome} known={isKnownConsentOutcome(call.outcome)} />;
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
  bars,
  unplaced,
  fallbackEndMs,
}: {
  call: CallDetailRow;
  state: ReturnType<typeof callState>;
  access: ReturnType<typeof recordingAccess>;
  placed: TurnSpan[];
  greeting: GreetingSpan | null;
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
          . The uploader runs only while no call is active, so a call that just ended reaches
          the bucket seconds to minutes later.
        </EmptyState>
      );
    case 'gone':
      return (
        <EmptyState title={`${RECORDING_REASON.gone}.`}>
          <code>artifact_state</code> is <code>expired</code> and the row carries no{' '}
          <code>artifact_key_prefix</code>: the disk copy was swept and the bucket copy went
          with it.
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
              />
            </>
          )}{' '}
          — <code>call.wav</code> carries the caller&rsquo;s channel, so it is withheld whole
          (trap 4).
        </EmptyState>
      );
    case 'playable':
      return (
        <Player
          callId={call.id}
          spans={placed}
          greeting={greeting}
          bars={bars}
          unplaced={unplaced}
          fallbackEndMs={fallbackEndMs}
        />
      );
  }
}
