/**
 * The two reads of `boot_report` (ADR 0012 D1, D6). Hand-written against
 * `../Fonnus/docs/read-contract.md` §2, parameterised, read-only, through the
 * one pool of `src/db.ts` as the `console` role. Every column named below is
 * one the contract names.
 *
 * A database without the table (a box before the pipeline's migration 0015,
 * SQLSTATE 42P01) or without the `console` grant on it (42501) is the no-report
 * state by definition, not an error page: both reads answer null for exactly
 * those two codes, with one stderr line, and let every other failure through.
 */
import { DatabaseError } from 'pg';
import { getPool } from '@/db';
import { parseBootReport, type BootReport } from '@/boot-report';

/** undefined_table, insufficient_privilege — the two codes that mean "no report here". */
const NO_REPORT_CODES = new Set(['42P01', '42501']);

async function readOne(
  name: string,
  sql: string,
  values: unknown[],
): Promise<BootReport | null> {
  try {
    const { rows } = await getPool().query<Record<string, unknown>>(sql, values);
    const row = rows[0];
    return row === undefined ? null : parseBootReport(row);
  } catch (err) {
    if (err instanceof DatabaseError && NO_REPORT_CODES.has(err.code ?? '')) {
      // The code and the query only: a driver message can carry the host or the role.
      process.stderr.write(`boot_report ${name}: SQLSTATE ${err.code ?? ''}, read as no report\n`);
      return null;
    }
    throw err;
  }
}

/**
 * The tenant's newest `boot_report` row — ADR 0029 D6's form; the contract's
 * tenant-less line is the same row while the pilot has one tenant. Null when
 * the tenant has none: the no-report state.
 */
export async function latestBootReport(tenantId: string): Promise<BootReport | null> {
  return readOne(
    'latestBootReport',
    `select id, tenant_id, booted_at, build_sha, fonnus_env, providers, vendors, voices
       from boot_report
      where tenant_id = $1
      order by id desc
      limit 1`,
    [tenantId],
  );
}

/**
 * The newest row of the tenant booted at or before `at` — the report that
 * labels the voice id a call started at `at` ran on (ADR 0012 D6). One row
 * however long the append-only table grows.
 */
export async function bootReportBefore(tenantId: string, at: Date): Promise<BootReport | null> {
  return readOne(
    'bootReportBefore',
    `select id, tenant_id, booted_at, build_sha, fonnus_env, providers, vendors, voices
       from boot_report
      where tenant_id = $1
        and booted_at <= $2
      order by id desc
      limit 1`,
    [tenantId, at],
  );
}
