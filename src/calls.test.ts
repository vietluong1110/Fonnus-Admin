import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CALL_STATE_CAVEAT,
  CALL_STATE_LABEL,
  CALL_STATE_TONE,
  CONSENT_OUTCOMES,
  END_REASONS,
  UNKNOWN_VOCABULARY_TONE,
  callState,
  consentOutcomeTone,
  endReasonTone,
  formatCount,
  formatClock,
  formatDuration,
  formatMs,
  formatWhen,
  failureLine,
  isKnownConsentOutcome,
  isKnownEndReason,
  isKnownFailedLeg,
  isKnownFailedStage,
  isKnownTurnSource,
  isOrdinaryEnding,
  isUuid,
  parseCostVnd,
  showCallerData,
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
    for (const text of [...Object.values(CALL_STATE_LABEL), ...Object.values(CALL_STATE_CAVEAT)]) {
      expect(text ?? '').not.toContain('no consent');
    }
    expect(CALL_STATE_LABEL.in_progress).toBe('in progress');
    expect(CALL_STATE_LABEL.not_finalized).toBe('not finalized');
  });

  it('gives every unfinalized state both a label and the caveat that explains it', () => {
    // The pair is what `src/ui/call-state.tsx` draws; a state with one half
    // would render a badge with no reason or a reason with no badge.
    for (const state of ['in_progress', 'not_finalized'] as const) {
      expect(CALL_STATE_LABEL[state]).not.toBe(null);
      expect(CALL_STATE_CAVEAT[state]).not.toBe(null);
    }
    expect(CALL_STATE_LABEL.finalized).toBeNull();
    expect(CALL_STATE_CAVEAT.finalized).toBeNull();
    expect(CALL_STATE_CAVEAT.in_progress).toBe('the consent row is written at finalize');
    expect(CALL_STATE_CAVEAT.not_finalized).toBe('process died or finish failed');
  });
});

describe('the call state is written in one place', () => {
  // The same scan the consent gate gets below: the list and the detail said the
  // phrase by hand and could drift apart, so no screen may hold the literal —
  // every one of them reads `CALL_STATE_LABEL` / `CALL_STATE_CAVEAT`.
  it('spells no call state by hand under src/app', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          if (/'not finalized'|"not finalized"|'in progress'|"in progress"/.test(
            readFileSync(full, 'utf8'),
          )) {
            offenders.push(`src/${relative(root, full).split(sep).join('/')}`);
          }
        }
      }
    };
    walk(join(root, 'app'));
    expect(offenders).toEqual([]);
  });
});

describe('showCallerData — read contract trap 4, gated by ADR 0005', () => {
  // Every value the outcome column can carry, plus the absent row (trap 2) and
  // a few near misses a hand-restored row could hold.
  const outcomes: (string | null)[] = [...CONSENT_OUTCOMES, 'GRANTED', 'denied', '', null];

  it('shows caller data only for a granted outcome while the gate is on', () => {
    expect(showCallerData('granted', 'on')).toBe(true);
    for (const outcome of outcomes.filter((value) => value !== 'granted')) {
      expect(showCallerData(outcome, 'on')).toBe(false);
    }
  });

  it('shows caller data for every outcome while the gate is off', () => {
    // The internal test phase: every caller is a team member who consented
    // off-band, and the calls whose disclosure needs tuning are exactly the
    // ones with no grant on record.
    for (const outcome of outcomes) {
      expect(showCallerData(outcome, 'off')).toBe(true);
    }
  });
});

describe('the consent gate has one enforcement point (ADR 0005)', () => {
  // The obligation lives in this reader, and a reader with two gates has one
  // that drifts: no other module may compare an outcome to the literal.
  // The dashboard's consented-sample count is not a gate; it goes through
  // `isConsentGranted` from the same file rather than a literal of its own.
  const ALLOWED = new Set(['src/calls.ts']);

  it('mentions the granted literal nowhere else under src/', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        const rel = `src/${relative(root, full).split(sep).join('/')}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          if (/'granted'|"granted"/.test(readFileSync(full, 'utf8')) && !ALLOWED.has(rel)) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
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
    expect(isKnownFailedLeg('llm')).toBe(true);
    expect(isKnownFailedLeg('tts')).toBe(true);
    // The speech-to-text leg never fails a reply (contract §3.1).
    expect(isKnownFailedLeg('stt')).toBe(false);
    expect(isKnownFailedStage('ttfb')).toBe(true);
    expect(isKnownFailedStage('idle')).toBe(true);
    expect(isKnownFailedStage('total')).toBe(true);
    expect(isKnownFailedStage('deadline')).toBe(false);
  });
});

describe('failureLine — trap 7', () => {
  it('says nothing when the turn did not fail', () => {
    // `failed_leg` is the test for "failed"; an interrupted turn with no leg
    // is a barge-in, not a failure.
    expect(failureLine(null, null, null)).toBeNull();
    expect(failureLine(null, 'ttfb', 15_040)).toBeNull();
  });

  it('names the leg, the deadline stage and the elapsed time', () => {
    expect(failureLine('llm', 'ttfb', 15_040)).toBe('Failed on llm at ttfb after 15 040 ms');
    expect(failureLine('tts', 'idle', 4_200)).toBe('Failed on tts at idle after 4 200 ms');
  });

  it('calls a null stage a provider error rather than a missing measurement', () => {
    expect(failureLine('tts', null, 900)).toBe(
      'Failed on tts — provider error, no deadline stage after 900 ms',
    );
  });

  it('says why the elapsed time is missing when there is no endpoint_decision', () => {
    expect(failureLine('llm', 'total', null)).toBe(
      'Failed on llm at total; elapsed not measured (no endpoint_decision mark)',
    );
    expect(failureLine('llm', null, null)).toBe(
      'Failed on llm — provider error, no deadline stage; elapsed not measured (no endpoint_decision mark)',
    );
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

describe('isOrdinaryEnding — what the call list says quietly', () => {
  it('is true only for a consented call the caller hung up', () => {
    expect(isOrdinaryEnding('granted', 'caller_hangup')).toBe(true);
  });

  it('is false for every other end reason under a granted call', () => {
    for (const reason of END_REASONS.filter((value) => value !== 'caller_hangup')) {
      expect(isOrdinaryEnding('granted', reason)).toBe(false);
    }
    // A value the contract does not name is an exception too (§4).
    expect(isOrdinaryEnding('granted', 'carrier_reset')).toBe(false);
    expect(isOrdinaryEnding('granted', null)).toBe(false);
  });

  it('is false for every outcome other than granted, and for none at all', () => {
    for (const outcome of CONSENT_OUTCOMES.filter((value) => value !== 'granted')) {
      expect(isOrdinaryEnding(outcome, 'caller_hangup')).toBe(false);
    }
    expect(isOrdinaryEnding('withdrawn', 'caller_hangup')).toBe(false);
    // Trap 2: no consent row is a state to show, never an ordinary ending.
    expect(isOrdinaryEnding(null, 'caller_hangup')).toBe(false);
    expect(isOrdinaryEnding(null, null)).toBe(false);
  });
});

describe('badge tones for the fixed vocabularies', () => {
  it('gives every contract end reason a tone', () => {
    for (const reason of END_REASONS) {
      expect(endReasonTone(reason)).not.toBe(UNKNOWN_VOCABULARY_TONE);
    }
    expect(endReasonTone('provider_failure')).toBe('error');
    expect(endReasonTone('caller_hangup')).toBe('neutral');
    expect(endReasonTone('max_turns')).toBe('info');
  });

  it('gives every contract consent outcome a tone', () => {
    for (const outcome of CONSENT_OUTCOMES) {
      expect(['success', 'warning']).toContain(consentOutcomeTone(outcome));
    }
    expect(consentOutcomeTone('granted')).toBe('success');
    expect(consentOutcomeTone('hung_up_before_disclosure')).toBe('warning');
    expect(consentOutcomeTone('hung_up_before_consent')).toBe('warning');
  });

  it('marks a value outside the vocabulary rather than colouring it as normal', () => {
    // The vocabularies grow additively (contract §4), so this is the case the
    // console meets first when the pipeline ships a new value.
    expect(endReasonTone('carrier_reset')).toBe('warning');
    expect(consentOutcomeTone('withdrawn')).toBe('warning');
    expect(UNKNOWN_VOCABULARY_TONE).toBe('warning');
  });

  it('badges only the call states that are not the normal one (trap 2)', () => {
    expect(CALL_STATE_TONE.finalized).toBeNull();
    expect(CALL_STATE_TONE.in_progress).toBe('info');
    expect(CALL_STATE_TONE.not_finalized).toBe('warning');
  });
});

describe('formatClock', () => {
  it('reads a length in milliseconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9_000)).toBe('0:09');
    expect(formatClock(75_000)).toBe('1:15');
    expect(formatClock(600_000)).toBe('10:00');
  });

  it('floors rather than rounds: the clock never reaches a second early', () => {
    expect(formatClock(1_999)).toBe('0:01');
    expect(formatClock(59_999)).toBe('0:59');
  });

  it('clamps a negative length to zero rather than showing -0:01', () => {
    expect(formatClock(-1)).toBe('0:00');
    expect(formatClock(-90_000)).toBe('0:00');
  });
});
