import { describe, expect, it } from 'vitest';
import {
  HEAD_PAIRS,
  LEGS,
  PARTITION_LEGS,
  SET_APART_SOURCES,
  STAGES,
  TARGETS,
  endOfTurnRows,
  headPairRows,
  legSpans,
  callerPerceivedEnd,
  parseMarks,
  setApartSource,
  spanOf,
  type Stage,
} from './latency';

/**
 * A full turn, seven marks, monotonic. The numbers are offsets from an
 * arbitrary epoch instant so the arithmetic is readable.
 */
const T0 = 1_757_000_000_000;
const FULL: Partial<Record<Stage, number>> = {
  speech_end: T0,
  stt_final: T0 + 180,
  endpoint_decision: T0 + 400,
  llm_first_token: T0 + 900,
  tts_first_byte: T0 + 1_150,
  first_audio_out: T0 + 1_260,
  playback_start: T0 + 1_320,
};

/** The three end-of-turn marks (contract §3.2) of that same turn. */
const TAIL: Partial<Record<Stage, number>> = {
  llm_last_token: T0 + 1_050,
  tts_last_byte: T0 + 1_400,
  playback_end: T0 + 3_100,
};

describe('LEGS — copied from ../Fonnus/app/src/domain/latency.ts', () => {
  it('names the seven legs in the pipeline order, holding_line appended last (ADR 0030)', () => {
    expect(LEGS.map((leg) => leg.name)).toEqual([
      'stt_emit',
      'endpoint_wait',
      'llm_ttft',
      'tts_ttfb',
      'send',
      'playback',
      'holding_line',
    ]);
  });

  it('pairs each leg with the marks PIPELINE_ARCHITECTURE.md §6 gives it', () => {
    expect(LEGS.map((leg) => [leg.name, leg.from, leg.to])).toEqual([
      ['stt_emit', 'speech_end', 'stt_final'],
      ['endpoint_wait', 'speech_end', 'endpoint_decision'],
      ['llm_ttft', 'endpoint_decision', 'llm_first_token'],
      ['tts_ttfb', 'llm_first_token', 'tts_first_byte'],
      ['send', 'tts_first_byte', 'first_audio_out'],
      ['playback', 'first_audio_out', 'playback_start'],
      ['holding_line', 'endpoint_decision', 'holding_line_out'],
    ]);
  });

  it('carries the ADR 0007 targets of ../Fonnus/tools/lib/call-report.ts', () => {
    expect(TARGETS).toEqual({ pipelineP95Ms: 1200, perceivedP95AlarmMs: 3600 });
  });
});

describe('SET_APART_SOURCES — copied from ../Fonnus/tools/lib/call-report.ts', () => {
  it('sets apart carry_over and reopen, the two sources whose endpoint_decision predates the commit', () => {
    expect(SET_APART_SOURCES).toEqual(['carry_over', 'reopen']);
    expect(setApartSource('carry_over')).toBe('carry_over');
    expect(setApartSource('reopen')).toBe('reopen');
  });

  it('keeps every turn-end signal label and a null source as an ordinary turn', () => {
    expect(setApartSource('speech_final')).toBeNull();
    expect(setApartSource('utterance_end')).toBeNull();
    expect(setApartSource(null)).toBeNull();
  });
});

describe('legSpans', () => {
  it('measures every leg of a full turn', () => {
    expect(legSpans(FULL)).toEqual({
      stt_emit: 180,
      endpoint_wait: 400,
      llm_ttft: 500,
      tts_ttfb: 250,
      send: 110,
      playback: 60,
      holding_line: null,
    });
  });

  it('measures holding_line from endpoint_decision to holding_line_out', () => {
    expect(legSpans({ ...FULL, holding_line_out: T0 + 700 }).holding_line).toBe(300);
  });

  it('tiles the caller-perceived span with endpoint_wait + holding_line when the line came first', () => {
    const marks = { ...FULL, holding_line_out: T0 + 700 };
    const spans = legSpans(marks);
    expect(spans.endpoint_wait! + spans.holding_line!).toBe(callerPerceivedEnd(marks)! - marks.speech_end!);
  });

  it('tiles the caller-perceived span with the four partition legs', () => {
    const spans = legSpans(FULL);
    const total = PARTITION_LEGS.reduce((sum, leg) => sum + (spans[leg] ?? 0), 0);
    expect(total).toBe(FULL.first_audio_out! - FULL.speech_end!);
  });

  it('tiles the pipeline span with the last three of them', () => {
    const spans = legSpans(FULL);
    const total = spans.llm_ttft! + spans.tts_ttfb! + spans.send!;
    expect(total).toBe(FULL.first_audio_out! - FULL.endpoint_decision!);
  });

  it('reports a leg with a missing end as null, never zero', () => {
    expect(legSpans({ speech_end: T0 }).stt_emit).toBeNull();
  });

  it('reports a reversed pair as null rather than a negative latency', () => {
    expect(legSpans({ speech_end: T0 + 500, stt_final: T0 }).stt_emit).toBeNull();
    expect(spanOf(T0 + 500, T0)).toBeUndefined();
  });
});

describe('callerPerceivedEnd — ../Fonnus/app/src/domain/latency.ts callerPerceivedMs', () => {
  // The four cases of ../Fonnus/app/src/domain/__tests__/latency.test.ts, "caller-perceived".
  it('answer only: the answer', () => {
    expect(callerPerceivedEnd({ first_audio_out: T0 + 1_000 })).toBe(T0 + 1_000);
  });

  it('line then answer: the line', () => {
    expect(callerPerceivedEnd({ holding_line_out: T0 + 600, first_audio_out: T0 + 1_000 })).toBe(T0 + 600);
  });

  it('line only: the line', () => {
    expect(callerPerceivedEnd({ holding_line_out: T0 + 600 })).toBe(T0 + 600);
  });

  it('neither: undefined', () => {
    expect(callerPerceivedEnd({ speech_end: T0 })).toBeUndefined();
  });
});

describe('parseMarks — the jsonb trust boundary', () => {
  it('keeps the twelve keys of contract §3.2 and drops everything else', () => {
    // `llm_first_reasoning` (migration 0014) and `holding_line_out` (ADR 0030)
    // are present only on a turn that reasoned, or spoke a holding line.
    const kept = { ...FULL, ...TAIL, llm_first_reasoning: T0 + 700, holding_line_out: T0 + 800 };
    expect(Object.keys(kept)).toHaveLength(STAGES.length);
    // `answered` is a real mark, but of `call_log.greeting_marks` (§3.5), not
    // of `turn.marks`; `foo` stands for a key a later pipeline may add.
    expect(parseMarks({ ...kept, answered: T0 - 5_000, foo: 2 })).toEqual(kept);
  });

  it('drops values that are not finite numbers', () => {
    expect(parseMarks({ speech_end: '123', stt_final: null, llm_first_token: Number.NaN })).toEqual(
      {},
    );
  });

  it('answers an empty object for anything that is not an object', () => {
    for (const junk of [null, undefined, 42, 'marks', [1, 2, 3], true]) {
      expect(parseMarks(junk)).toEqual({});
    }
  });
});

describe('endOfTurnRows — the end-of-turn marks of contract §3.2', () => {
  it('returns the three spans in the contract order, placed from speech_end', () => {
    expect(endOfTurnRows({ ...FULL, ...TAIL })).toEqual([
      { from: 'llm_first_token', to: 'llm_last_token', offsetMs: 900, spanMs: 150 },
      { from: 'tts_first_byte', to: 'tts_last_byte', offsetMs: 1_150, spanMs: 250 },
      { from: 'playback_start', to: 'playback_end', offsetMs: 1_320, spanMs: 1_780 },
    ]);
  });

  it('reports a half-stamped pair as not measured, keeping the other two', () => {
    const half = { ...FULL, ...TAIL };
    delete half.tts_last_byte;
    const rows = endOfTurnRows(half);
    expect(rows.map((row) => row.spanMs)).toEqual([150, null, 1_780]);
  });

  it('reports a reversed pair as null rather than a negative span', () => {
    const rows = endOfTurnRows({ ...FULL, ...TAIL, playback_end: T0 + 1_000 });
    expect(rows[2]).toEqual({
      from: 'playback_start',
      to: 'playback_end',
      offsetMs: 1_320,
      spanMs: null,
    });
  });

  it('measures a span it cannot place when there is no speech_end', () => {
    const noOrigin = { ...FULL, ...TAIL };
    delete noOrigin.speech_end;
    expect(endOfTurnRows(noOrigin)).toEqual([
      { from: 'llm_first_token', to: 'llm_last_token', offsetMs: null, spanMs: 150 },
      { from: 'tts_first_byte', to: 'tts_last_byte', offsetMs: null, spanMs: 250 },
      { from: 'playback_start', to: 'playback_end', offsetMs: null, spanMs: 1_780 },
    ]);
  });

  it('returns all three rows even when the turn stamped none of them', () => {
    expect(endOfTurnRows({})).toEqual([
      { from: 'llm_first_token', to: 'llm_last_token', offsetMs: null, spanMs: null },
      { from: 'tts_first_byte', to: 'tts_last_byte', offsetMs: null, spanMs: null },
      { from: 'playback_start', to: 'playback_end', offsetMs: null, spanMs: null },
    ]);
  });
});

describe('headPairRows — the thinking span of contract §3.2', () => {
  it('measures llm_first_reasoning → llm_first_token, placed from speech_end', () => {
    expect(HEAD_PAIRS).toHaveLength(1);
    expect(headPairRows({ ...FULL, llm_first_reasoning: T0 + 700 })).toEqual([
      {
        from: 'llm_first_reasoning',
        to: 'llm_first_token',
        label: 'thinking',
        offsetMs: 700,
        spanMs: 200,
      },
    ]);
  });

  it('is absent when the model streamed no reasoning', () => {
    // Not a row reading "not measured": no measurement was ever due.
    expect(headPairRows(FULL)).toEqual([]);
    expect(headPairRows({ llm_first_reasoning: T0 + 700 })).toEqual([]);
    expect(headPairRows({})).toEqual([]);
  });

  it('reports a reversed pair as not measured rather than a negative span', () => {
    const rows = headPairRows({ ...FULL, llm_first_reasoning: T0 + 1_000 });
    expect(rows[0]?.spanMs).toBeNull();
    expect(rows[0]?.offsetMs).toBe(1_000);
  });

  it('measures a span it cannot place when there is no speech_end', () => {
    const noOrigin = { ...FULL, llm_first_reasoning: T0 + 700 };
    delete noOrigin.speech_end;
    expect(headPairRows(noOrigin)).toEqual([
      {
        from: 'llm_first_reasoning',
        to: 'llm_first_token',
        label: 'thinking',
        offsetMs: null,
        spanMs: 200,
      },
    ]);
  });

  it('adds no leg — the pipeline names none for it', () => {
    // `llm_first_reasoning` sits inside `llm_ttft`, which the leg rows
    // already draw whole (`docs/upstream.md` §The waterfall).
    expect(LEGS).toHaveLength(7);
    const legStages: Stage[] = LEGS.flatMap((leg) => [leg.from, leg.to]);
    expect(legStages).not.toContain('llm_first_reasoning');
    expect(STAGES).toHaveLength(12);
    expect(STAGES.indexOf('holding_line_out')).toBe(STAGES.indexOf('first_audio_out') + 1);
    expect(STAGES.indexOf('playback_end')).toBe(STAGES.indexOf('holding_line_out') + 1);
    expect(STAGES.indexOf('llm_first_reasoning')).toBe(STAGES.indexOf('llm_first_token') - 1);
  });
});
