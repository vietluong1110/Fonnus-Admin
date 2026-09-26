/**
 * Per-turn latency marks and legs — copied, not imported, from
 * `../Fonnus/app/src/domain/latency.ts` (ADR 0001: the pipeline is a separate
 * repository and this console reads its data, so the rule travels as a copy with
 * a test pinning it to the pipeline's names). The stage list is the twelve keys
 * of `../Fonnus/docs/read-contract.md` §3.2; the legs are
 * `../Fonnus/PIPELINE_ARCHITECTURE.md` §6 plus `holding_line` (pipeline ADR 0030).
 *
 * Two headline spans (../Fonnus ADR 0007, ADR 0030):
 *   caller-perceived = speech_end → earliest(holding_line_out, first_audio_out)
 *                      (the alarm budget: whatever the caller heard first)
 *   pipeline         = endpoint_decision → first_audio_out (the tuning target;
 *                      always the answer, never the holding line)
 */

/** In the order a turn passes through them. */
export type Stage =
  | 'speech_end'
  | 'endpoint_decision'
  | 'stt_final'
  | 'llm_first_reasoning'
  | 'llm_first_token'
  | 'llm_last_token'
  | 'tts_first_byte'
  | 'tts_last_byte'
  | 'playback_start'
  | 'first_audio_out'
  /** The holding line's first byte handed to the sink (ADR 0030); turns that spoke one only. */
  | 'holding_line_out'
  | 'playback_end';

/** The twelve keys `turn.marks` may carry today; anything else is dropped. */
export const STAGES = [
  'speech_end',
  'endpoint_decision',
  'stt_final',
  'llm_first_reasoning',
  'llm_first_token',
  'llm_last_token',
  'tts_first_byte',
  'tts_last_byte',
  'playback_start',
  'first_audio_out',
  'holding_line_out',
  'playback_end',
] as const satisfies readonly Stage[];

export const LEGS = [
  /** The provider's transcript latency after the caller stopped talking. */
  { name: 'stt_emit', from: 'speech_end', to: 'stt_final' },
  /** Endpointing/VAD silence — the gap the reducer cannot shorten. */
  { name: 'endpoint_wait', from: 'speech_end', to: 'endpoint_decision' },
  /** Turn committed → the model's first token. */
  { name: 'llm_ttft', from: 'endpoint_decision', to: 'llm_first_token' },
  /** First token → the first synthesized byte (sentence 1 only). */
  { name: 'tts_ttfb', from: 'llm_first_token', to: 'tts_first_byte' },
  /** Synthesized → handed to the audio sink: our own buffering. */
  { name: 'send', from: 'tts_first_byte', to: 'first_audio_out' },
  /** Sink → FreeSWITCH says it played a chunk (advisory). */
  { name: 'playback', from: 'first_audio_out', to: 'playback_start' },
  /**
   * Committed → the holding line's first byte (ADR 0030); turns that spoke one
   * only. Appended last, as upstream, so every earlier leg keeps its index.
   */
  { name: 'holding_line', from: 'endpoint_decision', to: 'holding_line_out' },
] as const satisfies readonly { name: string; from: Stage; to: Stage }[];

/*
 * The three end-of-turn spans (`../Fonnus/docs/read-contract.md` §3.2, which
 * calls them the end-of-turn marks). They are deliberately NOT legs: the
 * pipeline names no leg for them and its own test pins that adding them must
 * not change the partition (`../Fonnus/app/src/domain/__tests__/latency.test.ts`,
 * "ignores the end-of-turn marks"). So this console coins no name for them
 * either — each row is identified by its mark pair and nothing else.
 */
const END_OF_TURN_PAIRS = [
  { from: 'llm_first_token', to: 'llm_last_token' },
  { from: 'tts_first_byte', to: 'tts_last_byte' },
  { from: 'playback_start', to: 'playback_end' },
] as const satisfies readonly { from: Stage; to: Stage }[];

export type LegName = (typeof LEGS)[number]['name'];

/**
 * The legs that tile a headline span exactly, so a bar drawn for one of them is
 * a share of the caller's wait rather than an overlapping measurement. The last
 * three always tile `pipeline_ms`. All four tile `caller_perceived_ms` only on a
 * turn without a holding line; on a turn with one, `endpoint_wait` +
 * `holding_line` tile it instead (`../Fonnus/app/src/domain/latency.ts`, the
 * comment above `LEGS`). `stt_emit` overlaps `endpoint_wait`, `playback` is
 * advisory and `holding_line` overlaps the pipeline span it runs inside, so all
 * three sit outside.
 */
export const PARTITION_LEGS = ['endpoint_wait', 'llm_ttft', 'tts_ttfb', 'send'] as const;

/**
 * The targets a per-turn number is compared against, from
 * `../Fonnus/tools/lib/call-report.ts` `TARGETS` (ADR 0007). They are P95
 * targets over a call set, so on a single turn they are a hint, not a verdict.
 */
export const TARGETS = { pipelineP95Ms: 1200, perceivedP95AlarmMs: 3600 } as const;

/**
 * A span whose end pre-dates its start is not a latency, it is a fault: a wall
 * clock can step back, and a pair stamped against two different generations is
 * a bug. Both are reported as "not measured".
 */
export function spanOf(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined || b < a) return undefined;
  return b - a;
}

/**
 * Where `caller_perceived_ms` ends: whatever the caller heard first — the
 * holding line when one played before the answer, else the answer. Copied from
 * `../Fonnus/app/src/domain/latency.ts` `TurnMarks.callerPerceivedMs` (ADR 0030).
 */
export function callerPerceivedEnd(marks: Partial<Record<Stage, number>>): number | undefined {
  const line = marks.holding_line_out;
  const answer = marks.first_audio_out;
  return line === undefined ? answer : answer === undefined ? line : Math.min(line, answer);
}

/**
 * One turn's legs, in ms. A leg whose either end was never stamped is `null` —
 * never a zero: a reply that failed before the first byte has no send leg, and
 * that is a different fact from an instant one.
 */
export function legSpans(marks: Partial<Record<Stage, number>>): Record<LegName, number | null> {
  const spans = {} as Record<LegName, number | null>;
  for (const leg of LEGS) {
    spans[leg.name] = spanOf(marks[leg.from], marks[leg.to]) ?? null;
  }
  return spans;
}

export interface EndOfTurnRow {
  from: Stage;
  to: Stage;
  spanMs: number | null;
  /** Where the span starts on the axis whose origin is `speech_end`. */
  offsetMs: number | null;
}

/**
 * The three end-of-turn spans, always all three and always in this order, on
 * an axis whose origin is `speech_end` so they can be drawn under the legs. A
 * reversed or half-stamped pair has no span, and a span with no `speech_end`
 * to place it from — or one that starts before it — has no offset (it is
 * listed, not drawn).
 *
 * Two readings the caller of this function must carry on screen, both §3.2:
 * on an `interrupted` turn `playback_end` is the last lull before the barge-in,
 * not the end of the reply; on `source = 'reopen'` these marks are the last
 * generation's while the head marks are the first's.
 */
export function endOfTurnRows(marks: Partial<Record<Stage, number>>): EndOfTurnRow[] {
  const origin = marks.speech_end;
  return END_OF_TURN_PAIRS.map((pair) => {
    const start = marks[pair.from];
    const offset = origin === undefined || start === undefined ? null : start - origin;
    return {
      from: pair.from,
      to: pair.to,
      spanMs: spanOf(start, marks[pair.to]) ?? null,
      offsetMs: offset === null || offset < 0 ? null : offset,
    };
  });
}

/*
 * The head pairs — spans between two head marks that belong to no leg. There is
 * one today: `llm_first_reasoning → llm_first_token`, how long a reasoning model
 * thought before its first spoken token (`../Fonnus` W2-L3 F7, contract §3.2).
 * It sits INSIDE `llm_ttft`, which the leg rows already draw whole, so it is a
 * second reading of that leg and never an eighth leg — the pipeline names no
 * leg for it and this console coins none (`docs/upstream.md` §The waterfall).
 * `label` is the plain-language gloss beside the mark pair, not a name for it.
 */
export const HEAD_PAIRS = [
  { from: 'llm_first_reasoning', to: 'llm_first_token', label: 'thinking' },
] as const satisfies readonly { from: Stage; to: Stage; label: string }[];

export interface HeadPairRow {
  from: Stage;
  to: Stage;
  label: string;
  spanMs: number | null;
  /** Where the span starts on the axis whose origin is `speech_end`. */
  offsetMs: number | null;
}

/**
 * The head pairs this turn has both marks for, in `HEAD_PAIRS` order. Unlike
 * `endOfTurnRows`, a pair with either mark missing is absent rather than an
 * empty row: a model that emits no reasoning stamps no `llm_first_reasoning`,
 * and a row reading "not measured" on every non-reasoning turn would say a
 * measurement failed where none was ever due. The rest is the same convention:
 * a reversed pair is "not measured" (null span), and a span with no
 * `speech_end` to place it from has no offset.
 *
 * One reading the caller must carry on screen (contract §3.2): on a turn that
 * failed over, `llm_first_reasoning` is the primary model's stamp and
 * `llm_first_token` the fallback's, so the span can contain a failover — the
 * record that proves one is in `call_event`.
 */
export function headPairRows(marks: Partial<Record<Stage, number>>): HeadPairRow[] {
  const origin = marks.speech_end;
  const rows: HeadPairRow[] = [];
  for (const pair of HEAD_PAIRS) {
    const start = marks[pair.from];
    if (start === undefined || marks[pair.to] === undefined) continue;
    const offset = origin === undefined ? null : start - origin;
    rows.push({
      from: pair.from,
      to: pair.to,
      label: pair.label,
      spanMs: spanOf(start, marks[pair.to]) ?? null,
      offsetMs: offset === null || offset < 0 ? null : offset,
    });
  }
  return rows;
}

/**
 * The trust boundary for `turn.marks`: a jsonb column, so anything at all can
 * arrive. Keys the console does not know are dropped rather than rendered — the
 * pipeline adds marks additively (contract §4), and an unknown key has no leg to
 * belong to. A non-finite or non-number value is dropped for the same reason.
 */
export function parseMarks(value: unknown): Partial<Record<Stage, number>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const marks: Partial<Record<Stage, number>> = {};
  for (const stage of STAGES) {
    const at = source[stage];
    if (typeof at === 'number' && Number.isFinite(at)) marks[stage] = at;
  }
  return marks;
}
