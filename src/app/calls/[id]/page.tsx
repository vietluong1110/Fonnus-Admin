import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isKnownArtifactState, recordingAccess } from '@/artifacts';
import {
  CALL_STATE_LABEL,
  CALL_STATE_TONE,
  callState,
  consentOutcomeTone,
  endReasonTone,
  failureLine,
  formatCount,
  formatDuration,
  formatMs,
  formatNumber,
  formatWhen,
  isKnownConsentOutcome,
  isKnownEndReason,
  isKnownFailedLeg,
  isKnownFailedStage,
  isKnownTurnSource,
  isOrdinaryEnding,
  isUuid,
  parseCostVnd,
  shortSha,
  showCallerData,
} from '@/calls';
import { getConfig } from '@/config';
import { TARGETS, endOfTurnRows, parseMarks, waterfallRows } from '@/latency';
import {
  bubbleView,
  recordingOffsetMs,
  turnSpans,
  withheldStateReason,
  type TurnBubbleView,
  type TurnSpan,
} from '@/playback';
import { getCall, getTurns, type CallDetailRow, type TurnRow } from '@/queries/calls';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import Field from '@/ui/field';
import PageHead from '@/ui/page-head';
import Stat from '@/ui/stat';
import Vocabulary from '@/ui/vocabulary';
import PlaybackProvider from './playback-provider';
import Player from './player';
import Transcript from './transcript';
import TurnWaterfall, { type TurnChartView } from './turn-waterfall';
import Waterfall from './waterfall';

// One call, as the database holds it right now.
export const dynamic = 'force-dynamic';

/** The grid every definition list on this screen uses. */
const FIELDS = 'm-0 grid grid-cols-2 gap-4 md:grid-cols-4';

/**
 * `config_snapshot` is jsonb and only promised to be a flat object of config key
 * → value (contract §3.4); a reader must tolerate keys it does not know, so it
 * is read as an unknown value and rendered by `String()`.
 */
function configEntries(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entries: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    entries[key] = String(raw);
  }
  return entries;
}

/** A key the process had no value for is absent, never null (contract §3.4). */
function configValue(entries: Record<string, string>, key: string): string {
  return entries[key] ?? 'not configured';
}

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Checked before any query: a malformed id names no call, so no SQL runs.
  if (!isUuid(id)) notFound();

  const call = await getCall(id);
  if (call === null) notFound();

  const turns = await getTurns(id);
  const state = callState(call.ended_at, call.outcome);
  // Read once per render and passed down: the gate is deployment state, not
  // per-turn state (ADR 0005).
  const config = getConfig();
  const gate = config.consentGate;
  const showCaller = showCallerData(call.outcome, gate);
  const access = recordingAccess(call, config);
  const stateLabel = CALL_STATE_LABEL[state];
  const stateTone = CALL_STATE_TONE[state];

  // The placement rules of `docs/upstream.md` §Artifacts, run once on the
  // server; the islands draw what this returns and re-derive nothing.
  const { placed, unplaced } = turnSpans(turns, call.recording_started_at);
  const fallbackEndMs = axisFallbackMs(call, placed);

  const chartTurns: TurnChartView[] = turns.map((turn) => {
    const marks = parseMarks(turn.marks);
    return {
      idx: turn.idx,
      rows: waterfallRows(marks),
      tail: endOfTurnRows(marks),
      perceivedMs: turn.caller_perceived_ms,
      pipelineMs: turn.pipeline_ms,
      interrupted: turn.interrupted,
      reopened: turn.source === 'reopen',
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

  return (
    <>
      <PageHead
        title={
          call.caller_phone_e164 === null ? 'Call' : `Call from ${call.caller_phone_e164}`
        }
        back={{ href: '/calls', label: 'Calls' }}
      >
        {stateLabel === null || stateTone === null ? null : (
          <Badge tone={stateTone}>{stateLabel}</Badge>
        )}
      </PageHead>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--size-ui)] text-text-muted">
        <span>{formatWhen(call.started_at)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatDuration(call.started_at, call.ended_at)}</span>
        <span aria-hidden="true">·</span>
        <Ending call={call} state={state} />
        {call.caller_phone_e164 === null ? (
          <>
            <span aria-hidden="true">·</span>
            {/* Trap 5: a null number may be the retention sweep's work, and the
                head must not read as a call from nobody. */}
            <span>caller number not on record</span>
          </>
        ) : null}
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-5">
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
            caveat="from the channel answer, not started_at — the media stream can open after the answer"
          />
          <Tile label="Consent outcome">
            {call.outcome === null ? (
              // Trap 2: no consent row is a state of the call, never "no consent".
              <>
                {stateTone === null ? null : <Badge tone={stateTone}>{withheldStateReason(state)}</Badge>}
                <Caveat>
                  {state === 'in_progress'
                    ? 'the consent row is written at finalize'
                    : 'process died or finish failed'}
                </Caveat>
              </>
            ) : (
              <Vocabulary
                value={call.outcome}
                known={isKnownConsentOutcome(call.outcome)}
                tone={consentOutcomeTone(call.outcome)}
              />
            )}
          </Tile>
          <Tile label="End reason">
            <Vocabulary
              value={call.end_reason}
              known={call.end_reason !== null && isKnownEndReason(call.end_reason)}
              tone={call.end_reason === null ? undefined : endReasonTone(call.end_reason)}
            />
          </Tile>
        </div>
      </Card>

      {/* One playhead for the player, the strip, the waterfall and the
          transcript; everything inside is rendered here and handed down as
          props, so no query result crosses the client boundary. */}
      <PlaybackProvider>
        <div className="grid gap-[18px] min-[1180px]:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-[18px]">
            <Card title="Recording">
              <RecordingBlock
                call={call}
                state={state}
                access={access}
                placed={placed}
                unplaced={unplaced}
                fallbackEndMs={fallbackEndMs}
              />
            </Card>

            <Card title="Latency">
              <TurnWaterfall turns={chartTurns} spans={placed} />
            </Card>
          </div>

          <Card title="Transcript">
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
        </div>
      </PlaybackProvider>

      <details className="flex flex-col gap-[18px]">
        <summary className="cursor-pointer font-display text-[17px] leading-[1.3] font-semibold text-text-heading">
          Pipeline detail
        </summary>

        <div className="mt-[18px] flex flex-col gap-[18px]">
          <Card title="Call">
            <dl className={FIELDS}>
              <Field label="Call id">
                {/* The FreeSWITCH channel UUID, in the numeric face so the groups
                    are countable and it wraps rather than widening the card. */}
                <span className="font-num break-all">{call.id}</span>
              </Field>
              <Field label="DID">{call.did ?? '—'}</Field>
              <Field label="Started">{formatWhen(call.started_at)}</Field>
              <Field label="Ended">
                {call.ended_at === null ? 'in progress' : formatWhen(call.ended_at)}
              </Field>
              <Field label="STT model">{call.stt_model ?? 'not reported'}</Field>
              <Field label="TTS model">{call.tts_model ?? 'not reported'}</Field>
              <Field label="Cost">
                {parseCostVnd(call.total_cost_vnd) === null
                  ? 'unpriced'
                  : `≥ ${formatNumber(parseCostVnd(call.total_cost_vnd) ?? 0)} VND`}
                <Caveat>floor — unpriced models count 0</Caveat>
              </Field>
              <Field label="STT audio">{formatMs(call.stt_audio_ms)}</Field>
              <Field label="TTS output">
                {formatCount(call.tts_chars)} chars · {formatCount(call.tts_bytes)} bytes
              </Field>
              <Field label="Recording started">
                {call.recording_started_at === null
                  ? 'not on record'
                  : formatWhen(call.recording_started_at)}
                <Caveat>sample 0 of call.wav — the origin every offset is measured from</Caveat>
              </Field>
              <Field label="Disclosure completed">
                {call.disclosure_completed_at === null
                  ? 'not on record'
                  : formatWhen(call.disclosure_completed_at)}
              </Field>
              <Field label="Artifact state">
                <Vocabulary
                  value={call.artifact_state}
                  known={call.artifact_state !== null && isKnownArtifactState(call.artifact_state)}
                />
                {call.artifact_state === null ? (
                  <Caveat>null — a row written before the pipeline&rsquo;s migration 0010</Caveat>
                ) : null}
              </Field>
              <Field label="Artifact key prefix">
                <span className="font-num break-all">{call.artifact_key_prefix ?? '—'}</span>
                <Caveat>where the call&rsquo;s objects sit in the bucket</Caveat>
              </Field>
              <Field label="Artifact directory">
                <span className="font-num break-all">{call.artifact_dir ?? '—'}</span>
                <Caveat>path only — the directory may have been swept</Caveat>
              </Field>
            </dl>
          </Card>

          <Card
            title="Config snapshot"
            sub="the configuration the process booted with, written at call start"
          >
            <ConfigSnapshot value={call.config_snapshot} />
          </Card>

          <Card title="Consent">
            {call.outcome === null ? (
              <div>
                {stateTone === null ? null : (
                  <Badge tone={stateTone}>{withheldStateReason(state)}</Badge>
                )}
                <Caveat>
                  {state === 'in_progress'
                    ? 'the consent row is written at finalize'
                    : 'process died or finish failed'}
                </Caveat>
              </div>
            ) : (
              <>
                <dl className={FIELDS}>
                  <Field label="Outcome">
                    <Vocabulary
                      value={call.outcome}
                      known={isKnownConsentOutcome(call.outcome)}
                      tone={consentOutcomeTone(call.outcome)}
                    />
                  </Field>
                  <Field label="Mode">{call.consent_mode ?? '—'}</Field>
                  <Field label="Disclosure completed">
                    {call.consent_disclosure_completed_at === null
                      ? 'not on record'
                      : formatWhen(call.consent_disclosure_completed_at)}
                  </Field>
                  <Field label="Granted">
                    {call.granted_at === null ? 'not on record' : formatWhen(call.granted_at)}
                  </Field>
                </dl>
                {call.disclosure_text === null ? null : (
                  <details className="text-[length:var(--size-ui)]">
                    <summary className="cursor-pointer text-text-link">disclosure text</summary>
                    <p className="mt-2 mb-0 whitespace-pre-wrap">{call.disclosure_text}</p>
                  </details>
                )}
              </>
            )}
          </Card>

          <h2 className="mt-2 font-display text-[17px] leading-[1.3] font-semibold text-text-heading">
            Turns on record ({formatNumber(turns.length)})
          </h2>
          {turns.length === 0 ? (
            <Card>
              <EmptyState title="No turns on record." />
            </Card>
          ) : (
            turns.map((turn) => <TurnCard key={turn.idx} turn={turn} />)
          )}
        </div>
      </details>
    </>
  );
}

/**
 * The strip's axis before the audio reports its own length, and when there is
 * no player at all: the last turn's end, or the call's own length measured on
 * the recording clock, whichever is longer. Zero when neither is known — the
 * strip guards against dividing by it.
 */
function axisFallbackMs(call: CallDetailRow, placed: TurnSpan[]): number {
  const ends = placed.map((span) => span.endMs);
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

/** A tile of the overview strip whose value is a vocabulary word, not a number. */
function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-ui text-[length:var(--size-ui)] leading-[1.4] text-text-muted">
        {label}
      </div>
      <div className="flex flex-col items-start gap-1">{children}</div>
    </div>
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
  if (call.outcome === null) return <>{withheldStateReason(state)}</>;
  return <Vocabulary value={call.outcome} known={isKnownConsentOutcome(call.outcome)} />;
}

/**
 * How the call ended, in the lede — the list's rule (`src/app/calls/page.tsx`):
 * the ordinary ending (`granted` + `caller_hangup`) is said quietly, and every
 * exception wears the tone it has elsewhere. A default is said, not drawn.
 */
function Ending({
  call,
  state,
}: {
  call: CallDetailRow;
  state: ReturnType<typeof callState>;
}) {
  if (isOrdinaryEnding(call.outcome, call.end_reason)) {
    return <span>caller_hangup — the caller hung up on a consented call</span>;
  }

  const stateTone = CALL_STATE_TONE[state];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {call.outcome === null ? (
        stateTone === null ? null : (
          <Badge tone={stateTone}>{withheldStateReason(state)}</Badge>
        )
      ) : (
        <Vocabulary
          value={call.outcome}
          known={isKnownConsentOutcome(call.outcome)}
          tone={consentOutcomeTone(call.outcome)}
        />
      )}
      {call.end_reason === null ? (
        state === 'finalized' ? (
          <span>end reason not on record</span>
        ) : null
      ) : (
        <Vocabulary
          value={call.end_reason}
          known={isKnownEndReason(call.end_reason)}
          tone={endReasonTone(call.end_reason)}
        />
      )}
    </span>
  );
}

/**
 * The recording, in one of the five states of `recordingAccess` (ADR 0004).
 * Only `playable` renders an `<audio>`; every other state is said in a dashed
 * box, which means "no content" and never a control (§Look and feel).
 */
function RecordingBlock({
  call,
  state,
  access,
  placed,
  unplaced,
  fallbackEndMs,
}: {
  call: CallDetailRow;
  state: ReturnType<typeof callState>;
  access: ReturnType<typeof recordingAccess>;
  placed: TurnSpan[];
  unplaced: number[];
  fallbackEndMs: number;
}) {
  switch (access) {
    case 'not_configured':
      return (
        <EmptyState title="Recording access not configured.">
          The <code>S3_*</code> group is unset (<code>.env.example</code>, ADR 0004), so no
          call&rsquo;s recording can be reached from here.
        </EmptyState>
      );
    case 'not_archived':
      return (
        <EmptyState title="Not archived yet.">
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
        <EmptyState title="Recording gone (retention).">
          <code>artifact_state</code> is <code>expired</code> and the row carries no{' '}
          <code>artifact_key_prefix</code>: the disk copy was swept and the bucket copy went
          with it.
        </EmptyState>
      );
    case 'withheld':
      return (
        <EmptyState title="Recording withheld.">
          {call.outcome === null ? (
            // Trap 2: no consent row is a state of the call, not a refusal —
            // the row is written in the finish transaction.
            <>the call is {withheldStateReason(state)}, so no consent outcome is on record yet</>
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
          unplaced={unplaced}
          fallbackEndMs={fallbackEndMs}
        />
      );
  }
}

/** The snapshot card's body: identity keys, then every other key it carries. */
function ConfigSnapshot({ value }: { value: unknown }) {
  const snapshot = configEntries(value);
  const buildSha = snapshot === null ? null : configValue(snapshot, 'FONNUS_BUILD_SHA');
  if (snapshot === null || buildSha === null) {
    return <EmptyState title="Not recorded.">The call predates config provenance.</EmptyState>;
  }
  const identityKeys = ['FONNUS_BUILD_SHA', 'PROVIDERS', 'FONNUS_ENV'];
  const otherKeys = Object.keys(snapshot)
    .filter((key) => !identityKeys.includes(key))
    .sort();

  return (
    <>
      <dl className={`${FIELDS} md:grid-cols-3`}>
        <Field label="FONNUS_BUILD_SHA">
          <span className="font-num" title={buildSha}>
            {shortSha(buildSha)}
          </span>
        </Field>
        <Field label="PROVIDERS">{configValue(snapshot, 'PROVIDERS')}</Field>
        <Field label="FONNUS_ENV">{configValue(snapshot, 'FONNUS_ENV')}</Field>
      </dl>
      <details className="text-[length:var(--size-ui)]">
        <summary className="cursor-pointer text-text-link">
          {formatNumber(otherKeys.length)} more keys
        </summary>
        <dl className="mt-3 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1">
          {otherKeys.map((key) => (
            <div key={key} className="contents">
              <dt className="font-num text-[length:var(--size-eyebrow)] text-text-muted">
                {key}
              </dt>
              <dd className="font-num text-[length:var(--size-eyebrow)] break-all">
                {snapshot[key]}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}

/**
 * The research view of one turn: everything the transcript above leaves out.
 * The spoken text itself is not repeated here — it is the transcript's, and a
 * second copy would be a second place the consent gate has to be right.
 */
function TurnCard({ turn }: { turn: TurnRow }) {
  const marks = parseMarks(turn.marks);
  const rows = waterfallRows(marks);
  const tail = endOfTurnRows(marks);
  // Trap 7: `failed_leg` is the test for "failed" — `interrupted` alone does
  // not tell a barge-in from a reply that died while already audible.
  const failure = failureLine(turn.failed_leg, turn.failed_stage, turn.failed_after_ms);
  const noMarksStored = hasNoMarksStored(turn);
  const perceived = turn.caller_perceived_ms;
  const pipeline = turn.pipeline_ms;

  return (
    <Card
      title={`Turn ${formatNumber(turn.idx)}`}
      level={3}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/* `turn.source` is plain text, not a badge: it names how the turn was
              cut, which is not a state anyone acts on. */}
          {turn.source === null ? null : (
            <span className="text-[length:var(--size-ui)] text-text-muted">
              <Vocabulary value={turn.source} known={isKnownTurnSource(turn.source)} />
            </span>
          )}
          {turn.interrupted ? <Badge tone="terracotta">interrupted</Badge> : null}
          {failure === null ? null : (
            <Badge tone="warning" title={failure}>
              failed
            </Badge>
          )}
        </div>
      }
    >
      {failure === null || turn.failed_leg === null ? null : (
        <div>
          {/* The sentence is `failureLine`'s, with the two vocabulary values
              rendered by `Vocabulary` so one the contract does not name is
              flagged rather than read as normal (contract §4). */}
          <p className="mb-0">
            Failed on{' '}
            <Vocabulary value={turn.failed_leg} known={isKnownFailedLeg(turn.failed_leg)} />
            {turn.failed_stage === null ? (
              ' — provider error, no deadline stage'
            ) : (
              <>
                {' at '}
                <Vocabulary
                  value={turn.failed_stage}
                  known={isKnownFailedStage(turn.failed_stage)}
                />
              </>
            )}
            {turn.failed_after_ms === null
              ? '; elapsed not measured (no endpoint_decision mark)'
              : ` after ${formatMs(turn.failed_after_ms)}`}
          </p>
          <Caveat>
            elapsed since <code>endpoint_decision</code>, not the bound — the bound is{' '}
            <code>config_snapshot.LLM_TTFB_MS</code> and its siblings
          </Caveat>
        </div>
      )}

      <dl className={FIELDS}>
        <Field label="LLM model">{turn.llm_model ?? 'not reported'}</Field>
        <Field label="Tokens">
          {formatCount(turn.tokens_in)} in · {formatCount(turn.tokens_out)} out
          <Caveat>of which cached: {formatCount(turn.tokens_cached)}</Caveat>
        </Field>
        <Field label="TTS output">
          {formatCount(turn.tts_chars)} chars · {formatCount(turn.tts_bytes)} bytes
        </Field>
        <Field label="Caller audio">
          {turn.speech_start_ms === null || turn.speech_end_ms === null
            ? 'not reported'
            : `${formatMs(turn.speech_start_ms)} → ${formatMs(turn.speech_end_ms)}`}
          <Caveat>offset into the recording</Caveat>
        </Field>
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-[length:var(--size-eyebrow)] text-text-muted">
            caller-perceived silence (<code>speech_end</code> → <code>first_audio_out</code>)
          </div>
          <div className="mt-0.5 font-num tabular-nums">{formatMs(perceived)}</div>
          <Caveat>
            target P95 &lt; {formatNumber(TARGETS.perceivedP95AlarmMs)} ms (aspirational)
            {perceived !== null && perceived > TARGETS.perceivedP95AlarmMs
              ? ' · over the P95 target'
              : ''}
          </Caveat>
        </div>
        <div>
          <div className="text-[length:var(--size-eyebrow)] text-text-muted">
            pipeline (<code>endpoint_decision</code> → <code>first_audio_out</code>)
          </div>
          <div className="mt-0.5 font-num tabular-nums">{formatMs(pipeline)}</div>
          <Caveat>
            target P95 &lt; {formatNumber(TARGETS.pipelineP95Ms)} ms
            {pipeline !== null && pipeline > TARGETS.pipelineP95Ms ? ' · over the P95 target' : ''}
          </Caveat>
        </div>
      </div>

      {noMarksStored ? (
        <EmptyState title="No marks recorded." />
      ) : Object.keys(marks).length === 0 ? (
        <EmptyState title="Marks recorded but none readable.">
          No key of contract §3.2 carries a number.
        </EmptyState>
      ) : (
        <>
          <Waterfall rows={rows} tail={tail} />
          {turn.interrupted ? (
            <Caveat>
              <code>playback_end</code> is the last lull before the barge-in, not the end of the
              reply
            </Caveat>
          ) : null}
          {turn.source === 'reopen' ? (
            <Caveat>head marks are the first generation&rsquo;s, end-of-turn marks the last&rsquo;s</Caveat>
          ) : null}
        </>
      )}
    </Card>
  );
}
