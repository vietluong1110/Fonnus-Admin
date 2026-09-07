/**
 * The call screens' view logic, as pure functions so the traps of
 * `../Fonnus/docs/read-contract.md` §5 are tested without a database or React.
 * Vocabulary is the pipeline's, unchanged (CLAUDE.md §Ground rules).
 */

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

/** Contract §3.1 — `turn.source`. */
export const TURN_SOURCES = ['speech_final', 'utterance_end', 'carry_over', 'reopen'] as const;

/**
 * A value outside a fixed vocabulary is rendered as-is with a warning, never
 * dropped: the vocabularies grow additively (contract §4), so an unknown value
 * is most likely a pipeline the console has not caught up with.
 */
export const UNKNOWN_VOCABULARY_TITLE = "value outside the contract's vocabulary";

export function isKnownEndReason(value: string): boolean {
  return (END_REASONS as readonly string[]).includes(value);
}

export function isKnownConsentOutcome(value: string): boolean {
  return (CONSENT_OUTCOMES as readonly string[]).includes(value);
}

export function isKnownTurnSource(value: string): boolean {
  return (TURN_SOURCES as readonly string[]).includes(value);
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

/** The screen text for a state that is not finalized; `finalized` says nothing. */
export const CALL_STATE_LABEL = {
  finalized: null,
  in_progress: 'in progress',
  not_finalized: 'not finalized — process died or finish failed',
} as const satisfies Record<CallState, string | null>;

/**
 * Trap 4: the consent obligation lives in this reader. `turn.caller_text` is
 * rendered only when the call's consent outcome is `granted`; storage does not
 * enforce it, so a hand-restored row could still carry text.
 */
export function showCallerText(outcome: string | null): boolean {
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

const CALL_TIME_ZONE = 'Asia/Ho_Chi_Minh';

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
