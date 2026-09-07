import { notFound } from 'next/navigation';
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
  isUuid,
  parseCostVnd,
  shortSha,
  showCallerText,
} from '@/calls';
import { TARGETS, endOfTurnRows, parseMarks, waterfallRows } from '@/latency';
import { getCall, getTurns, type TurnRow } from '@/queries/calls';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import Field from '@/ui/field';
import PageHead from '@/ui/page-head';
import Vocabulary from '@/ui/vocabulary';
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
  const stateLabel = CALL_STATE_LABEL[state];
  const stateTone = CALL_STATE_TONE[state];
  const cost = parseCostVnd(call.total_cost_vnd);
  const snapshot = configEntries(call.config_snapshot);
  const buildSha = snapshot === null ? null : configValue(snapshot, 'FONNUS_BUILD_SHA');
  const identityKeys = ['FONNUS_BUILD_SHA', 'PROVIDERS', 'FONNUS_ENV'];
  const otherKeys =
    snapshot === null
      ? []
      : Object.keys(snapshot)
          .filter((key) => !identityKeys.includes(key))
          .sort();

  return (
    <>
      <PageHead title="Call" back={{ href: '/calls', label: 'Calls' }}>
        {stateLabel === null || stateTone === null ? null : (
          <Badge tone={stateTone}>{stateLabel}</Badge>
        )}
      </PageHead>

      <Card>
        <dl className={FIELDS}>
          <Field label="Call id">
            {/* The FreeSWITCH channel UUID, in the numeric face so the groups
                are countable and it wraps rather than widening the card. */}
            <span className="font-num break-all">{call.id}</span>
          </Field>
          <Field label="DID">{call.did ?? '—'}</Field>
          <Field label="Caller">{call.caller_phone_e164 ?? 'not on record'}</Field>
          <Field label="Started">{formatWhen(call.started_at)}</Field>
          <Field label="Ended">
            {call.ended_at === null ? 'in progress' : formatWhen(call.ended_at)}
          </Field>
          <Field label="Duration">{formatDuration(call.started_at, call.ended_at)}</Field>
          <Field label="End reason">
            <Vocabulary
              value={call.end_reason}
              known={call.end_reason !== null && isKnownEndReason(call.end_reason)}
              tone={call.end_reason === null ? undefined : endReasonTone(call.end_reason)}
            />
          </Field>
          <Field label="Turns on record">
            {formatCount(call.turn_count)}
            <Caveat>turns written; an unconsented call has none</Caveat>
          </Field>
          <Field label="Cost">
            {cost === null ? 'unpriced' : `≥ ${formatNumber(cost)} VND`}
            <Caveat>floor — unpriced models count 0</Caveat>
          </Field>
          <Field label="STT model">{call.stt_model ?? 'not reported'}</Field>
          <Field label="TTS model">{call.tts_model ?? 'not reported'}</Field>
          <Field label="Answered → first audio">
            {formatMs(call.greeting_first_audio_ms)}
            <Caveat>
              from the channel answer, not <code>started_at</code> — the media stream can open
              after the answer
            </Caveat>
          </Field>
          <Field label="STT audio">{formatMs(call.stt_audio_ms)}</Field>
          <Field label="TTS output">
            {formatCount(call.tts_chars)} chars · {formatCount(call.tts_bytes)} bytes
          </Field>
          <Field label="Disclosure completed">
            {call.disclosure_completed_at === null
              ? 'not on record'
              : formatWhen(call.disclosure_completed_at)}
          </Field>
          <Field label="Recording started">
            {call.recording_started_at === null
              ? 'not on record'
              : formatWhen(call.recording_started_at)}
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
        {snapshot === null || buildSha === null ? (
          <EmptyState title="Not recorded.">
            The call predates config provenance.
          </EmptyState>
        ) : (
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
        )}
      </Card>

      <Card title="Consent">
        {call.outcome === null ? (
          <div>
            {stateTone === null ? null : (
              <Badge tone={stateTone}>
                {state === 'in_progress' ? 'in progress' : 'not finalized'}
              </Badge>
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
          <EmptyState title="No turns on record.">
            {showCallerText(call.outcome)
              ? 'No turn completed after consent, or a turn insert failed on the pipeline side (its /metrics counter db_write_failures_total says which).'
              : 'Turns before consent are not written (trap 1 in the read contract).'}
          </EmptyState>
        </Card>
      ) : (
        turns.map((turn) => (
          <TurnCard key={turn.idx} turn={turn} outcome={call.outcome} state={state} />
        ))
      )}
    </>
  );
}

function TurnCard({
  turn,
  outcome,
  state,
}: {
  turn: TurnRow;
  outcome: string | null;
  state: ReturnType<typeof callState>;
}) {
  const marks = parseMarks(turn.marks);
  const rows = waterfallRows(marks);
  const tail = endOfTurnRows(marks);
  // Trap 7: `failed_leg` is the test for "failed" — `interrupted` alone does
  // not tell a barge-in from a reply that died while already audible.
  const failure = failureLine(turn.failed_leg, turn.failed_stage, turn.failed_after_ms);
  // Decided on the stored value, not the parsed one: a `marks` object whose
  // every entry the parser refused is a pipeline write fault to surface, not a
  // turn that stamped nothing.
  const noMarksStored =
    turn.marks === null ||
    (typeof turn.marks === 'object' && Object.keys(turn.marks).length === 0);
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
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-[length:var(--size-eyebrow)] text-text-muted">Caller</div>
          {/* Trap 4: this reader is what enforces the consent obligation. */}
          {showCallerText(outcome) ? (
            <p className="mt-1 mb-0 whitespace-pre-wrap">{turn.caller_text ?? 'not on record'}</p>
          ) : (
            <p className="mt-1 mb-0 text-text-muted">
              caller text withheld — consent outcome:{' '}
              {outcome ?? (state === 'in_progress' ? 'in progress' : 'not finalized')}
            </p>
          )}
        </div>
        <div>
          <div className="text-[length:var(--size-eyebrow)] text-text-muted">Assistant</div>
          <p className="mt-1 mb-0 whitespace-pre-wrap">{turn.assistant_text ?? 'not on record'}</p>
        </div>
      </div>

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
