/**
 * The configuration edit — one of the two rows this console may write (read
 * contract §7, ADR 0007). One statement, verbatim as the contract words it,
 * on the editor pool as `console_editor`, signed with the account Caddy
 * authenticated. Append-only: a correction is a new row, a restore is a new row
 * carrying an older document; there is no `UPDATE` and no `DELETE` anywhere in
 * this repo, and `src/writes.test.ts` scans the tree to keep it that way.
 *
 * The document is validated against the copied schema before it gets here
 * (`src/configuration/document.ts`); Postgres' CHECK is the last net, not the
 * first.
 *
 * A row replaces the whole document, so a save made from a stale review would
 * silently undo whatever another operator saved in between. The insert
 * therefore runs in a transaction that first checks the tenant's newest row is
 * still the one the operator reviewed against (`base`), under a per-tenant
 * advisory lock so two console saves cannot both pass the check. The statement
 * itself stays the contract's, verbatim.
 */
import { DatabaseError, type PoolClient } from 'pg';
import type { Account } from '@/account';
import { createdBy } from '@/account';
import { getEditorPool } from '@/db';

export type InsertResult =
  | { ok: true; id: string; createdAt: Date }
  | { ok: false; reason: string };

/**
 * The three refusals the contract names, one sentence each, keyed by SQLSTATE.
 * Every other failure becomes one of the two sentences below: a driver message
 * can carry the host, the role or a fragment of the statement, and the
 * `error.tsx` rule keeps that out of a rendered page.
 */
const WRITE_REFUSALS: Readonly<Record<string, (tenantId: string) => string>> = {
  // insufficient_privilege
  '42501': () =>
    'the editor role cannot insert into runtime_config — the credential in EDITOR_DATABASE_URL is not console_editor, or its grant was revoked',
  // check_violation: `config` must be a JSON object
  '23514': () => 'the document is not a JSON object',
  // foreign_key_violation: `tenant_id` → `tenant_config.id`
  '23503': (tenantId) => `tenant ${tenantId} does not exist in tenant_config`,
};

/**
 * The server answered and refused, with a SQLSTATE this module does not name:
 * the statement did not commit, so "nothing was written" is a fact.
 */
const SERVER_REFUSAL = 'the save failed; nothing was written';

/**
 * No answer came back at all — the pool's client-side `query_timeout`
 * (`src/db.ts`), a dropped connection. The statement may have committed after
 * this process stopped waiting, so nothing here may claim it did not: the
 * operator is sent to the history, which is the only record that settles it.
 */
const INCOMPLETE = 'the save did not complete — reload and check the history before saving again';

/** Another row landed after the review this save was made from. */
export const NEWER_ROW =
  'another row was saved since this review; nothing was written — the diff below is now against that row, review it and save again';

/**
 * One new `runtime_config` row. `id` comes back as text because it is a
 * `bigint` and it is also the `runtime.version` the next call's snapshot
 * carries — the value the screen compares against, never arithmetic.
 *
 * `base` is the id of the tenant's newest row when the operator reviewed the
 * document, null when the tenant had none; the insert happens only while that
 * is still the newest row.
 *
 * `note` is stored null rather than empty: "no note" is one fact, and the
 * column is nullable for it.
 */
export async function insertRuntimeConfig(input: {
  tenantId: string;
  config: Record<string, unknown>;
  note: string | null;
  base: string | null;
  by: Account;
}): Promise<InsertResult> {
  const pool = getEditorPool();
  // The editor credential is optional (ADR 0007): unset is "editing is not
  // configured", which the form renders as a caveat, never as a failure.
  if (pool === undefined) {
    return { ok: false, reason: 'editing is not configured: EDITOR_DATABASE_URL is unset' };
  }
  const note = input.note === null || input.note === '' ? null : input.note;
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('begin');
    // Held to the end of the transaction: a second save for the same tenant
    // waits here, then sees this one's row as the newest.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      `runtime_config:${input.tenantId}`,
    ]);
    const newest = await client.query<{ id: string }>(
      `select id::text as id
         from runtime_config
        where tenant_id = $1
        order by runtime_config.id desc
        limit 1`,
      [input.tenantId],
    );
    if ((newest.rows[0]?.id ?? null) !== input.base) {
      await client.query('rollback');
      return { ok: false, reason: NEWER_ROW };
    }
    const { rows } = await client.query<{ id: string | number; created_at: Date }>(
      `insert into runtime_config (tenant_id, config, created_by, note)
       values ($1, $2::jsonb, $3, $4)
       returning id, created_at`,
      [input.tenantId, JSON.stringify(input.config), createdBy(input.by), note],
    );
    const row = rows[0];
    // `returning` on a successful single-row insert always yields one row; an
    // empty result would mean the driver handed back something else entirely.
    if (row === undefined) {
      await client.query('rollback');
      return { ok: false, reason: SERVER_REFUSAL };
    }
    await client.query('commit');
    return { ok: true, id: String(row.id), createdAt: row.created_at };
  } catch (err) {
    // A connection left mid-transaction is discarded, never handed back to the
    // pool for the next save to inherit.
    client?.release(err instanceof Error ? err : true);
    client = undefined;
    const refusal = err instanceof DatabaseError ? WRITE_REFUSALS[err.code ?? ''] : undefined;
    if (refusal !== undefined) return { ok: false, reason: refusal(input.tenantId) };
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`runtime_config insert failed: ${message}\n`);
    // A `DatabaseError` is the server's own answer: it read the statement and
    // refused it, so nothing was written. Anything else — the pool's
    // client-side `query_timeout`, a dropped connection — never reached an
    // answer, and the two cases must not be told the same way.
    return { ok: false, reason: err instanceof DatabaseError ? SERVER_REFUSAL : INCOMPLETE };
  } finally {
    client?.release();
  }
}
