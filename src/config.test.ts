import { afterEach, describe, expect, it, vi } from 'vitest';
import { readConfig, readConsentGate } from './config';
import { register } from './instrumentation';

/** The one key every other case still needs set. */
const DB = { DATABASE_URL: 'postgres://console:pw@127.0.0.1:5432/fonnus' } as const;

describe('readConfig', () => {
  it('returns the connection string when it is set', () => {
    expect(readConfig(DB)).toEqual({
      databaseUrl: 'postgres://console:pw@127.0.0.1:5432/fonnus',
      consentGate: 'on',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(readConfig({ DATABASE_URL: '  postgres://console@h/fonnus  ' })).toEqual({
      databaseUrl: 'postgres://console@h/fonnus',
      consentGate: 'on',
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

/** The five keys of the group, with a value each, as a full `.env` would set them. */
const S3 = {
  S3_ENDPOINT: 'https://s3.vn-hcm-1.vietnix.cloud',
  S3_REGION: 'vn-hcm-1',
  S3_BUCKET: 'recordinginternal',
  S3_ACCESS_KEY_ID: 'AKIACONSOLE',
  S3_SECRET_ACCESS_KEY: 'secret',
} as const;

describe('readConfig — the artifact store is one group (ADR 0004)', () => {
  it('reads all five keys into the group', () => {
    expect(readConfig({ ...DB, ...S3 }).artifactStore).toEqual({
      endpoint: 'https://s3.vn-hcm-1.vietnix.cloud',
      region: 'vn-hcm-1',
      bucket: 'recordinginternal',
      accessKeyId: 'AKIACONSOLE',
      secretAccessKey: 'secret',
    });
  });

  it('trims each value', () => {
    const padded = Object.fromEntries(Object.entries(S3).map(([key, value]) => [key, `  ${value} `]));
    expect(readConfig({ ...DB, ...padded }).artifactStore).toEqual(
      readConfig({ ...DB, ...S3 }).artifactStore,
    );
  });

  it('is undefined when no key is set — recording access is not configured', () => {
    expect(readConfig(DB).artifactStore).toBeUndefined();
  });

  it('treats keys that are empty or whitespace only as unset, not as a partial group', () => {
    const blank = Object.fromEntries(Object.keys(S3).map((key) => [key, '   ']));
    expect(readConfig({ ...DB, ...blank }).artifactStore).toBeUndefined();
  });

  for (const missing of Object.keys(S3)) {
    it(`throws naming ${missing} when every other key of the group is set`, () => {
      const partial = {
        ...DB,
        ...Object.fromEntries(Object.entries(S3).filter(([key]) => key !== missing)),
      };
      expect(() => readConfig(partial)).toThrow(new RegExp(missing));
      expect(() => readConfig(partial)).toThrow(/\.env\.example/);
    });
  }

  it('names every missing key of the group, not just the first', () => {
    // A typo rarely hits one key; the message has to list the whole gap.
    let message = '';
    try {
      readConfig({ ...DB, S3_ENDPOINT: S3.S3_ENDPOINT, S3_REGION: S3.S3_REGION });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('S3_BUCKET');
    expect(message).toContain('S3_ACCESS_KEY_ID');
    expect(message).toContain('S3_SECRET_ACCESS_KEY');
    expect(message).not.toContain('S3_ENDPOINT');
    expect(message).not.toContain('S3_REGION');
  });

  // A whitespace-only value is a key someone meant to set: it is missing, and
  // the group around it makes it a half-configured group, not "not configured".
  it('counts a whitespace-only key as missing inside an otherwise full group', () => {
    expect(() => readConfig({ ...DB, ...S3, S3_BUCKET: '  ' })).toThrow(/S3_BUCKET/);
  });
});

describe('readConfig — the editor credential (ADR 0007)', () => {
  const EDITOR = 'postgres://console_editor:pw@postgres:5432/fonnus';

  it('reads the key when it names the console_editor role', () => {
    expect(readConfig({ ...DB, EDITOR_DATABASE_URL: EDITOR }).editorDatabaseUrl).toBe(EDITOR);
    expect(readConfig({ ...DB, EDITOR_DATABASE_URL: `  ${EDITOR} ` }).editorDatabaseUrl).toBe(
      EDITOR,
    );
  });

  for (const [label, env] of [
    ['unset', {}],
    ['empty', { EDITOR_DATABASE_URL: '' }],
    ['whitespace only', { EDITOR_DATABASE_URL: '   ' }],
  ] as const) {
    it(`is absent from the config when the key is ${label} — editing not configured`, () => {
      const config = readConfig({ ...DB, ...env });
      expect(config.editorDatabaseUrl).toBeUndefined();
      expect('editorDatabaseUrl' in config).toBe(false);
    });
  }

  it('refuses to start when the value names another role', () => {
    // The `console` string pasted under the wrong key: a typo that would
    // otherwise surface as a Postgres 42501 on the first save, weeks later.
    for (const url of [DB.DATABASE_URL, 'postgres://fonnus:pw@postgres:5432/fonnus']) {
      expect(() => readConfig({ ...DB, EDITOR_DATABASE_URL: url })).toThrow(
        /EDITOR_DATABASE_URL/,
      );
      expect(() => readConfig({ ...DB, EDITOR_DATABASE_URL: url })).toThrow(/console_editor/);
    }
    expect(() =>
      readConfig({ ...DB, EDITOR_DATABASE_URL: DB.DATABASE_URL }),
    ).toThrow(/"console"/);
  });

  it('refuses to start when the value is not a URL', () => {
    expect(() => readConfig({ ...DB, EDITOR_DATABASE_URL: 'not a url' })).toThrow(
      /EDITOR_DATABASE_URL/,
    );
  });
});

describe('readConfig — the consent gate (ADR 0005)', () => {
  for (const [label, value] of [
    ['unset', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ] as const) {
    it(`defaults to on when CONSENT_GATE is ${label}`, () => {
      expect(readConfig(value === undefined ? DB : { ...DB, CONSENT_GATE: value }).consentGate).toBe(
        'on',
      );
    });
  }

  it('reads on and off, trimmed', () => {
    expect(readConfig({ ...DB, CONSENT_GATE: 'on' }).consentGate).toBe('on');
    expect(readConfig({ ...DB, CONSENT_GATE: 'off' }).consentGate).toBe('off');
    expect(readConfig({ ...DB, CONSENT_GATE: ' off ' }).consentGate).toBe('off');
  });

  for (const value of ['true', 'false', 'ON', 'Off', 'yes', '1', '0', 'onn']) {
    it(`refuses to start on CONSENT_GATE=${value}`, () => {
      // A garbled gate fails loud: an unset key fails closed by the default,
      // but a misspelling must not land on either side by accident.
      expect(() => readConfig({ ...DB, CONSENT_GATE: value })).toThrow(/CONSENT_GATE/);
      expect(() => readConfig({ ...DB, CONSENT_GATE: value })).toThrow(new RegExp(value));
    });
  }
});

describe('readConsentGate — the gate on its own, without the rest of the config', () => {
  // The gate's own reader (ADR 0005); these cases are `readConfig`'s above,
  // read through the smaller door to pin that the two never diverge.
  it('reads the same values readConfig does, and defaults to on', () => {
    expect(readConsentGate({})).toBe('on');
    expect(readConsentGate({ CONSENT_GATE: 'on' })).toBe('on');
    expect(readConsentGate({ CONSENT_GATE: ' off ' })).toBe('off');
    expect(() => readConsentGate({ CONSENT_GATE: 'yes' })).toThrow(/CONSENT_GATE/);
  });

  it('reads the gate with nothing else set', () => {
    expect(readConsentGate({ CONSENT_GATE: 'off' })).toBe('off');
  });
});

describe('register — the server refuses to start on a .env it cannot run under', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // `getConfig()` caches, so the order matters and is the point: the failing
  // environment must throw before any successful read can hide it. Next.js
  // calls this hook once before the first request and fails the server start on
  // a throw, which is what keeps a bad `.env` out of a page render.
  it('throws on every environment the config refuses, then reads a complete one', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => {
      register();
    }).toThrow(/DATABASE_URL/);

    vi.stubEnv('DATABASE_URL', DB.DATABASE_URL);
    vi.stubEnv('CONSENT_GATE', 'maybe');
    expect(() => {
      register();
    }).toThrow(/CONSENT_GATE/);

    vi.stubEnv('CONSENT_GATE', 'on');
    vi.stubEnv('S3_BUCKET', S3.S3_BUCKET);
    expect(() => {
      register();
    }).toThrow(/S3_ENDPOINT/);
    vi.stubEnv('S3_BUCKET', '');

    vi.stubEnv('EDITOR_DATABASE_URL', 'postgres://console:pw@postgres:5432/fonnus');
    expect(() => {
      register();
    }).toThrow(/EDITOR_DATABASE_URL/);
    vi.stubEnv('EDITOR_DATABASE_URL', '');

    vi.stubEnv('DATABASE_URL', DB.DATABASE_URL);
    vi.stubEnv('CONSENT_GATE', 'off');
    expect(() => {
      register();
    }).not.toThrow();
  });
});
