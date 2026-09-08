import { describe, expect, it } from 'vitest';
import {
  bubbleLengthMs,
  bubbleView,
  currentTurnIdx,
  recordingOffsetMs,
  turnAt,
  turnSpans,
  waterfallPlayheadMs,
  type TurnSpan,
} from './playback';
import type { Stage } from './latency';
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

/** The one span of a single-turn fixture, so a test can read it without an index check. */
function placeOne(overrides: Partial<TurnRow>): TurnSpan {
  const span = turnSpans([turn(overrides)], STARTED_AT).placed[0];
  if (span === undefined) throw new Error('the fixture turn was not placed');
  return span;
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

  it('has a null speechEndMs when marks.speech_end is absent — the waterfall axis has no origin', () => {
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

describe('waterfallPlayheadMs — the axis of src/latency.ts waterfallRows starts at speech_end', () => {
  const withSpeechEnd = placeOne({ speech_start_ms: 1_000, marks: marksAt({ speech_end: 1_500, playback_end: 4_000 }) });
  const withoutSpeechEnd = placeOne({ speech_start_ms: 6_000, marks: marksAt({ playback_end: 9_000 }) });

  it('measures the playhead from the turn speech_end place', () => {
    expect(waterfallPlayheadMs(2_400, withSpeechEnd)).toBe(900);
  });

  it('is null when the turn has no speech_end mark — the chart draws no line', () => {
    expect(waterfallPlayheadMs(7_000, withoutSpeechEnd)).toBeNull();
  });

  it('goes negative before speech_end and past the chart domain after it, without clamping', () => {
    expect(waterfallPlayheadMs(1_200, withSpeechEnd)).toBe(-300);
    expect(waterfallPlayheadMs(600_000, withSpeechEnd)).toBe(598_500);
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
    // Turn 1 is placed, turn 2 is not (no speech offset): the provider clears the
    // selection on every playhead move, so a selection that is still set was
    // made after the last move and is what the operator wants to read.
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

  it('seeks the assistant bubble to the place of first_audio_out, playback_start as fallback', () => {
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
    expect(view.callerSeekMs).toBe(1_000);
    expect(view.assistantSeekMs).toBe(2_400);
    expect(view.assistantLengthMs).toBe(3_000);

    const fallback = bubbleView(
      turn({ idx: 0, marks: marksAt({ playback_start: 2_600, playback_end: 5_400 }) }),
      context('granted', 'on'),
    );
    expect(fallback.assistantSeekMs).toBe(2_600);
  });

  it('has no seek at all when the call has no recorder clock', () => {
    const view = bubbleView(
      turn({ idx: 0, speech_start_ms: 1_000, marks: marksAt({ first_audio_out: 2_400 }) }),
      { ...context('granted', 'on'), recordingStartedAt: null },
    );
    expect(view.callerSeekMs).toBeNull();
    expect(view.assistantSeekMs).toBeNull();
  });

  it('flags an outcome outside the contract vocabulary rather than reading it as normal', () => {
    expect(bubbleView(turn(spoken), context('granted', 'on')).withheldReasonKnown).toBe(true);
    expect(bubbleView(turn(spoken), context('cancelled', 'on')).withheldReasonKnown).toBe(false);
  });
});
