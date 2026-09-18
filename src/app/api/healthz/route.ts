/**
 * The smoke check: is the database reachable, and are we the `console` role?
 * `select current_user` is both the "is the connection alive" probe and the role
 * report in one statement; it touches no table, so it needs nothing from the
 * read contract.
 *
 * Since ADR 0007 it answers for the editor credential too, in the same shape and
 * through the same function, under `editor`. That answer never moves the HTTP
 * status, and it never moves the timing either: the compose healthcheck and
 * `ops/deploy.sh`'s gate both give this route about three seconds, while a pool
 * waits five for a connection, so an editor host that drops packets rather than
 * refusing them would take the read-only console out of service over a
 * credential no screen uses. The two probes therefore run concurrently and the
 * editor's is bounded well inside the callers' patience.
 * `deploy.sh` prints a warning on `editor.status` instead.
 */
import type { Pool } from 'pg';
import { getEditorPool, getPool } from '@/db';
import { EXPECTED_EDITOR_ROLE, EXPECTED_ROLE, healthBody, type HealthAnswer } from '@/health';

// Never cached or prerendered: the answer is about this process, right now.
export const dynamic = 'force-dynamic';

/**
 * One credential's answer. The pool is built inside the `try` so that a missing
 * or garbled config — `getConfig()` throwing — is the same "error" answer as a
 * refused connection, rather than an unhandled throw out of the handler.
 */
async function probe(open: () => Pool, expected: string): Promise<HealthAnswer> {
  try {
    const { rows } = await open().query<{ role: string }>('select current_user as role');
    const role = rows[0]?.role;
    return role === undefined
      ? healthBody({ error: 'select current_user returned no row' })
      : healthBody({ role }, expected);
  } catch (err) {
    // Missing config, refused connection, timeout — all one answer to the caller.
    return healthBody({ error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Under `ops/deploy.sh`'s 3 s abort and compose's 5 s healthcheck timeout, and
 * under the pool's own 5 s connect timeout — so the answer is given without the
 * pool, not by shortening it: a host that silently drops packets never refuses,
 * it only stays quiet.
 */
const EDITOR_TIMEOUT_MS = 2_000;

/**
 * `{ status: 'not configured' }` when the key is unset — a state, not a fault.
 * A config this process cannot read at all has already been reported by the
 * reader's answer, so it reads as not configured here too.
 */
async function editorAnswer(): Promise<Record<string, unknown>> {
  let pool: Pool | undefined;
  try {
    pool = getEditorPool();
  } catch {
    // A `.env` this process cannot read at all: already the reader's answer.
  }
  if (pool === undefined) return { status: 'not configured' };
  const open = pool;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Record<string, unknown>>((resolve) => {
    timer = setTimeout(() => {
      resolve(healthBody({ error: `timed out after ${String(EDITOR_TIMEOUT_MS / 1000)} s` }).body);
    }, EDITOR_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      probe(() => open, EXPECTED_EDITOR_ROLE).then((answer) => answer.body),
      expired,
    ]);
  } finally {
    // The query is left to finish on its own; only the wait is abandoned.
    clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  // Concurrent, so the editor's wait is never added to the reader's.
  const [reader, editor] = await Promise.all([probe(getPool, EXPECTED_ROLE), editorAnswer()]);

  // `status` written last in both objects, so no detail can overwrite it.
  const { status: state, ...detail } = reader.body;
  return Response.json({ ...detail, editor, status: state }, { status: reader.status });
}
