import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUPING,
  DEFAULT_SINCE,
  MAX_WINDOW_DAYS,
  aggregate,
  dayKey,
  dayLabel,
  differingKeys,
  groupKey,
  parseGroup,
  parseSince,
  percentiles,
  snapshotKeys,
  snapshotValue,
} from './dashboard';
import type { DashboardCall, DashboardTurn } from './queries/dashboard';

const NOW = new Date('2026-09-07T10:00:00Z');

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
    expect(dayLabel('2026-09-05')).toBe('5/9');
    expect(dayLabel('2026-12-31')).toBe('31/12');
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

  it('lists the snapshot keys the window carries, sorted', () => {
    expect(snapshotKeys([call(), call({ config_snapshot: null })])).toEqual([
      'FONNUS_BUILD_SHA',
      'FONNUS_ENV',
      'TTS_FLUSH_MS',
    ]);
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
    const d = aggregate(calls, turns, 'none');
    expect(d.calls).toBe(3);
    expect(d.consentedCalls).toBe(2);
    expect(d.turns).toBe(3);
  });

  it('gives a leg a smaller count than the turn count when a mark is missing', () => {
    const d = aggregate(calls, turns, 'none');
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
    const d = aggregate(calls, turns, 'none');
    expect(d.outside.map((t) => [t.call_id, t.idx])).toEqual([['c2', 1]]);
  });

  it('buckets by day in the clinic zone, oldest first, with the calendar gap filled', () => {
    const d = aggregate(calls, turns, 'none');
    // c2 was answered at 23:30 UTC on the 6th — the 7th in +07. Nothing has
    // turns on the 6th, and that day is still a bucket: a real null point, so
    // the trend line breaks there instead of sloping through it.
    expect(d.byDay.map((day) => day.day)).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
    expect(d.byDay[0]?.turns).toBe(2);
    expect(d.byDay[0]?.pipelineP95).toBe(800);
    expect(d.byDay[1]).toEqual({
      day: '2026-09-06',
      turns: 0,
      perceivedP95: null,
      pipelineP95: null,
    });
    expect(d.byDay[2]?.perceivedP95).toBeNull();
  });

  it('excludes a negative headline span from its percentile, as it does a leg', () => {
    // Marks stamped out of order: a fault (contract §3.2), never a fast turn.
    const faulty = [
      turn({ call_id: 'c1', idx: 9, caller_perceived_ms: -5, pipeline_ms: -5 }),
      ...turns,
    ];
    const d = aggregate(calls, faulty, 'none');
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
    const full = aggregate(calls, withNullMarks, 'none');
    expect(full.turns).toBe(3);
    expect(full.turnsWithoutMarks).toBe(1);
    expect(full.outside.map((t) => [t.call_id, t.idx])).toEqual([
      ['c2', 1],
      ['c1', 3],
    ]);
    // It brings no group into existence and no group counts it.
    const grouped = aggregate(calls, withNullMarks, 'llm_model');
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
    );
    expect(d.differingKeys).toEqual(['TTS_FLUSH_MS']);
    expect(d.groups.map((g) => g.label)).toContain('unknown');
    // Biggest sample first.
    expect(d.groups[0]?.turns).toBe(2);
    expect(d.groups[0]?.label).toBe(`FONNUS_BUILD_SHA ${'a'.repeat(7)}`);
    expect(d.groups.reduce((sum, g) => sum + g.turns, 0)).toBe(d.turns);
  });

  it('leaves the groups empty and the differing keys unread when nothing is grouped', () => {
    const d = aggregate(calls, turns, 'none');
    expect(d.groups).toEqual([]);
    expect(d.differingKeys).toEqual([]);
  });

  it('groups by a model column', () => {
    const d = aggregate(calls, turns, 'llm_model');
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]?.key).toBe('openrouter/some-model');
    expect(d.groups[0]?.calls).toBe(2);
  });

  it('splits the calls of each day by consent and keeps an empty day at zero', () => {
    // c1 on the 5th (granted), c3 on the 6th (hung up before consent), c2 at
    // 23:30 UTC on the 6th, which is the 7th in +07 (granted). Unlike the P95
    // chart, a day with no call is a zero: nobody rang is a measurement.
    const d = aggregate(calls, turns, 'none');
    expect(d.callsByDay).toEqual([
      { day: '2026-09-05', consented: 1, notConsented: 0 },
      { day: '2026-09-06', consented: 0, notConsented: 1 },
      { day: '2026-09-07', consented: 1, notConsented: 0 },
    ]);
    const gapped = aggregate(
      [
        call({ id: 'a', started_at: new Date('2026-09-05T02:00:00Z') }),
        call({ id: 'b', started_at: new Date('2026-09-07T02:00:00Z') }),
      ],
      [],
      'none',
    );
    expect(gapped.callsByDay[1]).toEqual({ day: '2026-09-06', consented: 0, notConsented: 0 });
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
    const d = aggregate(priced, [], 'none');
    expect(d.costFloorVnd).toBe(10_000.5);
    expect(d.unpricedCalls).toBe(2);
    // Not one parseable figure is "no cost on record", not a zero cost.
    expect(aggregate([call({ total_cost_vnd: null })], [], 'none').costFloorVnd).toBeNull();
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
    const d = aggregate(mixed, [], 'none');
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
    const d = aggregate([call({ id: 'c1' })], failing, 'none');
    expect(d.failedTurns).toBe(4);
    expect(d.turnFailures).toEqual([
      { leg: 'llm', stage: 'ttfb', turns: 2 },
      { leg: 'llm', stage: null, turns: 1 },
      { leg: 'tts', stage: 'total', turns: 1 },
    ]);
  });

  it('lays the four partition legs out as the composition of a median reply', () => {
    const d = aggregate(calls, turns, 'none');
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
    expect(aggregate(calls, [], 'none').medianReply.every((leg) => leg.p50 === null)).toBe(true);
  });
});
