/**
 * The one Postgres pool (ADR 0001). Every query in this app goes through it, as
 * the read-only role `console` (../Fonnus ADR 0017), with hand-written SQL
 * against `../Fonnus/docs/read-contract.md`.
 */
import { Pool } from 'pg';
import { getConfig } from './config';

// Copied from ../Fonnus/app/src/persistence/db.ts — the same four bounds as the
// pipeline, so a stuck query cannot hold the `console` role's connections open.
// They are literals, not config: no deployment has a reason to differ.
//
// The two query bounds are per-client settings, not pool ones: the pool hands
// its whole options object to every client it creates
// (`pg-pool@3.14.0 index.js:241`, `new this.Client(this.options)`) and the
// client reads `statement_timeout` and `query_timeout` off it
// (`pg@8.23.0 lib/connection-parameters.js:121,124`), so setting them here does
// reach every connection.
export const POOL_OPTIONS = {
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000,
  query_timeout: 10_000,
} as const;

// `next dev` re-imports modules on every edit; without this the process would
// accumulate one pool per reload. A module-level variable is per module
// instance, so the cache has to outlive the module — hence globalThis.
const POOL_KEY = Symbol.for('fonnus-admin.pool');
const globalPools = globalThis as { [POOL_KEY]?: Pool };

/**
 * Created on first use, not at import: `next build` imports route modules, and
 * a build must not need `DATABASE_URL` (see `src/config.ts`).
 *
 * There is no `close()`. Next.js offers no shutdown hook worth wiring for a
 * read-only pool, and process exit releases the sockets either way.
 */
export function getPool(): Pool {
  const existing = globalPools[POOL_KEY];
  if (existing !== undefined) return existing;
  const pool = new Pool({ connectionString: getConfig().databaseUrl, ...POOL_OPTIONS });
  // `Pool extends EventEmitter` and its idle listener does `pool.emit('error')`
  // (pg-pool/index.js `makeIdleListener`), so an unlistened 'error' is an
  // uncaught exception: one idle backend dropped by the database would take the
  // whole server down with it.
  pool.on('error', (err: Error) => {
    process.stderr.write(`postgres pool error on an idle client: ${err.message}\n`);
  });
  globalPools[POOL_KEY] = pool;
  return pool;
}
