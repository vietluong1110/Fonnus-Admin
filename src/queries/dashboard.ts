/**
 * The latency dashboard's SQL. Hand-written against
 * `../Fonnus/docs/read-contract.md` (ADR 0001: no ORM schema copy, because a
 * copy drifts from the pipeline's and lies silently), parameterized, read-only,
 * through the one pool of `src/db.ts` as the `console` role. Every column named
 * below is one the contract names; a column that exists in the database but not
 * in the contract is not read.
 *
 * Neither query carries a LIMIT, and that is deliberate. The pipeline's own
 * reader does (`../Fonnus/app/src/persistence/call-queries.ts`
 * `turnMetricRows`), and there the LIMIT lands on turn rows *after* the join, so
 * a percentile built on it stands on a slice of the window rather than the
 * window. Here the window is the only bound; `MAX_WINDOW_DAYS` in
 * `src/dashboard.ts` keeps it inside the pool's 10 s `statement_timeout`.
 *
 * The two run as one read: `dashboardSince` puts them on one client inside a
 * REPEATABLE READ READ ONLY transaction, so both see the same snapshot of the
 * database and a call that starts between them cannot hand the screen turn rows
 * whose call row is missing.
 */
import { getPool } from '@/db';

export interface DashboardCall {
  id: string;
  started_at: Date;
  /** The id the call actually ran on, not the configured one — trap 6. */
  stt_model: string | null;
  tts_model: string | null;
  /** jsonb; `parseSnapshot` in `src/dashboard.ts` is its trust boundary. */
  config_snapshot: unknown;
  /** LEFT JOIN: null means no `consent_record` row — trap 2, not "no consent". */
  outcome: string | null;
}

/**
 * Every call the window holds, consented or not — the denominator the headline
 * numbers are qualified by (trap 1: an unconsented call has no `turn` rows, so
 * it contributes nothing to a percentile and the screen must still say it
 * happened). Ordered oldest first, the order the day buckets are read in.
 */
const CALLS_SQL = `select call_log.id,
            call_log.started_at,
            call_log.stt_model,
            call_log.tts_model,
            call_log.config_snapshot,
            consent_record.outcome
       from call_log
       left join consent_record on consent_record.call_id = call_log.id
      where call_log.started_at >= $1
      order by call_log.started_at`;

export interface DashboardTurn {
  call_id: string;
  idx: number;
  /** jsonb; `parseMarks` in `src/latency.ts` is its trust boundary. */
  marks: unknown;
  caller_perceived_ms: number | null;
  pipeline_ms: number | null;
  llm_model: string | null;
  interrupted: boolean;
  source: string | null;
  failed_leg: string | null;
  failed_stage: string | null;
  /** Elapsed from `endpoint_decision` to the failure, not the bound (trap 7). */
  failed_after_ms: number | null;
}

/**
 * Every turn of every call in the window. The window predicate is on the call,
 * not the turn — `turn` carries no timestamp of its own (§3) — so a turn is in
 * scope exactly when its call is, and the two result sets join by `call_id` in
 * TypeScript with nothing left over.
 */
const TURNS_SQL = `select turn.call_id,
            turn.idx,
            turn.marks,
            turn.caller_perceived_ms,
            turn.pipeline_ms,
            turn.llm_model,
            turn.interrupted,
            turn.source,
            turn.failed_leg,
            turn.failed_stage,
            turn.failed_after_ms
       from turn
       join call_log on call_log.id = turn.call_id
      where call_log.started_at >= $1
      order by call_log.started_at, turn.idx`;

/**
 * Both result sets, read as one snapshot of the database.
 *
 * REPEATABLE READ is what makes the pair consistent: every statement of the
 * transaction sees the database as of the first one, so a call that starts
 * while the screen is reading cannot appear in the turn rows without its call
 * row — the case `aggregate` in `src/dashboard.ts` would have to drop silently.
 * READ ONLY is a transaction attribute, not a write: it says out loud what the
 * `console` role is already restricted to (pipeline migration 0006).
 *
 * The client is taken from the one pool and released in `finally`, on the error
 * path too — a client checked out and never released is a connection the pool
 * never gets back.
 */
export async function dashboardSince(
  since: Date,
): Promise<{ calls: DashboardCall[]; turns: DashboardTurn[] }> {
  const client = await getPool().connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const calls = await client.query<DashboardCall>(CALLS_SQL, [since]);
    const turns = await client.query<DashboardTurn>(TURNS_SQL, [since]);
    await client.query('commit');
    return { calls: calls.rows, turns: turns.rows };
  } catch (error) {
    // A rollback on a connection that is already gone throws in its turn; the
    // read's own error is the one worth reporting, so this one is swallowed.
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
