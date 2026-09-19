import { DatabaseError } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { Account } from '@/account';

/*
 * The one statement this console writes to `runtime_config` (read contract §7).
 * The editor pool is faked — what is under test is the statement, its values,
 * and what the caller is told when Postgres refuses — so the suite opens no
 * socket. That the module reaches for the EDITOR pool and never the reader's is
 * held by the tree scan in `src/writes.test.ts`.
 */
const query = vi.fn();
const editorPool = vi.fn<() => { query: typeof query } | undefined>(() => ({ query }));
vi.mock('@/db', () => ({ getEditorPool: () => editorPool() }));

const { insertRuntimeConfig } = await import('./runtime-config');

const BY = 'hieu' as Account;
const CREATED_AT = new Date('2026-09-19T08:00:00Z');

function lastStatement(): { sql: string; values: unknown[] } {
  const call = query.mock.calls.at(-1);
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
    query.mockResolvedValue({ rows: [{ id: 7, created_at: CREATED_AT }] });
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: { turn: { max_reprompts: 2 } },
      note: 'fewer reprompts',
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
    query.mockResolvedValue({ rows: [{ id: 8, created_at: CREATED_AT }] });
    await insertRuntimeConfig({ tenantId: 'pilot', config: {}, note: '', by: BY });
    expect(lastStatement().values[3]).toBeNull();

    await insertRuntimeConfig({ tenantId: 'pilot', config: {}, note: null, by: BY });
    expect(lastStatement().values[3]).toBeNull();
  });

  it('writes {} as a legal document — "back to boot config"', async () => {
    query.mockResolvedValue({ rows: [{ id: 9, created_at: CREATED_AT }] });
    await insertRuntimeConfig({ tenantId: 'pilot', config: {}, note: null, by: BY });
    expect(lastStatement().values[1]).toBe('{}');
  });

  it('maps each refusal the contract names to its own sentence', async () => {
    const reasonFor = async (code: string): Promise<string> => {
      query.mockRejectedValue(databaseError(code));
      const result = await insertRuntimeConfig({
        tenantId: 'pilot',
        config: {},
        note: null,
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
    query.mockRejectedValue(databaseError('XX000'));
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: {},
      note: null,
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
    query.mockRejectedValue(new Error('Query read timeout on 10.0.0.9'));
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: {},
      note: null,
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
    const before = query.mock.calls.length;
    const result = await insertRuntimeConfig({
      tenantId: 'pilot',
      config: {},
      note: null,
      by: BY,
    });
    expect(result).toEqual({
      ok: false,
      reason: 'editing is not configured: EDITOR_DATABASE_URL is unset',
    });
    expect(query.mock.calls.length).toBe(before);
  });
});
