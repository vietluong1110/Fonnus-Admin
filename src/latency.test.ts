import { describe, expect, it } from 'vitest';
import {
  LEGS,
  PARTITION_LEGS,
  STAGES,
  TARGETS,
  endOfTurnRows,
  legSpans,
  parseMarks,
  spanOf,
  waterfallRows,
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
  it('names the six legs in the pipeline order', () => {
    expect(LEGS.map((leg) => leg.name)).toEqual([
      'stt_emit',
      'endpoint_wait',
      'llm_ttft',
      'tts_ttfb',
      'send',
      'playback',
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
    ]);
  });

  it('carries the ADR 0007 targets of ../Fonnus/tools/lib/call-report.ts', () => {
    expect(TARGETS).toEqual({ pipelineP95Ms: 1200, perceivedP95AlarmMs: 3600 });
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
    });
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

describe('parseMarks — the jsonb trust boundary', () => {
  it('keeps the ten keys of contract §3.2 and drops everything else', () => {
    const kept = { ...FULL, ...TAIL };
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

describe('waterfallRows', () => {
  it('places every leg on one axis whose origin is speech_end', () => {
    expect(waterfallRows(FULL)).toEqual([
      { leg: 'stt_emit', from: 'speech_end', to: 'stt_final', offsetMs: 0, spanMs: 180, partition: false },
      { leg: 'endpoint_wait', from: 'speech_end', to: 'endpoint_decision', offsetMs: 0, spanMs: 400, partition: true },
      { leg: 'llm_ttft', from: 'endpoint_decision', to: 'llm_first_token', offsetMs: 400, spanMs: 500, partition: true },
      { leg: 'tts_ttfb', from: 'llm_first_token', to: 'tts_first_byte', offsetMs: 900, spanMs: 250, partition: true },
      { leg: 'send', from: 'tts_first_byte', to: 'first_audio_out', offsetMs: 1_150, spanMs: 110, partition: true },
      { leg: 'playback', from: 'first_audio_out', to: 'playback_start', offsetMs: 1_260, spanMs: 60, partition: false },
    ]);
  });

  it('has no offset for a leg whose start was never stamped', () => {
    const rows = waterfallRows({ speech_end: T0, stt_final: T0 + 100 });
    expect(rows.find((row) => row.leg === 'llm_ttft')).toEqual({
      leg: 'llm_ttft',
      from: 'endpoint_decision',
      to: 'llm_first_token',
      offsetMs: null,
      spanMs: null,
      partition: true,
    });
  });

  it('has no offset at all when speech_end is missing', () => {
    const rows = waterfallRows({ endpoint_decision: T0, llm_first_token: T0 + 300 });
    expect(rows.every((row) => row.offsetMs === null)).toBe(true);
    expect(rows.find((row) => row.leg === 'llm_ttft')?.spanMs).toBe(300);
  });

  it('keeps the span but drops the placement of a leg that starts before speech_end', () => {
    const rows = waterfallRows({ speech_end: T0 + 500, endpoint_decision: T0, llm_first_token: T0 + 300 });
    const leg = rows.find((row) => row.leg === 'llm_ttft');
    expect(leg?.spanMs).toBe(300);
    expect(leg?.offsetMs).toBeNull();
  });

  it('returns six rows of nulls for a turn that stamped nothing', () => {
    const rows = waterfallRows(parseMarks({}));
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.spanMs === null && row.offsetMs === null)).toBe(true);
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
