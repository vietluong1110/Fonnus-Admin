/**
 * The Calls screen's arithmetic: the four cards, the hour-of-day histogram, the
 * day bands the list is drawn in, and the per-row turn strip. Pure functions
 * over the rows `callsInScope` returns, so every rule of `docs/upstream.md`
 * §Call list is tested without a database or React and the components stay a
 * rendering of it.
 *
 * Nothing here coins a term for a pipeline concept (CLAUDE.md §Ground rules):
 * the consent and bucket predicates are the two functions that own them
 * (`isConsentGranted`, `isFetchable`) and the percentile is the pipeline's own.
 */

import { isFetchable } from './artifacts';
import { CALL_TIME_ZONE, isConsentGranted } from './calls';
import type { Scope } from './calls-scope';
import { dayKey, percentiles } from './dashboard';
import type { CallScopeRow } from './queries/calls';
import type { Window } from './window';

/** The row fields each function here needs, so a test fixture stays small. */
type StatRow = Pick<
  CallScopeRow,
  'started_at' | 'ended_at' | 'turn_count' | 'outcome' | 'artifact_state' | 'artifact_key_prefix'
>;

/**
 * How long the call lasted, or null when it has no length on record: a call
 * still open has no `ended_at`, and an `ended_at` before `started_at` is the
 * reversed span contract §3.2 calls a fault — neither belongs in a percentile.
 */
export function callDurationMs(row: Pick<StatRow, 'started_at' | 'ended_at'>): number | null {
  if (row.ended_at === null) return null;
  const ms = row.ended_at.getTime() - row.started_at.getTime();
  return ms < 0 ? null : ms;
}

export interface CallStats {
  calls: number;
  /** Nearest-rank P50 over the calls that have a length; null when none does. */
  medianDurationMs: number | null;
  /** Calls with no `ended_at` — left out of the median, and said on the card. */
  openCalls: number;
  /** Mean `turn_count` over granted calls; null when the scope holds none. */
  turnsPerConsentedCall: number | null;
  consentedCalls: number;
  /** Calls whose files are in the bucket, by the pipeline's own predicate. */
  recordings: number;
  recordingShare: number | null;
}

/**
 * The four cards of the artboard, over the scope's rows (ADR 0006: the cards
 * describe the scope, the chips narrow only the list).
 *
 * Trap 1 twice over: `turn_count` is rows written, so a granted call with none
 * counts as a genuine zero in the mean, and an unconsented call is outside the
 * mean altogether rather than a zero in it.
 */
export function callStats(rows: StatRow[]): CallStats {
  const durations: number[] = [];
  let openCalls = 0;
  let consentedCalls = 0;
  let consentedTurns = 0;
  let recordings = 0;

  for (const row of rows) {
    if (row.ended_at === null) openCalls += 1;
    const ms = callDurationMs(row);
    if (ms !== null) durations.push(ms);
    if (isConsentGranted(row.outcome)) {
      consentedCalls += 1;
      consentedTurns += row.turn_count;
    }
    if (isFetchable(row.artifact_state, row.artifact_key_prefix)) recordings += 1;
  }

  return {
    calls: rows.length,
    // The pipeline's own nearest-rank percentile, imported rather than copied a
    // second time (`../Fonnus/tools/lib/call-report.ts`, via `src/dashboard.ts`).
    medianDurationMs: percentiles(durations).p50,
    openCalls,
    turnsPerConsentedCall: consentedCalls === 0 ? null : consentedTurns / consentedCalls,
    consentedCalls,
    recordings,
    recordingShare: rows.length === 0 ? null : recordings / rows.length,
  };
}

// The clinic's zone, the one every screen pins (`src/calls.ts`): a call
// answered at 23:30 UTC is a 06:30 call here, and an hour read in the process's
// zone would move the whole histogram on a box set to UTC.
const HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});

/** The hour of day, 0–23, a call's `started_at` falls in — in the clinic's zone. */
export function callHour(startedAt: Date): number {
  return Number(HOUR.format(startedAt));
}

// The list writes the clock alone: the date is the day band's job, and
// repeating it on 100 rows is the noise the band exists to remove. Same zone,
// pinned the same way — `formatWhen` remains the full instant everywhere else.
const TIME_OF_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** `14:32:07` in the clinic's zone — one row's time under its day band. */
export function formatTimeOfDay(at: Date): string {
  return TIME_OF_DAY.format(at);
}

/** Twenty-four counts, hour 0 first: "when calls come in" over the scope. */
export function hourHistogram(rows: Pick<StatRow, 'started_at'>[]): number[] {
  const counts = Array.from({ length: 24 }, () => 0);
  for (const row of rows) {
    const hour = callHour(row.started_at);
    counts[hour] = (counts[hour] ?? 0) + 1;
  }
  return counts;
}

export interface DayBand<T> {
  /** `YYYY-MM-DD` in the clinic's zone — the band's heading and its key. */
  day: string;
  rows: T[];
  /**
   * The longest call of the band, the scale each row's duration track is drawn
   * against. A rendering choice with no data behind it (`docs/upstream.md`);
   * zero when no call of the band has a length yet, and then no track is drawn.
   */
  longestDurationMs: number;
}

/**
 * The list's day bands, in the order the rows arrived (`started_at DESC`), so
 * the bands read newest day first without a second sort. A day the scope holds
 * no call has no band at all — unlike the Overview's per-day bars, this is a
 * list and an empty band would be a heading over nothing.
 */
export function dayBands<T extends Pick<StatRow, 'started_at' | 'ended_at'>>(
  rows: T[],
): DayBand<T>[] {
  const bands: DayBand<T>[] = [];
  for (const row of rows) {
    const day = dayKey(row.started_at);
    let band = bands.at(-1);
    if (band === undefined || band.day !== day) {
      band = { day, rows: [], longestDurationMs: 0 };
      bands.push(band);
    }
    band.rows.push(row);
    band.longestDurationMs = Math.max(band.longestDurationMs, callDurationMs(row) ?? 0);
  }
  return bands;
}

/*
 * The band heading of the artboard: `Wed 9 Sep`, in the clinic's zone. The
 * parts are assembled rather than formatted whole because no locale writes them
 * in that order: `en-US` puts the month first, and `en-GB` abbreviates
 * September as "Sept". The day and the zone are the data; the order is the
 * artboard's.
 */
const BAND_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: CALL_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

function formatBandDate(at: Date): string {
  const parts = new Map<string, string>(
    BAND_PARTS.formatToParts(at).map((part) => [part.type, part.value]),
  );
  const at2 = (type: string): string => parts.get(type) ?? '';
  return `${at2('weekday')} ${at2('day')} ${at2('month')}`;
}

/** A `YYYY-MM-DD` day key read back as the instant its midnight is here. */
function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00+07:00`);
}

/** `Today · Wed 9 Sep` for the day the operator is in, `Tue 8 Sep` for the rest. */
export function formatDayBand(day: string, now: Date): string {
  const label = formatBandDate(dayStart(day));
  return day === dayKey(now) ? `Today · ${label}` : label;
}

/**
 * The turn strip of one row: one tick per turn on record, `true` where that
 * turn failed (`failed_leg IS NOT NULL`, trap 7 — never `interrupted`).
 *
 * `null` is the strip's third answer, "none — not consented": a call with no
 * turn rows and no grant on record never had its turns written (trap 1), which
 * is a different fact from a call that was answered and said nothing. A granted
 * call with `turn_count` 0 is that second fact and gets an empty strip.
 *
 * Turn `idx` runs from 1 (contract §3), and the turns buffered before consent
 * are flushed when it is granted (`call-sink.ts` `consentGranted`), so a call
 * with rows has idx 1…`turn_count` and tick `i` is idx `i + 1`. The strip is
 * still drawn as long as the highest failed idx, so a row that broke that
 * assumption would show an extra tick rather than hide a failure.
 */
export function turnTicks(
  row: Pick<CallScopeRow, 'turn_count' | 'failed_turn_idx' | 'outcome'>,
): boolean[] | null {
  if (row.turn_count <= 0 && row.failed_turn_idx.length === 0) {
    return isConsentGranted(row.outcome) ? [] : null;
  }
  const failed = new Set(row.failed_turn_idx);
  const length = Math.max(row.turn_count, ...row.failed_turn_idx);
  return Array.from({ length }, (_, i) => failed.has(i + 1));
}

/** The phrase the strip carries instead of zero ticks (console vocabulary). */
export const NO_TURNS_LABEL = 'none — not consented';

/** `1 call` / `214 calls` — the count the heading and the day band open with. */
export function callCount(count: number): string {
  return `${String(count)} call${count === 1 ? '' : 's'}`;
}

/** How long a preset window reads in the heading; the URL keeps the preset. */
const PRESET_PHRASE: Record<string, string> = {
  '24h': 'the last 24 hours',
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
};

/**
 * How one window reads in a sentence — `in the last 7 days`, `since Fri 12 Sep`,
 * `from Fri 12 Sep to Thu 18 Sep`. Overview's heading and the Calls heading both
 * call it, so the two screens describe the same window in the same words.
 */
export function windowPhrase(window: Window): string {
  const { preset, since, until } = window;
  const phrase = PRESET_PHRASE[preset];
  if (phrase !== undefined) return `in ${phrase}`;
  if (until === null) return `since ${formatBandDate(since)}`;
  // `until` is the midnight after the last included day (ADR 0006); the phrase
  // names the day the operator asked for, not the bound the SQL uses.
  return `from ${formatBandDate(since)} to ${formatBandDate(new Date(until.getTime() - 1))}`;
}

/**
 * What the screen is counting, in one line above the list. A search says "all
 * time" because it ignores the window on purpose (ADR 0006) — the operator must
 * never read a search result as a window's worth of calls.
 */
export function scopeHeading(scope: Scope, count: number): string {
  if (scope.kind === 'search') {
    return `${callCount(count)} matching “${scope.keyword}”, all time`;
  }
  return `${callCount(count)} ${windowPhrase(scope.window)}`;
}
