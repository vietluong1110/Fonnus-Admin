import { DatabaseError } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '@/account';

/*
 * The one statement this console writes to `runtime_config` (read contract §7),
 * inside the transaction that checks the reviewed row is still the newest. The
 * editor pool is faked — what is under test is the statements, their values,
 * and what the caller is told when Postgres refuses — so the suite opens no
 * socket. That the module reaches for the EDITOR pool and never the reader's is
 * held by the tree scan in `src/writes.test.ts`.
 */

/** What the fake client answers for each statement; `insert` is the one under test. */
const insert = vi.fn();
/** The tenant's newest row id as the transaction's check reads it. */
let newestId: string | null = null;
const statements: { sql: string; values: unknown[] }[] = [];
const release = vi.fn();
const query = vi.fn((sql: string, values: unknown[] = []): Promise<unknown> => {
  statements.push({ sql, values });
  if (sql.includes('insert into')) return Promise.resolve(insert(sql, values));
  if (sql.includes('from runtime_config')) {
    return Promise.resolve({ rows: newestId === null ? [] : [{ id: newestId }] });
  }
  return Promise.resolve({ rows: [] });
});
const connect = vi.fn(() => Promise.resolve({ query, release }));
const editorPool = vi.fn<() => { connect: typeof connect } | undefined>(() => ({ connect }));
vi.mock('@/db', () => ({ getEditorPool: () => editorPool() }));

const { insertRuntimeConfig, NEWER_ROW } = await import('./runtime-config');

const BY = 'hieu' as Account;
const CREATED_AT = new Date('2026-09-19T08:00:00Z');

beforeEach(() => {
  newestId = null;
  statements.length = 0;
  release.mockClear();
});

function lastStatement(): { sql: string; values: unknown[] } {
  const call = insert.mock.calls.at(-1);
  if (call === undefined) throw new Error('no statement was issued');
  return { sql: call[0] as string, values: call[1] as unknown[] };
}

/** A `pg` query error as the driver raises it: SQLSTATE in `code`. */
function databaseError(code: string): DatabaseError {
  const err = new DatabaseError('permission denied for table runtime_config on 10.0.0.9', 0, 'error');
  err.code = code;
  return err;
}

describe('insertRuntimeConfig', () => {
  it('runs the contract’s statement with the document as jsonb and the account in created_by', async () => {
    insert.mockResolvedValue({ rows: [{ id: 7, created_at: CREATED_AT }] });
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: { turn: { max_reprompts: 2 } },
      note: 'fewer reprompts',
      base: null,
      by: BY,
    });

    const { sql, values } = lastStatement();
    expect(sql).toContain('insert into runtime_config (tenant_id, config, created_by, note)');
    expect(sql).toContain('values ($1, $2::jsonb, $3, $4)');
    expect(sql).toContain('returning id, created_at');
    expect(values).toEqual([
      'pilot',
      JSON.stringify({ turn: { max_reprompts: 2 } }),
      'console:hieu',
      'fewer reprompts',
    ]);
    // `bigint`: text on the way out, because it is compared against the
    // `runtime.version` a snapshot carries, never counted with.
    expect(result).toEqual({ ok: true, id: '7', createdAt: CREATED_AT });
    expect(result.ok && typeof result.id).toBe('string');
  });

  it('stores an empty note as null — "no note" is one fact', async () => {
    insert.mockResolvedValue({ rows: [{ id: 8, created_at: CREATED_AT }] });
    await insertRuntimeConfig({ tenantId: 'pilot', config: {}, note: '', base: null, by: BY });
    expect(lastStatement().values[3]).toBeNull();

    await insertRuntimeConfig({ tenantId: 'pilot', config: {}, note: null, base: null, by: BY });
    expect(lastStatement().values[3]).toBeNull();
  });

  it('writes {} as a legal document — "back to boot config"', async () => {
    insert.mockResolvedValue({ rows: [{ id: 9, created_at: CREATED_AT }] });
    await insertRuntimeConfig({ tenantId: 'pilot', config: {}, note: null, base: null, by: BY });
    expect(lastStatement().values[1]).toBe('{}');
  });

  it('maps each refusal the contract names to its own sentence', async () => {
    const reasonFor = async (code: string): Promise<string> => {
      insert.mockRejectedValue(databaseError(code));
      const result = await insertRuntimeConfig({
        tenantId: 'pilot',
        config: {},
        note: null,
        base: null,
        by: BY,
      });
      if (result.ok) throw new Error('expected a refusal');
      return result.reason;
    };

    expect(await reasonFor('42501')).toContain('EDITOR_DATABASE_URL is not console_editor');
    expect(await reasonFor('23514')).toBe('the document is not a JSON object');
    expect(await reasonFor('23503')).toBe('tenant pilot does not exist in tenant_config');
  });

  it('says nothing was written for a SQLSTATE it does not name — the server answered', async () => {
    insert.mockRejectedValue(databaseError('XX000'));
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: {},
      note: null,
      base: null,
      by: BY,
    });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('the save failed; nothing was written');
    // A driver message can carry the host or the role (`error.tsx` rule).
    expect(result.reason).not.toContain('10.0.0.9');
  });

  it('does not claim nothing was written when no answer came back at all', async () => {
    // The pool's client-side `query_timeout` and a dropped connection both
    // reject here while the statement may already have committed, so the only
    // honest sentence sends the operator to the history.
    insert.mockRejectedValue(new Error('Query read timeout on 10.0.0.9'));
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: {},
      note: null,
      base: null,
      by: BY,
    });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe(
      'the save did not complete — reload and check the history before saving again',
    );
    expect(result.reason).not.toContain('10.0.0.9');
  });

  it('refuses without a statement when editing is not configured', async () => {
    editorPool.mockReturnValueOnce(undefined);
    const before = connect.mock.calls.length;
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: {},
      note: null,
      base: null,
      by: BY,
    });
    expect(result).toEqual({
      ok: false,
      reason: 'editing is not configured: EDITOR_DATABASE_URL is unset',
    });
    expect(connect.mock.calls.length).toBe(before);
  });

  it('inserts inside a transaction, after locking the tenant and finding the reviewed row newest', async () => {
    newestId = '41';
    insert.mockResolvedValue({ rows: [{ id: 42, created_at: CREATED_AT }] });
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: {},
      note: null,
      base: '41',
      by: BY,
    });
    expect(result).toEqual({ ok: true, id: '42', createdAt: CREATED_AT });
    const sqls = statements.map(({ sql }) => sql.trim().split(/\s+/).slice(0, 2).join(' '));
    expect(sqls).toEqual(['begin', 'select pg_advisory_xact_lock(hashtext($1))', 'select id::text', 'insert into', 'commit']);
    expect(statements[1]?.values).toEqual(['runtime_config:pilot']);
    expect(release).toHaveBeenCalledWith();
  });

  it('writes nothing when another row landed after the review', async () => {
    newestId = '43';
    insert.mockClear();
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: {},
      note: null,
      base: '41',
      by: BY,
    });
    expect(result).toEqual({ ok: false, reason: NEWER_ROW });
    expect(insert).not.toHaveBeenCalled();
    expect(statements.at(-1)?.sql).toBe('rollback');
  });

  it('writes nothing when the tenant gained its first row after a review of none', async () => {
    newestId = '1';
    insert.mockClear();
    const result = await insertRuntimeConfig({ tenantId: 'pilot', config: {}, note: null, base: null, by: BY });
    expect(result).toEqual({ ok: false, reason: NEWER_ROW });
    expect(insert).not.toHaveBeenCalled();
  });

  it('discards the connection when a statement fails mid-transaction', async () => {
    insert.mockRejectedValue(databaseError('XX000'));
    await insertRuntimeConfig({ tenantId: 'pilot', config: {}, note: null, base: null, by: BY });
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });
});
