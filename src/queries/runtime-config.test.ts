import { describe, expect, it, vi } from 'vitest';

/*
 * What the Configuration screen actually asks Postgres for. The pool is faked —
 * the statement and its parameters are the thing under test, not Postgres — so
 * the suite still opens no socket.
 */
const query = vi.fn();
vi.mock('@/db', () => ({ getPool: () => ({ query }) }));

const { tenants, runtimeConfigRows, callsSinceRow, lastCallSnapshot } = await import(
  './runtime-config'
);

function lastStatement(): { sql: string; values: unknown[] } {
  const call = query.mock.calls.at(-1);
  if (call === undefined) throw new Error('no statement was issued');
  return { sql: call[0] as string, values: (call[1] ?? []) as unknown[] };
}

const CREATED_AT = new Date('2026-09-19T08:00:00Z');

describe('tenants', () => {
  it('reads the two columns the contract names, ordered by id', async () => {
    query.mockResolvedValue({ rows: [] });
    await tenants();

    const { sql, values } = lastStatement();
    expect(sql).toContain('select id, clinic_name');
    expect(sql).toContain('from tenant_config');
    expect(sql).toContain('order by id');
    // `created_at` and `updated_at` exist on the table and are not this
    // screen's business — a column the contract does not offer a use for is
    // not read.
    expect(sql).not.toContain('created_at');
    expect(sql).not.toContain('updated_at');
    expect(values).toEqual([]);
  });
});

describe('runtimeConfigRows', () => {
  it('reads one tenant’s whole history, newest first, with no LIMIT', async () => {
    query.mockResolvedValue({ rows: [] });
    await runtimeConfigRows('pilot');

    const { sql, values } = lastStatement();
    expect(sql).toContain('select id::text as id, tenant_id, config, created_at, created_by, note');
    expect(sql).toContain('from runtime_config');
    expect(sql).toContain('where tenant_id = $1');
    expect(sql).toContain('order by id desc');
    // ADR 0011 §Why: a bounded read would hide the row an operator came for.
    expect(sql).not.toMatch(/limit/i);
    expect(values).toEqual(['pilot']);
  });

  it('hands the rows back as they came', async () => {
    const row = {
      id: '7',
      tenant_id: 'pilot',
      config: {},
      created_at: CREATED_AT,
      created_by: 'console:hieu',
      note: null,
    };
    query.mockResolvedValue({ rows: [row] });
    expect(await runtimeConfigRows('pilot')).toEqual([row]);
  });
});

describe('callsSinceRow', () => {
  it('counts an absent version and an older one alike', async () => {
    query.mockResolvedValue({ rows: [{ total: 4, not_applied: 1 }] });
    const counted = await callsSinceRow('pilot', CREATED_AT, '7');

    const { sql, values } = lastStatement();
    expect(sql).toContain("config_snapshot->'runtime'->>'version' is distinct from $3");
    expect(sql).toContain('from call_log');
    expect(sql).toContain('where tenant_id = $1');
    expect(sql).toContain('started_at > $2');
    expect(values).toEqual(['pilot', CREATED_AT, '7']);
    expect(counted).toEqual({ total: 4, not_applied: 1 });
  });

  it('reads nothing of the call beyond the three columns the count needs', async () => {
    query.mockResolvedValue({ rows: [] });
    await callsSinceRow('pilot', CREATED_AT, '7');

    const { sql } = lastStatement();
    // Never inferred from the models a call ran (ADR 0011 §Rejected).
    expect(sql).not.toContain('stt_model');
    expect(sql).not.toContain('tts_model');
    expect(sql).not.toContain('turn');
    expect(sql).not.toContain('consent_record');
  });

  it('answers zero when the aggregate comes back empty', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await callsSinceRow('pilot', CREATED_AT, '7')).toEqual({ total: 0, not_applied: 0 });
  });
});

describe('lastCallSnapshot', () => {
  it('reads the newest call’s snapshot alone', async () => {
    query.mockResolvedValue({ rows: [{ config_snapshot: { STT_PROVIDER: 'deepgram' } }] });
    const snapshot = await lastCallSnapshot('pilot');

    const { sql, values } = lastStatement();
    expect(sql).toContain('select config_snapshot');
    expect(sql).toContain('order by started_at desc');
    expect(sql).toContain('limit 1');
    expect(values).toEqual(['pilot']);
    expect(snapshot).toEqual({ STT_PROVIDER: 'deepgram' });
  });

  it('answers null for a tenant with no call, and for a snapshot that is no object', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await lastCallSnapshot('pilot')).toBeNull();
    query.mockResolvedValue({ rows: [{ config_snapshot: null }] });
    expect(await lastCallSnapshot('pilot')).toBeNull();
  });
});

describe('the whole module', () => {
  it('writes nothing — every statement is a select', async () => {
    query.mockResolvedValue({ rows: [] });
    await tenants();
    await runtimeConfigRows('pilot');
    await callsSinceRow('pilot', CREATED_AT, '7');
    await lastCallSnapshot('pilot');
    for (const call of query.mock.calls) {
      expect(call[0] as string).not.toMatch(/\b(insert|update|delete)\b/i);
    }
    expect(query.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
