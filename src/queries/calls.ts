/**
 * The call screens' SQL. Hand-written against `../Fonnus/docs/read-contract.md`
 * (ADR 0001: no ORM schema copy, because a copy drifts from the pipeline's and
 * lies silently), parameterized, read-only, through the one pool of `src/db.ts`
 * as the `console` role. Every column named below is one the contract names; a
 * column that exists in the database but not in the contract is not read.
 */
import type { Scope } from '@/calls-scope';
import { getPool } from '@/db';

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

/** The call list's aggregate over `turn`: which turns of this call failed. */
export interface CallScopeRow extends CallListRow {
  /**
   * The `idx` of every turn with a non-null `failed_leg`, ascending — `[]` when
   * none failed and when the call has no turn rows at all (trap 1: an
   * unconsented call has none, however much the caller spoke).
   */
  failed_turn_idx: number[];
}

/*
 * The list select. The failed-turn list is a correlated aggregate rather than a
 * join, so one call is one row whatever its turn count: the subquery is served
 * by `turn`'s primary key `(call_id, idx)` (contract §3.3), and `coalesce`
 * turns "no failed turn" into an empty array rather than a null the screen
 * would have to test for. The consent row is joined, not required: it is
 * written only in the finish transaction, so a running or a died call has none.
 */
const SCOPE_SELECT = `select call_log.id,
            call_log.started_at,
            call_log.ended_at,
            call_log.end_reason,
            call_log.turn_count,
            call_log.total_cost_vnd,
            call_log.caller_phone_e164,
            call_log.artifact_state,
            call_log.artifact_key_prefix,
            consent_record.outcome,
            coalesce((select json_agg(t.idx order by t.idx)
                        from turn t
                       where t.call_id = call_log.id
                         and t.failed_leg is not null), '[]'::json) as failed_turn_idx
       from call_log
       left join consent_record on consent_record.call_id = call_log.id`;

/**
 * Newest first; the index `call_log_started_idx` serves the order (contract
 * §3.3). The id breaks a tie so two calls that share a `started_at` keep one
 * order across requests — a page is one statement, and page N+1 must start
 * where page N stopped.
 */
const SCOPE_ORDER = `order by call_log.started_at desc, call_log.id`;

/**
 * Every call of the scope, with no LIMIT: the screen pages the rows in memory
 * so the cards, the histogram and the chip counts stand on the same set as the
 * list (ADR 0006). The window is the bound — `MAX_WINDOW_DAYS` in
 * `src/window.ts` keeps it inside the pool's 10 s `statement_timeout` — and a
 * search has none, which is deliberate: the operator searches all history.
 *
 * Both search predicates are built from sanitised input (`parseScope` keeps
 * digits for the number and `[0-9a-f-]` for the id), so no `%` or `_` of the
 * operator's can reach the LIKE. Neither is served by an index (the uuid is
 * cast to text, the suffix has no leading anchor) — a sequential scan of
 * `call_log`, acceptable at the pilot's row count (`docs/upstream.md`).
 */
export async function callsInScope(scope: Scope): Promise<CallScopeRow[]> {
  if (scope.kind === 'window') {
    const { since, until } = scope.window;
    const sql =
      until === null
        ? `${SCOPE_SELECT}\n      where call_log.started_at >= $1\n      ${SCOPE_ORDER}`
        : `${SCOPE_SELECT}\n      where call_log.started_at >= $1\n        and call_log.started_at < $2\n      ${SCOPE_ORDER}`;
    const values = until === null ? [since] : [since, until];
    const { rows } = await getPool().query<CallScopeRow>(sql, values);
    return rows;
  }

  const predicates: string[] = [];
  const values: string[] = [];
  if (scope.phoneDigits !== null) {
    values.push(scope.phoneDigits);
    predicates.push(`call_log.caller_phone_e164 like '%' || $${String(values.length)}`);
  }
  if (scope.idPrefix !== null) {
    values.push(scope.idPrefix);
    predicates.push(`call_log.id::text like $${String(values.length)} || '%'`);
  }
  // A keyword too short to be either predicate matches nothing, and asking
  // Postgres for "nothing" is a sequential scan of the whole table to prove it.
  if (predicates.length === 0) return [];

  const { rows } = await getPool().query<CallScopeRow>(
    `${SCOPE_SELECT}\n      where ${predicates.join(' or ')}\n      ${SCOPE_ORDER}`,
    values,
  );
  return rows;
}

export interface CallDetailRow extends CallListRow {
  /** Identical on every row today, so they are the detail's alone, not the list's. */
  did: string | null;
  /** Contract §3, `not null`: scopes the call's `boot_report` read (ADR 0012 D6). */
  tenant_id: string;
  stt_model: string | null;
  tts_model: string | null;
  recording_started_at: Date | null;
  stt_audio_ms: number | null;
  tts_chars: number | null;
  tts_bytes: number | null;
  /** jsonb, validated where it is rendered — never trusted by shape here. */
  config_snapshot: unknown;
  consent_mode: string | null;
  consent_disclosure_completed_at: Date | null;
  granted_at: Date | null;
  disclosure_text: string | null;
  /** §3.5 — `first_audio_out − answered` for the greeting; null before 0008. */
  greeting_first_audio_ms: number | null;
  /**
   * §3.5 — the greeting's own marks: `answered` plus the reply-side keys, since
   * the greeting has no `turn` row. Null on a row written before migration
   * 0008, on a call that never finalized, and on one terminated before the
   * greeting was dispatched; then the axis has no greeting block.
   */
  greeting_marks: Record<string, number> | null;
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
            call_log.tenant_id,
            call_log.stt_model,
            call_log.tts_model,
            call_log.recording_started_at,
            call_log.stt_audio_ms,
            call_log.tts_chars,
            call_log.tts_bytes,
            call_log.config_snapshot,
            call_log.greeting_first_audio_ms,
            call_log.greeting_marks,
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

/**
 * One `call_event` row of a call's trail — the nine columns
 * `../Fonnus/docs/read-contract.md` §3 names, and no other. The order is `seq`
 * and never `ts`: two records the pipeline wrote in order can carry the same
 * `ts`, or one that steps back a few milliseconds (trap 9).
 */
export interface CallEventRow {
  seq: number;
  ts: Date;
  kind: string;
  type: string;
  gen: number | null;
  turn_idx: number | null;
  phase: string | null;
  sensitive: boolean;
  /** jsonb; `parseEventRow` in `src/intervals.ts` is its trust boundary. */
  data: unknown;
}

/**
 * The whole trail of one call, in `seq` order, with no `LIMIT`: the
 * completeness verdict is `count(*)` against `max(seq)` (trap 8) and both are
 * taken from this array, so a bounded read would make the verdict lie. One
 * statement on the `console` pool, outside any transaction — ADR 0010
 * decision 2: the only race a third statement adds is the call finalizing
 * mid-read, which is exactly what the `open` verdict models.
 *
 * No row at all is not "nothing happened": it is `RECORD_CALLS` off, a call
 * that died before its first record, a row set the retention sweep removed, or
 * a call older than pipeline migration 0009 (trap 8, `trailVerdict`).
 */
export async function getCallEvents(callId: string): Promise<CallEventRow[]> {
  const { rows } = await getPool().query<CallEventRow>(
    `select seq,
            ts,
            kind,
            type,
            gen,
            turn_idx,
            phase,
            sensitive,
            data
       from call_event
      where call_id = $1
      order by seq`,
    [callId],
  );
  return rows;
}

/**
 * One `call_annotation` row — the eleven columns
 * `../Fonnus/docs/read-contract.md` §3 names, and no other. Written by a person
 * who heard the call, after it (pipeline ADR 0027); the pipeline writes none of
 * them, and this repo's own form is PLAN row A10.
 */
export interface AnnotationRow {
  /** §3: `bigint`, which `pg` hands over as a string to keep the precision. */
  id: string;
  call_id: string;
  /** §3: milliseconds on the recording clock, 0 being `recording_started_at`. */
  from_ms: number;
  /** §3: the same clock; a CHECK enforces `to_ms > from_ms`. */
  to_ms: number;
  /** §3.1 vocabulary; null is a retraction of `supersedes`, never "unlabelled" (trap 13). */
  label: string | null;
  /** §3: the caller's actual words there — caller content, under trap 4 and trap 13. */
  caller_said: string | null;
  /** §3: free text, same consent and TTL rules as `caller_said`. */
  note: string | null;
  /** §3: the row this one replaces whole; `bigint`, so a string here too. */
  supersedes: string | null;
  /** §3: when the retention sweep nulled both texts — null means they are as written. */
  text_expired_at: Date | null;
  /**
   * §3: who wrote the row — the console's own account prefix (`src/account.ts`)
   * or a hand insert on the box. Opaque text to every reader, never re-derived
   * from the session that is reading.
   */
  created_by: string;
  /** §3: when the row was inserted — the annotator's clock, not the TTL predicate (trap 13). */
  created_at: Date;
}

/**
 * Every annotation of one call, history included, with no `LIMIT`: "current"
 * is the contract §3 rule (a labelled row no other row supersedes) and it is
 * derived in TypeScript from this array, beside the history the card shows on
 * demand — a bounded read would make both lie. The order is `id`, the order
 * the pipeline's own `callEvidenceOf` uses: a correction is always inserted
 * after the row it supersedes.
 *
 * One statement on the `console` pool, outside any transaction, beside
 * `getCallEvents` (ADR 0010, "No shared transaction"). No row at all is the
 * ordinary case — nobody has annotated the call — and, by the insert gate of
 * §7, the only case on a call without granted consent or without a
 * `recording_started_at` (trap 13).
 */
export async function getCallAnnotations(callId: string): Promise<AnnotationRow[]> {
  const { rows } = await getPool().query<AnnotationRow>(
    `select id,
            call_id,
            from_ms,
            to_ms,
            label,
            caller_said,
            note,
            supersedes,
            text_expired_at,
            created_by,
            created_at
       from call_annotation
      where call_id = $1
      order by id`,
    [callId],
  );
  return rows;
}
