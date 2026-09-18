/*
 * The Call card inside the collapsed "Pipeline detail" block: the row as the
 * database holds it, field by field.
 *
 * This is the ONE file in the app that renders `call_log.caller_phone_e164`
 * unmasked (ADR 0008): the operator opens this block on purpose, and everywhere
 * else — the list, the detail head, the document title — the number goes
 * through `maskPhone`. The tree scan in `src/calls.test.ts` allow-lists exactly
 * this path.
 */

import { isKnownArtifactState } from '@/artifacts';
import { CALL_STATE_LABEL, formatCount, formatMs, formatNumber, formatWhen, parseCostVnd } from '@/calls';
import type { CallDetailRow } from '@/queries/calls';
import Caveat from '@/ui/caveat';
import Field from '@/ui/field';
import Vocabulary from '@/ui/vocabulary';

export default function CallCard({ call }: { call: CallDetailRow }) {
  const cost = parseCostVnd(call.total_cost_vnd);
  return (
    <dl className="m-0 grid grid-cols-2 gap-4 md:grid-cols-4">
      <Field label="Call id">
        {/* The FreeSWITCH channel UUID, in the numeric face so the groups are
            countable and it wraps rather than widening the card. */}
        <span className="font-num break-all">{call.id}</span>
      </Field>
      <Field label="Caller number">
        {/* Trap 5: a null number may be the retention sweep's work, never a
            call from nobody. */}
        <span className="font-num break-all">{call.caller_phone_e164 ?? 'not on record'}</span>
        <Caveat>the full number — masked everywhere else (ADR 0008)</Caveat>
      </Field>
      <Field label="DID">{call.did ?? '—'}</Field>
      <Field label="Started">{formatWhen(call.started_at)}</Field>
      <Field label="Ended">
        {call.ended_at === null ? CALL_STATE_LABEL.in_progress : formatWhen(call.ended_at)}
      </Field>
      <Field label="STT model">{call.stt_model ?? 'not reported'}</Field>
      <Field label="TTS model">{call.tts_model ?? 'not reported'}</Field>
      <Field label="Cost">
        {cost === null ? 'unpriced' : `≥ ${formatNumber(cost)} ₫`}
        <Caveat>floor — unpriced models count 0</Caveat>
      </Field>
      <Field label="STT audio">{formatMs(call.stt_audio_ms)}</Field>
      <Field label="TTS output">
        {formatCount(call.tts_chars)} chars · {formatCount(call.tts_bytes)} bytes
      </Field>
      <Field label="Answered → first audio">
        {call.greeting_first_audio_ms === null
          ? 'not measured'
          : `${formatNumber(call.greeting_first_audio_ms)} ms`}
        <Caveat>
          <code>first_audio_out − answered</code> of the greeting — from the channel answer, not{' '}
          <code>started_at</code>
        </Caveat>
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
        {/* Text, never a link: it is a path on the box that nobody outside it
            can open, and the retention sweep may already have taken it. */}
        <span className="font-num break-all">{call.artifact_dir ?? '—'}</span>
        <Caveat>a path on the box; may have been swept (retention)</Caveat>
      </Field>
    </dl>
  );
}
