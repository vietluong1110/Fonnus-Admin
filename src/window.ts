/**
 * The window every screen reads its population from — the URL contract of
 * ADR 0006, parsed in one place so Overview and Calls cannot disagree about
 * what "the last 7 days" is. `parseSince` is a copy of
 * `../Fonnus/tools/report-calls.ts`, kept here beside the rest of the window so
 * a preset window means exactly what `report-calls --since <same>` means.
 *
 * Vocabulary is the pipeline's, unchanged (CLAUDE.md §Ground rules); the preset
 * names and `custom` are the console's own, settled with the operator.
 */

import { CALL_TIME_ZONE } from './calls';

const DAY_MS = 86_400_000;

/** The three presets the control offers, in the order it draws them (ADR 0006). */
export const WINDOW_PRESETS = ['24h', '7d', '30d'] as const;

/** What `since` means when the operator asks for nothing — the pipeline's own default. */
export const DEFAULT_SINCE = '7d';

/**
 * The longest window the screen will accept. It is not a product limit: the
 * window's every call and every turn are read with no LIMIT, and the pool gives
 * any statement 10 seconds (`statement_timeout` in `src/db.ts`). A year and a
 * day is well past what the retention sweep leaves on record anyway.
 */
export const MAX_WINDOW_DAYS = 366;

/**
 * A date-only bound (`2026-09-01`) is a day in the clinic's zone, the zone
 * every screen pins — the same fact `src/calls.ts` prints as the `+07` suffix:
 * Vietnam has run one offset with no daylight saving since 1975, so the bound
 * is resolved with a constant offset rather than a per-instant lookup. A test
 * pins the constant against `Intl` in `CALL_TIME_ZONE`, so a zone that ever
 * moved would fail the suite rather than shift a window silently.
 */
const CALL_TIME_ZONE_OFFSET = '+07:00';

/** A query string key can arrive repeated; the first value is the answer. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** What `parseSince` answers: the lower bound, or the default and why. */
export interface Since {
  since: Date;
  /** Present only when the requested window was rejected; the default is shown instead. */
  error?: string;
}

export type Preset = (typeof WINDOW_PRESETS)[number] | 'custom';

export interface Window {
  since: Date;
  /** Null on a preset window: open-ended, exactly as `report-calls --since` is. */
  until: Date | null;
  preset: Preset;
  /** The `since` string as it is re-emitted in links. */
  spec: string;
  /** Present only when the requested window was rejected; the default is shown instead. */
  error?: string;
}

function defaultSince(now: Date): Date {
  return new Date(now.getTime() - 7 * DAY_MS);
}

/** A relative spec (`7d`, `36h`, `90m`) has no fixed instant, so no `until` may sit beside it. */
const RELATIVE = /^(\d+)([dhm])$/;

/** `YYYY-MM-DD` — a day in the clinic's zone rather than an instant. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function sinceError(trimmed: string): string {
  return `since expects 7d, 36h, 90m or an ISO instant, got '${trimmed}' — showing the default ${DEFAULT_SINCE} window.`;
}

function spanError(): string {
  return `a window longer than ${String(MAX_WINDOW_DAYS)} days is refused: the screen reads every turn in it and the pool gives a statement 10 seconds (statement_timeout, src/db.ts) — showing the default ${DEFAULT_SINCE} window.`;
}

/**
 * `7d` / `36h` / `90m`, or any instant `Date` can parse — copied from
 * `../Fonnus/tools/report-calls.ts` `parseSince`, so the console's window means
 * exactly what the pipeline's `report-calls --since` flag means. Two changes:
 * `now` is a parameter rather than a call to the clock, and a rejection is a
 * returned message rather than a thrown `UsageError`, because a screen answers
 * a bad query string by rendering the default window and saying so.
 */
export function parseSince(spec: string | undefined, now: Date): Since {
  if (spec === undefined || spec.trim() === '') return { since: defaultSince(now) };
  const trimmed = spec.trim();

  let since: Date;
  const relative = RELATIVE.exec(trimmed);
  if (relative !== null) {
    const amount = Number(relative[1]);
    const unitMs = { d: DAY_MS, h: 3_600_000, m: 60_000 }[relative[2] as 'd' | 'h' | 'm'];
    since = new Date(now.getTime() - amount * unitMs);
  } else {
    const parsed = parseAbsolute(trimmed);
    if (parsed === null) return { since: defaultSince(now), error: sinceError(trimmed) };
    since = parsed;
  }

  // `9999999999d` is a number the regex accepts and the Date range does not:
  // the subtraction lands outside ±8.64e15 ms and `since` is an invalid Date,
  // which Postgres would refuse rather than the screen. Same answer as garbage.
  if (Number.isNaN(since.getTime())) {
    return { since: defaultSince(now), error: sinceError(trimmed) };
  }

  if (now.getTime() - since.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    return { since: defaultSince(now), error: spanError() };
  }

  return { since };
}

/**
 * An absolute bound: a date-only value is 00:00 of that day in the clinic's
 * zone (ADR 0006), anything else is taken literally — a value with a time is
 * the instant it spells, whatever zone it carries. Null when `Date` cannot read
 * it at all.
 */
function parseAbsolute(trimmed: string): Date | null {
  const raw = DATE_ONLY.test(trimmed) ? `${trimmed}T00:00:00${CALL_TIME_ZONE_OFFSET}` : trimmed;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The upper bound of a custom range. A date-only value is 00:00 of the
 * FOLLOWING day in the clinic's zone, so "1 Sep to 10 Sep" on the control
 * includes both days and the SQL stays half-open (ADR 0006).
 */
function parseUntil(trimmed: string): Date | null {
  const parsed = parseAbsolute(trimmed);
  if (parsed === null) return null;
  return DATE_ONLY.test(trimmed) ? new Date(parsed.getTime() + DAY_MS) : parsed;
}

function defaultWindow(now: Date, error?: string): Window {
  return {
    since: defaultSince(now),
    until: null,
    preset: DEFAULT_SINCE,
    spec: DEFAULT_SINCE,
    ...(error === undefined ? {} : { error }),
  };
}

function presetOf(spec: string, until: Date | null): Preset {
  if (until !== null) return 'custom';
  return (WINDOW_PRESETS as readonly string[]).includes(spec) ? (spec as Preset) : 'custom';
}

/**
 * The whole window from the query string: `since` in the pipeline's own forms
 * or a date, and `until` only beside an absolute `since` (ADR 0006). A refusal
 * is never a thrown error and never an empty screen — it is the default window
 * plus the line the screen prints, so a pasted URL with a typo still shows
 * calls and says what it did with the request.
 */
export function parseWindow(
  params: Record<string, string | string[] | undefined>,
  now: Date,
): Window {
  const spec = (first(params.since) ?? '').trim();
  const untilSpec = (first(params.until) ?? '').trim();

  if (untilSpec === '') {
    const base = parseSince(spec === '' ? undefined : spec, now);
    if (base.error !== undefined) return defaultWindow(now, base.error);
    const emitted = spec === '' ? DEFAULT_SINCE : spec;
    return { since: base.since, until: null, preset: presetOf(emitted, null), spec: emitted };
  }

  // A relative `since` moves with the clock, so an upper bound beside it would
  // name a window that is a different window a minute later (ADR 0006).
  if (spec === '' || RELATIVE.test(spec)) {
    return defaultWindow(
      now,
      `until needs an absolute since (a date or an ISO instant), not '${spec === '' ? DEFAULT_SINCE : spec}' — showing the default ${DEFAULT_SINCE} window.`,
    );
  }

  const since = parseAbsolute(spec);
  if (since === null) return defaultWindow(now, sinceError(spec));

  const until = parseUntil(untilSpec);
  if (until === null) {
    return defaultWindow(
      now,
      `until expects a date or an ISO instant, got '${untilSpec}' — showing the default ${DEFAULT_SINCE} window.`,
    );
  }

  if (until.getTime() <= since.getTime()) {
    return defaultWindow(
      now,
      `until must come after since, got '${untilSpec}' — showing the default ${DEFAULT_SINCE} window.`,
    );
  }

  if (until.getTime() - since.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    return defaultWindow(now, spanError());
  }

  return { since, until, preset: 'custom', spec };
}

/**
 * The unit of one chart column. The console's own term, fixed here: a BUCKET
 * is one column of a window chart, and the BUCKET UNIT is how wide it is. It
 * is decided by the window alone, never by the data, so an empty edge of the
 * window is still drawn (`src/dashboard.ts` builds the buckets from it).
 */
export type BucketUnit = 'hour' | 'day' | 'week';

/**
 * The span past which a day column stops being readable: 45 days is already
 * 45 columns, and the label row can only carry every fifth of them.
 */
const WEEK_ABOVE_DAYS = 45;

/**
 * Which unit the window is drawn in. A preset answers by name, so the two
 * screens never disagree about what `24h` looks like; a custom range answers
 * by its span, measured against `now` when it is open-ended.
 */
export function bucketUnit(window: Window, now: Date): BucketUnit {
  if (window.preset === '24h') return 'hour';
  if (window.preset === '7d' || window.preset === '30d') return 'day';
  const span = (window.until ?? now).getTime() - window.since.getTime();
  return span <= WEEK_ABOVE_DAYS * DAY_MS ? 'day' : 'week';
}

/**
 * The link a preset pill points at. Every other key the screen carries (the
 * keyword, the grouping) is passed in `extra` and re-emitted, so switching the
 * window never silently drops the rest of the screen's state; `until` is left
 * out, because a preset window is open-ended.
 */
export function windowHref(
  base: string,
  preset: (typeof WINDOW_PRESETS)[number],
  extra: Record<string, string> = {},
): string {
  const search = new URLSearchParams({ since: preset });
  for (const [key, value] of Object.entries(extra)) {
    if (value !== '' && key !== 'since' && key !== 'until') search.set(key, value);
  }
  return `${base}?${search.toString()}`;
}

/** A day as the custom range fields hold it: three strings, any of them blank. */
export interface DayParts {
  day: string;
  month: string;
  year: string;
}

// The clinic's zone, the one every screen pins: a day read in the process's
// zone would be another day on a box set to UTC.
const CLINIC_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The clinic day an instant falls on, split for the `dd / mm / yyyy` fields. */
export function dayParts(at: Date): DayParts {
  const parts = new Map(CLINIC_DAY.formatToParts(at).map((part) => [part.type, part.value]));
  return { day: parts.get('day') ?? '', month: parts.get('month') ?? '', year: parts.get('year') ?? '' };
}

/**
 * The fields as the `since` / `until` value the URL carries (`YYYY-MM-DD`), or
 * null while they do not spell a real day — `31/02/2026` included, which
 * `Date` would otherwise roll over into March without a word.
 */
export function partsIso({ day, month, year }: DayParts): string | null {
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
