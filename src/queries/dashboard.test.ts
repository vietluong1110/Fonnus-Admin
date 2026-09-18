import { describe, expect, it, vi } from 'vitest';

/*
 * The dashboard's two statements must run on one client inside one transaction,
 * or the calls and the turns are two snapshots of a moving database. The pool is
 * faked here — the sequence is the thing under test, not Postgres — so the suite
 * still opens no socket.
 */
const connect = vi.fn();
vi.mock('@/db', () => ({ getPool: () => ({ connect }) }));

const { dashboardWindow } = await import('./dashboard');
const { parseWindow } = await import('@/window');

const NOW = new Date('2026-09-07T10:00:00Z');

/** Records every statement it is given, in order; `select` answers with rows. */
function fakeClient(over: { failOn?: string } = {}) {
  const statements: string[] = [];
  let released = 0;
  const client = {
    query: vi.fn((sql: string) => {
      statements.push(sql);
      if (over.failOn !== undefined && sql.includes(over.failOn)) {
        return Promise.reject(new Error('statement timeout'));
      }
      return Promise.resolve({ rows: [{ id: sql.includes('from turn') ? 'turn' : 'call' }] });
    }),
    release: () => {
      released += 1;
    },
  };
  return {
    client,
    statements,
    releases: () => released,
  };
}

describe('dashboardWindow', () => {
  it('reads both result sets on one client in one repeatable read transaction', async () => {
    const fake = fakeClient();
    connect.mockResolvedValue(fake.client);

    const window = parseWindow({ since: '7d' }, NOW);
    const { calls, turns } = await dashboardWindow(window);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(fake.statements[0]).toBe('begin isolation level repeatable read read only');
    expect(fake.statements[1]).toContain('from call_log');
    expect(fake.statements[2]).toContain('from turn');
    expect(fake.statements[3]).toBe('commit');
    expect(fake.statements).toHaveLength(4);
    // Both statements are bounded by the window and by nothing else — no LIMIT
    // (`docs/upstream.md` §Dashboard), and the window arrives as a parameter.
    expect(fake.statements[1]).not.toMatch(/limit/i);
    expect(fake.statements[2]).not.toMatch(/limit/i);
    expect(fake.client.query).toHaveBeenNthCalledWith(2, expect.any(String), [window.since]);
    expect(fake.client.query).toHaveBeenNthCalledWith(3, expect.any(String), [window.since]);
    // A preset window is open-ended, exactly as `report-calls --since` is.
    expect(fake.statements[1]).not.toContain('$2');
    expect(fake.statements[2]).not.toContain('$2');
    expect(calls).toEqual([{ id: 'call' }]);
    expect(turns).toEqual([{ id: 'turn' }]);
    expect(fake.releases()).toBe(1);
  });

  it('bounds both statements above on a custom range', async () => {
    const fake = fakeClient();
    connect.mockResolvedValue(fake.client);

    const window = parseWindow({ since: '2026-09-01', until: '2026-09-10' }, NOW);
    await dashboardWindow(window);

    expect(fake.statements[1]).toContain('call_log.started_at < $2');
    expect(fake.statements[2]).toContain('call_log.started_at < $2');
    expect(fake.client.query).toHaveBeenNthCalledWith(2, expect.any(String), [
      window.since,
      window.until,
    ]);
  });

  it('reads the three columns the window\u2019s cards stand on', async () => {
    const fake = fakeClient();
    connect.mockResolvedValue(fake.client);

    await dashboardWindow(parseWindow({}, NOW));

    for (const column of ['call_log.ended_at', 'call_log.end_reason', 'call_log.total_cost_vnd']) {
      expect(fake.statements[1]).toContain(column);
    }
  });

  it('rolls back and releases the client when a statement fails', async () => {
    const fake = fakeClient({ failOn: 'from turn' });
    connect.mockResolvedValue(fake.client);

    await expect(dashboardWindow(parseWindow({}, NOW))).rejects.toThrow('statement timeout');
    expect(fake.statements.at(-1)).toBe('rollback');
    // A client checked out and never released is a connection the pool never
    // gets back — one failed window would leak one of ten.
    expect(fake.releases()).toBe(1);
  });
});
