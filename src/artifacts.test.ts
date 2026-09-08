import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_STATES,
  PRESIGN_EXPIRES_S,
  callWavKey,
  isKnownArtifactState,
  isFetchable,
  presignCallWav,
  recordingAccess,
} from './artifacts';

// Pins the copy of ../Fonnus/app/src/persistence/call-queries.ts `fetchableCallsSince`
// (contract §6, trap 12): archived, or expired with a prefix still on the row.
describe('isFetchable — the pipeline archived predicate', () => {
  it('holds for archived whatever the prefix says', () => {
    expect(isFetchable('archived', 'calls/2026/09/08/abc')).toBe(true);
    expect(isFetchable('archived', null)).toBe(true);
  });
  it('holds for expired only while the prefix is on the row', () => {
    expect(isFetchable('expired', 'calls/2026/09/08/abc')).toBe(true);
    expect(isFetchable('expired', null)).toBe(false);
  });
  it('fails for spooled, failed, null and an unknown state', () => {
    for (const state of ['spooled', 'failed', null, 'uploading']) {
      expect(isFetchable(state, 'calls/2026/09/08/abc')).toBe(false);
    }
  });
});

describe('callWavKey — contract §6', () => {
  it('appends call.wav under the prefix', () => {
    expect(callWavKey('calls/2026/09/08/abc')).toBe('calls/2026/09/08/abc/call.wav');
  });
});

// `presignCallWav` reads the bucket keys through `src/config.ts`, so the whole
// module is stubbed: no `.env` is needed and the signature is computed against
// values this file states. Signing is local — nothing here opens a socket.
const STORE = {
  endpoint: 'https://s3.vn-hcm-1.vietnix.cloud',
  region: 'vn-hcm-1',
  bucket: 'recordinginternal',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret-example',
};
vi.mock('./config', () => ({
  getConfig: () => ({
    databaseUrl: 'postgres://console@localhost/fonnus',
    artifactStore: STORE,
    consentGate: 'on',
  }),
}));

const PREFIX = 'calls/2026-09-08/6f1d2f2e-8b3a-4a6e-9a1f-2b7c1d0e5a44';

// The five states of ADR 0004, in the order `recordingAccess` reads them.
describe('recordingAccess — ADR 0004', () => {
  const on = { artifactStore: STORE, consentGate: 'on' } as const;
  const off = { artifactStore: STORE, consentGate: 'off' } as const;
  const call = (
    state: string | null,
    prefix: string | null,
    outcome: string | null,
  ): {
    artifact_state: string | null;
    artifact_key_prefix: string | null;
    outcome: string | null;
  } => ({
    artifact_state: state,
    artifact_key_prefix: prefix,
    outcome,
  });

  it('says not_configured whatever the row says, when the S3_* group is unset', () => {
    const unset = { consentGate: 'on' } as const;
    expect(recordingAccess(call('archived', PREFIX, 'granted'), unset)).toBe('not_configured');
    expect(recordingAccess(call('spooled', null, null), unset)).toBe('not_configured');
  });

  it('says not_archived for spooled, failed, null and an unknown state', () => {
    for (const state of ['spooled', 'failed', null, 'uploading']) {
      expect(recordingAccess(call(state, PREFIX, 'granted'), on)).toBe('not_archived');
    }
  });

  it('says gone for a fetchable row with no prefix left on it', () => {
    expect(recordingAccess(call('expired', null, 'granted'), on)).toBe('gone');
    // archived without a prefix is fetchable by the predicate but has no key to sign
    expect(recordingAccess(call('archived', null, 'granted'), on)).toBe('gone');
    expect(recordingAccess(call('expired', PREFIX, 'granted'), on)).toBe('playable');
  });

  it('withholds a fetchable recording whose call did not consent, gate on', () => {
    for (const outcome of ['hung_up_before_disclosure', 'hung_up_before_consent', null]) {
      expect(recordingAccess(call('archived', PREFIX, outcome), on)).toBe('withheld');
      expect(recordingAccess(call('expired', PREFIX, outcome), on)).toBe('withheld');
    }
  });

  it('plays the same rows with the gate off, and a granted call either way', () => {
    for (const outcome of ['hung_up_before_disclosure', 'hung_up_before_consent', null]) {
      expect(recordingAccess(call('archived', PREFIX, outcome), off)).toBe('playable');
    }
    expect(recordingAccess(call('archived', PREFIX, 'granted'), on)).toBe('playable');
    expect(recordingAccess(call('archived', PREFIX, 'granted'), off)).toBe('playable');
  });

  it('keeps the gate below the bucket: an unconsented spooled call is not_archived', () => {
    // The order matters on screen — "not in the bucket yet" is the true reason,
    // and it would be hidden if the gate ran first.
    expect(recordingAccess(call('spooled', PREFIX, null), on)).toBe('not_archived');
  });
});

describe('the artifact_state vocabulary — contract §6', () => {
  it('is exactly the four values the contract names', () => {
    expect([...ARTIFACT_STATES]).toEqual(['spooled', 'archived', 'expired', 'failed']);
  });

  it('flags a value the contract does not name, so the screen can warn on it', () => {
    for (const state of ARTIFACT_STATES) expect(isKnownArtifactState(state)).toBe(true);
    expect(isKnownArtifactState('uploading')).toBe(false);
    expect(isKnownArtifactState('ARCHIVED')).toBe(false);
  });
});

describe('presignCallWav — ADR 0004', () => {
  it('signs for 900 seconds, the ADR number', () => {
    expect(PRESIGN_EXPIRES_S).toBe(900);
  });

  it('signs a virtual-hosted GET on the configured bucket for the call.wav key', async () => {
    const url = new URL(await presignCallWav(PREFIX));
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('recordinginternal.s3.vn-hcm-1.vietnix.cloud');
    expect(url.pathname).toBe(`/${callWavKey(PREFIX)}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(PRESIGN_EXPIRES_S));
    // A signature is present and scoped to the configured region, so the URL is
    // signed rather than merely assembled.
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/vn-hcm-1/s3/aws4_request');
  });
});

describe('the bucket predicate has one home (ADR 0004)', () => {
  // Three screens read `artifact_state` — the list's signal, the detail's
  // player, the `/recording` route — and all three go through this module. A
  // second comparison to the literal is a second predicate that will drift.
  const ALLOWED = new Set(['src/artifacts.ts']);

  it('mentions the archived literal nowhere else under src/', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        const rel = `src/${relative(root, full).split(sep).join('/')}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          if (/'archived'|"archived"/.test(readFileSync(full, 'utf8')) && !ALLOWED.has(rel)) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
