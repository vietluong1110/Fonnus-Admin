/**
 * The latency dashboard's view logic, as pure functions so the pipeline's own
 * rules (nearest-rank percentiles, the `--since` window, which spans count as
 * samples) are tested without a database or React. Three of them are copies of
 * pipeline code, each with its source named at the copy: this repo reads the
 * pipeline's data but shares no code with it (ADR 0001), so a rule travels as a
 * copy pinned by a test, never as an import.
 *
 * Vocabulary is the pipeline's, unchanged (CLAUDE.md §Ground rules).
 */

import { CALL_TIME_ZONE, isConsentGranted, shortSha } from './calls';
import { LEGS, type LegName, legSpans, parseMarks } from './latency';
import type { DashboardCall, DashboardTurn } from './queries/dashboard';

const DAY_MS = 86_400_000;

/** What `since` means when the operator asks for nothing — the pipeline's own default. */
export const DEFAULT_SINCE = '7d';

/**
 * The longest window the screen will accept. It is not a product limit: the
 * window's every call and every turn are read with no LIMIT, and the pool gives
 * any statement 10 seconds (`statement_timeout` in `src/db.ts`). A year and a
 * day is well past what the retention sweep leaves on record anyway.
 */
export const MAX_WINDOW_DAYS = 366;

export interface Window {
  since: Date;
  /** Present only when the requested window was rejected; the default is shown instead. */
  error?: string;
}

function defaultSince(now: Date): Date {
  return new Date(now.getTime() - 7 * DAY_MS);
}

/**
 * `7d` / `36h` / `90m`, or any instant `Date` can parse — copied from
 * `../Fonnus/tools/report-calls.ts` `parseSince`, so the console's window means
 * exactly what the pipeline's `report-calls --since` flag means. Two changes:
 * `now` is a parameter rather than a call to the clock, and a rejection is a
 * returned message rather than a thrown `UsageError`, because a screen answers
 * a bad query string by rendering the default window and saying so.
 */
export function parseSince(spec: string | undefined, now: Date): Window {
  if (spec === undefined || spec.trim() === '') return { since: defaultSince(now) };
  const trimmed = spec.trim();

  let since: Date;
  const relative = /^(\d+)([dhm])$/.exec(trimmed);
  if (relative !== null) {
    const amount = Number(relative[1]);
    const unitMs = { d: DAY_MS, h: 3_600_000, m: 60_000 }[relative[2] as 'd' | 'h' | 'm'];
    since = new Date(now.getTime() - amount * unitMs);
  } else {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return {
        since: defaultSince(now),
        error: `since expects 7d, 36h, 90m or an ISO instant, got '${trimmed}' — showing the default ${DEFAULT_SINCE} window.`,
      };
    }
    since = parsed;
  }

  // `9999999999d` is a number the regex accepts and the Date range does not:
  // the subtraction lands outside ±8.64e15 ms and `since` is an invalid Date,
  // which Postgres would refuse rather than the screen. Same answer as garbage.
  if (Number.isNaN(since.getTime())) {
    return {
      since: defaultSince(now),
      error: `since expects 7d, 36h, 90m or an ISO instant, got '${trimmed}' — showing the default ${DEFAULT_SINCE} window.`,
    };
  }

  if (now.getTime() - since.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    return {
      since: defaultSince(now),
      error: `a window longer than ${String(MAX_WINDOW_DAYS)} days is refused: the screen reads every turn in it and the pool gives a statement 10 seconds (statement_timeout, src/db.ts) — showing the default ${DEFAULT_SINCE} window.`,
    };
  }

  return { since };
}

export interface Percentiles {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

/**
 * Nearest-rank percentiles. Sub-100-turn samples make interpolation a lie.
 *
 * Copied verbatim from `../Fonnus/tools/lib/call-report.ts` `percentiles` so
 * the number on this screen is the number in the pipeline's own report: the
 * explicit numeric sort, the `min(n-1, ceil(q*n)-1)` rank, and the all-null
 * answer on an empty sample rather than a zero.
 */
export function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { count: 0, p50: null, p95: null, max: null };
  const at = (q: number): number => {
    const v = sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    if (v === undefined) throw new Error(`percentiles: no value at q=${String(q)}`);
    return v;
  };
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}

// The clinic's zone, the one `src/calls.ts` pins for every screen: a call
// answered at 23:30 UTC belongs to the next Vietnamese day, and a day bucket
// read in the process's zone would move calls between days on a UTC box.
const DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` in the clinic's zone — the bucket a call's `started_at` falls in. */
export function dayKey(date: Date): string {
  const parts = new Map<string, string>(DAY.formatToParts(date).map((p) => [p.type, p.value]));
  const at = (type: string): string => parts.get(type) ?? '';
  return `${at('year')}-${at('month')}-${at('day')}`;
}

/**
 * The ways the numbers can be split. `config` is the contract's "group on the
 * whole object" (§3.4, jsonb equality is structural); `key:<K>` is its "group on
 * one key". The model groupings read the columns, which are the ids the call
 * actually ran on — under `PROVIDERS=fake` those differ from the snapshot's
 * model keys (trap 6).
 */
export const GROUPINGS = ['none', 'llm_model', 'stt_model', 'tts_model', 'config'] as const;

export type Grouping = (typeof GROUPINGS)[number] | `key:${string}`;

/** The query string is untrusted; anything the list does not name is no grouping. */
export function parseGroup(raw: string | undefined): Grouping {
  if (raw === undefined) return 'none';
  if ((GROUPINGS as readonly string[]).includes(raw)) return raw as Grouping;
  if (raw.startsWith('key:') && raw.length > 'key:'.length) return raw as Grouping;
  return 'none';
}

/** The group a value with no answer falls in — never dropped (contract §3.4). */
export const UNKNOWN_GROUP = 'unknown';

/**
 * `config_snapshot` is jsonb: the column can hold anything, so this is its trust
 * boundary. A flat object is what the contract describes (§3.4); anything else,
 * including the null of a row written before migration 0007, is no snapshot.
 */
export function parseSnapshot(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * A JSON value as one canonical string: object keys sorted at every level,
 * array order kept, because order is meaning in `OPENROUTER_STOP` and in the
 * other list-valued keys (§3.4). Written by hand rather than with
 * `JSON.stringify`'s array replacer, which filters keys at every nesting level
 * and so erases a nested object entirely — `runtime` and
 * `SPEECHMATICS_SOUNDS_LIKE` would both serialize to `{}`.
 */
function canonicalJson(value: unknown): string {
  // `JSON.stringify` answers `undefined` rather than a string for `undefined`
  // itself; jsonb never hands one over, and an absent key is a caller's `null`.
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  const fields = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
  return `{${fields.join(',')}}`;
}

/**
 * A snapshot's identity as a string — "this exact configuration" (§3.4, where
 * the grouping is jsonb equality, which is structural). Sorted at every level
 * so two processes that booted the same configuration land in one group
 * whatever order Postgres handed the object over in, and so that two calls on
 * one build SHA with different `runtime.config` land in two.
 */
function snapshotIdentity(snapshot: Record<string, unknown>): string {
  return canonicalJson(snapshot);
}

export function groupKey(
  call: DashboardCall,
  turn: DashboardTurn,
  grouping: Grouping,
): string {
  if (grouping === 'none') return 'all';
  if (grouping === 'llm_model') return turn.llm_model ?? UNKNOWN_GROUP;
  if (grouping === 'stt_model') return call.stt_model ?? UNKNOWN_GROUP;
  if (grouping === 'tts_model') return call.tts_model ?? UNKNOWN_GROUP;
  const snapshot = parseSnapshot(call.config_snapshot);
  if (snapshot === null) return UNKNOWN_GROUP;
  if (grouping === 'config') return snapshotIdentity(snapshot);
  const key = grouping.slice('key:'.length);
  // The key comes from the query string, so it can name a prototype property:
  // `key:__proto__` would otherwise fold every call into one group and
  // `key:constructor` into a group named after a function. Only own keys are
  // snapshot values; anything else is no answer, which is the unknown group.
  const value = Object.hasOwn(snapshot, key) ? snapshot[key] : undefined;
  return value === undefined || value === null ? UNKNOWN_GROUP : renderValue(value);
}

/**
 * A snapshot value as text. Values are typed as the pipeline parsed them (§3.4:
 * `"BARGE_IN_ENABLED": false`, not `"false"`), so a boolean or a number is
 * rendered through JSON rather than stringified — and jsonb can hold a shape
 * the contract does not describe, which JSON also renders rather than turning
 * into `[object Object]`.
 *
 * Exported because the call detail renders the same column and must render it
 * the same way: `runtime` and `SPEECHMATICS_SOUNDS_LIKE` are objects and four
 * more keys are arrays (§3.4), so a second renderer is a second place that can
 * print `[object Object]`.
 */
export function renderValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Every key any snapshot in the window carries, sorted — the `key:` options. */
export function snapshotKeys(calls: DashboardCall[]): string[] {
  const keys = new Set<string>();
  for (const call of calls) {
    const snapshot = parseSnapshot(call.config_snapshot);
    if (snapshot !== null) for (const key of Object.keys(snapshot)) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * The keys whose values are not the same in every snapshot — the only ones
 * worth a column when configurations sit side by side. A key one snapshot omits
 * and another carries differs too (§3.4: a key the process had no value for is
 * absent, which is itself a configuration difference). A null snapshot has no
 * keys to compare and contributes nothing, though it is still a group.
 */
export function differingKeys(snapshots: Array<Record<string, unknown> | null>): string[] {
  const present = snapshots.filter((s): s is Record<string, unknown> => s !== null);
  if (present.length < 2) return [];
  const keys = new Set<string>();
  for (const snapshot of present) for (const key of Object.keys(snapshot)) keys.add(key);
  const differing: string[] = [];
  for (const key of keys) {
    // An absent key and a null one are two values, as `snapshotValue` and
    // `snapshotIdentity` already hold — hashing both to `null` would let two
    // groups differ by a key this column never names.
    const rendered = new Set(
      present.map((s) => (Object.hasOwn(s, key) ? canonicalJson(s[key]) : 'absent')),
    );
    if (rendered.size > 1) differing.push(key);
  }
  return differing.sort();
}

/** How a snapshot value reads in a cell; an absent key is not a null one (§3.4). */
export function snapshotValue(snapshot: Record<string, unknown> | null, key: string): string {
  if (snapshot === null) return UNKNOWN_GROUP;
  // Own keys only, for the reason `groupKey` gives: a prototype property is not
  // a snapshot value, it is an absent key.
  const value = Object.hasOwn(snapshot, key) ? snapshot[key] : undefined;
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  return renderValue(value);
}

export interface DashboardGroup {
  key: string;
  label: string;
  snapshot: Record<string, unknown> | null;
  calls: number;
  turns: number;
  legs: Record<LegName, Percentiles>;
  perceived: Percentiles;
  pipeline: Percentiles;
}

export interface DashboardDay {
  day: string;
  turns: number;
  perceivedP95: number | null;
  pipelineP95: number | null;
}

export interface Dashboard {
  calls: number;
  consentedCalls: number;
  /** Turns with a non-null `marks` — the pipeline's `turnCount`. */
  turns: number;
  /** Turns whose `marks` column is null: in `outside`, in no other number. */
  turnsWithoutMarks: number;
  legs: Record<LegName, Percentiles>;
  perceived: Percentiles;
  pipeline: Percentiles;
  byDay: DashboardDay[];
  groups: DashboardGroup[];
  /** Only ever filled when grouping on the whole snapshot. */
  differingKeys: string[];
  outside: DashboardTurn[];
}

/** One group's raw samples, before `percentiles` turns them into a row. */
interface Samples {
  legs: Record<LegName, number[]>;
  perceived: number[];
  pipeline: number[];
  turns: number;
  turnsWithoutMarks: number;
  calls: Set<string>;
}

function blankSamples(): Samples {
  const legs = {} as Record<LegName, number[]>;
  for (const leg of LEGS) legs[leg.name] = [];
  return {
    legs,
    perceived: [],
    pipeline: [],
    turns: 0,
    turnsWithoutMarks: 0,
    calls: new Set<string>(),
  };
}

/**
 * Collecting one turn into a sample set. Copied from
 * `../Fonnus/tools/lib/cross-call-report.ts` `buildCrossCallReport`: the samples
 * are `legSpans(parseMarks(marks))`, a leg only one end of which was stamped or
 * one whose ends run backwards is left out, and a failed or interrupted turn is
 * counted like any other — a reply that gave up is part of what the caller
 * lived through. So a leg's `count` is the turns that stamped both its marks,
 * which is not the turn count.
 *
 * The turn count itself is the pipeline's `turnCount`: turns with a non-null
 * `marks` column, the filter `turnMetricRows` applies in SQL
 * (`../Fonnus/app/src/persistence/call-queries.ts`), so the number on this
 * screen equals the one `report-calls` prints for the same window. A row whose
 * column is null is counted apart and enters no number; a row whose column is
 * `{}` — the process stamped nothing — is a turn, exactly as the pipeline's
 * `IS NOT NULL` treats it. `parseMarks` cannot tell the two apart, so the test
 * is on the raw column (contract §3: `marks` is nullable).
 */
function collect(samples: Samples, turn: DashboardTurn): void {
  if (turn.marks === null) {
    samples.turnsWithoutMarks += 1;
    return;
  }
  samples.turns += 1;
  samples.calls.add(turn.call_id);
  const spans = legSpans(parseMarks(turn.marks));
  for (const leg of LEGS) {
    const value = spans[leg.name];
    if (value !== null && value >= 0) samples.legs[leg.name].push(value);
  }
  // The same `>= 0` guard the legs get: a negative span is marks stamped out of
  // order, a fault rather than a fast turn (contract §3.2), and a fault must not
  // pull a percentile down.
  if (turn.caller_perceived_ms !== null && turn.caller_perceived_ms >= 0) {
    samples.perceived.push(turn.caller_perceived_ms);
  }
  if (turn.pipeline_ms !== null && turn.pipeline_ms >= 0) {
    samples.pipeline.push(turn.pipeline_ms);
  }
}

function legPercentiles(legs: Record<LegName, number[]>): Record<LegName, Percentiles> {
  const out = {} as Record<LegName, Percentiles>;
  for (const leg of LEGS) out[leg.name] = percentiles(legs[leg.name]);
  return out;
}

/** What a group's row is called. The whole-snapshot case is identified by its
 * differing keys, so the label only has to place it: the build SHA of the image
 * that answered those calls does that, and is in every snapshot (§3.4). */
function groupLabel(key: string, snapshot: Record<string, unknown> | null): string {
  if (key === UNKNOWN_GROUP) return UNKNOWN_GROUP;
  if (snapshot === null) return key;
  const sha = snapshot['FONNUS_BUILD_SHA'];
  return typeof sha === 'string' ? `FONNUS_BUILD_SHA ${shortSha(sha)}` : 'configuration';
}

/**
 * The buckets between the first and the last day, so a day the window holds no
 * turn for is a null point rather than a gap the trend line slopes straight
 * through — the thing `src/app/dashboard/trend.tsx` says a drawn-through gap
 * would misread as a measurement. A key is already `YYYY-MM-DD` in the clinic's
 * zone, so stepping it is calendar arithmetic on the label and no zone is
 * involved a second time.
 */
function fillDayGaps(days: DashboardDay[]): DashboardDay[] {
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) return days;

  const byDay = new Map(days.map((day) => [day.day, day]));
  const filled: DashboardDay[] = [];
  for (let at = dayMillis(first.day); at <= dayMillis(last.day); at += DAY_MS) {
    const day = new Date(at).toISOString().slice(0, 10);
    filled.push(byDay.get(day) ?? { day, turns: 0, perceivedP95: null, pipelineP95: null });
  }
  return filled;
}

/** A `YYYY-MM-DD` key as UTC midnight — a position on the calendar, not an instant. */
function dayMillis(day: string): number {
  const [year, month, date] = day.split('-');
  return Date.UTC(Number(year), Number(month) - 1, Number(date));
}

export function aggregate(
  calls: DashboardCall[],
  turns: DashboardTurn[],
  grouping: Grouping,
): Dashboard {
  const byId = new Map(calls.map((call) => [call.id, call]));

  const overall = blankSamples();
  const days = new Map<string, Samples>();
  const groups = new Map<string, { samples: Samples; snapshot: Record<string, unknown> | null }>();
  const withTurns = new Set<string>();
  const outside: DashboardTurn[] = [];

  for (const turn of turns) {
    const call = byId.get(turn.call_id);
    // The two result sets are read in one REPEATABLE READ transaction
    // (`dashboardSince`, `src/queries/dashboard.ts`), so they are the same
    // snapshot of the database and a turn whose call is missing is a broken
    // foreign key rather than a call that started between the two statements.
    // It is skipped rather than counted into a total it has no day for.
    if (call === undefined) continue;
    withTurns.add(call.id);
    collect(overall, turn);

    const day = dayKey(call.started_at);
    let dayS = days.get(day);
    if (dayS === undefined) {
      dayS = blankSamples();
      days.set(day, dayS);
    }
    collect(dayS, turn);

    // A turn without marks is in no number, so it does not bring a group into
    // existence either: an all-zero row would read as a group that was measured
    // and found empty.
    if (grouping !== 'none' && turn.marks !== null) {
      const key = groupKey(call, turn, grouping);
      let group = groups.get(key);
      if (group === undefined) {
        group = {
          samples: blankSamples(),
          snapshot: grouping === 'config' ? parseSnapshot(call.config_snapshot) : null,
        };
        groups.set(key, group);
      }
      collect(group.samples, turn);
    }

    // The reply never became audible: no `first_audio_out`, so neither headline
    // span exists and the turn is in no percentile at all.
    if (parseMarks(turn.marks).first_audio_out === undefined) outside.push(turn);
  }

  // Trap 1: an unconsented call has no `turn` rows, so every percentile above
  // stands on granted calls only. A call that has turns is counted as consented
  // whatever its outcome column says — the turns are on record either way.
  const consented = calls.filter(
    (call) => isConsentGranted(call.outcome) || withTurns.has(call.id),
  ).length;

  const rows: DashboardGroup[] = [...groups.entries()].map(([key, group]) => ({
    key,
    label: grouping === 'config' ? groupLabel(key, group.snapshot) : key,
    snapshot: group.snapshot,
    calls: group.samples.calls.size,
    turns: group.samples.turns,
    legs: legPercentiles(group.samples.legs),
    perceived: percentiles(group.samples.perceived),
    pipeline: percentiles(group.samples.pipeline),
  }));
  // Biggest sample first — the group a reading can actually be made from.
  rows.sort((a, b) => b.turns - a.turns || a.label.localeCompare(b.label));

  return {
    calls: calls.length,
    consentedCalls: consented,
    turns: overall.turns,
    turnsWithoutMarks: overall.turnsWithoutMarks,
    legs: legPercentiles(overall.legs),
    perceived: percentiles(overall.perceived),
    pipeline: percentiles(overall.pipeline),
    byDay: fillDayGaps(
      [...days.entries()]
        .map(([day, samples]) => ({
          day,
          turns: samples.turns,
          perceivedP95: percentiles(samples.perceived).p95,
          pipelineP95: percentiles(samples.pipeline).p95,
        }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    ),
    groups: rows,
    differingKeys:
      grouping === 'config' ? differingKeys(rows.map((row) => row.snapshot)) : [],
    outside,
  };
}
