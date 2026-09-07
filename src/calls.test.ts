import { describe, expect, it, vi } from 'vitest';
import {
  CALL_STATE_LABEL,
  callState,
  formatCount,
  formatDuration,
  formatMs,
  formatWhen,
  isKnownConsentOutcome,
  isKnownEndReason,
  isKnownTurnSource,
  isUuid,
  parseCostVnd,
  showCallerText,
  shortSha,
} from './calls';

describe('callState — read contract trap 2', () => {
  it('is finalized once a consent outcome exists', () => {
    expect(callState(new Date('2026-09-05T07:03:12Z'), 'hung_up_before_consent')).toBe('finalized');
  });

  it('is in progress when nothing has ended and no consent row exists', () => {
    expect(callState(null, null)).toBe('in_progress');
  });

  it('is not finalized when the call ended without a consent row', () => {
    expect(callState(new Date('2026-09-05T07:03:12Z'), null)).toBe('not_finalized');
  });

  it('never says "no consent" for a missing row', () => {
    for (const label of Object.values(CALL_STATE_LABEL)) {
      expect(label ?? '').not.toContain('no consent');
    }
    expect(CALL_STATE_LABEL.in_progress).toBe('in progress');
    expect(CALL_STATE_LABEL.not_finalized).toBe(
      'not finalized — process died or finish failed',
    );
  });
});

describe('showCallerText — read contract trap 4', () => {
  it('is true only for a granted outcome', () => {
    expect(showCallerText('granted')).toBe(true);
    for (const outcome of ['hung_up_before_disclosure', 'hung_up_before_consent', 'GRANTED', '', null]) {
      expect(showCallerText(outcome)).toBe(false);
    }
  });
});

describe('parseCostVnd — read contract trap 3', () => {
  it('parses the numeric string pg hands over', () => {
    expect(parseCostVnd('1234.5000')).toBe(1234.5);
    expect(parseCostVnd('0.0000')).toBe(0);
  });

  it('treats an unparseable or absent value as missing, never as zero', () => {
    expect(parseCostVnd('abc')).toBeNull();
    expect(parseCostVnd('')).toBeNull();
    expect(parseCostVnd(null)).toBeNull();
  });
});

describe('fixed vocabularies — contract §3.1', () => {
  it('knows the pipeline values and flags anything else', () => {
    expect(isKnownEndReason('caller_hangup')).toBe(true);
    expect(isKnownEndReason('provider_failure')).toBe(true);
    expect(isKnownEndReason('sip_bye')).toBe(false);
    expect(isKnownConsentOutcome('hung_up_before_disclosure')).toBe(true);
    expect(isKnownConsentOutcome('denied')).toBe(false);
    expect(isKnownTurnSource('utterance_end')).toBe(true);
    expect(isKnownTurnSource('carry_over')).toBe(true);
    expect(isKnownTurnSource('barge_in')).toBe(false);
  });
});

describe('formatWhen — pinned to Asia/Ho_Chi_Minh', () => {
  // The instant below is 2026-09-05 07:03:12 UTC, i.e. 14:03:12 in Ho Chi Minh
  // City. `Intl` reads the zone from the formatter's option, not from the
  // process, so the string must not move when TZ does.
  const instant = new Date('2026-09-05T07:03:12Z');

  it('renders the clinic-local time with its offset', () => {
    expect(formatWhen(instant)).toBe('2026-09-05 14:03:12 +07');
  });

  it('renders the same string whatever the process TZ says', () => {
    try {
      for (const zone of ['UTC', 'America/New_York', 'Australia/Sydney']) {
        vi.stubEnv('TZ', zone);
        expect(formatWhen(instant)).toBe('2026-09-05 14:03:12 +07');
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('crosses midnight the way the clinic does, not the way UTC does', () => {
    expect(formatWhen(new Date('2026-09-05T18:30:00Z'))).toBe('2026-09-06 01:30:00 +07');
  });
});

describe('formatting', () => {
  it('groups milliseconds and says when a span was not measured', () => {
    expect(formatMs(1234)).toBe('1 234 ms');
    expect(formatMs(42)).toBe('42 ms');
    expect(formatMs(null)).toBe('not measured');
  });

  it('keeps "not reported" distinct from zero for accounting figures', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12345)).toBe('12 345');
    expect(formatCount(null)).toBe('not reported');
  });

  it('reads a duration as minutes and seconds, and an unended call as in progress', () => {
    const started = new Date('2026-09-05T07:03:12Z');
    expect(formatDuration(started, new Date(started.getTime() + 75_000))).toBe('1:15');
    expect(formatDuration(started, new Date(started.getTime() + 9_000))).toBe('0:09');
    expect(formatDuration(started, null)).toBe('in progress');
  });

  it('calls an ended_at before started_at not measured, never in progress (contract §3.2)', () => {
    const started = new Date('2026-09-05T07:03:12Z');
    expect(formatDuration(started, new Date(started.getTime() - 1))).toBe('not measured');
  });
});

describe('shortSha — contract §3.4', () => {
  it('shortens a commit SHA to seven characters', () => {
    expect(shortSha('0123456789abcdef0123456789abcdef01234567')).toBe('0123456');
  });

  it('leaves "local" alone', () => {
    expect(shortSha('local')).toBe('local');
  });
});

describe('isUuid — the route parameter never reaches SQL unchecked', () => {
  it('accepts a channel UUID', () => {
    expect(isUuid('4f1f2c3a-1b2c-4d5e-8f90-0123456789ab')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['', 'abc', "1' or '1'='1", '4f1f2c3a1b2c4d5e8f900123456789ab']) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
