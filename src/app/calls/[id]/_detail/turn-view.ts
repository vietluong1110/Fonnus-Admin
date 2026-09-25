/**
 * The selected turn and the turn table as rows of plain values: the capsule
 * stack of "Selected turn" (ADR 0014 decision 7) and the per-turn cost cells
 * (ADR 0015). Pure — no React — so the rules are held by
 * `turn-view.test.ts`; this repo's runner has no renderer.
 *
 * Every position here is a wall-clock mark, measured from the turn's earliest
 * mark, so every row of the stack shares one scale and the bars are
 * comparable (the `HBar` rule). The recording offset of that earliest mark is
 * what places the playhead on the same scale (`recordingOffsetMs`).
 */

import { costCell, turnCost, type TurnCostInput } from '@/cost';
import { CALL_STATE_LABEL, formatMs, formatNumber, type CallState } from '@/calls';
import { endOfTurnRows, headPairRows, LEGS, PARTITION_LEGS, TARGETS, type Stage } from '@/latency';
import { recordingOffsetMs } from '@/playback';
import { termFor, type Term } from '@/ui/glossary';

/** One capsule row: a span on the turn's scale, or "—" with the reason in the tooltip. */
export interface TrackRowView {
  key: string;
  term: Term;
  /** The span on the scale, in ms from the earliest mark; null draws an empty track. */
  span: { from: number; to: number } | null;
  value: string;
  /** Where the dashed target mark sits on the scale, when it falls inside it. */
  target?: number;
  tone: string;
  /** A measurement outside the partition — `stt_emit` and `playback` (PARTITION_LEGS). */
  outlined: boolean;
}

export interface SelectedTurnView {
  /** Earliest mark to `playback_end`, else to the latest mark, in ms. */
  scaleMax: number;
  /** The earliest mark's place on the recording; null when the call has no recorder clock. */
  scaleStartOnRecordingMs: number | null;
  rows: TrackRowView[];
}

/** The columns the stack reads, as `getTurns` returns them. */
export interface SelectedTurnInput {
  marks: Partial<Record<Stage, number>>;
  pipeline_ms: number | null;
  caller_perceived_ms: number | null;
  interrupted: boolean;
  /** `turn.source === 'reopen'`: head marks are the first generation's (contract §3.2). */
  reopened: boolean;
}

const HEADLINE_TONE = 'var(--chart-1)';
const OVER_TONE = 'var(--error)';
const LEG_TONE = 'var(--chart-1)';
const SECOND_TONE = 'var(--chart-3)';

/** The mark names a span lacks, for the "—" row's tooltip. */
function absent(marks: Partial<Record<Stage, number>>, from: Stage, to: Stage): Stage[] {
  return [from, to].filter((stage) => marks[stage] === undefined);
}

/** A term whose tooltip carries the row's own fact after the glossary's description. */
function withNote(term: Term, note: string | null): Term {
  if (note === null) return term;
  return { ...term, description: term.description === undefined ? note : `${term.description} — ${note}` };
}

/**
 * One span between two marks: drawn when both are stamped and in order; "—"
 * naming the missing mark(s); "not measured" when the pair is reversed (a
 * clock fault, `spanOf`).
 */
function markSpan(
  marks: Partial<Record<Stage, number>>,
  from: Stage,
  to: Stage,
  earliest: number,
): { span: { from: number; to: number } | null; value: string; note: string | null } {
  const missing = absent(marks, from, to);
  if (missing.length > 0) {
    return { span: null, value: '—', note: `no ${missing.join(' or ')} mark on this turn` };
  }
  const a = marks[from] as number;
  const b = marks[to] as number;
  if (b < a) return { span: null, value: 'not measured', note: `${to} stamped before ${from} — a clock fault` };
  return { span: { from: a - earliest, to: b - earliest }, value: formatMs(b - a), note: null };
}

/**
 * A headline span (ADR 0007): the bar from the marks, the number from the
 * stored column — the pipeline's own figure — and the target as a dashed mark
 * from the span's start, drawn only when it falls on the scale. A negative
 * stored value is "not measured" and draws no bar; a null one leaves the
 * number to the marks, and the tooltip says so.
 */
function headline(
  code: 'pipeline_ms' | 'caller_perceived_ms',
  stored: number | null,
  marks: Partial<Record<Stage, number>>,
  from: Stage,
  earliest: number,
  scaleMax: number,
  targetMs: number,
  targetNote: string,
): TrackRowView {
  const base = termFor('span', code) as Term;
  const drawn = markSpan(marks, from, 'first_audio_out', earliest);
  let value = drawn.value;
  let note = drawn.note;
  let span = drawn.span;
  if (stored !== null && stored >= 0) value = formatMs(stored);
  else if (stored !== null) {
    // The row says the span was not measured, so it draws none: a bar from
    // the marks beside "not measured" would be read as the measurement.
    value = 'not measured';
    note = 'the stored value is negative — a clock fault (contract §3.2)';
    span = null;
  } else if (drawn.span !== null) {
    note = 'from marks; stored column null';
  }
  // The tone follows the number shown: the stored figure, or the marks' when it is null.
  const shownMs = stored ?? (drawn.span === null ? null : drawn.span.to - drawn.span.from);
  const over = shownMs !== null && shownMs > targetMs;
  const start = marks[from];
  const target = start === undefined ? undefined : start - earliest + targetMs;
  return {
    key: code,
    term: withNote(base, [targetNote, note].filter((part) => part !== null).join('; ')),
    span,
    value,
    ...(target !== undefined && target <= scaleMax ? { target } : {}),
    tone: over ? OVER_TONE : HEADLINE_TONE,
    outlined: false,
  };
}

/**
 * The capsule stack of one turn, in the order the screen reads it: the two
 * headline spans, the six legs, model reasoning when the turn has it, and the
 * three end-of-turn spans. Null when the turn has no readable mark at all —
 * there is no scale to draw on.
 */
export function selectedTurnView(
  turn: SelectedTurnInput,
  recordingStartedAt: Date | null,
): SelectedTurnView | null {
  const { marks } = turn;
  const values = Object.values(marks);
  if (values.length === 0) return null;
  const earliest = Math.min(...values);
  const end = marks.playback_end ?? Math.max(...values);
  const scaleMax = Math.max(0, end - earliest);

  const rows: TrackRowView[] = [
    headline(
      'pipeline_ms',
      turn.pipeline_ms,
      marks,
      'endpoint_decision',
      earliest,
      scaleMax,
      TARGETS.pipelineP95Ms,
      `target P95 < ${formatNumber(TARGETS.pipelineP95Ms)} ms, a hint on one turn`,
    ),
    headline(
      'caller_perceived_ms',
      turn.caller_perceived_ms,
      marks,
      'speech_end',
      earliest,
      scaleMax,
      TARGETS.perceivedP95AlarmMs,
      `alarm at P95 ≥ ${formatNumber(TARGETS.perceivedP95AlarmMs)} ms (aspirational), a hint on one turn`,
    ),
  ];

  const partition: readonly string[] = PARTITION_LEGS;
  for (const leg of LEGS) {
    const drawn = markSpan(marks, leg.from, leg.to, earliest);
    rows.push({
      key: leg.name,
      term: withNote(termFor('leg', leg.name) as Term, drawn.note),
      span: drawn.span,
      value: drawn.value,
      tone: LEG_TONE,
      outlined: !partition.includes(leg.name),
    });
  }

  // Present only when both marks are: a model that emits no reasoning stamps
  // no `llm_first_reasoning`, and "—" on every such turn would claim a
  // measurement failed where none was due (`headPairRows`).
  for (const pair of headPairRows(marks)) {
    const drawn = markSpan(marks, pair.from, pair.to, earliest);
    rows.push({
      key: `${pair.from} → ${pair.to}`,
      term: withNote(
        termFor('span', `${pair.from} → ${pair.to}`) as Term,
        [drawn.note, 'on a turn that failed over, the first mark is the primary model’s and the second the fallback’s (contract §3.2)']
          .filter((part) => part !== null)
          .join('; '),
      ),
      span: drawn.span,
      value: drawn.value,
      tone: SECOND_TONE,
      outlined: false,
    });
  }

  // The end-of-turn spans have no name upstream and none here: each row's
  // glossary name is its mark pair (`src/latency.ts`, END_OF_TURN_PAIRS).
  for (const pair of endOfTurnRows(marks)) {
    const drawn = markSpan(marks, pair.from, pair.to, earliest);
    const notes = [drawn.note];
    if (pair.to === 'playback_end' && turn.interrupted) {
      notes.push('playback_end is the last lull before the barge-in, not the end of the reply');
    }
    if (turn.reopened) notes.push('end-of-turn marks are the last generation’s, head marks the first’s');
    const note = notes.filter((part) => part !== null).join('; ');
    const key = `${pair.from} → ${pair.to}`;
    rows.push({
      key,
      term: withNote(termFor('span', key) as Term, note === '' ? null : note),
      span: drawn.span,
      value: drawn.value,
      tone: SECOND_TONE,
      outlined: false,
    });
  }

  return {
    scaleMax,
    scaleStartOnRecordingMs:
      recordingStartedAt === null ? null : recordingOffsetMs(earliest, recordingStartedAt.getTime()),
    rows,
  };
}

/**
 * The playhead on the turn's scale, or undefined when it is not on it: no
 * recorder clock, or the audio is before the earliest mark or past the end.
 */
export function playheadOnScale(view: SelectedTurnView, playheadMs: number): number | undefined {
  if (view.scaleStartOnRecordingMs === null) return undefined;
  const at = playheadMs - view.scaleStartOnRecordingMs;
  return at < 0 || at > view.scaleMax ? undefined : at;
}

/**
 * The "Number of turns" tooltip: both branches of contract trap 1 —
 * `turn_count` is written only in the finish transaction, and an unconsented
 * call keeps no turns — and where the rows are counted instead.
 */
export const TURN_COUNT_HINT =
  'turns written, set only when the call is finalized: 0 while the call is not finalized, and none on an unconsented call (trap 1); Turns on record counts the rows';

/**
 * The note beside `turn_count`: the call's own state label, the one the head
 * shows (`CALL_STATE_LABEL`), when the count reads 0 beside real
 * `turn` rows (trap 1 — the finish transaction has not run, so the rows are the
 * number to read), else none.
 */
export function turnCountView(
  turnCount: number,
  rowsOnRecord: number,
  state: CallState,
): { note: string | null } {
  return { note: turnCount === 0 && rowsOnRecord > 0 ? CALL_STATE_LABEL[state] : null };
}

/** A turn's three cost cells (ADR 0015 decision 3): STT has no per-turn figure. */
export interface TurnCostCells {
  stt: string;
  llm: string;
  tts: string;
}

/**
 * The cost cells of one turn at list price. Each leg names only its own
 * unpriced model — the LLM cell never says the TTS model is unpriced.
 */
export function turnCostCells(turn: TurnCostInput, ttsModel: string | null): TurnCostCells {
  const cost = turnCost(turn, ttsModel);
  return {
    stt: '—',
    llm: costCell(
      cost.llmVnd,
      cost.unpriced.filter((model) => model === turn.llm_model),
    ),
    tts: costCell(
      cost.ttsVnd,
      cost.unpriced.filter((model) => model === ttsModel),
    ),
  };
}
