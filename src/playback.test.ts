import { describe, expect, it } from 'vitest';
import {
  barScaleMs,
  bubbleLengthMs,
  bubbleView,
  currentTurnIdx,
  greetingSpan,
  leavesSelection,
  recordingOffsetMs,
  SEEK_SLACK_MS,
  parseTurnParam,
  turnBars,
  turnAt,
  turnSpans,
  playRangeOf,
  watchRangeEnd,
  type RangeClock,
} from './playback';
import { TARGETS, type Stage } from './latency';
import type { TurnRow } from './queries/calls';

/** The recorder's clock origin: sample 0 of `call.wav` (../Fonnus ADR 0012). */
const ORIGIN = 1_757_000_000_000;
const STARTED_AT = new Date(ORIGIN);

/** One turn row, every column null-ish unless the case under test sets it. */
function turn(overrides: Partial<TurnRow> = {}): TurnRow {
  return {
    idx: 0,
    caller_text: null,
    assistant_text: null,
    interrupted: false,
    source: null,
    speech_start_ms: null,
    speech_end_ms: null,
    marks: {},
    caller_perceived_ms: null,
    pipeline_ms: null,
    llm_model: null,
    tokens_in: null,
    tokens_out: null,
    tokens_cached: null,
    tts_chars: null,
    tts_bytes: null,
    failed_leg: null,
    failed_stage: null,
    failed_after_ms: null,
    ...overrides,
  };
}

/** Marks as wall-clock instants, written as offsets from the origin for readability. */
function marksAt(offsets: Partial<Record<Stage, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(offsets).map(([stage, ms]) => [stage, ORIGIN + ms]));
}

describe('recordingOffsetMs — copied from ../Fonnus/app/src/recording/artifact-recorder.ts', () => {
  it('is the pipeline recordingMsAt expression: max(0, round(wallMs - originMs))', () => {
    expect(recordingOffsetMs(ORIGIN + 1_500, ORIGIN)).toBe(1_500);
    expect(recordingOffsetMs(ORIGIN, ORIGIN)).toBe(0);
  });

  it('clamps a mark stamped before the recorder started to sample 0', () => {
    expect(recordingOffsetMs(ORIGIN - 1, ORIGIN)).toBe(0);
    expect(recordingOffsetMs(ORIGIN - 5_000, ORIGIN)).toBe(0);
  });

  it('rounds halves the way Math.round does', () => {
    expect(recordingOffsetMs(ORIGIN + 10.5, ORIGIN)).toBe(11);
    expect(recordingOffsetMs(ORIGIN + 10.4, ORIGIN)).toBe(10);
    // Math.round(-0.5) is -0, then clamped away by the max(0, …).
    expect(recordingOffsetMs(ORIGIN - 0.5, ORIGIN)).toBe(0);
  });
});

describe('turnSpans — docs/upstream.md §Artifacts, "placing a turn on the recording"', () => {
  it('places nothing when recording_started_at is null: no recorder clock, no axis', () => {
    const turns = [turn({ idx: 0, speech_start_ms: 100 }), turn({ idx: 1, speech_start_ms: 900 })];
    expect(turnSpans(turns, null)).toEqual({ placed: [], unplaced: [0, 1] });
  });

  it('leaves a turn with a null speech_start_ms unplaced, never a block at 0', () => {
    const { placed, unplaced } = turnSpans(
      [turn({ idx: 0, speech_start_ms: null, speech_end_ms: 400, marks: marksAt({ playback_end: 2_000 }) })],
      STARTED_AT,
    );
    expect(placed).toEqual([]);
    expect(unplaced).toEqual([0]);
  });

  it('leaves a turn with no start, no marks and no speech_end_ms unplaced', () => {
    expect(turnSpans([turn({ idx: 3 })], STARTED_AT)).toEqual({ placed: [], unplaced: [3] });
  });

  it('ends the block at the place of marks.playback_end when it is present', () => {
    const { placed } = turnSpans(
      [
        turn({
          idx: 0,
          speech_start_ms: 1_000,
          speech_end_ms: 1_800,
          marks: marksAt({ speech_end: 1_800, playback_start: 2_600, playback_end: 5_400 }),
        }),
      ],
      STARTED_AT,
    );
    expect(placed).toEqual([
      { idx: 0, startMs: 1_000, endMs: 5_400, speechEndMs: 1_800, interrupted: false, failed: false },
    ]);
  });

  it('falls back to the largest mark by value when playback_end is absent (a failed leg)', () => {
    const { placed } = turnSpans(
      [
        turn({
          idx: 1,
          speech_start_ms: 1_000,
          speech_end_ms: 1_800,
          failed_leg: 'llm_ttft',
          marks: marksAt({ speech_end: 1_800, endpoint_decision: 2_100, llm_first_token: 3_400 }),
        }),
      ],
      STARTED_AT,
    );
    expect(placed[0]).toMatchObject({ startMs: 1_000, endMs: 3_400, speechEndMs: 1_800, failed: true });
  });

  it('falls back to speech_end_ms when the turn reached no mark at all', () => {
    const { placed } = turnSpans([turn({ idx: 2, speech_start_ms: 700, speech_end_ms: 1_250 })], STARTED_AT);
    expect(placed[0]).toMatchObject({ startMs: 700, endMs: 1_250, speechEndMs: null });
  });

  it('clamps a mark earlier than the origin to 0, then keeps the block from running backwards', () => {
    const { placed } = turnSpans(
      [turn({ idx: 0, speech_start_ms: 0, speech_end_ms: 0, marks: marksAt({ speech_end: -3_000, playback_end: -500 }) })],
      STARTED_AT,
    );
    expect(placed[0]).toMatchObject({ startMs: 0, endMs: 0, speechEndMs: 0 });
  });

  it('collapses a block whose computed end pre-dates its start to a zero-length one, still placed', () => {
    const { placed, unplaced } = turnSpans(
      [turn({ idx: 0, speech_start_ms: 4_000, marks: marksAt({ playback_end: 1_000 }) })],
      STARTED_AT,
    );
    expect(placed[0]).toMatchObject({ startMs: 4_000, endMs: 4_000 });
    expect(unplaced).toEqual([]);
  });

  it('has a null speechEndMs when marks.speech_end is absent', () => {
    const { placed } = turnSpans(
      [turn({ idx: 0, speech_start_ms: 100, marks: marksAt({ playback_end: 2_000 }) })],
      STARTED_AT,
    );
    expect(placed).toEqual([expect.objectContaining({ speechEndMs: null })]);
  });

  it('ignores a marks value that is not a mark, through parseMarks (src/latency.ts trust boundary)', () => {
    const { placed } = turnSpans(
      [turn({ idx: 0, speech_start_ms: 100, speech_end_ms: 900, marks: 'not an object' })],
      STARTED_AT,
    );
    expect(placed[0]).toMatchObject({ endMs: 900, speechEndMs: null });
  });

  it('keeps idx order and carries interrupted through', () => {
    const { placed } = turnSpans(
      [
        turn({ idx: 0, speech_start_ms: 100, speech_end_ms: 200, interrupted: true }),
        turn({ idx: 1, speech_start_ms: 50, speech_end_ms: 60 }),
      ],
      STARTED_AT,
    );
    expect(placed.map((span) => span.idx)).toEqual([0, 1]);
    expect(placed.map((span) => span.interrupted)).toEqual([true, false]);
  });
});

describe('turnAt — the turn under the playhead', () => {
  const spans = turnSpans(
    [
      turn({ idx: 0, speech_start_ms: 1_000, marks: marksAt({ speech_end: 1_500, playback_end: 4_000 }) }),
      turn({ idx: 1, speech_start_ms: 6_000, marks: marksAt({ speech_end: 6_400, playback_end: 9_000 }) }),
    ],
    STARTED_AT,
  ).placed;

  it('has no turn before the first placed one', () => {
    expect(turnAt(spans, 0)).toBeNull();
    expect(turnAt(spans, 999)).toBeNull();
  });

  it('takes the turn exactly at its start', () => {
    expect(turnAt(spans, 1_000)?.idx).toBe(0);
    expect(turnAt(spans, 6_000)?.idx).toBe(1);
  });

  it('keeps the previous turn current between its end and the next start', () => {
    expect(turnAt(spans, 5_000)?.idx).toBe(0);
  });

  it('keeps the last turn current past its end', () => {
    expect(turnAt(spans, 30_000)?.idx).toBe(1);
  });

  it('gives a barge-in overlap to the later start the moment it begins', () => {
    const overlapping = turnSpans(
      [
        turn({ idx: 0, speech_start_ms: 1_000, marks: marksAt({ playback_end: 8_000 }) }),
        turn({ idx: 1, speech_start_ms: 5_000, marks: marksAt({ playback_end: 9_000 }) }),
      ],
      STARTED_AT,
    ).placed;
    expect(turnAt(overlapping, 4_999)?.idx).toBe(0);
    expect(turnAt(overlapping, 5_000)?.idx).toBe(1);
  });

  it('gives two spans with the same start to the later turn', () => {
    const tied = turnSpans(
      [
        turn({ idx: 0, speech_start_ms: 2_000, speech_end_ms: 2_500 }),
        turn({ idx: 1, speech_start_ms: 2_000, speech_end_ms: 2_500 }),
      ],
      STARTED_AT,
    ).placed;
    expect(turnAt(tied, 2_000)?.idx).toBe(1);
  });

  it('has no turn at all when nothing was placed', () => {
    expect(turnAt([], 5_000)).toBeNull();
  });
});

describe('playRangeOf — what a bubble\'s play glyph plays, per side', () => {
  const spoken = turn({
    speech_start_ms: 1_000,
    speech_end_ms: 1_800,
    marks: marksAt({ first_audio_out: 2_400, playback_start: 2_600, playback_end: 5_400 }),
  });

  it('plays the caller from speech_start_ms to speech_end_ms, both already recording offsets', () => {
    expect(playRangeOf(spoken, 'caller', STARTED_AT)).toEqual({ fromMs: 1_000, toMs: 1_800 });
  });

  it('plays the assistant from first_audio_out to playback_end, placed through the origin', () => {
    expect(playRangeOf(spoken, 'assistant', STARTED_AT)).toEqual({ fromMs: 2_400, toMs: 5_400 });
  });

  it('starts the assistant at playback_start when first_audio_out was never stamped', () => {
    const late = turn({ marks: marksAt({ playback_start: 2_600, playback_end: 5_400 }) });
    expect(playRangeOf(late, 'assistant', STARTED_AT)).toEqual({ fromMs: 2_600, toMs: 5_400 });
  });

  it('stops an interrupted reply at playback_end, the last lull before the cut', () => {
    // Contract §3.2. The next turn's speech_start_ms is taken on an unmuted line
    // only, so it falls after the cut and is never read here — nor on a reply
    // that failed mid-way (trap 7), where the degraded line follows.
    const cut = turn({ ...spoken, interrupted: true });
    expect(playRangeOf(cut, 'assistant', STARTED_AT)).toEqual({ fromMs: 2_400, toMs: 5_400 });
    const failed = turn({ ...spoken, interrupted: true, failed_leg: 'tts', failed_stage: 'idle' });
    expect(playRangeOf(failed, 'assistant', STARTED_AT)).toEqual({ fromMs: 2_400, toMs: 5_400 });
  });

  it('has nothing to play with a missing end, a reversed pair, or no recorder clock', () => {
    expect(playRangeOf(turn({ speech_start_ms: 1_000 }), 'caller', STARTED_AT)).toBeNull();
    expect(playRangeOf(turn({ marks: marksAt({ first_audio_out: 2_400 }) }), 'assistant', STARTED_AT)).toBeNull();
    expect(playRangeOf(turn({ speech_start_ms: 1_800, speech_end_ms: 1_000 }), 'caller', STARTED_AT)).toBeNull();
    expect(playRangeOf(spoken, 'caller', null)).toBeNull();
    expect(playRangeOf(spoken, 'assistant', null)).toBeNull();
  });
});

describe('bubbleLengthMs — voice length per bubble', () => {
  it('measures the caller from the recording offsets and the assistant from first_audio_out', () => {
    expect(
      bubbleLengthMs(
        turn({
          speech_start_ms: 1_000,
          speech_end_ms: 1_800,
          marks: marksAt({ first_audio_out: 2_400, playback_start: 2_600, playback_end: 5_400 }),
        }),
      ),
    ).toEqual({ caller: 800, assistant: 3_000 });
  });

  it('falls back to playback_start when first_audio_out was never stamped', () => {
    expect(
      bubbleLengthMs(turn({ marks: marksAt({ playback_start: 2_600, playback_end: 5_400 }) }))
        .assistant,
    ).toBe(2_800);
  });

  it('reports null when the columns and the marks are missing', () => {
    expect(bubbleLengthMs(turn())).toEqual({ caller: null, assistant: null });
  });

  it('reports null for a half-stamped pair on either side', () => {
    expect(bubbleLengthMs(turn({ speech_start_ms: 1_000, marks: marksAt({ first_audio_out: 2_400 }) }))).toEqual({
      caller: null,
      assistant: null,
    });
    expect(bubbleLengthMs(turn({ speech_end_ms: 1_800, marks: marksAt({ playback_end: 5_400 }) }))).toEqual({
      caller: null,
      assistant: null,
    });
  });

  it('reports null for a reversed pair — a clock fault, not a negative length', () => {
    expect(
      bubbleLengthMs(
        turn({
          speech_start_ms: 2_000,
          speech_end_ms: 1_000,
          marks: marksAt({ first_audio_out: 5_400, playback_end: 2_600 }),
        }),
      ),
    ).toEqual({ caller: null, assistant: null });
  });

  it('measures the length heard before a barge-in on an interrupted turn', () => {
    expect(
      bubbleLengthMs(
        turn({ interrupted: true, marks: marksAt({ first_audio_out: 2_600, playback_end: 3_100 }) }),
      ).assistant,
    ).toBe(500);
  });

  it('needs no recording origin: the assistant length is a difference of two wall marks', () => {
    const shifted = { first_audio_out: ORIGIN + 999_000, playback_end: ORIGIN + 1_001_000 };
    expect(bubbleLengthMs(turn({ marks: shifted })).assistant).toBe(2_000);
  });
});

describe('currentTurnIdx — which turn the screen is on', () => {
  const spans = turnSpans(
    [
      turn({ idx: 0, speech_start_ms: 1_000, marks: marksAt({ playback_end: 4_000 }) }),
      turn({ idx: 1, speech_start_ms: 6_000, marks: marksAt({ playback_end: 9_000 }) }),
    ],
    STARTED_AT,
  ).placed;

  it('follows the playhead once it has moved into a placed turn', () => {
    expect(currentTurnIdx(spans, 7_000, null, 0)).toBe(1);
  });

  it('keeps the selection while the playhead is before the first placed turn', () => {
    expect(currentTurnIdx(spans, 500, 1, 0)).toBe(1);
  });

  it('lets a click on an unplaced turn win while the playhead sits inside a placed one', () => {
    // Turn 1 is placed, turn 2 is not (no speech offset): an unplaced turn has
    // no block for the playhead to leave, so its selection is what the
    // operator wants to read until the next click.
    const mixed = turnSpans(
      [
        turn({ idx: 1, speech_start_ms: 1_000, marks: marksAt({ playback_end: 4_000 }) }),
        turn({ idx: 2, speech_start_ms: null, marks: marksAt({ playback_end: 9_000 }) }),
      ],
      STARTED_AT,
    ).placed;
    expect(currentTurnIdx(mixed, 2_000, 2, 1)).toBe(2);
    expect(currentTurnIdx(mixed, 2_000, null, 1)).toBe(1);
  });

  it('reads a playhead still at 0 as "not moved", whatever a span starts at', () => {
    const fromZero = turnSpans([turn({ idx: 3, speech_start_ms: 0, speech_end_ms: 900 })], STARTED_AT).placed;
    expect(currentTurnIdx(fromZero, 0, null, 3)).toBe(3);
    expect(currentTurnIdx(fromZero, 0, 7, 3)).toBe(7);
  });

  it('follows the selection alone when no turn could be placed at all', () => {
    expect(currentTurnIdx([], 12_000, 2, 0)).toBe(2);
  });

  it('falls back to the first turn on record before any click', () => {
    expect(currentTurnIdx([], 12_000, null, 0)).toBe(0);
  });

  it('has no turn at all on a call with none', () => {
    expect(currentTurnIdx([], 0, null, null)).toBeNull();
  });
});

describe('bubbleView — the consent gate on the bubble (trap 4, ADR 0005)', () => {
  const spoken = { idx: 0, caller_text: 'toi dong y', assistant_text: 'vang a' } as const;
  /** Every context field but the two the gate turns on. */
  const context = (outcome: string | null, gate: 'on' | 'off') => ({
    outcome,
    state: 'finalized' as const,
    gate,
    recordingStartedAt: STARTED_AT,
    span: undefined,
  });

  it('withholds a hand-restored caller_text on every unconsented outcome, gate on', () => {
    // Storage does not enforce the gate: these rows can carry text and must not
    // render it. `null` is a call with no consent row at all (trap 2).
    for (const outcome of ['hung_up_before_disclosure', 'hung_up_before_consent', null]) {
      const view = bubbleView(turn(spoken), context(outcome, 'on'));
      expect(view.callerText).toBeNull();
      expect(view.callerWithheld).toBe(true);
      // The assistant's own words are not caller-derived and stay.
      expect(view.assistantText).toBe('vang a');
    }
  });

  it('says the call state, not "not on record", when there is no consent row', () => {
    const view = bubbleView(turn(spoken), {
      ...context(null, 'on'),
      state: 'in_progress',
    });
    expect(view.withheldReason).toBe('in progress');
    expect(view.withheldByState).toBe(true);
    expect(bubbleView(turn(spoken), { ...context(null, 'on'), state: 'not_finalized' }).withheldReason).toBe(
      'not finalized',
    );
    expect(bubbleView(turn(spoken), context('declined', 'on')).withheldByState).toBe(false);
  });

  it('passes the text on a consented call', () => {
    const view = bubbleView(turn(spoken), context('granted', 'on'));
    expect(view.callerText).toBe('toi dong y');
    expect(view.callerWithheld).toBe(false);
  });

  it('passes the text on every outcome with the gate off — the internal test phase', () => {
    for (const outcome of ['hung_up_before_disclosure', 'refused', null]) {
      const view = bubbleView(turn(spoken), context(outcome, 'off'));
      expect(view.callerText).toBe('toi dong y');
      expect(view.callerWithheld).toBe(false);
    }
  });

  it('distinguishes a null column from a withheld one: not withheld, no text', () => {
    // Trap 5 — the retention sweep nulls the text on an old call; the page says
    // "not on record", which is not the withheld sentence.
    const view = bubbleView(turn({ idx: 0, caller_text: null }), context('granted', 'on'));
    expect(view.callerText).toBeNull();
    expect(view.callerWithheld).toBe(false);
  });

  it('seeks a bubble click to the turn start and plays each side over its own range', () => {
    const placed = turnSpans(
      [turn({ idx: 0, speech_start_ms: 1_000, marks: marksAt({ playback_end: 6_000 }) })],
      STARTED_AT,
    ).placed[0];
    const view = bubbleView(
      turn({
        idx: 0,
        speech_start_ms: 1_000,
        speech_end_ms: 1_800,
        marks: marksAt({ first_audio_out: 2_400, playback_start: 2_600, playback_end: 5_400 }),
      }),
      { ...context('granted', 'on'), span: placed },
    );
    expect(view.seekMs).toBe(1_000);
    expect(view.callerRange).toEqual({ fromMs: 1_000, toMs: 1_800 });
    expect(view.assistantRange).toEqual({ fromMs: 2_400, toMs: 5_400 });
    expect(view.assistantLengthMs).toBe(3_000);

    const fallback = bubbleView(
      turn({ idx: 0, marks: marksAt({ playback_start: 2_600, playback_end: 5_400 }) }),
      context('granted', 'on'),
    );
    expect(fallback.assistantRange).toEqual({ fromMs: 2_600, toMs: 5_400 });

    const cut = bubbleView(
      turn({
        idx: 0,
        interrupted: true,
        marks: marksAt({ first_audio_out: 2_400, playback_end: 5_400 }),
      }),
      context('granted', 'on'),
    );
    expect(cut.assistantRange).toEqual({ fromMs: 2_400, toMs: 5_400 });
  });

  it('has no seek at all when the call has no recorder clock', () => {
    const view = bubbleView(
      turn({ idx: 0, speech_start_ms: 1_000, marks: marksAt({ first_audio_out: 2_400 }) }),
      { ...context('granted', 'on'), recordingStartedAt: null },
    );
    expect(view.seekMs).toBeNull();
    expect(view.callerRange).toBeNull();
    expect(view.assistantRange).toBeNull();
  });

  it('flags an outcome outside the contract vocabulary rather than reading it as normal', () => {
    expect(bubbleView(turn(spoken), context('granted', 'on')).withheldReasonKnown).toBe(true);
    expect(bubbleView(turn(spoken), context('cancelled', 'on')).withheldReasonKnown).toBe(false);
  });
});

describe('greetingSpan — docs/upstream.md §Call detail, the greeting_marks row', () => {
  it('runs from answered to playback_end, on the recording clock', () => {
    const span = greetingSpan(
      { answered: ORIGIN + 200, first_audio_out: ORIGIN + 1_200, playback_end: ORIGIN + 6_400 },
      STARTED_AT,
    );
    expect(span).toEqual({ startMs: 200, endMs: 6_400 });
  });

  it('ends at the latest key present when playback_end was never stamped', () => {
    // A caller who hung up mid-disclosure leaves `answered` and whatever the
    // greeting reached; the block ends there, not at the call's end.
    const span = greetingSpan(
      { answered: ORIGIN, tts_first_byte: ORIGIN + 900, first_audio_out: ORIGIN + 1_100 },
      STARTED_AT,
    );
    expect(span).toEqual({ startMs: 0, endMs: 1_100 });
  });

  it('is a hairline when only answered was stamped', () => {
    expect(greetingSpan({ answered: ORIGIN + 500 }, STARTED_AT)).toEqual({
      startMs: 500,
      endMs: 500,
    });
  });

  it('is null without answered, without the column, and without an origin', () => {
    expect(greetingSpan({ playback_end: ORIGIN + 3_000 }, STARTED_AT)).toBeNull();
    expect(greetingSpan(null, STARTED_AT)).toBeNull();
    expect(greetingSpan({ answered: ORIGIN }, null)).toBeNull();
  });

  it('drops a key that carries no finite number, and a key of its own invention', () => {
    // The column is jsonb: the same trust boundary `parseMarks` is for a turn's.
    const span = greetingSpan(
      {
        answered: ORIGIN,
        playback_end: Number.NaN,
        speech_end: ORIGIN + 9_000,
        first_audio_out: ORIGIN + 800,
      },
      STARTED_AT,
    );
    expect(span).toEqual({ startMs: 0, endMs: 800 });
  });

  it('collapses a block whose end pre-dates answered, never draws it backwards', () => {
    expect(greetingSpan({ answered: ORIGIN + 4_000, playback_end: ORIGIN + 10 }, STARTED_AT)).toEqual({
      startMs: 4_000,
      endMs: 4_000,
    });
  });
});

describe('turnBars and barScaleMs — the lower lane of "The call"', () => {
  it('carries each turn state and marks a null pipeline_ms as not measured', () => {
    const bars = turnBars([
      turn({ idx: 0, pipeline_ms: 1_040 }),
      turn({ idx: 1, pipeline_ms: null, failed_leg: 'llm', failed_stage: 'ttfb' }),
      turn({ idx: 2, pipeline_ms: 980, interrupted: true }),
    ]);
    expect(bars).toEqual([
      { idx: 0, pipelineMs: 1_040, failed: false, interrupted: false, measured: true },
      { idx: 1, pipelineMs: null, failed: true, interrupted: false, measured: false },
      { idx: 2, pipelineMs: 980, failed: false, interrupted: true, measured: true },
    ]);
  });

  it('treats a negative pipeline_ms as not measured, never as a bar', () => {
    // Contract §3.2: a span whose end pre-dates its start is a clock fault.
    expect(turnBars([turn({ pipeline_ms: -30 })])[0]?.measured).toBe(false);
  });

  it('never scales below the target, so the target line is always on the plot', () => {
    expect(barScaleMs([])).toBe(TARGETS.pipelineP95Ms);
    expect(barScaleMs(turnBars([turn({ pipeline_ms: 400 })]))).toBe(TARGETS.pipelineP95Ms);
    expect(barScaleMs(turnBars([turn({ pipeline_ms: 2_500 })]))).toBe(2_500);
    // An unmeasured turn has no height to scale to.
    expect(barScaleMs(turnBars([turn({ pipeline_ms: -9_000 })]))).toBe(TARGETS.pipelineP95Ms);
  });
});

describe('parseTurnParam — the ?turn=<idx> arrival (ADR 0006)', () => {
  const turns = [{ idx: 0 }, { idx: 1 }, { idx: 3 }];

  it('selects the turn the link names', () => {
    expect(parseTurnParam('3', turns)).toBe(3);
    expect(parseTurnParam('0', turns)).toBe(0);
  });

  it('selects nothing for a turn this call never wrote', () => {
    expect(parseTurnParam('2', turns)).toBeNull();
    expect(parseTurnParam('7', turns)).toBeNull();
  });

  it('selects nothing for a value that is not an index at all', () => {
    // A repeated key arrives as an array; the rest is what a hand-typed or
    // truncated URL carries.
    expect(parseTurnParam(['1', '2'], turns)).toBeNull();
    expect(parseTurnParam(undefined, turns)).toBeNull();
    expect(parseTurnParam('', turns)).toBeNull();
    expect(parseTurnParam('first', turns)).toBeNull();
    expect(parseTurnParam('-1', turns)).toBeNull();
    expect(parseTurnParam('1.5', turns)).toBeNull();
    expect(parseTurnParam(' 1', turns)).toBeNull();
  });

  it('selects nothing on a call with no turns on record (trap 1)', () => {
    expect(parseTurnParam('0', [])).toBeNull();
  });
});

describe('leavesSelection — when a playhead move ends the selection', () => {
  const spans = turnSpans(
    [
      turn({ idx: 0, speech_start_ms: 1_000, marks: marksAt({ playback_end: 4_000 }) }),
      turn({ idx: 1, speech_start_ms: 6_000, marks: marksAt({ playback_end: 9_000 }) }),
      turn({ idx: 2, speech_start_ms: null }),
    ],
    STARTED_AT,
  ).placed;

  it('keeps the selection while the playhead is inside the selected turn', () => {
    expect(leavesSelection(spans, 1, 6_000)).toBe(false);
    expect(leavesSelection(spans, 1, 7_500)).toBe(false);
    expect(leavesSelection(spans, 1, 9_000)).toBe(false);
  });

  it('forgives a seek that lands a frame early or late', () => {
    expect(leavesSelection(spans, 1, 6_000 - SEEK_SLACK_MS)).toBe(false);
    expect(leavesSelection(spans, 1, 9_000 + SEEK_SLACK_MS)).toBe(false);
  });

  it('ends it once the playhead is outside the turn', () => {
    expect(leavesSelection(spans, 1, 2_000)).toBe(true);
    expect(leavesSelection(spans, 1, 9_500)).toBe(true);
    expect(leavesSelection(spans, 0, 6_000)).toBe(true);
  });

  it('has nothing to end with no selection, or a selected turn with no block', () => {
    expect(leavesSelection(spans, null, 2_000)).toBe(false);
    expect(leavesSelection(spans, 2, 2_000)).toBe(false);
    expect(leavesSelection([], 1, 2_000)).toBe(false);
  });
});

describe('watchRangeEnd — playing one range and stopping at its end', () => {
  /**
   * A frame clock the test steps by hand, an audio whose position it sets,
   * and the player's `seeking` / `timeupdate` events it fires.
   */
  function fakeClock(startMs: number) {
    let position = startMs;
    let next = 1;
    const frames = new Map<number, () => void>();
    const listeners = { seeking: new Set<() => void>(), timeupdate: new Set<() => void>() };
    const pauses: number[] = [];
    const clock: RangeClock = {
      positionMs: () => position,
      pause: () => pauses.push(position),
      frame: (callback) => {
        const handle = next++;
        frames.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => frames.delete(handle),
      on: (event, callback) => {
        listeners[event].add(callback);
        return () => listeners[event].delete(callback);
      },
    };
    const step = (toMs: number): void => {
      position = toMs;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    };
    const fire = (event: 'seeking' | 'timeupdate', atMs: number): void => {
      position = atMs;
      for (const callback of [...listeners[event]]) callback();
    };
    const listening = (): number => listeners.seeking.size + listeners.timeupdate.size;
    return { clock, step, fire, pauses, pending: () => frames.size, listening };
  }

  it('pauses on the first frame at or past the end, and stops watching', () => {
    const fake = fakeClock(1_000);
    watchRangeEnd(fake.clock, 1_000, 2_000);
    fake.step(1_500);
    expect(fake.pauses).toEqual([]);
    fake.step(2_010);
    expect(fake.pauses).toEqual([2_010]);
    expect(fake.pending()).toBe(0);
    expect(fake.listening()).toBe(0);
  });

  it('pauses even when the first check after a stall finds the audio far past the end', () => {
    // A background tab: no frame for seconds while the audio played on.
    const fake = fakeClock(1_000);
    watchRangeEnd(fake.clock, 1_000, 2_000);
    fake.step(9_000);
    expect(fake.pauses).toEqual([9_000]);
  });

  it('pauses on timeupdate when the frames have stopped', () => {
    const fake = fakeClock(1_000);
    watchRangeEnd(fake.clock, 1_000, 2_000);
    fake.fire('timeupdate', 1_800);
    expect(fake.pauses).toEqual([]);
    fake.fire('timeupdate', 2_240);
    expect(fake.pauses).toEqual([2_240]);
    expect(fake.pending()).toBe(0);
    expect(fake.listening()).toBe(0);
  });

  it('is cancelled by the returned function — another seek or a pause', () => {
    const fake = fakeClock(1_000);
    const cancel = watchRangeEnd(fake.clock, 1_000, 2_000);
    fake.step(1_200);
    cancel();
    expect(fake.pending()).toBe(0);
    expect(fake.listening()).toBe(0);
    fake.step(2_500);
    expect(fake.pauses).toEqual([]);
  });

  it('lets go without pausing on a native seek elsewhere, wherever it lands', () => {
    for (const target of [5_000, 1_500, 200]) {
      const fake = fakeClock(1_000);
      watchRangeEnd(fake.clock, 1_000, 2_000);
      fake.fire('seeking', target);
      fake.step(target + 3_000);
      expect(fake.pauses).toEqual([]);
      expect(fake.pending()).toBe(0);
      expect(fake.listening()).toBe(0);
    }
  });

  it("keeps watching through the range's own seek to its start, whose event fires late", () => {
    const fake = fakeClock(1_000);
    watchRangeEnd(fake.clock, 1_000, 2_000);
    fake.fire('seeking', 1_000 + SEEK_SLACK_MS);
    fake.step(2_050);
    expect(fake.pauses).toEqual([2_050]);
  });
});
