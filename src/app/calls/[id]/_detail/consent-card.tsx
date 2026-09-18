/*
 * The consent record as it was written, inside "Pipeline detail". A missing row
 * is not a refusal: it is written in the call's finish transaction, so a call
 * still running or one that died has none (trap 2) — the card says which,
 * through the call's own state.
 */

import { consentOutcomeTone, formatWhen, isKnownConsentOutcome, type CallState } from '@/calls';
import type { CallDetailRow } from '@/queries/calls';
import CallStateBlock from '@/ui/call-state';
import Field from '@/ui/field';
import Vocabulary from '@/ui/vocabulary';

export default function ConsentCard({
  call,
  state,
}: {
  call: CallDetailRow;
  state: CallState;
}) {
  if (call.outcome === null) {
    return (
      <div className="flex flex-col items-start gap-1">
        <CallStateBlock state={state} />
        <p className="mb-0 text-[length:var(--size-ui)] text-text-muted">
          not finalized — the consent row is written when the call finishes
        </p>
      </div>
    );
  }

  return (
    <>
      <dl className="m-0 grid grid-cols-2 gap-4 md:grid-cols-4">
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
          {/* The bot's own line, not caller speech: it is not behind the gate. */}
          <p className="mt-2 mb-0 whitespace-pre-wrap">{call.disclosure_text}</p>
        </details>
      )}
    </>
  );
}
