import Link from 'next/link';
import {
  CALL_STATE_LABEL,
  UNKNOWN_VOCABULARY_TITLE,
  callState,
  formatCount,
  formatDuration,
  formatNumber,
  formatWhen,
  isKnownConsentOutcome,
  isKnownEndReason,
  parseCostVnd,
} from '@/calls';
import { CALL_LIST_LIMIT, listCalls } from '@/queries/calls';

// The list is about the database right now; nothing here may be prerendered.
export const dynamic = 'force-dynamic';

/**
 * A value from one of the contract's fixed vocabularies (§3.1). An unknown one
 * is shown as it was stored, marked — the vocabularies grow additively, so
 * hiding an unfamiliar value would hide the pipeline's newest behaviour.
 */
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

export default async function CallsPage() {
  const calls = await listCalls(CALL_LIST_LIMIT);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-xl font-semibold">Calls</h1>
      <p className="mt-1 text-sm text-muted">
        The {formatNumber(CALL_LIST_LIMIT)} most recent calls, newest first.
      </p>

      {calls.length === 0 ? (
        <p className="mt-6 rounded-xl border border-border bg-surface p-6">No calls on record.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left align-bottom">
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Duration</th>
                <th className="px-4 py-3 font-semibold">End reason</th>
                <th className="px-4 py-3 font-semibold">Consent</th>
                <th className="px-4 py-3 font-semibold">
                  Turns on record
                  {/* Trap 1: rows written, not turns spoken. */}
                  <span className="block font-normal text-muted">
                    turns written; an unconsented call has none
                  </span>
                </th>
                <th className="px-4 py-3 font-semibold">
                  Cost
                  {/* Trap 3: the column keeps no trace of the unpriced legs. */}
                  <span className="block font-normal text-muted">
                    floor — unpriced models count 0
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const state = callState(call.ended_at, call.outcome);
                const cost = parseCostVnd(call.total_cost_vnd);
                return (
                  <tr key={call.id} className="border-b border-border align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <Link href={`/calls/${call.id}`} className="text-accent underline">
                        {formatWhen(call.started_at)}
                      </Link>
                      <span className="block text-muted">
                        {call.did ?? 'no DID on record'} · {call.stt_model ?? 'stt not reported'} ·{' '}
                        {call.tts_model ?? 'tts not reported'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {formatDuration(call.started_at, call.ended_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Vocabulary
                        value={call.end_reason}
                        known={call.end_reason !== null && isKnownEndReason(call.end_reason)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {call.outcome === null ? (
                        <>
                          {state === 'in_progress' ? 'in progress' : 'not finalized'}
                          <span className="block text-muted">
                            {CALL_STATE_LABEL[state] === null
                              ? null
                              : state === 'in_progress'
                                ? 'the consent row is written at finalize'
                                : 'process died or finish failed'}
                          </span>
                        </>
                      ) : (
                        <Vocabulary
                          value={call.outcome}
                          known={isKnownConsentOutcome(call.outcome)}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">{formatCount(call.turn_count)}</td>
                    <td className="px-4 py-3">
                      {cost === null ? 'unpriced' : `≥ ${formatNumber(cost)} VND`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
