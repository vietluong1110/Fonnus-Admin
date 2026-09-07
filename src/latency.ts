/**
 * Per-turn latency marks and legs — copied, not imported, from
 * `../Fonnus/app/src/domain/latency.ts` (ADR 0001: the pipeline is a separate
 * repository and this console reads its data, so the rule travels as a copy with
 * a test pinning it to the pipeline's names). The stage list is the seven keys
 * of `../Fonnus/docs/read-contract.md` §3.2; the legs are
 * `../Fonnus/PIPELINE_ARCHITECTURE.md` §6.
 *
 * Two headline spans (../Fonnus ADR 0007):
 *   caller-perceived = speech_end → first_audio_out        (the alarm budget)
 *   pipeline         = endpoint_decision → first_audio_out (the tuning target)
 */

/** In the order a turn passes through them. */
export type Stage =
  | 'speech_end'
  | 'endpoint_decision'
  | 'stt_final'
  | 'llm_first_token'
  | 'tts_first_byte'
  | 'playback_start'
  | 'first_audio_out';

/** The seven keys `turn.marks` may carry today; anything else is dropped. */
export const STAGES = [
  'speech_end',
  'endpoint_decision',
  'stt_final',
  'llm_first_token',
  'tts_first_byte',
  'playback_start',
  'first_audio_out',
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
] as const satisfies readonly { name: string; from: Stage; to: Stage }[];

export type LegName = (typeof LEGS)[number]['name'];

/**
 * The legs that tile a headline span exactly, so a bar drawn for one of them is
 * a share of the caller's wait rather than an overlapping measurement. All four
 * tile `caller_perceived_ms`; the last three tile `pipeline_ms`. `stt_emit`
 * overlaps `endpoint_wait` and `playback` is advisory, so both sit outside.
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

export interface WaterfallRow {
  leg: LegName;
  from: Stage;
  to: Stage;
  /** Where the leg starts on an axis whose origin is `speech_end`. */
  offsetMs: number | null;
  spanMs: number | null;
  partition: boolean;
}

/**
 * One row per leg, in `LEGS` order, placed on a single axis that starts at
 * `speech_end` — so the bars read as one turn's timeline rather than six
 * independent durations.
 */
export function waterfallRows(marks: Partial<Record<Stage, number>>): WaterfallRow[] {
  // Where a leg starts on the axis. Null when it cannot be placed: no
  // `speech_end` to measure from (the pipeline deliberately leaves it out when
  // the audio clock has no origin — `effect-runner.ts`, "an invented speech_end
  // is worse than a missing one"), or a start that pre-dates it, which is the
  // same clock fault as a reversed span. The leg may still have a span.
  const placement = (origin: number | undefined, start: number | undefined): number | null => {
    if (origin === undefined || start === undefined) return null;
    const offset = start - origin;
    return offset >= 0 ? offset : null;
  };
  const origin = marks.speech_end;
  const partition: readonly string[] = PARTITION_LEGS;
  return LEGS.map((leg) => {
    const start = marks[leg.from];
    return {
      leg: leg.name,
      from: leg.from,
      to: leg.to,
      offsetMs: placement(origin, start),
      spanMs: spanOf(start, marks[leg.to]) ?? null,
      partition: partition.includes(leg.name),
    };
  });
}
