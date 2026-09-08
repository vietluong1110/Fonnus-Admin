/**
 * Audio ↔ marks: where a turn sits on the recording's time axis, which turn the
 * screen is on, where the playhead falls on that turn's waterfall, and the view
 * object each transcript bubble is drawn from. Pure — no React, no I/O, no
 * database, so the consent gate's effect on a bubble is testable in isolation.
 *
 * The recording clock is the wall clock (`../Fonnus/docs/adr/0012-*`): sample 0
 * of `call.wav` is `call_log.recording_started_at` exactly, on both channels
 * (`../Fonnus/app/src/recording/wav-writer.ts`). So a mark's place in the audio
 * is a subtraction, and no new pipeline data is needed to line the transcript,
 * the call strip and the waterfall up with what is being heard.
 *
 * The writer pads a gap over `GAP_TOLERANCE_MS = 100` with silence and never
 * rewinds a track, so every offset below is right to within ~100 ms and can
 * only drift late relative to the audio, never early (`wav-writer.ts`).
 */
import {
  failureLine,
  isKnownConsentOutcome,
  isKnownTurnSource,
  showCallerData,
  type CallState,
} from './calls';
import type { ConsentGate } from './config';
import { parseMarks, spanOf, type Stage } from './latency';
import type { TurnRow } from './queries/calls';

/**
 * The pipeline's own `recordingMsAt`, copied rather than re-derived
 * (`../Fonnus/app/src/recording/artifact-recorder.ts:528`,
 * `Math.max(0, Math.round(wallMs - this.recordingStartedAt))`): a mark stamped
 * before the recorder's clock started is the file's first sample, not a
 * negative offset.
 */
export function recordingOffsetMs(wallMs: number, originMs: number): number {
  return Math.max(0, Math.round(wallMs - originMs));
}

export interface TurnSpan {
  idx: number;
  /** = `turn.speech_start_ms`. */
  startMs: number;
  /** Place of `marks.playback_end`; else the largest mark by value; else `speech_end_ms`. */
  endMs: number;
  /** Place of `marks.speech_end` on the recording, or null — the waterfall's axis origin. */
  speechEndMs: number | null;
  interrupted: boolean;
  /** `failed_leg !== null` — the contract's test for "failed" (§3.2, trap 7). */
  failed: boolean;
}

/**
 * Places the turns on the recording's axis, keeping `idx` order.
 *
 * A null `recording_started_at` places nothing: the call never had a recorder
 * clock, so no block and no playhead line, though the transcript still reads.
 * A turn with a null `speech_start_ms` has no place either — it is listed as
 * "not placed" under the strip, never drawn as a block at 0.
 *
 * `turn.speech_start_ms` and `speech_end_ms` are already recording offsets,
 * written through `recordingMsAt` (`../Fonnus/app/src/session/effect-runner.ts:839-840`);
 * they are used as they stand and never re-derived from the marks.
 */
export function turnSpans(
  turns: TurnRow[],
  recordingStartedAt: Date | null,
): { placed: TurnSpan[]; unplaced: number[] } {
  if (recordingStartedAt === null) return { placed: [], unplaced: turns.map((turn) => turn.idx) };
  const origin = recordingStartedAt.getTime();
  const placed: TurnSpan[] = [];
  const unplaced: number[] = [];
  for (const turn of turns) {
    if (turn.speech_start_ms === null) {
      unplaced.push(turn.idx);
      continue;
    }
    const marks = parseMarks(turn.marks);
    const startMs = turn.speech_start_ms;
    // The block runs to the place of `playback_end`; when the reply never
    // played (a failed leg, a turn cut before playback) the latest mark the
    // turn did reach ends it, and a turn with no mark at all ends at its own
    // `speech_end_ms`, i.e. where the caller stopped talking.
    const end = endWallMs(marks);
    const rawEndMs = end === undefined ? (turn.speech_end_ms ?? startMs) : recordingOffsetMs(end, origin);
    placed.push({
      idx: turn.idx,
      startMs,
      // A clock that stepped back, or a mark stamped before speech start, must
      // not produce a block that runs backwards: it collapses to a hairline.
      endMs: rawEndMs < startMs ? startMs : rawEndMs,
      speechEndMs: marks.speech_end === undefined ? null : recordingOffsetMs(marks.speech_end, origin),
      interrupted: turn.interrupted,
      failed: turn.failed_leg !== null,
    });
  }
  return { placed, unplaced };
}

/** The wall-clock instant a turn's block ends at, or undefined when it has no mark. */
function endWallMs(marks: Partial<Record<Stage, number>>): number | undefined {
  if (marks.playback_end !== undefined) return marks.playback_end;
  let latest: number | undefined;
  for (const at of Object.values(marks)) {
    if (latest === undefined || at > latest) latest = at;
  }
  return latest;
}

/**
 * The placed turn with the latest start at or before the playhead; null before
 * the first one. Between a reply's end and the next utterance the previous turn
 * stays current — its waterfall is still the one being heard out. Overlapping
 * blocks (a barge-in starts the next turn before the last turn's
 * `playback_end`) resolve the same way: the later start wins the moment it
 * begins.
 */
export function turnAt(spans: TurnSpan[], playheadMs: number): TurnSpan | null {
  let current: TurnSpan | null = null;
  for (const span of spans) {
    if (span.startMs <= playheadMs && (current === null || span.startMs >= current.startMs)) current = span;
  }
  return current;
}

/**
 * Which turn the screen is on: the operator's click, until the playhead moves
 * again; the playhead's turn after that; and the first turn on record when
 * neither says anything — so a call whose turns cannot be placed at all (null
 * `recording_started_at`, every `speech_start_ms` null) is still readable turn
 * by turn, and a turn that cannot be placed stays selectable while the
 * recording is paused inside another.
 *
 * `selectedIdx` is non-null only between a click and the next playhead move —
 * the provider clears it on every seek and on every position the player
 * reports (`playback-provider.tsx`) — which is what makes "the selection wins"
 * safe: a selection never outlives the position it was made at.
 *
 * "The playhead has moved" is `playheadMs > 0`: a playhead still at 0 is the
 * state the page rendered with rather than a position anyone chose. A
 * deliberate seek back to 0 is therefore read as "not moved", which shows the
 * same turn a click at 0 selects anyway.
 */
export function currentTurnIdx(
  spans: TurnSpan[],
  playheadMs: number,
  selectedIdx: number | null,
  firstIdx: number | null,
): number | null {
  if (selectedIdx !== null) return selectedIdx;
  const under = playheadMs > 0 ? turnAt(spans, playheadMs) : null;
  return under?.idx ?? firstIdx;
}

/**
 * The playhead's place on one turn's waterfall, whose axis starts at
 * `speech_end` (`src/latency.ts`, `waterfallRows`). Null when the turn has no
 * `speech_end` mark — the chart's own "measured but not placed" rule. The value
 * may be negative or past the chart's domain; the chart discards it then, this
 * function does not clamp, so the caller can tell "before this turn" from
 * "inside it".
 */
export function waterfallPlayheadMs(playheadMs: number, span: TurnSpan): number | null {
  return span.speechEndMs === null ? null : playheadMs - span.speechEndMs;
}

/**
 * The voice length of each bubble of one turn, in ms, independent of the
 * recording's origin — both are differences within one clock.
 *
 * Caller: `speech_end_ms − speech_start_ms`, two recording offsets. Assistant:
 * `playback_end − assistantStartWallMs`, two wall-clock marks. Null when either
 * end is missing or the pair is reversed, which is a clock fault and not a
 * length. On an `interrupted` turn the assistant's number is the length heard
 * before the barge-in — a fact the bubble's pill says, not this number.
 */
export function bubbleLengthMs(turn: TurnRow): { caller: number | null; assistant: number | null } {
  const marks = parseMarks(turn.marks);
  return {
    caller: spanOf(turn.speech_start_ms ?? undefined, turn.speech_end_ms ?? undefined) ?? null,
    assistant: spanOf(assistantStartWallMs(marks), marks.playback_end) ?? null,
  };
}

/**
 * Where the assistant's voice starts, as a wall-clock instant: `first_audio_out`,
 * the hand-over of the first frame to the sink, which is where the recorder
 * begins writing the bot's channel of `call.wav` (`docs/upstream.md` §Artifacts,
 * "bubble length and where a bubble seeks to"; `../Fonnus/docs/runbook.md` §2.5
 * row 10). FreeSWITCH's `playback_start` is advisory and later, and stands in
 * only when `first_audio_out` was never stamped.
 */
export function assistantStartWallMs(
  marks: Partial<Record<Stage, number>>,
): number | undefined {
  return marks.first_audio_out ?? marks.playback_start;
}

/** Trap 2 in one phrase: what a call with no consent row is, in its place. */
export function withheldStateReason(state: CallState): string {
  return state === 'in_progress' ? 'in progress' : 'not finalized';
}

/** One turn's two bubbles, prepared on the server. */
export interface TurnBubbleView {
  idx: number;
  /** Null with the gate open means the column itself is null — trap 5, "not on record". */
  callerText: string | null;
  /** True when the consent gate withholds it; the text is then not in this object at all. */
  callerWithheld: boolean;
  /** What to say in place of withheld text: the outcome, or the call's state. */
  withheldReason: string;
  /** False when `withheldReason` is a value outside the contract's vocabulary. */
  withheldReasonKnown: boolean;
  /**
   * True when `withheldReason` is the call's state, not a consent outcome: the
   * call has no consent row yet (trap 2), and the bubble must not present the
   * state as if it were one.
   */
  withheldByState: boolean;
  assistantText: string | null;
  /** `speech_end_ms − speech_start_ms`; null = no length to say. */
  callerLengthMs: number | null;
  /** `playback_end − first_audio_out` by mark. */
  assistantLengthMs: number | null;
  /** Where the bubble seeks to on the recording, or null when it has no place there. */
  callerSeekMs: number | null;
  assistantSeekMs: number | null;
  interrupted: boolean;
  /** `failureLine(...)`, or null when `failed_leg` is null (trap 7). */
  failure: string | null;
  source: string | null;
  sourceKnown: boolean;
}

/**
 * One turn as the transcript draws it. The consent gate is applied here and
 * nowhere else on this screen (trap 4, ADR 0005): a withheld bubble is not sent
 * the text at all, only the outcome — or, with no consent row, the call's state
 * (trap 2) — to say in its place. Storage does not enforce the gate, so a
 * hand-restored `caller_text` on an unconsented call must die here.
 */
export function bubbleView(
  turn: TurnRow,
  context: {
    outcome: string | null;
    state: CallState;
    gate: ConsentGate;
    recordingStartedAt: Date | null;
    span: TurnSpan | undefined;
  },
): TurnBubbleView {
  const marks = parseMarks(turn.marks);
  const length = bubbleLengthMs(turn);
  const showCaller = showCallerData(context.outcome, context.gate);
  const origin =
    context.recordingStartedAt === null ? null : context.recordingStartedAt.getTime();
  const assistantStart = assistantStartWallMs(marks);
  return {
    idx: turn.idx,
    callerText: showCaller ? turn.caller_text : null,
    callerWithheld: !showCaller,
    withheldReason: context.outcome ?? withheldStateReason(context.state),
    withheldReasonKnown: context.outcome === null || isKnownConsentOutcome(context.outcome),
    withheldByState: context.outcome === null,
    assistantText: turn.assistant_text,
    callerLengthMs: length.caller,
    assistantLengthMs: length.assistant,
    callerSeekMs: context.span?.startMs ?? null,
    assistantSeekMs:
      origin === null || assistantStart === undefined
        ? null
        : recordingOffsetMs(assistantStart, origin),
    interrupted: turn.interrupted,
    failure: failureLine(turn.failed_leg, turn.failed_stage, turn.failed_after_ms),
    source: turn.source,
    sourceKnown: turn.source === null || isKnownTurnSource(turn.source),
  };
}
