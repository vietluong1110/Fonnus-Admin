/*
 * The Call card inside the collapsed "Pipeline detail" block: the row's own
 * facts that no other part of the page states, three to a line — who and where
 * (id, caller number, DID), when (start, end, the recording's origin), and what
 * it used (STT audio, TTS output, cost). The models are in the "Ran on" strip,
 * the greeting latency in the call's stat strip, the disclosure time in the
 * Consent card; the artifact columns are not shown, because `artifact_state`
 * already decides the player and a path on the box is nothing to act on.
 *
 * This is the ONE file in the app that renders `call_log.caller_phone_e164`
 * unmasked (ADR 0008): the operator opens this block on purpose, and everywhere
 * else — the list, the detail head, the document title — the number goes
 * through `maskPhone`. The tree scan in `src/calls.test.ts` allow-lists exactly
 * this path.
 */

import { CALL_STATE_LABEL, formatCount, formatMs, formatNumber, formatWhen, parseCostVnd } from '@/calls';
import type { CallDetailRow } from '@/queries/calls';
import Caveat from '@/ui/caveat';
import Field from '@/ui/field';

export default function CallCard({ call }: { call: CallDetailRow }) {
  const cost = parseCostVnd(call.total_cost_vnd);
  return (
    <dl className="m-0 grid grid-cols-2 gap-4 md:grid-cols-3">
      <Field label="Call id" hint="The FreeSWITCH channel UUID; the head's button copies it">
        {/* The numeric face so the groups are countable; it wraps rather than
            widening the card. */}
        <span className="font-num break-all">{call.id}</span>
      </Field>
      <Field label="Caller number" hint="The full number — masked everywhere else (ADR 0008)">
        {/* Trap 5: a null number may be the retention sweep's work, never a
            call from nobody. */}
        <span className="font-num break-all">{call.caller_phone_e164 ?? 'not on record'}</span>
      </Field>
      <Field label="DID">{call.did ?? '—'}</Field>
      <Field label="Started">{formatWhen(call.started_at)}</Field>
      <Field label="Ended">
        {call.ended_at === null ? CALL_STATE_LABEL.in_progress : formatWhen(call.ended_at)}
      </Field>
      <Field
        label="Recording started"
        hint="Sample 0 of call.wav — the origin every offset is measured from"
      >
        {call.recording_started_at === null
          ? 'not on record'
          : formatWhen(call.recording_started_at)}
      </Field>
      <Field label="STT audio">{formatMs(call.stt_audio_ms)}</Field>
      <Field label="TTS output">
        {formatCount(call.tts_chars)} chars · {formatCount(call.tts_bytes)} bytes
      </Field>
      <Field label="Cost">
        {cost === null ? 'unpriced' : `≥ ${formatNumber(cost)} ₫`}
        <Caveat>floor — unpriced models count 0</Caveat>
      </Field>
    </dl>
  );
}
