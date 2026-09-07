import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CALL_STATE_LABEL,
  UNKNOWN_VOCABULARY_TITLE,
  callState,
  formatCount,
  formatDuration,
  formatMs,
  formatNumber,
  formatWhen,
  isKnownConsentOutcome,
  isKnownEndReason,
  isKnownTurnSource,
  isUuid,
  parseCostVnd,
  shortSha,
  showCallerText,
} from '@/calls';
import { TARGETS, parseMarks, waterfallRows } from '@/latency';
import { getCall, getTurns, type TurnRow } from '@/queries/calls';
import Waterfall from './waterfall';

// One call, as the database holds it right now.
export const dynamic = 'force-dynamic';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

/** See the same component on the call list: an unknown value is shown, marked. */
function Vocabulary({ value, known }: { value: string | null; known: boolean }) {
  if (value === null) return <>—</>;
  return (
    <>
      {value}
      {known ? null : (
        <span title={UNKNOWN_VOCABULARY_TITLE} className="ml-1 text-muted">
          ⚠
        </span>
      )}
    </>
  );
}

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
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/calls" className="text-sm text-accent underline">
        ← Calls
      </Link>

      <section className="mt-4 rounded-xl border border-border bg-surface p-6">
        <h1 className="font-mono text-lg break-all">{call.id}</h1>
        {stateLabel === null ? null : <p className="mt-1 text-sm text-muted">{stateLabel}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Field label="DID">{call.did ?? '—'}</Field>
          <Field label="Caller">{call.caller_phone_e164 ?? 'not on record'}</Field>
          <Field label="Started">{formatWhen(call.started_at)}</Field>
          <Field label="Ended">
            {call.ended_at === null ? 'in progress' : formatWhen(call.ended_at)}
          </Field>
          <Field label="Duration">
            {formatDuration(call.started_at, call.ended_at)}
          </Field>
          <Field label="End reason">
            <Vocabulary
              value={call.end_reason}
              known={call.end_reason !== null && isKnownEndReason(call.end_reason)}
            />
          </Field>
          <Field label="Turns on record">
            {formatCount(call.turn_count)}
            <span className="block text-xs text-muted">
              turns written; an unconsented call has none
            </span>
          </Field>
          <Field label="Cost">
            {cost === null ? 'unpriced' : `≥ ${formatNumber(cost)} VND`}
            <span className="block text-xs text-muted">floor — unpriced models count 0</span>
          </Field>
          <Field label="STT model">{call.stt_model ?? 'not reported'}</Field>
          <Field label="TTS model">{call.tts_model ?? 'not reported'}</Field>
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
            <span className="font-mono text-xs break-all">{call.artifact_dir ?? '—'}</span>
            <span className="block text-xs text-muted">
              path only — the directory may have been swept
            </span>
          </Field>
        </dl>
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-6">
        <h2 className="font-semibold">Config snapshot</h2>
        <p className="mt-1 text-xs text-muted">
          the configuration the process booted with, written at call start
        </p>
        {snapshot === null || buildSha === null ? (
          <p className="mt-3 text-sm">not recorded — the call predates config provenance</p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <Field label="FONNUS_BUILD_SHA">
                <span className="font-mono" title={buildSha}>
                  {shortSha(buildSha)}
                </span>
              </Field>
              <Field label="PROVIDERS">{configValue(snapshot, 'PROVIDERS')}</Field>
              <Field label="FONNUS_ENV">{configValue(snapshot, 'FONNUS_ENV')}</Field>
            </dl>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-accent">
                {formatNumber(otherKeys.length)} more keys
              </summary>
              <table className="mt-3 w-full border-collapse text-left">
                <tbody>
                  {otherKeys.map((key) => (
                    <tr key={key} className="border-b border-border last:border-b-0">
                      <th className="py-1 pr-4 font-mono text-xs font-normal align-top">{key}</th>
                      <td className="py-1 font-mono text-xs break-all">{snapshot[key]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-6">
        <h2 className="font-semibold">Consent</h2>
        {call.outcome === null ? (
          <p className="mt-3 text-sm">
            {state === 'in_progress' ? 'in progress' : 'not finalized'}
            <span className="block text-xs text-muted">
              {state === 'in_progress'
                ? 'the consent row is written at finalize'
                : 'process died or finish failed'}
            </span>
          </p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Field label="Outcome">
                <Vocabulary value={call.outcome} known={isKnownConsentOutcome(call.outcome)} />
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
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-accent">disclosure text</summary>
                <p className="mt-2 whitespace-pre-wrap">{call.disclosure_text}</p>
              </details>
            )}
          </>
        )}
      </section>

      <h2 className="mt-8 font-semibold">
        Turns on record ({formatNumber(turns.length)})
      </h2>
      {turns.length === 0 ? (
        <div className="mt-3 rounded-xl border border-border bg-surface p-6 text-sm">
          <p>No turns on record.</p>
          {showCallerText(call.outcome) ? null : (
            <p className="mt-1 text-muted">
              turns before consent are not written (trap 1 in the read contract)
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {turns.map((turn) => (
            <TurnCard key={turn.idx} turn={turn} outcome={call.outcome} state={state} />
          ))}
        </div>
      )}
    </main>
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
  // Decided on the stored value, not the parsed one: a `marks` object whose
  // every entry the parser refused is a pipeline write fault to surface, not a
  // turn that stamped nothing.
  const noMarksStored =
    turn.marks === null ||
    (typeof turn.marks === 'object' && Object.keys(turn.marks).length === 0);
  const perceived = turn.caller_perceived_ms;
  const pipeline = turn.pipeline_ms;

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Turn {formatNumber(turn.idx)}</h3>
        {turn.source === null ? null : (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs">
            <Vocabulary value={turn.source} known={isKnownTurnSource(turn.source)} />
          </span>
        )}
        {turn.interrupted ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs">interrupted</span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs text-muted">Caller</div>
          {/* Trap 4: this reader is what enforces the consent obligation. */}
          {showCallerText(outcome) ? (
            <p className="mt-1 whitespace-pre-wrap">{turn.caller_text ?? 'not on record'}</p>
          ) : (
            <p className="mt-1 text-muted">
              caller text withheld — consent outcome:{' '}
              {outcome ?? (state === 'in_progress' ? 'in progress' : 'not finalized')}
            </p>
          )}
        </div>
        <div>
          <div className="text-xs text-muted">Assistant</div>
          <p className="mt-1 whitespace-pre-wrap">{turn.assistant_text ?? 'not on record'}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Field label="LLM model">{turn.llm_model ?? 'not reported'}</Field>
        <Field label="Tokens">
          {formatCount(turn.tokens_in)} in · {formatCount(turn.tokens_out)} out
          <span className="block text-xs text-muted">
            of which cached: {formatCount(turn.tokens_cached)}
          </span>
        </Field>
        <Field label="TTS output">
          {formatCount(turn.tts_chars)} chars · {formatCount(turn.tts_bytes)} bytes
        </Field>
        <Field label="Caller audio">
          {turn.speech_start_ms === null || turn.speech_end_ms === null
            ? 'not reported'
            : `${formatMs(turn.speech_start_ms)} → ${formatMs(turn.speech_end_ms)}`}
          <span className="block text-xs text-muted">offset into the recording</span>
        </Field>
      </dl>

      <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
        <div>
          <div className="text-xs text-muted">
            caller-perceived silence (<code>speech_end</code> → <code>first_audio_out</code>)
          </div>
          <div className="mt-0.5">{formatMs(perceived)}</div>
          <div className="text-xs text-muted">
            target P95 &lt; {formatNumber(TARGETS.perceivedP95AlarmMs)} ms (aspirational)
            {perceived !== null && perceived > TARGETS.perceivedP95AlarmMs
              ? ' · over the P95 target'
              : ''}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">
            pipeline (<code>endpoint_decision</code> → <code>first_audio_out</code>)
          </div>
          <div className="mt-0.5">{formatMs(pipeline)}</div>
          <div className="text-xs text-muted">
            target P95 &lt; {formatNumber(TARGETS.pipelineP95Ms)} ms
            {pipeline !== null && pipeline > TARGETS.pipelineP95Ms ? ' · over the P95 target' : ''}
          </div>
        </div>
      </div>

      {noMarksStored ? (
        <p className="mt-3 text-sm text-muted">no marks recorded</p>
      ) : Object.keys(marks).length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          marks recorded but none readable — no key of contract §3.2 carries a number
        </p>
      ) : (
        <Waterfall rows={rows} />
      )}
    </section>
  );
}
