/**
 * The call screens' SQL. Hand-written against `../Fonnus/docs/read-contract.md`
 * (ADR 0001: no ORM schema copy, because a copy drifts from the pipeline's and
 * lies silently), parameterized, read-only, through the one pool of `src/db.ts`
 * as the `console` role. Every column named below is one the contract names; a
 * column that exists in the database but not in the contract is not read.
 */
import { getPool } from '@/db';

/** The call list is a fixed page of the newest calls — no paging in A1. */
export const CALL_LIST_LIMIT = 100;

export interface CallListRow {
  id: string;
  started_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
  turn_count: number;
  /** `numeric(14,4)`: `pg` returns it as a string to keep the precision. */
  total_cost_vnd: string | null;
  /** Trap 5: null is age or a call that never reached it, never "no number". */
  caller_phone_e164: string | null;
  /** Contract §6 vocabulary `spooled | archived | expired | failed`; null before migration 0010. */
  artifact_state: string | null;
  /** The bucket key prefix the call's objects live under (contract §6). */
  artifact_key_prefix: string | null;
  /** LEFT JOIN: null means no `consent_record` row — trap 2, not "no consent". */
  outcome: string | null;
}

/**
 * Newest first; the index `call_log_started_idx` serves the order (contract
 * §3.3). The consent row is joined, not required: it is written only in the
 * finish transaction, so a running or a died call has none.
 */
export async function listCalls(limit: number): Promise<CallListRow[]> {
  const { rows } = await getPool().query<CallListRow>(
    `select call_log.id,
            call_log.started_at,
            call_log.ended_at,
            call_log.end_reason,
            call_log.turn_count,
            call_log.total_cost_vnd,
            call_log.caller_phone_e164,
            call_log.artifact_state,
            call_log.artifact_key_prefix,
            consent_record.outcome
       from call_log
       left join consent_record on consent_record.call_id = call_log.id
      order by call_log.started_at desc
      limit $1`,
    [limit],
  );
  return rows;
}

export interface CallDetailRow extends CallListRow {
  /** Identical on every row today, so they are the detail's alone, not the list's. */
  did: string | null;
  stt_model: string | null;
  tts_model: string | null;
  recording_started_at: Date | null;
  disclosure_completed_at: Date | null;
  stt_audio_ms: number | null;
  tts_chars: number | null;
  tts_bytes: number | null;
  artifact_dir: string | null;
  /** jsonb, validated where it is rendered — never trusted by shape here. */
  config_snapshot: unknown;
  consent_mode: string | null;
  consent_disclosure_completed_at: Date | null;
  granted_at: Date | null;
  disclosure_text: string | null;
  /** §3.5 — `first_audio_out − answered` for the greeting; null before 0008. */
  greeting_first_audio_ms: number | null;
}

/** One call, or null when the id names no row. */
export async function getCall(id: string): Promise<CallDetailRow | null> {
  const { rows } = await getPool().query<CallDetailRow>(
    `select call_log.id,
            call_log.started_at,
            call_log.ended_at,
            call_log.end_reason,
            call_log.turn_count,
            call_log.total_cost_vnd,
            call_log.caller_phone_e164,
            call_log.artifact_state,
            call_log.artifact_key_prefix,
            call_log.did,
            call_log.stt_model,
            call_log.tts_model,
            call_log.recording_started_at,
            call_log.disclosure_completed_at,
            call_log.stt_audio_ms,
            call_log.tts_chars,
            call_log.tts_bytes,
            call_log.artifact_dir,
            call_log.config_snapshot,
            call_log.greeting_first_audio_ms,
            consent_record.consent_mode,
            consent_record.disclosure_completed_at as consent_disclosure_completed_at,
            consent_record.granted_at,
            consent_record.outcome,
            consent_record.disclosure_text
       from call_log
       left join consent_record on consent_record.call_id = call_log.id
      where call_log.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface TurnRow {
  idx: number;
  caller_text: string | null;
  assistant_text: string | null;
  interrupted: boolean;
  source: string | null;
  speech_start_ms: number | null;
  speech_end_ms: number | null;
  /** jsonb; `parseMarks` in `src/latency.ts` is its trust boundary. */
  marks: unknown;
  caller_perceived_ms: number | null;
  pipeline_ms: number | null;
  llm_model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cached: number | null;
  tts_chars: number | null;
  tts_bytes: number | null;
  /** §3.1 vocabularies; all three are null on rows written before 0008. */
  failed_leg: string | null;
  failed_stage: string | null;
  /** Elapsed from `endpoint_decision` to the failure, not the bound (trap 7). */
  failed_after_ms: number | null;
}

/** The turns on record for one call, in the order they were spoken. */
export async function getTurns(callId: string): Promise<TurnRow[]> {
  const { rows } = await getPool().query<TurnRow>(
    `select idx,
            caller_text,
            assistant_text,
            interrupted,
            source,
            speech_start_ms,
            speech_end_ms,
            marks,
            caller_perceived_ms,
            pipeline_ms,
            llm_model,
            tokens_in,
            tokens_out,
            tokens_cached,
            tts_chars,
            tts_bytes,
            failed_leg,
            failed_stage,
            failed_after_ms
       from turn
      where call_id = $1
      order by idx`,
    [callId],
  );
  return rows;
}
