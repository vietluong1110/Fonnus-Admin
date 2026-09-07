import { afterEach, describe, expect, it, vi } from 'vitest';
import { POOL_OPTIONS, getPool } from './db';

describe('POOL_OPTIONS', () => {
  // Pins the copy of ../Fonnus/app/src/persistence/db.ts. If the pipeline moves
  // a bound, this test is where the two repos are reconciled.
  it('carries the pipeline pool bounds unchanged', () => {
    expect({ ...POOL_OPTIONS }).toEqual({
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      query_timeout: 10_000,
    });
  });
});

describe('getPool', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // `new Pool()` opens no socket until a query runs, so this stays a pure test;
  // the URL points at a closed port so a mistake here fails fast, not by hanging.
  it('creates one pool per process with the idle-error listener wired', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://console:x@127.0.0.1:1/fonnus');
    const first = getPool();
    const second = getPool();
    expect(second).toBe(first);
    // Without this listener an idle backend dropped by Postgres is an uncaught
    // exception that ends the process (PLAN.md row A0).
    expect(first.listenerCount('error')).toBe(1);
  });
});
