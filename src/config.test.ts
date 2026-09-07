import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

describe('readConfig', () => {
  it('returns the connection string when it is set', () => {
    expect(readConfig({ DATABASE_URL: 'postgres://console:pw@127.0.0.1:5432/fonnus' })).toEqual({
      databaseUrl: 'postgres://console:pw@127.0.0.1:5432/fonnus',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(readConfig({ DATABASE_URL: '  postgres://console@h/fonnus  ' })).toEqual({
      databaseUrl: 'postgres://console@h/fonnus',
    });
  });

  for (const [label, env] of [
    ['missing', {}],
    ['empty', { DATABASE_URL: '' }],
    ['whitespace only', { DATABASE_URL: '   ' }],
  ] as const) {
    it(`throws naming DATABASE_URL when it is ${label}`, () => {
      expect(() => readConfig(env)).toThrow(/DATABASE_URL/);
    });
  }
});
