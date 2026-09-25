import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUPING,
  DEFAULT_SINCE,
  MAX_WINDOW_DAYS,
  aggregate,
  bucketKey,
  configuredLlmOf,
  dayKey,
  dayLabel,
  differingKeys,
  groupKey,
  parseGroup,
  parseSince,
  parseWindow,
  percentiles,
  snapshotValue,
  voiceIdOf,
  weekKey,
  windowBuckets,
} from './dashboard';
import type { Window } from './window';
import type { DashboardCall, DashboardTurn } from './queries/dashboard';

const NOW = new Date('2026-09-07T10:00:00Z');

/**
 * The window the `aggregate` fixtures live in: 5–7 September in the clinic's
 * zone, `until` exclusive at midnight of the 8th (ADR 0006). Three day buckets,
 * whatever the calls happen to fall on — the charts draw the window, not the
 * data's own range.
 */
const WINDOW: Window = {
  since: new Date('2026-09-05T00:00:00+07:00'),
  until: new Date('2026-09-08T00:00:00+07:00'),
  preset: 'custom',
  spec: '2026-09-05',
};

describe('percentiles — copied from ../Fonnus/tools/lib/call-report.ts', () => {
  it('answers nulls on an empty sample rather than zeros', () => {
    expect(percentiles([])).toEqual({ count: 0, p50: null, p95: null, max: null });
  });

  it('puts one value at every rank', () => {
    expect(percentiles([42])).toEqual({ count: 1, p50: 42, p95: 42, max: 42 });
  });

  it('takes the nearest rank, never an interpolation', () => {
    // 1..10: p50 is the 5th value, p95 the 10th (ceil(.95*10) = 10).
    expect(percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({
      count: 10,
      p50: 5,
      p95: 10,
      max: 10,
    });
  });

  it('sorts numerically, not as strings', () => {
    expect(percentiles([1000, 9, 200]).p50).toBe(200);
    expect(percentiles([1000, 9, 200]).max).toBe(1000);
  });
});

describe('parseSince — copied from ../Fonnus/tools/report-calls.ts', () => {
  it('defaults to the pipeline flag default when nothing is asked for', () => {
    expect(DEFAULT_SINCE).toBe('7d');
    expect(parseSince(undefined, NOW).since.toISOString()).toBe('2026-08-31T10:00:00.000Z');
    expect(parseSince(undefined, NOW).error).toBeUndefined();
  });

  it('reads days, hours and minutes', () => {
    expect(parseSince('7d', NOW).since.toISOString()).toBe('2026-08-31T10:00:00.000Z');
    expect(parseSince('36h', NOW).since.toISOString()).toBe('2026-09-05T22:00:00.000Z');
    expect(parseSince('15m', NOW).since.toISOString()).toBe('2026-09-07T09:45:00.000Z');
  });

  it('reads an ISO instant', () => {
    expect(parseSince('2026-09-01T00:00:00Z', NOW).since.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('answers garbage with a message and the default window', () => {
    const window = parseSince('last tuesday', NOW);
    expect(window.error).toContain('7d, 36h, 90m or an ISO instant');
    expect(window.since.toISOString()).toBe('2026-08-31T10:00:00.000Z');
  });

  it('answers an amount past the Date range with a message and the default window', () => {
    // The regex accepts the digits; `now - 9999999999 days` is outside the Date
    // range, and an invalid Date would reach Postgres as a bad parameter.
    const window = parseSince('9999999999d', NOW);
    expect(window.error).toContain('7d, 36h, 90m or an ISO instant');
    expect(window.since.toISOString()).toBe('2026-08-31T10:00:00.000Z');
  });

  it('refuses a window past the cap, naming the statement timeout', () => {
    expect(MAX_WINDOW_DAYS).toBe(366);
    const window = parseSince('400d', NOW);
    expect(window.error).toContain('statement_timeout');
    expect(window.since.toISOString()).toBe('2026-08-31T10:00:00.000Z');

    // The cap applies to an ISO instant the same way.
    expect(parseSince('2020-01-01T00:00:00Z', NOW).error).toContain('366 days');
    expect(parseSince('366d', NOW).error).toBeUndefined();
  });
});

describe('dayLabel', () => {
  it('writes a day key the way the charts label it', () => {
    expect(dayLabel('2026-09-05')).toBe('05-09');
    expect(dayLabel('2026-12-31')).toBe('31-12');
  });
});

describe('dayKey', () => {
  it('buckets in Asia/Ho_Chi_Minh, never the process zone', () => {
    // 23:30 UTC is 06:30 the next morning in +07.
    expect(dayKey(new Date('2026-09-06T23:30:00Z'))).toBe('2026-09-07');
    expect(dayKey(new Date('2026-09-06T16:59:00Z'))).toBe('2026-09-06');
    expect(dayKey(new Date('2026-09-06T17:00:00Z'))).toBe('2026-09-07');
  });
});

describe('bucketKey and windowBuckets', () => {
  it('names an hour bucket by the clinic zone, midnight as 00', () => {
    expect(bucketKey('hour', new Date('2026-09-06T23:30:00Z'))).toBe('2026-09-07T06');
    expect(bucketKey('hour', new Date('2026-09-06T17:00:00Z'))).toBe('2026-09-07T00');
  });

  it('names a week bucket by its Monday', () => {
    // 5 September 2026 is a Saturday; 7 September is the next Monday.
    expect(weekKey(new Date('2026-09-05T02:00:00Z'))).toBe('2026-08-31');
    expect(weekKey(new Date('2026-09-07T02:00:00Z'))).toBe('2026-09-07');
    // A Sunday belongs to the week that started six days earlier, not to the
    // one starting tomorrow.
    expect(weekKey(new Date('2026-09-06T02:00:00Z'))).toBe('2026-08-31');
  });

  it('stops at the last instant of the window, never one bucket past it', () => {
    // `until` is exclusive — midnight of the 8th is the end of the 7th, so the
    // 8th is not a column (ADR 0006).
    const buckets = windowBuckets(
      {
        since: new Date('2026-09-05T00:00:00+07:00'),
        until: new Date('2026-09-08T00:00:00+07:00'),
        preset: 'custom',
        spec: '2026-09-05',
      },
      NOW,
      'day',
    );
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
    ]);
    // A date-only range covers each of its days end to end: no partial column.
    expect(buckets.every((bucket) => !bucket.partial)).toBe(true);
  });

  it('marks the edge buckets a rolling window only reaches into', () => {
    // `24h` is open-ended, so it ends inside the current hour — the last
    // column is "this hour so far" and the chart fades it. NOW sits exactly on
    // the hour, so `now - 24h` lands exactly on a bucket boundary and the
    // FIRST column is whole; a minute later it would not be, which the next
    // assertion pins.
    const onTheHour = windowBuckets(parseWindow({ since: '24h' }, NOW), NOW, 'hour');
    expect(onTheHour).toHaveLength(25);
    expect(onTheHour[0]?.partial).toBe(false);
    expect(onTheHour[24]?.partial).toBe(true);
    expect(onTheHour.slice(1, 24).every((bucket) => !bucket.partial)).toBe(true);

    const mid = new Date(NOW.getTime() + 30 * 60_000);
    const rolling = windowBuckets(parseWindow({ since: '24h' }, mid), mid, 'hour');
    expect(rolling).toHaveLength(25);
    expect(rolling[0]?.partial).toBe(true);
    expect(rolling[24]?.partial).toBe(true);
    expect(rolling.slice(1, 24).every((bucket) => !bucket.partial)).toBe(true);
  });

  it('marks a week the window starts or ends inside, and marks neither of a whole one', () => {
    // 10 June 2026 is a Wednesday: the window opens inside the week of Monday
    // the 8th, and closes inside the week of Monday 7 September.
    const midweek = windowBuckets(
      {
        since: new Date('2026-06-10T00:00:00+07:00'),
        until: new Date('2026-09-08T00:00:00+07:00'),
        preset: 'custom',
        spec: '2026-06-10',
      },
      NOW,
      'week',
    );
    expect(midweek[0]?.partial).toBe(true);
    expect(midweek.at(-1)?.partial).toBe(true);

    // Monday 8 June to Sunday 6 September: every week whole, none faded.
    const whole = windowBuckets(
      {
        since: new Date('2026-06-08T00:00:00+07:00'),
        until: new Date('2026-09-07T00:00:00+07:00'),
        preset: 'custom',
        spec: '2026-06-08',
      },
      NOW,
      'week',
    );
    expect(whole.every((bucket) => !bucket.partial)).toBe(true);
  });
});

const SNAPSHOT_A = { TTS_FLUSH_MS: 120, FONNUS_ENV: 'prod', FONNUS_BUILD_SHA: 'a'.repeat(40) };
const SNAPSHOT_B = { FONNUS_ENV: 'prod', TTS_FLUSH_MS: 240, FONNUS_BUILD_SHA: 'a'.repeat(40) };

function call(over: Partial<DashboardCall> = {}): DashboardCall {
  return {
    id: 'call-1',
    started_at: new Date('2026-09-06T02:00:00Z'),
    ended_at: new Date('2026-09-06T02:03:00Z'),
    end_reason: 'caller_hangup',
    total_cost_vnd: '9240.0000',
    stt_model: 'nova-3',
    tts_model: 'sonic-2',
    config_snapshot: SNAPSHOT_A,
    outcome: 'granted',
    ...over,
  };
}

function turn(over: Partial<DashboardTurn> = {}): DashboardTurn {
  return {
    call_id: 'call-1',
    idx: 1,
    marks: {},
    caller_perceived_ms: null,
    pipeline_ms: null,
    llm_model: 'openrouter/some-model',
    interrupted: false,
    source: 'speech_final',
    failed_leg: null,
    failed_stage: null,
    failed_after_ms: null,
    ...over,
  };
}

describe('grouping', () => {
  it('falls back to the default grouping for anything the list does not name', () => {
    // ADR 0009 decision 4: the screen opens grouped by the model, the change
    // the hypothesis loop makes most often.
    expect(DEFAULT_GROUPING).toBe('key:OPENROUTER_MODEL');
    expect(parseGroup(undefined)).toBe('key:OPENROUTER_MODEL');
    expect(parseGroup('models')).toBe('key:OPENROUTER_MODEL');
    expect(parseGroup('key:')).toBe('key:OPENROUTER_MODEL');
    expect(parseGroup('none')).toBe('none');
    expect(parseGroup('config')).toBe('config');
    expect(parseGroup('key:TTS_FLUSH_MS')).toBe('key:TTS_FLUSH_MS');
    // The one dotted path the vocabulary allows (ADR 0009 decision 2).
    expect(parseGroup('key:runtime.version')).toBe('key:runtime.version');
  });

  it('groups a null snapshot as unknown rather than dropping it', () => {
    expect(groupKey(call({ config_snapshot: null }), turn(), 'config')).toBe('unknown');
    expect(groupKey(call({ config_snapshot: null }), turn(), 'key:TTS_FLUSH_MS')).toBe('unknown');
    expect(groupKey(call({ stt_model: null }), turn(), 'stt_model')).toBe('unknown');
    expect(groupKey(call(), turn({ llm_model: null }), 'llm_model')).toBe('unknown');
  });

  it('groups by the voice key of the call\'s own TTS vendor', () => {
    const snapshot = (extra: Record<string, unknown>) => call({ config_snapshot: extra });
    expect(
      groupKey(snapshot({ TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: 'c-1', ELEVENLABS_VOICE_ID: 'e-1' }), turn(), 'voice'),
    ).toBe('c-1');
    expect(
      groupKey(snapshot({ TTS_PROVIDER: 'elevenlabs', CARTESIA_VOICE_ID: 'c-1', ELEVENLABS_VOICE_ID: 'e-1' }), turn(), 'voice'),
    ).toBe('e-1');
    // The vendor's own key missing is no answer, never the other vendor's id.
    expect(groupKey(snapshot({ TTS_PROVIDER: 'cartesia', ELEVENLABS_VOICE_ID: 'e-1' }), turn(), 'voice')).toBe(
      'unknown',
    );
    // No known vendor: whichever of the two is present (docs/upstream.md §Overview).
    expect(groupKey(snapshot({ ELEVENLABS_VOICE_ID: 'e-1' }), turn(), 'voice')).toBe('e-1');
    expect(groupKey(snapshot({ TTS_PROVIDER: 'fake' }), turn(), 'voice')).toBe('unknown');
    expect(groupKey(call({ config_snapshot: null }), turn(), 'voice')).toBe('unknown');
    expect(parseGroup('voice')).toBe('voice');
  });

  it('reads own keys only, so a prototype property is no group', () => {
    // The key comes from the query string: `__proto__` would otherwise fold
    // every call into one group and `constructor` into a function's group.
    expect(groupKey(call(), turn(), 'key:__proto__')).toBe('unknown');
    expect(groupKey(call(), turn(), 'key:constructor')).toBe('unknown');
    expect(groupKey(call(), turn(), 'key:toString')).toBe('unknown');
    // A key the snapshot really carries still answers with its value.
    expect(groupKey(call(), turn(), 'key:FONNUS_ENV')).toBe('prod');
    expect(snapshotValue(SNAPSHOT_A, 'constructor')).toBe('absent');
    expect(snapshotValue(SNAPSHOT_A, 'FONNUS_ENV')).toBe('prod');
  });

  // §3.4: the snapshot is not flat. `runtime` is `{version, config}` and
  // `SPEECHMATICS_SOUNDS_LIKE` is an object; `JSON.stringify`'s array replacer
  // filters keys at every level, so both used to hash to `{}` and two calls on
  // one build SHA with different runtime configuration fell into one group.
  const NESTED_A = {
    FONNUS_BUILD_SHA: 'b'.repeat(40),
    TTS_FLUSH_MS: 120,
    runtime: { version: 7, config: { tts: { flush_ms: 120 }, stt: { endpointing_ms: 300 } } },
  };
  const NESTED_B = {
    FONNUS_BUILD_SHA: 'b'.repeat(40),
    TTS_FLUSH_MS: 120,
    runtime: { version: 7, config: { tts: { flush_ms: 120 }, stt: { endpointing_ms: 900 } } },
  };

  it('separates two configurations that differ only inside runtime.config', () => {
    expect(groupKey(call({ config_snapshot: NESTED_A }), turn(), 'config')).not.toBe(
      groupKey(call({ config_snapshot: NESTED_B }), turn(), 'config'),
    );
  });

  it('sorts keys at every level, so a nested insertion order is no difference', () => {
    const shuffled = {
      TTS_FLUSH_MS: 120,
      runtime: {
        config: { stt: { endpointing_ms: 300 }, tts: { flush_ms: 120 } },
        version: 7,
      },
      FONNUS_BUILD_SHA: NESTED_A.FONNUS_BUILD_SHA,
    };
    expect(groupKey(call({ config_snapshot: shuffled }), turn(), 'config')).toBe(
      groupKey(call({ config_snapshot: NESTED_A }), turn(), 'config'),
    );
  });

  it('keeps array order, because order is meaning in OPENROUTER_STOP', () => {
    expect(
      groupKey(call({ config_snapshot: { OPENROUTER_STOP: ['a', 'b'] } }), turn(), 'config'),
    ).not.toBe(
      groupKey(call({ config_snapshot: { OPENROUTER_STOP: ['b', 'a'] } }), turn(), 'config'),
    );
  });

  it('never names runtime itself as a column, whatever differs inside it', () => {
    // ADR 0009 decision 1: the cell would hold a 54-leaf document, and every
    // leaf a console edit changes already surfaces as a flat-key difference.
    // Here the two rows carry one version, so there is no column at all.
    expect(differingKeys([NESTED_A, NESTED_B])).toEqual([]);
  });

  it('adds the derived runtime.version column only when the version differs', () => {
    const later = { ...NESTED_A, runtime: { version: 8, config: {} } };
    expect(differingKeys([NESTED_A, later])).toEqual(['runtime.version']);
    // A call on boot configuration carries no `runtime` at all, which is a
    // difference from one that ran under a row (§3.4).
    const boot = { FONNUS_BUILD_SHA: NESTED_A.FONNUS_BUILD_SHA, TTS_FLUSH_MS: 120 };
    expect(differingKeys([NESTED_A, boot])).toEqual(['runtime.version']);
    expect(snapshotValue(NESTED_A, 'runtime.version')).toBe('7');
    expect(snapshotValue(boot, 'runtime.version')).toBe('absent');
  });

  it('groups by the runtime_config row the call ran under, unknown on boot config', () => {
    expect(groupKey(call({ config_snapshot: NESTED_A }), turn(), 'key:runtime.version')).toBe('7');
    expect(
      groupKey(call({ config_snapshot: { TTS_FLUSH_MS: 120 } }), turn(), 'key:runtime.version'),
    ).toBe('unknown');
    expect(
      groupKey(call({ config_snapshot: { runtime: { config: {} } } }), turn(), 'key:runtime.version'),
    ).toBe('unknown');
  });

  it('reads a renamed key under either spelling, so one deploy is one group', () => {
    // Contract §3.4's COALESCE: rows written before 2026-09-17 carry `STT_*`,
    // rows after it `DEEPGRAM_*`, and the two are one setting (ADR 0009).
    const before = call({ config_snapshot: { STT_ENDPOINTING_MS: 300 } });
    const after = call({ config_snapshot: { DEEPGRAM_ENDPOINTING_MS: 300 } });
    for (const grouping of [
      'key:DEEPGRAM_ENDPOINTING_MS',
      'key:STT_ENDPOINTING_MS',
    ] as const) {
      expect(groupKey(before, turn(), grouping)).toBe('300');
      expect(groupKey(after, turn(), grouping)).toBe('300');
    }
    // And the column carries the new name, once.
    expect(
      differingKeys([{ STT_ENDPOINTING_MS: 300 }, { DEEPGRAM_ENDPOINTING_MS: 900 }]),
    ).toEqual(['DEEPGRAM_ENDPOINTING_MS']);
    expect(differingKeys([{ STT_TURN_TRIGGER: 'a' }, { DEEPGRAM_TURN_TRIGGER: 'a' }])).toEqual([]);
    expect(snapshotValue({ STT_UTTERANCE_END_MS: 1000 }, 'DEEPGRAM_UTTERANCE_END_MS')).toBe('1000');
  });

  it('does not care what order Postgres handed the snapshot keys over in', () => {
    const first = groupKey(call({ config_snapshot: SNAPSHOT_A }), turn(), 'config');
    const shuffled = { FONNUS_BUILD_SHA: SNAPSHOT_A.FONNUS_BUILD_SHA, FONNUS_ENV: 'prod', TTS_FLUSH_MS: 120 };
    expect(groupKey(call({ config_snapshot: shuffled }), turn(), 'config')).toBe(first);
    expect(groupKey(call({ config_snapshot: SNAPSHOT_B }), turn(), 'config')).not.toBe(first);
  });

  it('reads one snapshot key as text, whatever JSON type it was stored as', () => {
    expect(groupKey(call(), turn(), 'key:TTS_FLUSH_MS')).toBe('120');
    expect(
      groupKey(call({ config_snapshot: { BARGE_IN_ENABLED: false } }), turn(), 'key:BARGE_IN_ENABLED'),
    ).toBe('false');
  });
});

describe('voiceIdOf — the one voice rule of the Overview and the call detail', () => {
  it("reads the key of the snapshot's own TTS_PROVIDER vendor", () => {
    expect(voiceIdOf({ TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: 'c-1' })).toEqual({
      key: 'CARTESIA_VOICE_ID',
      id: 'c-1',
    });
    expect(voiceIdOf({ TTS_PROVIDER: 'elevenlabs', ELEVENLABS_VOICE_ID: 'e-1' })).toEqual({
      key: 'ELEVENLABS_VOICE_ID',
      id: 'e-1',
    });
  });

  it('takes whichever voice key is present when no known vendor is named', () => {
    expect(voiceIdOf({ ELEVENLABS_VOICE_ID: 'e-1' })).toEqual({ key: 'ELEVENLABS_VOICE_ID', id: 'e-1' });
    expect(voiceIdOf({ TTS_PROVIDER: 'fake', CARTESIA_VOICE_ID: 'c-1' })).toEqual({
      key: 'CARTESIA_VOICE_ID',
      id: 'c-1',
    });
    expect(voiceIdOf({ TTS_PROVIDER: 'fake' })).toBeNull();
  });

  it("never falls back to another vendor's key when the named vendor's key is absent", () => {
    expect(voiceIdOf({ TTS_PROVIDER: 'cartesia', ELEVENLABS_VOICE_ID: 'e-1' })).toBeNull();
    expect(voiceIdOf({ TTS_PROVIDER: 'elevenlabs', CARTESIA_VOICE_ID: 'c-1' })).toBeNull();
  });

  it('reads own keys only and non-empty string ids only', () => {
    // A vendor named after a prototype property is no known vendor, and an
    // inherited property is no key.
    expect(voiceIdOf({ TTS_PROVIDER: 'constructor' })).toBeNull();
    expect(voiceIdOf({ TTS_PROVIDER: '__proto__' })).toBeNull();
    expect(voiceIdOf(Object.create({ CARTESIA_VOICE_ID: 'inherited' }) as Record<string, unknown>)).toBeNull();
    expect(voiceIdOf({ TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: 7 })).toBeNull();
    expect(voiceIdOf({ TTS_PROVIDER: 'cartesia', CARTESIA_VOICE_ID: '' })).toBeNull();
  });
});

describe('configuredLlmOf', () => {
  it("reads the snapshot's own OPENROUTER_MODEL as a non-empty string", () => {
    expect(configuredLlmOf({ OPENROUTER_MODEL: 'openai/gpt-oss-120b' })).toBe('openai/gpt-oss-120b');
    expect(configuredLlmOf({ OPENROUTER_MODEL: '' })).toBeNull();
    expect(configuredLlmOf({ OPENROUTER_MODEL: 7 })).toBeNull();
    expect(configuredLlmOf({})).toBeNull();
    expect(configuredLlmOf(null)).toBeNull();
    expect(configuredLlmOf(Object.create({ OPENROUTER_MODEL: 'inherited' }))).toBeNull();
  });
});

describe('differingKeys', () => {
  it('names only the key two configurations disagree on', () => {
    expect(differingKeys([SNAPSHOT_A, SNAPSHOT_B])).toEqual(['TTS_FLUSH_MS']);
  });

  it('has nothing to compare with fewer than two snapshots', () => {
    expect(differingKeys([SNAPSHOT_A])).toEqual([]);
    expect(differingKeys([SNAPSHOT_A, null])).toEqual([]);
  });

  it('counts an absent key as a difference and renders it as absent', () => {
    expect(differingKeys([{ A: 1 }, { A: 1, B: 2 }])).toEqual(['B']);
    expect(snapshotValue({ A: 1 }, 'B')).toBe('absent');
    expect(snapshotValue(null, 'B')).toBe('unknown');
    expect(snapshotValue({ B: false }, 'B')).toBe('false');
  });

  it('tells an absent key from a null one, as the group identity does', () => {
    // Two snapshots the dashboard already puts in separate groups must show
    // the key they differ on, or the two rows read as the same configuration.
    expect(groupKey(call({ config_snapshot: { A: 1 } }), turn(), 'config')).not.toBe(
      groupKey(call({ config_snapshot: { A: 1, B: null } }), turn(), 'config'),
    );
    expect(differingKeys([{ A: 1 }, { A: 1, B: null }])).toEqual(['B']);
  });

  it('never names faq, and faq alone does not split the config grouping (contract §3.4)', () => {
    // `config_snapshot.faq` is the tenant's FAQ entries as read, ~8 KB a call.
    const faqA = { ...SNAPSHOT_A, faq: { count: 1, entries: [{ key: 'gio_mo_cua', question: 'q', answer: 'a', description: 'd' }] } };
    const faqB = { ...SNAPSHOT_A, faq: { count: 1, entries: [{ key: 'gio_mo_cua', question: 'q', answer: 'b', description: 'd' }] } };
    expect(differingKeys([faqA, faqB])).toEqual([]);
    // Present on one, absent on the other: still no column, still one group.
    expect(differingKeys([faqA, SNAPSHOT_A])).toEqual([]);
    expect(differingKeys([faqA, { ...SNAPSHOT_B, faq: faqA.faq }])).toEqual(['TTS_FLUSH_MS']);
    const group = (snapshot: Record<string, unknown>) =>
      groupKey(call({ config_snapshot: snapshot }), turn(), 'config');
    expect(group(faqA)).toBe(group(faqB));
    expect(group(faqA)).toBe(group(SNAPSHOT_A));
    expect(group(faqA)).not.toBe(group(SNAPSHOT_B));
  });
});

describe('aggregate', () => {
  const calls = [
    call({ id: 'c1', started_at: new Date('2026-09-05T02:00:00Z') }),
    call({ id: 'c2', started_at: new Date('2026-09-06T23:30:00Z'), config_snapshot: SNAPSHOT_B }),
    // Unconsented: no turn rows at all (trap 1), still a call in the window.
    call({ id: 'c3', started_at: new Date('2026-09-06T03:00:00Z'), outcome: 'hung_up_before_consent' }),
  ];
  const turns = [
    // A whole turn: every mark stamped.
    turn({
      call_id: 'c1',
      idx: 1,
      caller_perceived_ms: 900,
      pipeline_ms: 700,
      marks: {
        speech_end: 1_000,
        endpoint_decision: 1_200,
        llm_first_token: 1_500,
        tts_first_byte: 1_700,
        first_audio_out: 1_900,
      },
    }),
    // Interrupted, and its `send` leg runs backwards — the leg is no sample,
    // the turn still is.
    turn({
      call_id: 'c1',
      idx: 2,
      interrupted: true,
      caller_perceived_ms: 1_100,
      pipeline_ms: 800,
      marks: {
        speech_end: 5_000,
        endpoint_decision: 5_200,
        llm_first_token: 5_500,
        tts_first_byte: 5_900,
        first_audio_out: 5_800,
      },
    }),
    // Failed on the LLM leg: no `first_audio_out`, so no headline span exists.
    turn({
      call_id: 'c2',
      idx: 1,
      failed_leg: 'llm',
      failed_stage: null,
      failed_after_ms: 15_040,
      marks: { speech_end: 9_000, endpoint_decision: 9_200 },
    }),
    // A turn whose call is not in the window's call set — impossible in
    // practice (one predicate), counted nowhere if it ever happens.
    turn({ call_id: 'ghost', idx: 1, caller_perceived_ms: 99_999 }),
  ];

  it('counts the calls, the consented calls and the turns apart', () => {
    const d = aggregate(calls, turns, 'none', WINDOW, NOW);
    expect(d.calls).toBe(3);
    expect(d.consentedCalls).toBe(2);
    expect(d.turns).toBe(3);
  });

  it('gives a leg a smaller count than the turn count when a mark is missing', () => {
    const d = aggregate(calls, turns, 'none', WINDOW, NOW);
    // Three turns; two stamped `llm_first_token`, and only one has a `send` leg
    // that runs forwards.
    expect(d.legs.llm_ttft.count).toBe(2);
    expect(d.legs.send.count).toBe(1);
    expect(d.legs.send.max).toBe(200);
    // The interrupted turn is a sample everywhere its marks allow.
    expect(d.legs.endpoint_wait.count).toBe(3);
    expect(d.perceived.count).toBe(2);
    expect(d.pipeline.p95).toBe(800);
  });

  it('lists exactly the turns whose reply never became audible', () => {
    const d = aggregate(calls, turns, 'none', WINDOW, NOW);
    expect(d.outside.map((t) => [t.call_id, t.idx])).toEqual([['c2', 1]]);
  });

  it('buckets the latency by day in the clinic zone, oldest first, across the window', () => {
    const d = aggregate(calls, turns, 'none', WINDOW, NOW);
    // c2 was answered at 23:30 UTC on the 6th — the 7th in +07. Nothing has
    // turns on the 6th, and that day is still a bucket: a real null point, so
    // the chart draws a gap there instead of a fast day.
    expect(d.bucketUnit).toBe('day');
    expect(d.latencyByBucket.map((bucket) => bucket.key)).toEqual([
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
    ]);
    expect(d.latencyByBucket.map((bucket) => bucket.label)).toEqual(['05-09', '06-09', '07-09']);
    expect(d.latencyByBucket[0]?.turns).toBe(2);
    expect(d.latencyByBucket[0]?.pipelineP95).toBe(800);
    expect(d.latencyByBucket[1]).toEqual({
      key: '2026-09-06',
      label: '06-09',
      partial: false,
      turns: 0,
      perceivedP95: null,
      pipelineP95: null,
    });
    expect(d.latencyByBucket[2]?.perceivedP95).toBeNull();
  });

  it('excludes a negative headline span from its percentile, as it does a leg', () => {
    // Marks stamped out of order: a fault (contract §3.2), never a fast turn.
    const faulty = [
      turn({ call_id: 'c1', idx: 9, caller_perceived_ms: -5, pipeline_ms: -5 }),
      ...turns,
    ];
    const d = aggregate(calls, faulty, 'none', WINDOW, NOW);
    expect(d.turns).toBe(4);
    expect(d.perceived.count).toBe(2);
    expect(d.pipeline.count).toBe(2);
    expect(d.perceived.p50).toBe(900);
  });

  it('sets a turn whose marks column is null apart from every number', () => {
    // The pipeline's `turnMetricRows` filters `marks IS NOT NULL` in SQL, so
    // `turnCount` never counts these; the console counts them apart instead of
    // hiding them. A stamped-nothing `{}` is a turn on both sides.
    const withNullMarks = [...turns, turn({ call_id: 'c1', idx: 3, marks: null })];
    const full = aggregate(calls, withNullMarks, 'none', WINDOW, NOW);
    expect(full.turns).toBe(3);
    expect(full.turnsWithoutMarks).toBe(1);
    expect(full.outside.map((t) => [t.call_id, t.idx])).toEqual([
      ['c2', 1],
      ['c1', 3],
    ]);
    // It brings no group into existence and no group counts it.
    const grouped = aggregate(calls, withNullMarks, 'llm_model', WINDOW, NOW);
    expect(grouped.groups[0]?.turns).toBe(3);
  });

  it('shows only the keys the configurations disagree on, and keeps a null one', () => {
    const withNull = [
      ...calls,
      call({ id: 'c4', started_at: new Date('2026-09-06T04:00:00Z'), config_snapshot: null }),
    ];
    const d = aggregate(
      withNull,
      [...turns, turn({ call_id: 'c4', idx: 1, pipeline_ms: 400 })],
      'config',
      WINDOW,
      NOW,
    );
    expect(d.differingKeys).toEqual(['TTS_FLUSH_MS']);
    expect(d.groups.map((g) => g.label)).toContain('unknown');
    // Biggest sample first.
    expect(d.groups[0]?.turns).toBe(2);
    expect(d.groups[0]?.label).toBe(`FONNUS_BUILD_SHA ${'a'.repeat(7)}`);
    expect(d.groups.reduce((sum, g) => sum + g.turns, 0)).toBe(d.turns);
  });

  it('leaves the groups empty and the differing keys unread when nothing is grouped', () => {
    const d = aggregate(calls, turns, 'none', WINDOW, NOW);
    expect(d.groups).toEqual([]);
    expect(d.differingKeys).toEqual([]);
  });

  it('groups by a model column', () => {
    const d = aggregate(calls, turns, 'llm_model', WINDOW, NOW);
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]?.key).toBe('openrouter/some-model');
    expect(d.groups[0]?.calls).toBe(2);
  });

  it('splits the calls of each bucket by consent and covers both window edges', () => {
    // c1 on the 5th (granted), c3 on the 6th (hung up before consent), c2 at
    // 23:30 UTC on the 6th, which is the 7th in +07 (granted). Unlike the P95
    // chart, a bucket with no call is a zero: nobody rang is a measurement.
    const d = aggregate(calls, turns, 'none', WINDOW, NOW);
    expect(d.callsByBucket).toEqual([
      { key: '2026-09-05', label: '05-09', partial: false, consented: 1, notConsented: 0 },
      { key: '2026-09-06', label: '06-09', partial: false, consented: 0, notConsented: 1 },
      { key: '2026-09-07', label: '07-09', partial: false, consented: 1, notConsented: 0 },
    ]);
  });

  it('draws the whole window, not the first day with a call to the last', () => {
    // A seven-day window with calls on its third and fifth day: seven buckets,
    // and the zeros at both edges are the answer — the window was quiet there.
    const week: Window = {
      since: new Date('2026-09-01T00:00:00+07:00'),
      until: new Date('2026-09-08T00:00:00+07:00'),
      preset: 'custom',
      spec: '2026-09-01',
    };
    const d = aggregate(
      [
        call({ id: 'a', started_at: new Date('2026-09-03T02:00:00Z') }),
        call({ id: 'b', started_at: new Date('2026-09-05T02:00:00Z') }),
      ],
      [],
      'none',
      week,
      NOW,
    );
    expect(d.callsByBucket).toHaveLength(7);
    expect(d.callsByBucket.map((bucket) => bucket.consented)).toEqual([0, 0, 1, 0, 1, 0, 0]);
    expect(d.callsByBucket[0]?.label).toBe('01-09');
    expect(d.callsByBucket[6]?.label).toBe('07-09');
  });

  it('draws a 24h window as hours in the clinic zone', () => {
    // The `24h` preset is open-ended, so it runs from `now - 24h` to `now` —
    // which touches 25 clock hours, the two partial ones at the edges included.
    const day = parseWindow({ since: '24h' }, NOW);
    const d = aggregate(
      [call({ id: 'a', started_at: new Date('2026-09-07T09:30:00Z') })],
      [],
      'none',
      day,
      NOW,
    );
    expect(d.bucketUnit).toBe('hour');
    expect(d.callsByBucket).toHaveLength(25);
    // 10:00 UTC on the 7th is 17:00 in +07, at both ends of the window.
    expect(d.callsByBucket[0]?.key).toBe('2026-09-06T17');
    expect(d.callsByBucket[0]?.label).toBe('17');
    expect(d.callsByBucket[24]?.key).toBe('2026-09-07T17');
    // The call at 09:30 UTC is 16:30 in +07 — the second-to-last bucket.
    expect(d.callsByBucket[23]).toEqual({
      key: '2026-09-07T16',
      label: '16',
      partial: false,
      consented: 1,
      notConsented: 0,
    });
  });

  it('pins the zone offset the partial flag is decided in against parseWindow', () => {
    // `bucketInstant` turns a key back into an instant with a written +07:00
    // offset, a second copy of the constant `src/window.ts` resolves date-only
    // bounds with (and pins against Intl). If the two ever disagreed, every
    // date-only window's first column would be marked partial — so a bound
    // resolved by `parseWindow` is a whole day here, and one ms later is not.
    const whole = parseWindow({ since: '2026-09-05', until: '2026-09-07' }, NOW);
    expect(windowBuckets(whole, NOW, 'day').map((bucket) => bucket.partial)).toEqual([
      false,
      false,
      false,
    ]);
    const shaved = { ...whole, since: new Date(whole.since.getTime() + 1) };
    expect(windowBuckets(shaved, NOW, 'day')[0]?.partial).toBe(true);
    expect(windowBuckets(whole, NOW, 'hour')[0]?.partial).toBe(false);
    expect(windowBuckets(shaved, NOW, 'hour')[0]?.partial).toBe(true);
  });

  it('folds a call the clock put past the window into the last column', () => {
    // The open-ended preset's SQL has no upper bound, so a box whose clock ran
    // ahead can hand over a call from the future. 65 minutes past `now` is the
    // NEXT clock hour (18:05 in +07), a key no column carries — five minutes
    // would still land in the last column's own hour and test nothing.
    // Dropping it would leave the chart totalling to less than the "Calls"
    // figure printed beside it.
    const day = parseWindow({ since: '24h' }, NOW);
    const d = aggregate(
      [
        call({ id: 'a', started_at: new Date(NOW.getTime() + 65 * 60_000) }),
        call({ id: 'b', started_at: new Date('2026-09-07T09:30:00Z') }),
      ],
      [],
      'none',
      day,
      NOW,
    );
    expect(d.callsByBucket.map((bucket) => bucket.key)).not.toContain('2026-09-07T18');
    const total = d.callsByBucket.reduce(
      (sum, bucket) => sum + bucket.consented + bucket.notConsented,
      0,
    );
    expect(total).toBe(d.calls);
    expect(d.callsByBucket.at(-1)?.consented).toBe(1);
    // And the edge columns say they are partial, so a short bar is readable.
    expect(d.callsByBucket.at(-1)?.partial).toBe(true);
  });

  it('folds a call before the first column into it rather than dropping it', () => {
    const d = aggregate(
      [call({ id: 'a', started_at: new Date('2026-09-01T02:00:00Z') })],
      [],
      'none',
      WINDOW,
      NOW,
    );
    expect(d.callsByBucket[0]?.consented).toBe(1);
    expect(
      d.callsByBucket.reduce((sum, bucket) => sum + bucket.consented + bucket.notConsented, 0),
    ).toBe(d.calls);
  });

  it('draws a window past 45 days as Monday-start weeks', () => {
    const quarter: Window = {
      since: new Date('2026-06-10T00:00:00+07:00'),
      until: new Date('2026-09-08T00:00:00+07:00'),
      preset: 'custom',
      spec: '2026-06-10',
    };
    const d = aggregate(
      [call({ id: 'a', started_at: new Date('2026-09-05T02:00:00Z') })],
      [],
      'none',
      quarter,
      NOW,
    );
    expect(d.bucketUnit).toBe('week');
    // 10 June 2026 is a Wednesday: its week starts Monday the 8th. The last
    // bucket is the week of Monday 7 September, the one `until` ends inside.
    expect(d.callsByBucket[0]?.key).toBe('2026-06-08');
    expect(d.callsByBucket[0]?.label).toBe('08-06');
    expect(d.callsByBucket.at(-1)?.key).toBe('2026-09-07');
    expect(d.callsByBucket).toHaveLength(14);
    // The call on 5 September (a Saturday) lands in the week of Monday the 31st.
    expect(d.callsByBucket.find((bucket) => bucket.key === '2026-08-31')?.consented).toBe(1);
  });

  it('places a call by the clinic zone, never by the box the console runs on', () => {
    // 23:30 UTC on the 4th is 06:30 on the 5th in +07: the 5th's bucket.
    const late = aggregate(
      [call({ id: 'a', started_at: new Date('2026-09-04T23:30:00Z') })],
      [],
      'none',
      {
        since: new Date('2026-09-04T00:00:00+07:00'),
        until: new Date('2026-09-06T00:00:00+07:00'),
        preset: 'custom',
        spec: '2026-09-04',
      },
      NOW,
    );
    expect(late.callsByBucket).toEqual([
      { key: '2026-09-04', label: '04-09', partial: false, consented: 0, notConsented: 0 },
      { key: '2026-09-05', label: '05-09', partial: false, consented: 1, notConsented: 0 },
    ]);
  });

  it('sums the cost as a floor and counts the calls it could not price', () => {
    // Trap 3: `numeric` arrives as a string; an unparseable one is missing,
    // never 0, and the count of them travels with the number on screen.
    const priced = [
      call({ id: 'a', total_cost_vnd: '9240.0000' }),
      call({ id: 'b', total_cost_vnd: '760.5000' }),
      call({ id: 'c', total_cost_vnd: null }),
      call({ id: 'd', total_cost_vnd: 'n/a' }),
    ];
    const d = aggregate(priced, [], 'none', WINDOW, NOW);
    expect(d.costFloorVnd).toBe(10_000.5);
    expect(d.unpricedCalls).toBe(2);
    // Not one parseable figure is "no cost on record", not a zero cost.
    expect(aggregate([call({ total_cost_vnd: null })], [], 'none', WINDOW, NOW).costFloorVnd).toBeNull();
  });

  it('counts the end reasons and the outcomes, with not finalized beside them', () => {
    // Trap 2: a call with no consent row is a state of the call — in progress,
    // or the finish transaction failed — and is never a refusal, so it is in
    // neither distribution and is counted apart.
    const mixed = [
      call({ id: 'a', end_reason: 'caller_hangup', outcome: 'granted' }),
      call({ id: 'b', end_reason: 'caller_hangup', outcome: 'granted' }),
      call({ id: 'c', end_reason: 'max_duration', outcome: 'hung_up_before_consent' }),
      call({ id: 'd', end_reason: null, ended_at: null, outcome: null }),
    ];
    const d = aggregate(mixed, [], 'none', WINDOW, NOW);
    expect(d.endReasons).toEqual([
      { value: 'caller_hangup', calls: 2 },
      { value: 'max_duration', calls: 1 },
    ]);
    expect(d.outcomes).toEqual([
      { value: 'granted', calls: 2 },
      { value: 'hung_up_before_consent', calls: 1 },
    ]);
    expect(d.notFinalized).toBe(1);
    expect(d.noRow).toBe(1);
  });

  it('counts turn failures by leg and stage, keeping a provider error apart', () => {
    // Trap 7: `failed_leg IS NOT NULL` is the one test, and a null stage under
    // a set leg is a provider error — a bucket of its own, never folded into
    // the deadline stages.
    const failing = [
      turn({ call_id: 'c1', idx: 1, failed_leg: 'llm', failed_stage: 'ttfb' }),
      turn({ call_id: 'c1', idx: 2, failed_leg: 'llm', failed_stage: 'ttfb' }),
      turn({ call_id: 'c1', idx: 3, failed_leg: 'llm', failed_stage: null }),
      turn({ call_id: 'c1', idx: 4, failed_leg: 'tts', failed_stage: 'total' }),
      turn({ call_id: 'c1', idx: 5 }),
      // No marks at all: in no number on the screen, this one included.
      turn({ call_id: 'c1', idx: 6, marks: null, failed_leg: 'tts', failed_stage: 'ttfb' }),
    ];
    const d = aggregate([call({ id: 'c1' })], failing, 'none', WINDOW, NOW);
    expect(d.failedTurns).toBe(4);
    expect(d.turnFailures).toEqual([
      { leg: 'llm', stage: 'ttfb', turns: 2 },
      { leg: 'llm', stage: null, turns: 1 },
      { leg: 'tts', stage: 'total', turns: 1 },
    ]);
  });

  describe('the holding line (ADR 0030)', () => {
    const withLine = [
      ...turns,
      // The line played, then the answer: inside every percentile.
      turn({
        call_id: 'c1',
        idx: 3,
        caller_perceived_ms: 600,
        pipeline_ms: 1_900,
        marks: {
          speech_end: 20_000,
          endpoint_decision: 20_200,
          holding_line_out: 20_600,
          llm_first_token: 21_800,
          tts_first_byte: 21_950,
          first_audio_out: 22_100,
        },
      }),
      // The line played and the answer never became audible.
      turn({
        call_id: 'c1',
        idx: 4,
        caller_perceived_ms: 700,
        failed_leg: 'llm',
        failed_stage: 'total',
        marks: { speech_end: 30_000, endpoint_decision: 30_200, holding_line_out: 30_700 },
      }),
    ];

    it('lists a line-only turn as never audible, saying the line played', () => {
      const d = aggregate(calls, withLine, 'none', WINDOW, NOW);
      expect(d.outside.map((t) => [t.call_id, t.idx, t.holdingLine])).toEqual([
        ['c2', 1, false],
        ['c1', 4, true],
      ]);
      // It still has a caller_perceived_ms, which is in that percentile.
      expect(d.perceived.count).toBe(4);
      expect(d.pipeline.count).toBe(3);
    });

    it('aggregates holding_line over the turns carrying both of its marks', () => {
      const d = aggregate(calls, withLine, 'none', WINDOW, NOW);
      expect(d.legs.holding_line).toEqual({ count: 2, p50: 400, p95: 500, max: 500 });
      expect(aggregate(calls, turns, 'none', WINDOW, NOW).legs.holding_line).toEqual({
        count: 0,
        p50: null,
        p95: null,
        max: null,
      });
    });

    it('counts the turns that heard a line, for the reply-composition caveat', () => {
      expect(aggregate(calls, withLine, 'none', WINDOW, NOW).holdingLineTurns).toBe(2);
      expect(aggregate(calls, turns, 'none', WINDOW, NOW).holdingLineTurns).toBe(0);
    });

    it('keeps the median reply to the four partition legs', () => {
      const d = aggregate(calls, withLine, 'none', WINDOW, NOW);
      expect(d.medianReply.map((leg) => leg.leg)).toEqual(['endpoint_wait', 'llm_ttft', 'tts_ttfb', 'send']);
    });
  });

  it('lays the four partition legs out as the composition of a median reply', () => {
    const d = aggregate(calls, turns, 'none', WINDOW, NOW);
    expect(d.medianReply.map((leg) => leg.leg)).toEqual([
      'endpoint_wait',
      'llm_ttft',
      'tts_ttfb',
      'send',
    ]);
    expect(d.medianReply).toEqual([
      { leg: 'endpoint_wait', p50: d.legs.endpoint_wait.p50 },
      { leg: 'llm_ttft', p50: d.legs.llm_ttft.p50 },
      { leg: 'tts_ttfb', p50: d.legs.tts_ttfb.p50 },
      { leg: 'send', p50: d.legs.send.p50 },
    ]);
    // A leg no turn stamped both marks of has no P50 — never a zero.
    expect(aggregate(calls, [], 'none', WINDOW, NOW).medianReply.every((leg) => leg.p50 === null)).toBe(true);
  });
});
