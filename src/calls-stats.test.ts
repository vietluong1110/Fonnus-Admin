import { describe, expect, it } from 'vitest';
import {
  NO_TURNS_LABEL,
  callDurationMs,
  callHour,
  callStats,
  dayBands,
  formatDayBand,
  formatTimeOfDay,
  hourHistogram,
  scopeHeading,
  turnTicks,
  windowPhrase,
} from './calls-stats';
import type { CallScopeRow } from './queries/calls';

/** One scope row; every field the Calls screen reads has a harmless default. */
function call(over: Partial<CallScopeRow> = {}): CallScopeRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    started_at: new Date('2026-09-09T03:00:00Z'),
    ended_at: new Date('2026-09-09T03:01:00Z'),
    end_reason: 'caller_hangup',
    turn_count: 3,
    total_cost_vnd: '1200.0000',
    caller_phone_e164: '+84901234417',
    artifact_state: 'archived',
    artifact_key_prefix: 'calls/2026-09-09/abc',
    outcome: 'granted',
    failed_turn_idx: [],
    ...over,
  };
}

describe('callDurationMs', () => {
  it('is null for a call still open and for a reversed span (contract §3.2)', () => {
    expect(callDurationMs(call({ ended_at: null }))).toBeNull();
    expect(
      callDurationMs(
        call({
          started_at: new Date('2026-09-09T03:01:00Z'),
          ended_at: new Date('2026-09-09T03:00:00Z'),
        }),
      ),
    ).toBeNull();
  });
});

describe('callStats — the four cards of docs/upstream.md §Call list', () => {
  const start = new Date('2026-09-09T03:00:00Z');
  const closed = (seconds: number, over: Partial<CallScopeRow> = {}): CallScopeRow =>
    call({ started_at: start, ended_at: new Date(start.getTime() + seconds * 1000), ...over });

  it('takes the median over closed calls only and counts the open ones', () => {
    const stats = callStats([
      closed(60),
      closed(180),
      closed(300),
      call({ ended_at: null }),
      call({ ended_at: null }),
    ]);
    // Nearest-rank P50 of [60, 180, 300] seconds — the open calls have no
    // length at all and are left out rather than counted as 0.
    expect(stats.medianDurationMs).toBe(180_000);
    expect(stats.openCalls).toBe(2);
    expect(stats.calls).toBe(5);
  });

  it('has no median at all when no call of the scope has ended', () => {
    expect(callStats([call({ ended_at: null })]).medianDurationMs).toBeNull();
  });

  it('averages turns over granted calls only, a granted zero included', () => {
    const stats = callStats([
      closed(60, { outcome: 'granted', turn_count: 6 }),
      closed(60, { outcome: 'granted', turn_count: 0 }),
      // Trap 1: an unconsented call has no turn rows however much the caller
      // spoke, so it is outside the mean rather than a zero inside it.
      closed(60, { outcome: 'hung_up_before_consent', turn_count: 0 }),
      // Trap 2: no consent row is a state of the call, and not a grant.
      closed(60, { outcome: null, turn_count: 4 }),
    ]);
    expect(stats.consentedCalls).toBe(2);
    expect(stats.turnsPerConsentedCall).toBe(3);
  });

  it('has no turns-per-call figure when the scope holds no granted call', () => {
    expect(callStats([closed(60, { outcome: null })]).turnsPerConsentedCall).toBeNull();
  });

  it('counts recordings by the pipeline archived predicate and their share', () => {
    const stats = callStats([
      closed(60, { artifact_state: 'archived' }),
      closed(60, { artifact_state: 'expired', artifact_key_prefix: 'calls/x' }),
      closed(60, { artifact_state: 'expired', artifact_key_prefix: null }),
      closed(60, { artifact_state: 'spooled' }),
    ]);
    expect(stats.recordings).toBe(2);
    expect(stats.recordingShare).toBe(0.5);
  });

  it('answers an empty scope with nulls rather than zeros', () => {
    expect(callStats([])).toEqual({
      calls: 0,
      medianDurationMs: null,
      openCalls: 0,
      turnsPerConsentedCall: null,
      consentedCalls: 0,
      recordings: 0,
      recordingShare: null,
    });
  });
});

describe('hourHistogram — the clinic zone, not the process zone', () => {
  it('buckets a 23:30 UTC call into hour 6 of the next day in +07', () => {
    expect(callHour(new Date('2026-09-08T23:30:00Z'))).toBe(6);
    const counts = hourHistogram([
      call({ started_at: new Date('2026-09-08T23:30:00Z') }),
      call({ started_at: new Date('2026-09-09T07:15:00Z') }),
      call({ started_at: new Date('2026-09-09T07:45:00Z') }),
    ]);
    expect(counts).toHaveLength(24);
    expect(counts[6]).toBe(1);
    expect(counts[14]).toBe(2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('keeps midnight and the last hour of the day apart', () => {
    expect(callHour(new Date('2026-09-08T17:00:00Z'))).toBe(0);
    expect(callHour(new Date('2026-09-08T16:59:00Z'))).toBe(23);
  });
});

describe('formatTimeOfDay', () => {
  it('writes the clock in the clinic zone, whatever the process zone is', () => {
    expect(formatTimeOfDay(new Date('2026-09-09T07:32:07Z'))).toBe('14:32:07');
    expect(formatTimeOfDay(new Date('2026-09-08T17:00:00Z'))).toBe('00:00:00');
  });
});

describe('dayBands', () => {
  it('keeps the rows in order and takes the longest duration of each band', () => {
    const rows = [
      call({
        started_at: new Date('2026-09-09T07:32:00Z'),
        ended_at: new Date('2026-09-09T07:34:41Z'),
      }),
      call({
        started_at: new Date('2026-09-09T04:20:00Z'),
        ended_at: new Date('2026-09-09T04:21:08Z'),
      }),
      call({
        started_at: new Date('2026-09-08T14:44:00Z'),
        ended_at: new Date('2026-09-08T14:49:00Z'),
      }),
      // Still open: no length, so it cannot set the band's scale.
      call({ started_at: new Date('2026-09-08T12:40:00Z'), ended_at: null }),
    ];
    const bands = dayBands(rows);
    expect(bands.map((band) => band.day)).toEqual(['2026-09-09', '2026-09-08']);
    expect(bands.map((band) => band.rows.length)).toEqual([2, 2]);
    expect(bands[0]?.longestDurationMs).toBe(161_000);
    expect(bands[1]?.longestDurationMs).toBe(300_000);
    expect(bands[0]?.rows[0]).toBe(rows[0]);
  });

  it('opens a band per run, so a day the order revisits is not merged away', () => {
    // The list is `started_at DESC`, so this cannot arise from the query; the
    // band is a rendering of the order it was given, never a regroup of it.
    const bands = dayBands([
      call({ started_at: new Date('2026-09-09T03:00:00Z') }),
      call({ started_at: new Date('2026-09-08T03:00:00Z') }),
      call({ started_at: new Date('2026-09-09T02:00:00Z') }),
    ]);
    expect(bands.map((band) => band.day)).toEqual(['2026-09-09', '2026-09-08', '2026-09-09']);
  });

  it('has no band at all for an empty scope', () => {
    expect(dayBands([])).toEqual([]);
  });
});

describe('formatDayBand', () => {
  const now = new Date('2026-09-09T10:00:00Z');

  it('names today as today and every other day by its date', () => {
    expect(formatDayBand('2026-09-09', now)).toBe('Today · Wed 9 Sep');
    expect(formatDayBand('2026-09-08', now)).toBe('Tue 8 Sep');
  });
});

describe('turnTicks — trap 1 and trap 7', () => {
  it('draws one tick per turn on record and paints the failed ones', () => {
    // `idx` runs from 1 (contract §3), so idx 3 is the third tick.
    expect(turnTicks(call({ turn_count: 4, failed_turn_idx: [3] }))).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it('reads "none — not consented" for a call with no grant on record', () => {
    expect(turnTicks(call({ turn_count: 0, outcome: 'hung_up_before_consent' }))).toBeNull();
    expect(turnTicks(call({ turn_count: 0, outcome: null }))).toBeNull();
    expect(NO_TURNS_LABEL).toBe('none — not consented');
  });

  it('gives a granted call with no turn rows an empty strip, not the phrase', () => {
    // Trap 1: rows written. A granted call that wrote none is a genuine zero.
    expect(turnTicks(call({ turn_count: 0, outcome: 'granted' }))).toEqual([]);
  });

  it('never hides a failed turn behind a short turn_count', () => {
    expect(turnTicks(call({ turn_count: 1, failed_turn_idx: [1, 2] }))).toEqual([true, true]);
  });
});

describe('scopeHeading', () => {
  it('names the preset window the operator chose', () => {
    const window = {
      since: new Date('2026-09-02T00:00:00Z'),
      until: null,
      preset: '7d' as const,
      spec: '7d',
    };
    expect(scopeHeading({ kind: 'window', window }, 214)).toBe('214 calls in the last 7 days');
    expect(scopeHeading({ kind: 'window', window: { ...window, preset: '24h', spec: '24h' } }, 1)).toBe(
      '1 call in the last 24 hours',
    );
  });

  it('names both days of a custom range, the last one included', () => {
    expect(
      scopeHeading(
        {
          kind: 'window',
          window: {
            // 1 Sep 00:00 +07 to the midnight after 10 Sep — the half-open
            // bound of ADR 0006, read back as the day the operator asked for.
            since: new Date('2026-08-31T17:00:00Z'),
            until: new Date('2026-09-10T17:00:00Z'),
            preset: 'custom',
            spec: '2026-09-01',
          },
        },
        33,
      ),
    ).toBe('33 calls from Tue 1 Sep to Thu 10 Sep');
  });

  it('says a search is all time, whatever the window says', () => {
    expect(
      scopeHeading({ kind: 'search', keyword: '4417', phoneDigits: '4417', idPrefix: null }, 3),
    ).toBe('3 calls matching “4417”, all time');
  });
});

describe('windowPhrase', () => {
  // Overview prints this phrase too (`src/app/page.tsx`), so the two screens
  // cannot describe one window in two sentences.
  it('is the window half of the Calls heading, word for word', () => {
    const preset = {
      since: new Date('2026-09-02T00:00:00Z'),
      until: null,
      preset: '30d' as const,
      spec: '30d',
    };
    expect(windowPhrase(preset)).toBe('in the last 30 days');
    expect(scopeHeading({ kind: 'window', window: preset }, 214)).toBe(
      `214 calls ${windowPhrase(preset)}`,
    );
  });

  it('names a custom range by its days, and an open-ended one by its first', () => {
    const custom = {
      since: new Date('2026-08-31T17:00:00Z'),
      until: new Date('2026-09-10T17:00:00Z'),
      preset: 'custom' as const,
      spec: '2026-09-01',
    };
    expect(windowPhrase(custom)).toBe('from Tue 1 Sep to Thu 10 Sep');
    expect(windowPhrase({ ...custom, until: null })).toBe('since Tue 1 Sep');
  });
});
