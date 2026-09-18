import { describe, expect, it } from 'vitest';
import { EXPECTED_EDITOR_ROLE, healthBody } from './health';

describe('healthBody', () => {
  it('is ok when connected as the console role', () => {
    expect(healthBody({ role: 'console' })).toEqual({
      status: 200,
      body: { role: 'console', status: 'ok' },
    });
  });

  it('is degraded when connected as any other role, and names it', () => {
    expect(healthBody({ role: 'fonnus' })).toEqual({
      status: 503,
      body: { role: 'fonnus', status: 'degraded' },
    });
  });

  it('is an error when the connection or the config failed, and carries the message', () => {
    expect(healthBody({ error: 'connect ECONNREFUSED 127.0.0.1:1' })).toEqual({
      status: 503,
      body: { error: 'connect ECONNREFUSED 127.0.0.1:1', status: 'error' },
    });
  });

  it('takes the expected role as a parameter, for the editor credential (ADR 0007)', () => {
    expect(healthBody({ role: 'console_editor' }, EXPECTED_EDITOR_ROLE)).toEqual({
      status: 200,
      body: { role: 'console_editor', status: 'ok' },
    });
    // The reader's credential under the editor's key, or the reverse: both are
    // the wrong role for the pool they came out of, and both are named.
    expect(healthBody({ role: 'console' }, EXPECTED_EDITOR_ROLE)).toEqual({
      status: 503,
      body: { role: 'console', status: 'degraded' },
    });
    expect(healthBody({ role: 'console_editor' })).toEqual({
      status: 503,
      body: { role: 'console_editor', status: 'degraded' },
    });
  });

  it('writes status last in every body so no detail can overwrite it', () => {
    for (const answer of [
      healthBody({ role: 'console' }),
      healthBody({ role: 'fonnus' }),
      healthBody({ error: 'boom' }),
    ]) {
      const keys = Object.keys(answer.body);
      expect(keys.at(-1)).toBe('status');
    }
  });
});
