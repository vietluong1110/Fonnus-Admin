import { afterEach, describe, expect, it, vi } from 'vitest';
import { POOL_OPTIONS, getEditorPool, getPool } from './db';

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

describe('getEditorPool (ADR 0007)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Order matters, and is the point: `getConfig()` caches per process, so the
  // unconfigured case has to be observed before any environment that carries the
  // key. The second case starts a fresh module registry for that reason.
  it('is undefined while EDITOR_DATABASE_URL is unset — editing not configured', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://console:x@127.0.0.1:1/fonnus');
    expect(getEditorPool()).toBeUndefined();
  });

  it('creates one editor pool per process with the idle-error listener wired', async () => {
    vi.resetModules();
    vi.stubEnv('DATABASE_URL', 'postgres://console:x@127.0.0.1:1/fonnus');
    vi.stubEnv('EDITOR_DATABASE_URL', 'postgres://console_editor:x@127.0.0.1:1/fonnus');
    const db = await import('./db');
    const first = db.getEditorPool();
    const second = db.getEditorPool();
    expect(first).toBeDefined();
    expect(second).toBe(first);
    // Same reason as the read pool: an idle backend dropped by Postgres would
    // otherwise be an uncaught exception that ends the process.
    expect(first?.listenerCount('error')).toBe(1);
  });
});
