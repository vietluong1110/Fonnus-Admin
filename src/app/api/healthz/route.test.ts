import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/*
 * The route's own contract, which the pure `healthBody` cannot state: which
 * credential decides the HTTP status, what the body looks like when the two
 * disagree, and that an unreachable editor host cannot make the read-only
 * console look down (ADR 0007 decision 6).
 *
 * `@/db` is the only impure import; a fake pool is enough, because the route
 * asks it for one statement and nothing else. `vi.mock` is hoisted above the
 * import of `./route` above.
 */
const { mockGetPool, mockGetEditorPool } = vi.hoisted(() => ({
  mockGetPool: vi.fn(),
  mockGetEditorPool: vi.fn(),
}));
vi.mock('@/db', () => ({ getPool: mockGetPool, getEditorPool: mockGetEditorPool }));

/** A pool that answers `select current_user` with the given role. */
const connectedAs = (role: string) => ({ query: () => Promise.resolve({ rows: [{ role }] }) });
/** A pool whose connection fails the way a refused port does. */
const refused = () => ({
  query: () =>
    Promise.reject(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' })),
});
/** A pool whose host drops packets: no refusal ever comes back. */
const silent = () => ({ query: () => new Promise(() => undefined) });
/** A pool that answers, but only after `ms` — a slow database, not a dead one. */
const slowlyAs = (role: string, ms: number) => ({
  query: () =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({ rows: [{ role }] });
      }, ms);
    }),
});

async function answer(): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET();
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

afterEach(() => {
  vi.useRealTimers();
  mockGetPool.mockReset();
  mockGetEditorPool.mockReset();
});

describe('GET /api/healthz — the reader alone decides the status (ADR 0007)', () => {
  it('stays 200 when the reader is fine and the editor credential is not', async () => {
    mockGetPool.mockReturnValue(connectedAs('console'));
    mockGetEditorPool.mockReturnValue(refused());
    const { status, body } = await answer();
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    // The code only: the message names the host, and the body answers anyone.
    expect(body.editor).toEqual({ error: 'ECONNREFUSED', status: 'error' });
  });

  it('is 503 when the reader is degraded, whatever the editor says', async () => {
    // The editor's "ok" must not rescue the deploy gate: the wrong credential in
    // DATABASE_URL is exactly what that gate exists to catch.
    mockGetPool.mockReturnValue(connectedAs('fonnus'));
    mockGetEditorPool.mockReturnValue(connectedAs('console_editor'));
    const { status, body } = await answer();
    expect(status).toBe(503);
    expect(body).toEqual({
      role: 'fonnus',
      editor: { role: 'console_editor', status: 'ok' },
      status: 'degraded',
    });
  });

  it('says not configured when there is no editor credential', async () => {
    mockGetPool.mockReturnValue(connectedAs('console'));
    mockGetEditorPool.mockReturnValue(undefined);
    expect((await answer()).body.editor).toEqual({ status: 'not configured' });
  });

  it('says not configured when the config itself cannot be read', async () => {
    // A `.env` this process cannot read is already the reader's answer; the
    // editor must not turn it into an unhandled throw out of the handler.
    mockGetPool.mockReturnValue(connectedAs('console'));
    mockGetEditorPool.mockImplementation(() => {
      throw new Error('DATABASE_URL is not set');
    });
    const { status, body } = await answer();
    expect(status).toBe(200);
    expect(body.editor).toEqual({ status: 'not configured' });
  });

  it('reports the editor as degraded when it connected as another role', async () => {
    mockGetPool.mockReturnValue(connectedAs('console'));
    mockGetEditorPool.mockReturnValue(connectedAs('fonnus'));
    const { status, body } = await answer();
    expect(status).toBe(200);
    expect(body.editor).toEqual({ role: 'fonnus', status: 'degraded' });
  });
});

describe('GET /api/healthz — a failure is a code, never the message', () => {
  it('keeps the host and the role out of the body, and in the server log', async () => {
    const log = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const message = 'password authentication failed for user "console" at db.internal:5432';
    mockGetPool.mockReturnValue({ query: () => Promise.reject(new Error(message)) });
    mockGetEditorPool.mockReturnValue(undefined);
    const { status, body } = await answer();
    expect(status).toBe(503);
    expect(body.error).toBe('failed; the reason is in the server log');
    expect(JSON.stringify(body)).not.toContain('db.internal');
    expect(log).toHaveBeenCalledWith(`healthz: ${message}\n`);
    log.mockRestore();
  });
});

describe('GET /api/healthz — the key order ops/deploy.sh matches on', () => {
  // `healthy()` globs on `200 *'"role":"console"'*`, so the role has to come
  // before the status in the body, and `status` last in both objects is what
  // keeps a detail from ever overwriting it.
  it('writes status last at the top level and inside editor', async () => {
    mockGetPool.mockReturnValue(connectedAs('console'));
    mockGetEditorPool.mockReturnValue(connectedAs('console_editor'));
    const { body } = await answer();
    expect(Object.keys(body)).toEqual(['role', 'editor', 'status']);
    expect(Object.keys(body.editor as Record<string, unknown>)).toEqual(['role', 'status']);
  });

  it('serialises the line the deploy script and the docs quote', async () => {
    mockGetPool.mockReturnValue(connectedAs('console'));
    mockGetEditorPool.mockReturnValue(connectedAs('console_editor'));
    const { body } = await answer();
    expect(JSON.stringify(body)).toBe(
      '{"role":"console","editor":{"role":"console_editor","status":"ok"},"status":"ok"}',
    );
  });
});

describe('GET /api/healthz — an editor host that drops packets', () => {
  it('answers within its own bound instead of waiting for the pool', async () => {
    // The pool waits 5 s for a connection, ops/deploy.sh aborts at 3 s and the
    // compose healthcheck at 5 s: without this bound an optional credential
    // would fail the deploy gate for the read-only console.
    vi.useFakeTimers();
    mockGetPool.mockReturnValue(connectedAs('console'));
    mockGetEditorPool.mockReturnValue(silent());

    const pending = answer();
    await vi.advanceTimersByTimeAsync(2_000);
    const { status, body } = await pending;

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.editor).toEqual({ error: 'timed out after 2 s', status: 'error' });
  });

  it("runs the two probes at once, so neither wait is added to the other's", async () => {
    // A reader that takes a second and an editor that never answers: run
    // concurrently the route is done at 2 s, run in sequence it would be 3 s —
    // past the deploy gate's abort, which is the whole point of the bound.
    vi.useFakeTimers();
    mockGetPool.mockReturnValue(slowlyAs('console', 1_000));
    mockGetEditorPool.mockReturnValue(silent());

    let settled = false;
    const pending = answer().then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const { status, body } = await pending;
    expect(settled).toBe(true);
    expect(status).toBe(200);
    expect(body.editor).toEqual({ error: 'timed out after 2 s', status: 'error' });
  });
});
