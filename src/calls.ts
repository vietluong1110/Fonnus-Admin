/**
 * The call screens' view logic, as pure functions so the traps of
 * `../Fonnus/docs/read-contract.md` §5 are tested without a database or React.
 * Vocabulary is the pipeline's, unchanged (CLAUDE.md §Ground rules).
 */

import type { ConsentGate } from './config';
import type { BadgeTone } from './ui/badge';

/** Contract §3.1 — `call_log.end_reason`. */
export const END_REASONS = [
  'max_duration',
  'max_turns',
  'max_reprompts',
  'provider_failure',
  'caller_hangup',
  'shutdown',
  'media_stream_closed',
] as const;

/** Contract §3.1 — `consent_record.outcome`, enforced by a database CHECK. */
export const CONSENT_OUTCOMES = [
  'granted',
  'hung_up_before_disclosure',
  'hung_up_before_consent',
] as const;

/** Contract §3.1 — `turn.failed_leg`: the two legs a reply can fail on. */
export const FAILED_LEGS = ['llm', 'tts'] as const;

/** Contract §3.1 — `turn.failed_stage`: which deadline tripped. */
export const FAILED_STAGES = ['ttfb', 'idle', 'total'] as const;

/** Contract §3.1 — `turn.source`. */
export const TURN_SOURCES = ['speech_final', 'utterance_end', 'carry_over', 'reopen'] as const;

/**
 * A value outside a fixed vocabulary is rendered as-is with a warning, never
 * dropped: the vocabularies grow additively (contract §4), so an unknown value
 * is most likely a pipeline the console has not caught up with.
 */
export const UNKNOWN_VOCABULARY_TITLE = "value outside the contract's vocabulary";

/*
 * Which badge tone each fixed vocabulary value wears. Pure data beside the
 * vocabularies it colours, so a value added upstream shows up here as a missing
 * key rather than as a silently grey pill.
 *
 * The tones are the design system's, and they carry the operator's reading:
 * `error` only for a failure the pipeline itself owns (`provider_failure`),
 * `info` for a limit the pipeline applied on purpose, `neutral` for an ending
 * nobody needs to act on. An unknown value is `warning` — see
 * UNKNOWN_VOCABULARY_TITLE.
 */
export const UNKNOWN_VOCABULARY_TONE: BadgeTone = 'warning';

// Typed as an open map so an unknown key reads `undefined` at the lookup, and
// `satisfies` still fails the build if a contract value loses its tone.
const END_REASON_TONE: Record<string, BadgeTone> = {
  max_duration: 'info',
  max_turns: 'info',
  max_reprompts: 'info',
  provider_failure: 'error',
  caller_hangup: 'neutral',
  shutdown: 'neutral',
  media_stream_closed: 'neutral',
} satisfies Record<(typeof END_REASONS)[number], BadgeTone>;

const CONSENT_OUTCOME_TONE: Record<string, BadgeTone> = {
  granted: 'success',
  hung_up_before_disclosure: 'warning',
  hung_up_before_consent: 'warning',
} satisfies Record<(typeof CONSENT_OUTCOMES)[number], BadgeTone>;

export function endReasonTone(value: string): BadgeTone {
  return END_REASON_TONE[value] ?? UNKNOWN_VOCABULARY_TONE;
}

export function consentOutcomeTone(value: string): BadgeTone {
  return CONSENT_OUTCOME_TONE[value] ?? UNKNOWN_VOCABULARY_TONE;
}

export function isKnownEndReason(value: string): boolean {
  return (END_REASONS as readonly string[]).includes(value);
}

export function isKnownConsentOutcome(value: string): boolean {
  return (CONSENT_OUTCOMES as readonly string[]).includes(value);
}

export function isKnownTurnSource(value: string): boolean {
  return (TURN_SOURCES as readonly string[]).includes(value);
}

export function isKnownFailedLeg(value: string): boolean {
  return (FAILED_LEGS as readonly string[]).includes(value);
}

export function isKnownFailedStage(value: string): boolean {
  return (FAILED_STAGES as readonly string[]).includes(value);
}

/**
 * The sentence a failed turn carries. `failed_leg` is the test for "failed"
 * (trap 7: `interrupted` alone does not tell a barge-in from a mid-reply
 * failure), so a null leg is not a failure and gets no line at all.
 *
 * A null stage with a leg is a provider error rather than a deadline (§3.1),
 * and it is said in words — an absent stage rendered as a dash would read as a
 * missing measurement. A null `failed_after_ms` means the turn has no
 * `endpoint_decision` mark to measure the elapsed time from (§3.2 column note).
 */
export function failureLine(
  failedLeg: string | null,
  failedStage: string | null,
  failedAfterMs: number | null,
): string | null {
  if (failedLeg === null) return null;
  const where =
    failedStage === null
      ? `Failed on ${failedLeg} — provider error, no deadline stage`
      : `Failed on ${failedLeg} at ${failedStage}`;
  return failedAfterMs === null
    ? `${where}; elapsed not measured (no endpoint_decision mark)`
    : `${where} after ${formatNumber(failedAfterMs)} ms`;
}

/**
 * "How it ended" in one cell. The ordinary ending is a consented call the
 * caller hung up (`granted` + `caller_hangup`): it is said quietly, without a
 * pill, because a default is said and not drawn (CONTEXT.md §Look and feel).
 * Anything else — another outcome, another end reason, a null on either side,
 * a call with no consent row at all (trap 2) — is the exception the row wears
 * its existing tone for.
 */
export function isOrdinaryEnding(outcome: string | null, endReason: string | null): boolean {
  return isConsentGranted(outcome) && endReason === 'caller_hangup';
}

export type CallState = 'finalized' | 'in_progress' | 'not_finalized';

/**
 * Trap 2: a `call_log` row with no `consent_record` row does NOT mean "no
 * consent". The call row is written at call start and the consent row only in
 * the finish transaction, so a missing outcome is either a call still running or
 * a finalize that never completed.
 */
export function callState(endedAt: Date | null, outcome: string | null): CallState {
  if (outcome !== null) return 'finalized';
  return endedAt === null ? 'in_progress' : 'not_finalized';
}

/**
 * The screen text for a state that is not finalized; `finalized` says nothing.
 * The short phrase alone — every screen that names a call state takes it from
 * here, so the list and the detail cannot drift apart, and `src/ui/call-state.tsx`
 * is where the phrase and its caveat are drawn together.
 */
export const CALL_STATE_LABEL = {
  finalized: null,
  in_progress: 'in progress',
  not_finalized: 'not finalized',
} as const satisfies Record<CallState, string | null>;

/** Why the state is what it is — the sentence that travels with the label. */
export const CALL_STATE_CAVEAT = {
  finalized: null,
  in_progress: 'the consent row is written at finalize',
  not_finalized: 'process died or finish failed',
} as const satisfies Record<CallState, string | null>;

/** `finalized` is the normal case and wears no badge at all. */
export const CALL_STATE_TONE = {
  finalized: null,
  in_progress: 'info',
  not_finalized: 'warning',
} as const satisfies Record<CallState, BadgeTone | null>;

/**
 * Trap 4: the consent obligation lives in this reader. Every caller-derived
 * byte — `turn.caller_text`, the recording — is rendered only when the call's
 * consent outcome is `granted`; storage does not enforce it, so a hand-restored
 * row could still carry text.
 *
 * `gate` is the internal test phase's deployment switch (ADR 0005): `off` shows
 * caller data for every call, because in that phase every caller is a team
 * member who consented off-band. This file is the only place in `src/` that
 * compares an outcome to `granted`, so there is one gate to change when the
 * phase ends.
 */
export function showCallerData(outcome: string | null, gate: ConsentGate): boolean {
  return gate === 'off' || isConsentGranted(outcome);
}

/**
 * The bare fact, not a gate: whether this call's consent outcome is `granted`.
 * The dashboard counts the consented sample with it (trap 1 — percentiles stand
 * on consented calls only), and that count must stay the truth about the data
 * whatever `CONSENT_GATE` is set to. Kept in this file so the literal lives in
 * one place.
 */
export function isConsentGranted(outcome: string | null): boolean {
  return outcome === 'granted';
}

/**
 * `total_cost_vnd` is `numeric(14,4)`, which `pg` hands over as a string to
 * keep the precision. An unparseable value is missing, never 0 — trap 3 already
 * makes a real 0 mean "nothing could be priced".
 */
export function parseCostVnd(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * `m:ss` — how a call length is read out loud. No `ended_at` is a call still
 * running; an `ended_at` before `started_at` is a clock fault and reads "not
 * measured", the contract's word for a reversed span (§3.2), never a state.
 */
export function formatDuration(startedAt: Date, endedAt: Date | null): string {
  if (endedAt === null) return 'in progress';
  const ms = endedAt.getTime() - startedAt.getTime();
  if (ms < 0) return 'not measured';
  const seconds = Math.round(ms / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * `m:ss` from a length in milliseconds — the player's clock and a bubble's
 * voice length. Floored, not rounded, because a clock that reads the end one
 * second before the audio reaches it is wrong on the way there; and clamped at
 * zero, because a negative length is a clock fault the caller has already
 * rendered as "not measured" (contract §3.2), never `-0:01`.
 */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The clinic's zone, pinned once for every screen — never the process's. */
export const CALL_TIME_ZONE = 'Asia/Ho_Chi_Minh';

// Vietnam has run one offset with no daylight saving since 1975, so the suffix
// is a constant rather than a per-instant lookup. It is written out because the
// stored instants are absolute (contract §3) and a reader must not have to
// guess which clock a screen shows.
const CALL_TIME_ZONE_SUFFIX = '+07';

// Pinned to the clinic's zone, never the process's: the console may run on a
// box set to UTC and the operator still reads the call in local time.
const WHEN = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** `2026-09-05 14:03:12 +07`, whatever the process `TZ` is. */
export function formatWhen(date: Date): string {
  const parts = new Map<string, string>(
    WHEN.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const at = (type: string): string => parts.get(type) ?? '';
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}:${at('second')} ${CALL_TIME_ZONE_SUFFIX}`;
}

/** Space-grouped so long millisecond figures stay readable: `1 234`. */
export function formatNumber(value: number): string {
  const [whole = '', fraction] = value.toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** A missing measurement is said, not blanked (contract §3.2). */
export function formatMs(value: number | null): string {
  return value === null ? 'not measured' : `${formatNumber(value)} ms`;
}

/** A missing accounting figure is a different fact from a zero (contract §3). */
export function formatCount(value: number | null): string {
  return value === null ? 'not reported' : formatNumber(value);
}

/** `FONNUS_BUILD_SHA` is a 40-character commit SHA, or `local` (contract §3.4). */
export function shortSha(sha: string): string {
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 7) : sha;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The route parameter is checked here so a malformed id never reaches SQL. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
