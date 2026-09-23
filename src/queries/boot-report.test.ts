import { DatabaseError } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

/*
 * The two reads of `boot_report` (ADR 0012 D1, D6). The pool is faked — the
 * statements, their parameters and which failures read as "no report" are the
 * thing under test — so the suite opens no socket.
 */
const query = vi.fn();
vi.mock('@/db', () => ({ getPool: () => ({ query }) }));

const { latestBootReport, bootReportBefore } = await import('./boot-report');

/** Whitespace folded, so the assertion is on the statement and not its indentation. */
function lastStatement(): { sql: string; values: unknown[] } {
  const call = query.mock.calls.at(-1);
  if (call === undefined) throw new Error('no statement was issued');
  return { sql: (call[0] as string).replace(/\s+/g, ' ').trim(), values: call[1] as unknown[] };
}

/** A `pg` query error as the driver raises it: SQLSTATE in `code`. */
function databaseError(code: string): DatabaseError {
  const err = new DatabaseError('relation "boot_report" does not exist on 10.0.0.9', 0, 'error');
  err.code = code;
  return err;
}

const ROW = {
  id: '12',
  tenant_id: 'pilot',
  booted_at: new Date('2026-09-23T01:00:00Z'),
  build_sha: 'abc1234',
  fonnus_env: 'prod',
  providers: 'real',
  vendors: { stt: ['deepgram'], tts: ['cartesia'] },
  voices: { cartesia: [{ id: 'linh', label: 'Linh', is_default: true }] },
};
const AT = new Date('2026-09-23T02:00:00Z');

let stderr: MockInstance<typeof process.stderr.write>;
beforeEach(() => {
  query.mockReset();
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => {
  stderr.mockRestore();
});

describe('latestBootReport', () => {
  it('reads the tenant’s newest row, by id, with the columns contract §2 names', async () => {
    query.mockResolvedValue({ rows: [ROW] });
    const report = await latestBootReport('pilot');

    expect(lastStatement()).toEqual({
      sql: 'select id, tenant_id, booted_at, build_sha, fonnus_env, providers, vendors, voices from boot_report where tenant_id = $1 order by id desc limit 1',
      values: ['pilot'],
    });
    expect(report?.id).toBe('12');
    expect(report?.vendors).toEqual({ stt: ['deepgram'], tts: ['cartesia'] });
  });

  it('answers null for a tenant with no row', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await latestBootReport('pilot')).toBeNull();
  });
});

describe('bootReportBefore', () => {
  it('reads the newest row booted at or before the call', async () => {
    query.mockResolvedValue({ rows: [ROW] });
    await bootReportBefore('pilot', AT);

    expect(lastStatement()).toEqual({
      sql: 'select id, tenant_id, booted_at, build_sha, fonnus_env, providers, vendors, voices from boot_report where tenant_id = $1 and booted_at <= $2 order by id desc limit 1',
      values: ['pilot', AT],
    });
  });
});

describe('a database before migration 0015 is the no-report state (D1)', () => {
  it.each(['42P01', '42501'])('SQLSTATE %s answers null with one stderr line', async (code) => {
    query.mockRejectedValue(databaseError(code));

    expect(await latestBootReport('pilot')).toBeNull();
    expect(await bootReportBefore('pilot', AT)).toBeNull();
    expect(stderr).toHaveBeenCalledTimes(2);
    const lines = stderr.mock.calls.map((call) => String(call[0]));
    expect(lines[0]).toContain(code);
    expect(lines[0]).toContain('latestBootReport');
    expect(lines[1]).toContain('bootReportBefore');
    // The driver's message can carry the host; the line does not.
    expect(lines.join('')).not.toContain('10.0.0.9');
  });

  it('lets every other database error through', async () => {
    query.mockRejectedValue(databaseError('57014'));
    await expect(latestBootReport('pilot')).rejects.toThrow(DatabaseError);
    await expect(bootReportBefore('pilot', AT)).rejects.toThrow(DatabaseError);
  });

  it('lets a failure that is not a database answer through', async () => {
    query.mockRejectedValue(new Error('Connection terminated due to connection timeout'));
    await expect(latestBootReport('pilot')).rejects.toThrow('connection timeout');
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('the whole module', () => {
  it('writes nothing — every statement is a select', async () => {
    query.mockResolvedValue({ rows: [] });
    await latestBootReport('pilot');
    await bootReportBefore('pilot', AT);
    for (const call of query.mock.calls) {
      expect(call[0] as string).not.toMatch(/\b(insert|update|delete)\b/i);
    }
  });
});
