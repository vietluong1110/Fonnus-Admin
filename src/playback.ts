/**
 * Audio ↔ marks: where a turn sits on the recording's time axis, which turn the
 * screen is on, which stretch of the recording a bubble's play glyph plays, and
 * the view object each transcript bubble is drawn from. Pure — no React, no I/O, no
 * database, so the consent gate's effect on a bubble is testable in isolation.
 *
 * The recording clock is the wall clock (`../Fonnus/docs/adr/0012-*`): sample 0
 * of `call.wav` is `call_log.recording_started_at` exactly, on both channels
 * (`../Fonnus/app/src/recording/wav-writer.ts`). So a mark's place in the audio
 * is a subtraction, and no new pipeline data is needed to line the transcript,
 * the call strip and the selected turn up with what is being heard.
 *
 * The writer pads a gap over `GAP_TOLERANCE_MS = 100` with silence and never
 * rewinds a track, so every offset below is right to within ~100 ms and can
 * only drift late relative to the audio, never early (`wav-writer.ts`).
 */
import {
  CALL_STATE_LABEL,
  failureLine,
  isKnownConsentOutcome,
  showCallerData,
  type CallState,
} from './calls';
import type { ConsentGate } from './config';
import { TARGETS, parseMarks, spanOf, type Stage } from './latency';
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
  /** Place of `marks.speech_end` on the recording, or null when the mark is absent. */
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
 * stays current — its reply is still the one being heard out. Overlapping
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
 * `selectedIdx` is non-null only while the playhead stays inside the selected
 * turn — the provider clears it the moment a seek or a reported position
 * leaves that turn's block (`leavesSelection`, `playback-provider.tsx`) — which
 * is what makes "the selection wins" safe: a selection never outlives the turn
 * being heard.
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
 * How far outside a turn's block the playhead may sit and still be "in" it.
 * The recording drifts up to ~100 ms late against the marks (see the header),
 * and a seek lands on a frame boundary, so a click that seeks to a turn's own
 * start must never read as having left it.
 */
export const SEEK_SLACK_MS = 150;

/**
 * Whether a playhead position ends the selection: true only when a turn is
 * selected, that turn has a block on the recording, and the position falls
 * outside `[speech_start_ms, playback_end]` (`TurnSpan.startMs`–`endMs`) by
 * more than `SEEK_SLACK_MS`. A selected turn with no block — no
 * `speech_start_ms`, or a call with no `recording_started_at` — has nothing to
 * leave, so it stays selected until the next click.
 */
export function leavesSelection(
  spans: TurnSpan[],
  selectedIdx: number | null,
  playheadMs: number,
): boolean {
  if (selectedIdx === null) return false;
  const span = spans.find((candidate) => candidate.idx === selectedIdx);
  if (span === undefined) return false;
  return playheadMs < span.startMs - SEEK_SLACK_MS || playheadMs > span.endMs + SEEK_SLACK_MS;
}

/** What `watchRangeEnd` needs of the player and the frame clock — `<audio>` and `requestAnimationFrame` in the browser. */
export interface RangeClock {
  /** Where the audio is now, in ms. */
  positionMs: () => number;
  pause: () => void;
  frame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  /** Listens for the player's own `seeking` or `timeupdate` event; returns the unsubscribe. */
  on: (event: 'seeking' | 'timeupdate', callback: () => void) => () => void;
}

/**
 * Plays a range to its end: pauses the audio at the first check that finds
 * the position at or past `toMs`, however far past — a check is once a frame
 * (`timeupdate` fires only every ~250 ms, too sparse to stop on a word), and
 * `timeupdate` is a second check, because a background tab stops the frames
 * while the audio plays on (the overshoot there is accepted).
 *
 * Moving the audio elsewhere is known from the player's own `seeking` event,
 * never inferred from the position. The one `seeking` the watch lets pass is
 * the range's own start: the provider's seek to `fromMs` fires its event after
 * the watch has begun, and so does the start position of an audio that had
 * not loaded yet. Returns the cancel, which the provider also calls on its
 * own seek or a pause.
 */
export function watchRangeEnd(clock: RangeClock, fromMs: number, toMs: number): () => void {
  let handle: number | null = null;
  let done = false;
  let unsubscribe: (() => void)[] = [];
  const stop = (): void => {
    if (done) return;
    done = true;
    if (handle !== null) clock.cancelFrame(handle);
    handle = null;
    for (const each of unsubscribe) each();
  };
  const check = (): void => {
    if (done || clock.positionMs() < toMs) return;
    stop();
    clock.pause();
  };
  const tick = (): void => {
    handle = null;
    check();
    if (!done) handle = clock.frame(tick);
  };
  unsubscribe = [
    clock.on('timeupdate', check),
    clock.on('seeking', () => {
      if (Math.abs(clock.positionMs() - fromMs) > SEEK_SLACK_MS) stop();
    }),
  ];
  handle = clock.frame(tick);
  return stop;
}

/** A stretch of the recording, in ms from sample 0 — what a bubble's play glyph hears. */
export interface PlayRange {
  fromMs: number;
  toMs: number;
}

/**
 * What one bubble's play glyph plays (`playRange`, `playback-provider.tsx`):
 * the caller's own utterance, `speech_start_ms → speech_end_ms` (already
 * recording offsets), or the reply as heard, `first_audio_out` (else
 * `playback_start`, `assistantStartWallMs`) `→ playback_end`, placed through
 * the recorder's origin. Null when the call has no recorder clock, either end
 * is missing, or the pair is empty or reversed — a glyph with nothing to play
 * is not drawn.
 *
 * On an `interrupted` reply `playback_end` is the last lull before the cut
 * (../Fonnus/docs/read-contract.md §3.2), so the range stops there and the
 * audio after it is not played. The next turn's `speech_start_ms` is no
 * substitute: the pipeline takes it on an unmuted line only, and the line is
 * muted while a reply plays (`app/src/session/effect-runner.ts:483`), so it
 * falls after the cut — and after the degraded line, on a reply that failed
 * mid-way (trap 7).
 */
export function playRangeOf(
  turn: Pick<TurnRow, 'speech_start_ms' | 'speech_end_ms' | 'marks'>,
  side: 'caller' | 'assistant',
  recordingStartedAt: Date | null,
): PlayRange | null {
  let fromMs: number | null = null;
  let toMs: number | null = null;
  if (recordingStartedAt === null) return null;
  if (side === 'caller') {
    fromMs = turn.speech_start_ms;
    toMs = turn.speech_end_ms;
  } else {
    const marks = parseMarks(turn.marks);
    const start = assistantStartWallMs(marks);
    const origin = recordingStartedAt.getTime();
    if (start !== undefined && marks.playback_end !== undefined) {
      fromMs = recordingOffsetMs(start, origin);
      toMs = recordingOffsetMs(marks.playback_end, origin);
    }
  }
  return fromMs === null || toMs === null || toMs <= fromMs ? null : { fromMs, toMs };
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
  /**
   * Where a click on either bubble seeks to: the turn's start
   * (`speech_start_ms`), or null when the turn has no place on the recording.
   */
  seekMs: number | null;
  /** What each bubble's play glyph plays (`playRangeOf`); null draws no glyph. */
  callerRange: PlayRange | null;
  assistantRange: PlayRange | null;
  interrupted: boolean;
  /** `failureLine(...)`, or null when `failed_leg` is null (trap 7). */
  failure: string | null;
  /** The two columns `failureChip` names the failure from. */
  failedLeg: string | null;
  failedStage: string | null;
  source: string | null;
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
  const length = bubbleLengthMs(turn);
  const showCaller = showCallerData(context.outcome, context.gate);
  return {
    idx: turn.idx,
    callerText: showCaller ? turn.caller_text : null,
    callerWithheld: !showCaller,
    // A state with no label is `finalized`, which only a non-null outcome
    // produces — so the `??` branch is unreachable there and exists for the type.
    withheldReason: context.outcome ?? CALL_STATE_LABEL[context.state] ?? '',
    withheldReasonKnown: context.outcome === null || isKnownConsentOutcome(context.outcome),
    withheldByState: context.outcome === null,
    assistantText: turn.assistant_text,
    callerLengthMs: length.caller,
    assistantLengthMs: length.assistant,
    seekMs: context.span?.startMs ?? null,
    callerRange: playRangeOf(turn, 'caller', context.recordingStartedAt),
    assistantRange: playRangeOf(turn, 'assistant', context.recordingStartedAt),
    interrupted: turn.interrupted,
    failure: failureLine(turn.failed_leg, turn.failed_stage, turn.failed_after_ms),
    failedLeg: turn.failed_leg,
    failedStage: turn.failed_stage,
    source: turn.source,
  };
}

/**
 * The greeting's own marks (`../Fonnus/docs/read-contract.md` §3.5): `answered`
 * plus the reply-side keys of `turn.marks`. The greeting has no `turn` row —
 * there is no caller utterance and no LLM call — so none of the caller-side or
 * `llm_*` keys can appear, and a key never reached is absent.
 */
const GREETING_KEYS = [
  'answered',
  'tts_first_byte',
  'tts_last_byte',
  'first_audio_out',
  'playback_start',
  'playback_end',
] as const;

/** Where the greeting sits on the recording's axis, in ms from sample 0. */
export interface GreetingSpan {
  startMs: number;
  endMs: number;
}

/**
 * The greeting's block on the upper lane of "The call" (`docs/upstream.md`
 * §Call detail, the `greeting_marks` row): from `answered` to `playback_end`,
 * else to the latest key present by value, else `answered` itself — a hairline,
 * which is what a caller who hung up during the disclosure leaves behind.
 *
 * Null when the column carries no readable `answered` (a row written before the
 * pipeline's migration 0008, a call that never finalized, one terminated before
 * the greeting was dispatched) or when the call has no `recording_started_at`
 * to place it against — the same origin rule every turn block obeys. The
 * greeting has no `pipeline_ms` of its own, so the lower lane draws no bar
 * under it.
 */
export function greetingSpan(
  marks: Record<string, number> | null,
  recordingStartedAt: Date | null,
): GreetingSpan | null {
  if (marks === null || recordingStartedAt === null) return null;
  // The column is jsonb: the same trust boundary `parseMarks` is for a turn's,
  // over the greeting's own key list.
  const readable: Partial<Record<(typeof GREETING_KEYS)[number], number>> = {};
  for (const key of GREETING_KEYS) {
    const at = marks[key];
    if (typeof at === 'number' && Number.isFinite(at)) readable[key] = at;
  }
  const answered = readable.answered;
  if (answered === undefined) return null;

  let end = readable.playback_end;
  if (end === undefined) {
    for (const at of Object.values(readable)) {
      if (end === undefined || at > end) end = at;
    }
  }
  const origin = recordingStartedAt.getTime();
  const startMs = recordingOffsetMs(answered, origin);
  const endMs = recordingOffsetMs(end ?? answered, origin);
  // A `playback_end` stamped before `answered` is a clock fault, not a block
  // that runs backwards (`turnSpans` collapses the same way).
  return { startMs, endMs: endMs < startMs ? startMs : endMs };
}

/** One turn's bar on the lower lane of "The call". */
export interface TurnBar {
  idx: number;
  /** `turn.pipeline_ms` as stored — read only when `measured` is true. */
  pipelineMs: number | null;
  failed: boolean;
  interrupted: boolean;
  /**
   * False when the turn has no `pipeline_ms` to draw: a reply that never became
   * audible stamps no `first_audio_out` and the column is null, and a negative
   * value is the clock fault of contract §3.2. Both are "not measured" — a
   * dashed outline, never a bar of height zero, which would read as an instant
   * reply (`docs/upstream.md` §Call detail, the `turn` row).
   */
  measured: boolean;
}

/** One bar per turn, in `idx` order — the lower lane's whole input. */
export function turnBars(turns: TurnRow[]): TurnBar[] {
  return turns.map((turn) => ({
    idx: turn.idx,
    pipelineMs: turn.pipeline_ms,
    failed: turn.failed_leg !== null,
    interrupted: turn.interrupted,
    measured: turn.pipeline_ms !== null && turn.pipeline_ms >= 0,
  }));
}

/**
 * The top of the lower lane's scale: the target always fits, so the dashed
 * target line is on the plot even on a call whose every turn beat it, and a
 * turn that missed it is read as a bar above that line rather than as a bar.
 */
export function barScaleMs(bars: TurnBar[]): number {
  let max: number = TARGETS.pipelineP95Ms;
  for (const bar of bars) {
    if (bar.measured && bar.pipelineMs !== null && bar.pipelineMs > max) max = bar.pipelineMs;
  }
  return max;
}

/**
 * `?turn=<idx>` — the turn a link from the Overview or the Calls list opens on
 * (ADR 0006: the URL carries `turn` and nothing else). Anything that is not the
 * `idx` of a turn this call has selects nothing, so the screen opens on its own
 * first turn rather than on an empty selection: a repeated key (Next hands the
 * value as an array), a word, a sign, and an `idx` the call never wrote — the
 * link may name a turn of another call, or one the retention sweep has taken.
 */
export function parseTurnParam(
  raw: string | string[] | undefined,
  turns: Array<{ idx: number }>,
): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const idx = Number(raw);
  return turns.some((turn) => turn.idx === idx) ? idx : null;
}
