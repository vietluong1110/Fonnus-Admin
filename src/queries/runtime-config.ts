/**
 * The Configuration screen's SQL. Hand-written against
 * `../Fonnus/docs/read-contract.md` (ADR 0001: no ORM schema copy, because a
 * copy drifts from the pipeline's and lies silently), parameterized, read-only,
 * through the one pool of `src/db.ts` as the `console` role. Every column named
 * below is one the contract names; a column that exists in the database but not
 * in the contract is not read.
 *
 * The screen's one write lives in `src/writes/runtime-config.ts` on the editor
 * pool — nothing here writes (ADR 0007).
 */
import { getPool } from '@/db';
import { parseSnapshot } from '@/dashboard';

export interface TenantRow {
  /** The tenant key the pipeline routes a call by; `pilot` today (§3). */
  id: string;
  /** May be null — the id is the label then. */
  clinic_name: string | null;
}

/** Every tenant, ordered by id: the head's name with one row, its picker with more. */
export async function tenants(): Promise<TenantRow[]> {
  const { rows } = await getPool().query<TenantRow>(
    `select id, clinic_name
       from tenant_config
      order by id`,
  );
  return rows;
}

export interface RuntimeConfigRow {
  /** `bigint`, read as text: it is also the `runtime.version` a snapshot carries. */
  id: string;
  tenant_id: string;
  /** jsonb — a complete document, never a patch; an absent leaf is the boot value (§3.4). */
  config: unknown;
  created_at: Date;
  /**
   * As stored, never re-composed here: a row this console wrote carries the
   * account prefix `createdBy` in `src/account.ts` builds, and the pipeline's
   * own tools write other prefixes (§3).
   */
  created_by: string;
  note: string | null;
}

/**
 * A tenant's whole history, newest first, with no LIMIT (ADR 0011 §Why): the
 * newest row is "current" and pre-fills the form, and a bounded read would hide
 * the row an operator came to look for. Rows are written one per edit, by hand.
 * `order by id desc` rather than by `created_at`: the id is the version a
 * snapshot names, and it is monotonic where two rows can share a timestamp.
 */
export async function runtimeConfigRows(tenantId: string): Promise<RuntimeConfigRow[]> {
  const { rows } = await getPool().query<RuntimeConfigRow>(
    `select id::text as id, tenant_id, config, created_at, created_by, note
       from runtime_config
      where tenant_id = $1
      order by id desc`,
    [tenantId],
  );
  return rows;
}

export interface AppliedCount {
  /** Calls the tenant answered after the row landed. */
  total: number;
  /** Of those, the ones that ran on boot config or an older row. */
  not_applied: number;
}

/**
 * "Latest row not applied", counted and never inferred (ADR 0011 decision 7).
 * `is distinct from` so that an absent version — boot config, or a row the
 * pipeline refused (pipeline ADR 0020 D7) — counts alongside an older one.
 *
 * The window opens at the row's `created_at`: the pipeline reads the row before
 * the session exists and stamps `started_at` after it, so a call started
 * earlier never saw the row. A call that was being answered exactly as the row
 * landed can be counted here although it legitimately ran on the row before —
 * the screen's copy says so.
 */
export async function callsSinceRow(
  tenantId: string,
  createdAt: Date,
  rowId: string,
): Promise<AppliedCount> {
  const { rows } = await getPool().query<AppliedCount>(
    `select count(*)::int as total,
            count(*) filter (where config_snapshot->'runtime'->>'version' is distinct from $3)::int as not_applied
       from call_log
      where tenant_id = $1
        and started_at > $2`,
    [tenantId, createdAt, rowId],
  );
  return rows[0] ?? { total: 0, not_applied: 0 };
}

/** The newest call's start and snapshot: what the "last call" column and the boot report checks read. */
export interface LastCall {
  started_at: Date;
  /** Null when the call carries no snapshot, or one that is not a flat object. */
  snapshot: Record<string, unknown> | null;
}

/**
 * The snapshot of the last call this tenant answered — the only record of what
 * a leaf's value actually WAS on a call (§3.4); a `runtime_config` row is what
 * was asked for, not what ran — beside its `started_at`, which decides whether
 * the newest `boot_report` row is still the running process's and which report
 * labels its voice id (ADR 0012 D5, D6). Null when the tenant has answered no
 * call; `snapshot` null when that call's snapshot is not the flat object the
 * contract describes (`parseSnapshot` is the jsonb trust boundary).
 */
export async function lastCallSnapshot(tenantId: string): Promise<LastCall | null> {
  const { rows } = await getPool().query<{ started_at: Date; config_snapshot: unknown }>(
    `select started_at, config_snapshot
       from call_log
      where tenant_id = $1
      order by started_at desc
      limit 1`,
    [tenantId],
  );
  const row = rows[0];
  return row === undefined
    ? null
    : { started_at: row.started_at, snapshot: parseSnapshot(row.config_snapshot) };
}
