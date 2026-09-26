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

import {
  CALL_TIME_ZONE,
  CALL_TIME_ZONE_OFFSET,
  formatDayShort,
  isConsentGranted,
  parseCostVnd,
  shortSha,
} from './calls';
import { FLAT_KEYS } from './configuration/flat-keys';
import { LEGS, PARTITION_LEGS, type LegName, legSpans, parseMarks } from './latency';
import type { DashboardCall, DashboardTurn } from './queries/dashboard';
import { type BucketUnit, type Window, bucketUnit, dayParts } from './window';

const DAY_MS = 86_400_000;

/*
 * The window moved to `src/window.ts` when Calls started reading the same one
 * (ADR 0006); it is re-exported here so the dashboard's own callers and tests
 * keep one import. New code takes it from `src/window.ts`.
 */
export {
  DEFAULT_SINCE,
  MAX_WINDOW_DAYS,
  WINDOW_PRESETS,
  bucketUnit,
  parseSince,
  parseWindow,
  windowHref,
} from './window';
export type { BucketUnit, Preset, Since, Window } from './window';

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

/**
 * `YYYY-MM-DD` in the clinic's zone — the bucket a call's `started_at` falls
 * in. A call answered at 23:30 UTC belongs to the next Vietnamese day, which is
 * why the day comes from `dayParts` and never from the process's zone.
 */
export function dayKey(date: Date): string {
  const { day, month, year } = dayParts(date);
  return `${year}-${month}-${day}`;
}

/**
 * A day bucket as the charts write it — `05-09` for the 5th of September, the
 * console's short day (`formatDayShort`), so an axis reads like every other
 * date on screen. The key is already a day in the clinic's zone, so it is read
 * as midnight at the clinic's offset and lands on the same day.
 */
export function dayLabel(day: string): string {
  return formatDayShort(new Date(`${day}T00:00:00${CALL_TIME_ZONE_OFFSET}`));
}

// The same formatter with the hour, for the `24h` window's columns. `h23` so
// midnight is `00` and not `24`, which is what the label row prints.
const HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

/** `YYYY-MM-DDTHH` in the clinic's zone — the hour bucket a `started_at` falls in. */
export function hourKey(date: Date): string {
  const parts = new Map<string, string>(HOUR.formatToParts(date).map((p) => [p.type, p.value]));
  const at = (type: string): string => parts.get(type) ?? '';
  return `${at('year')}-${at('month')}-${at('day')}T${at('hour')}`;
}

/**
 * The week bucket, named by its Monday in the clinic's zone (ISO weeks, the
 * pipeline's own convention nowhere but here — the console says "weeks start
 * Monday" on the card rather than leaving the reader to guess). The day key is
 * already a calendar position, so the walk back to Monday is calendar
 * arithmetic on it and no zone is involved a second time.
 */
export function weekKey(date: Date): string {
  const day = dayKey(date);
  const at = dayMillis(day);
  // `getUTCDay()` is 0 on Sunday; `(d + 6) % 7` makes Monday the 0th day.
  const back = (new Date(at).getUTCDay() + 6) % 7;
  return new Date(at - back * DAY_MS).toISOString().slice(0, 10);
}

/** The bucket a call's `started_at` belongs to, under the window's unit. */
export function bucketKey(unit: BucketUnit, date: Date): string {
  if (unit === 'hour') return hourKey(date);
  if (unit === 'week') return weekKey(date);
  return dayKey(date);
}

/** What a column is called under the axis: `07` · `05-09` · the Monday's `05-09`. */
export function bucketLabel(unit: BucketUnit, key: string): string {
  return unit === 'hour' ? key.slice(11, 13) : dayLabel(key.slice(0, 10));
}

/** One bucket key as a position on the calendar — UTC midnight of its clinic day. */
function bucketMillis(unit: BucketUnit, key: string): number {
  return unit === 'hour'
    ? dayMillis(key.slice(0, 10)) + Number(key.slice(11, 13)) * 3_600_000
    : dayMillis(key);
}

const STEP_MS: Record<BucketUnit, number> = {
  hour: 3_600_000,
  day: DAY_MS,
  week: 7 * DAY_MS,
};

/**
 * The clinic zone as a fixed offset in milliseconds. A bucket KEY is a
 * calendar position (`bucketMillis` puts it at UTC midnight of its clinic
 * day); the instant that position really starts at is seven hours earlier,
 * because Vietnam has run `+07:00` with no daylight saving since 1975 — the
 * same constant assumption `src/window.ts` makes when it resolves a date-only
 * bound, and the one `CALL_TIME_ZONE` is pinned against there.
 */
const ZONE_OFFSET_MS = offsetMs(CALL_TIME_ZONE_OFFSET);

/** `+07:00` → 25 200 000: the one zone constant, read as milliseconds. */
function offsetMs(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`not a UTC offset: ${offset}`);
  }
  const ms = (Number(match[2]) * 60 + Number(match[3])) * 60_000;
  return match[1] === '-' ? -ms : ms;
}

/** One column of a window chart: its key, what the axis calls it, and whether
 * the window covers only part of it. */
export interface WindowBucket {
  key: string;
  label: string;
  /**
   * The window starts or ends inside this bucket, so its bar stands on less
   * time than its neighbours'. A rolling preset always ends inside one (the
   * current hour or day "so far") and usually starts inside one, so the charts
   * fade the column and the card says so — a shorter bar for a reason the
   * reader cannot see is a wrong reading, not a small one.
   */
  partial: boolean;
}

/** The instant a bucket key really begins, in the clinic's zone. */
function bucketInstant(unit: BucketUnit, key: string): number {
  return bucketMillis(unit, key) - ZONE_OFFSET_MS;
}

/**
 * The columns of a window chart: every bucket the window touches, from `since`
 * to its last instant, in order — never "the first day with a call to the
 * last". An edge of the window nobody rang in is a column of zeros, which is
 * the answer the operator asked for; a walk over the data alone would have
 * drawn a shorter window than the one the control says is on screen.
 *
 * The upper bound is the window's last instant rather than `until`: `until` is
 * exclusive (00:00 of the day after the range on a date-only bound, ADR 0006),
 * so taking it as an instant would add one empty bucket past the range. That
 * same last instant decides the last column's `partial`, and `since` the
 * first's: an edge bucket the window only reaches into is marked, never
 * dropped, so the count of columns is the window's own count either way.
 */
export function windowBuckets(window: Window, now: Date, unit: BucketUnit): WindowBucket[] {
  const last = window.until === null ? now : new Date(window.until.getTime() - 1);
  const end = bucketMillis(unit, bucketKey(unit, last));
  const step = STEP_MS[unit];

  const buckets: WindowBucket[] = [];
  for (let at = bucketMillis(unit, bucketKey(unit, window.since)); at <= end; at += step) {
    const key =
      unit === 'hour'
        ? `${new Date(at).toISOString().slice(0, 10)}T${new Date(at).toISOString().slice(11, 13)}`
        : new Date(at).toISOString().slice(0, 10);
    buckets.push({ key, label: bucketLabel(unit, key), partial: false });
  }

  const first = buckets[0];
  const final = buckets[buckets.length - 1];
  if (first !== undefined && window.since.getTime() > bucketInstant(unit, first.key)) {
    first.partial = true;
  }
  // The bucket is covered to its end only when the window's last instant
  // reaches the last millisecond of it; an open-ended window ends at `now`, so
  // its last column is the current hour, day or week so far.
  if (final !== undefined && last.getTime() < bucketInstant(unit, final.key) + step - 1) {
    final.partial = true;
  }
  return buckets;
}

/**
 * The column a key belongs to when the key is not one of them. The open-ended
 * preset's SQL has no upper bound, so a call whose `started_at` is past `now` —
 * a clock that ran ahead on the pipeline's box — has a key past the last
 * column and used to vanish from both charts while the "Calls" figure still
 * counted it. It is folded into the edge it ran off instead. Keys are
 * `YYYY-MM-DD` or `YYYY-MM-DDTHH`, so string order is time order within one
 * unit. Null only when the window has no columns at all.
 */
export function foldKey(key: string, keys: string[]): string | null {
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) return null;
  if (key <= first) return first;
  if (key >= last) return last;
  // Between the edges every key of the unit is already a column; the scan is
  // the answer if one ever is not.
  let at = first;
  for (const candidate of keys) if (candidate <= key) at = candidate;
  return at;
}

/**
 * The ways the numbers can be split. `config` is the contract's "group on the
 * whole object" (§3.4, jsonb equality is structural); `key:<K>` is its "group on
 * one key". The model groupings read the columns, which are the ids the call
 * actually ran on — under `PROVIDERS=fake` those differ from the snapshot's
 * model keys (trap 6). `voice` is the effective voice id (`voiceIdOf`).
 */
export const GROUPINGS = ['none', 'llm_model', 'stt_model', 'tts_model', 'config', 'voice'] as const;

export type Grouping = (typeof GROUPINGS)[number] | `key:${string}`;

/**
 * The grouping the screen opens on (ADR 0009): `llm_ttft` is the only leg a
 * model change moves, and the model is the change the hypothesis loop makes
 * most often.
 */
export const DEFAULT_GROUPING: Grouping = 'key:OPENROUTER_MODEL';

/**
 * The one dotted `key:` the vocabulary allows — `config_snapshot->'runtime'->>'version'`,
 * the `runtime_config.id` the call ran under (ADR 0009 decision 2). Every other
 * `key:` names a top-level key, and a dot in one of those is a key with a dot,
 * never a path.
 */
export const RUNTIME_VERSION_KEY = 'runtime.version';

/**
 * The 2026-09-17 rename (contract §3.4, ADR 0024): three Deepgram frame timings
 * lost their `STT_` spelling. Rows written before that deploy carry the old
 * name, so both spellings resolve to one value and one column — the contract's
 * own COALESCE instruction. Deleted when the old rows have aged out (ADR 0009).
 */
export const KEY_ALIASES: Record<string, string> = {
  DEEPGRAM_ENDPOINTING_MS: 'STT_ENDPOINTING_MS',
  DEEPGRAM_UTTERANCE_END_MS: 'STT_UTTERANCE_END_MS',
  DEEPGRAM_TURN_TRIGGER: 'STT_TURN_TRIGGER',
};

/** The new spelling of a key, whichever of the two was asked for. */
export function canonicalKey(key: string): string {
  if (Object.hasOwn(KEY_ALIASES, key)) return key;
  const renamed = Object.entries(KEY_ALIASES).find(([, old]) => old === key);
  return renamed === undefined ? key : renamed[0];
}

/** The query string is untrusted; anything the list does not name is the default. */
export function parseGroup(raw: string | undefined): Grouping {
  if (raw === undefined) return DEFAULT_GROUPING;
  if ((GROUPINGS as readonly string[]).includes(raw)) return raw as Grouping;
  if (raw.startsWith('key:') && raw.length > 'key:'.length) return raw as Grouping;
  return DEFAULT_GROUPING;
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

/** `config_snapshot->'faq'` (contract §3.4): never a grouping identity, never a column. */
const SNAPSHOT_FAQ_KEY = 'faq';

/**
 * A snapshot's identity as a string — "this exact configuration" (§3.4, where
 * the grouping is jsonb equality, which is structural). Sorted at every level
 * so two processes that booted the same configuration land in one group
 * whatever order Postgres handed the object over in, and so that two calls on
 * one build SHA with different `runtime.config` land in two.
 *
 * The top-level `faq` key is left out (contract §3.4, pipeline ADR 0031): it is
 * the tenant's FAQ entries as read, about 8 KB per call, and an edit to one
 * answer's wording must not split an otherwise identical configuration.
 */
function snapshotIdentity(snapshot: Record<string, unknown>): string {
  return canonicalJson(
    Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== SNAPSHOT_FAQ_KEY)),
  );
}

/**
 * One snapshot key's value, under either spelling of a renamed key. Own keys
 * only, for the reason `groupKey` gives: a key from the query string can name a
 * prototype property, and a prototype property is not a snapshot value.
 * `undefined` is "the snapshot does not carry this key", which is a different
 * fact from a stored `null` (§3.4).
 */
function lookup(snapshot: Record<string, unknown>, key: string): unknown {
  const canonical = canonicalKey(key);
  if (Object.hasOwn(snapshot, canonical)) return snapshot[canonical];
  const old = KEY_ALIASES[canonical];
  if (old !== undefined && Object.hasOwn(snapshot, old)) return snapshot[old];
  return undefined;
}

/**
 * The `runtime_config` row the call ran under — `runtime.version`, the only
 * nested value this console reads (ADR 0009). Absent on a call that ran on boot
 * configuration, and on one whose row was refused.
 */
function runtimeVersion(snapshot: Record<string, unknown>): unknown {
  const runtime = snapshot['runtime'];
  if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) return undefined;
  const object = runtime as Record<string, unknown>;
  return Object.hasOwn(object, 'version') ? object['version'] : undefined;
}

/**
 * The voice id the call's speech ran on, and the key it was read from — the
 * one rule the Overview's `voice` grouping and the call detail's voice
 * (`voiceFact`) share (docs/upstream.md §Overview). The snapshot's own
 * `TTS_PROVIDER` picks the key through the per-vendor table
 * (`FLAT_KEYS['tts.voice']`, copied from the pipeline's `RUNTIME_KEY_MAP`),
 * and then only that key is read: a snapshot carries the voice key of its own
 * vendor only (contract §3.4, pipeline ADR 0029), so another vendor's key is
 * never read in its place. A snapshot that names no known vendor takes
 * whichever per-vendor key is present. Own keys only, non-empty string ids
 * only; null when there is none. The id is the identity, never its
 * `boot_report` label: a label can change between boots.
 */
export function voiceIdOf(snapshot: Record<string, unknown>): { key: string; id: string } | null {
  const byVendor = FLAT_KEYS['tts.voice'];
  if (typeof byVendor !== 'object') return null;
  const vendor = Object.hasOwn(snapshot, 'TTS_PROVIDER') ? snapshot['TTS_PROVIDER'] : undefined;
  const keys =
    typeof vendor === 'string' && Object.hasOwn(byVendor, vendor)
      ? [byVendor[vendor]]
      : Object.values(byVendor);
  for (const key of keys) {
    if (key === undefined || !Object.hasOwn(snapshot, key)) continue;
    const id = snapshot[key];
    if (typeof id === 'string' && id !== '') return { key, id };
  }
  return null;
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
  if (grouping === 'voice') return voiceIdOf(snapshot)?.id ?? UNKNOWN_GROUP;
  const key = grouping.slice('key:'.length);
  // The key comes from the query string, so it can name a prototype property:
  // `key:__proto__` would otherwise fold every call into one group and
  // `key:constructor` into a group named after a function. `lookup` reads own
  // keys only; anything else is no answer, which is the unknown group.
  const value = key === RUNTIME_VERSION_KEY ? runtimeVersion(snapshot) : lookup(snapshot, key);
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
  for (const snapshot of present) {
    // `runtime` is never a column of its own (ADR 0009 decision 1): a cell
    // holding the whole document is unreadable, and it always differs when the
    // version does — which the derived column below says in one number. The
    // renamed keys fold onto their new spelling, so a deploy that straddles the
    // rename shows one column, not two. `faq` is left out for the reason
    // `snapshotIdentity` gives, and because a cell of 8 KB is unreadable.
    for (const key of Object.keys(snapshot)) {
      if (key !== 'runtime' && key !== SNAPSHOT_FAQ_KEY) keys.add(canonicalKey(key));
    }
  }
  const differing: string[] = [];
  for (const key of keys) {
    // An absent key and a null one are two values, as `snapshotValue` and
    // `snapshotIdentity` already hold — hashing both to `null` would let two
    // groups differ by a key this column never names.
    const rendered = new Set(
      present.map((s) => {
        const value = lookup(s, key);
        return value === undefined ? 'absent' : canonicalJson(value);
      }),
    );
    if (rendered.size > 1) differing.push(key);
  }
  differing.sort();

  // The one derived column, last: what the flat keys cannot show is "a new
  // runtime_config row that changed nothing effective" (ADR 0009 §Why).
  const versions = new Set(
    present.map((s) => {
      const version = runtimeVersion(s);
      return version === undefined ? 'absent' : canonicalJson(version);
    }),
  );
  if (versions.size > 1) differing.push(RUNTIME_VERSION_KEY);
  return differing;
}

/**
 * The LLM model a call was configured with — its snapshot's `OPENROUTER_MODEL`,
 * own key only — for the Overview's unpriced models (ADR 0015 decision 7): a
 * call with no turn rows (trap 1) still paid for its LLM. Null when the
 * snapshot is missing or the key is absent or not a non-empty string.
 */
export function configuredLlmOf(configSnapshot: unknown): string | null {
  const snapshot = parseSnapshot(configSnapshot);
  const model = snapshot === null ? undefined : lookup(snapshot, 'OPENROUTER_MODEL');
  return typeof model === 'string' && model !== '' ? model : null;
}

/**
 * The router model a call was billed for, if the router ran on it — its
 * snapshot's `TYPESAFE_MODEL` when `ROUTER_MODE` says it ran (contract §3.4:
 * both keys are always present from ADR 0032 on, so the mode is what says
 * whether the router ran). Trap 3 prices each router decision into
 * `total_cost_vnd`, so an unpriced router model makes the total a floor just as
 * an unpriced LLM does. Null on `off`, on a snapshot older than the router, and
 * on an empty or non-string model (`''` under `PROVIDERS=fake`).
 *
 * The router also needs at least one FAQ entry to run, and a shadow call with
 * none never asked it; naming its model then errs toward "floor", the visible
 * side (ADR 0015 D7).
 */
export function configuredRouterOf(configSnapshot: unknown): string | null {
  const snapshot = parseSnapshot(configSnapshot);
  if (snapshot === null) return null;
  const mode = lookup(snapshot, 'ROUTER_MODE');
  if (typeof mode !== 'string' || mode === 'off') return null;
  const model = lookup(snapshot, 'TYPESAFE_MODEL');
  return typeof model === 'string' && model !== '' ? model : null;
}

/** How a snapshot value reads in a cell; an absent key is not a null one (§3.4). */
export function snapshotValue(snapshot: Record<string, unknown> | null, key: string): string {
  if (snapshot === null) return UNKNOWN_GROUP;
  // Own keys only, for the reason `groupKey` gives: a prototype property is not
  // a snapshot value, it is an absent key.
  const value = key === RUNTIME_VERSION_KEY ? runtimeVersion(snapshot) : lookup(snapshot, key);
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

/** One column of the latency chart. A null P95 is "not measured", never "fast". */
export interface DashboardLatencyBucket {
  key: string;
  label: string;
  /** The window covers only part of this bucket — the chart fades it (`WindowBucket`). */
  partial: boolean;
  turns: number;
  perceivedP95: number | null;
  pipelineP95: number | null;
}

/** Calls answered in one bucket of the window, split by trap 1's dividing line. */
export interface DashboardCallBucket {
  key: string;
  label: string;
  /** The window covers only part of this bucket — the chart fades it (`WindowBucket`). */
  partial: boolean;
  consented: number;
  notConsented: number;
}

/** One value of a fixed vocabulary (§3.1) and the calls that carry it. */
export interface VocabularyCount {
  value: string;
  calls: number;
}

/** Turns that failed, by the pair the contract identifies a failure with. */
export interface TurnFailure {
  leg: string;
  /** Null under a set leg is a provider error, not a missing measurement (§3.1). */
  stage: string | null;
  turns: number;
}

/** One partition leg's P50 — the composition of a median reply. */
export interface LegMedian {
  leg: string;
  p50: number | null;
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
  /** The unit the two window charts are drawn in, decided by the window alone. */
  bucketUnit: BucketUnit;
  latencyByBucket: DashboardLatencyBucket[];
  /** Every call of the window by bucket, consented or not — not only the measured ones. */
  callsByBucket: DashboardCallBucket[];
  /**
   * The window's cost, a FLOOR while any model the calls ran on has no price
   * row (trap 3). Null when not one call carried a parseable figure.
   */
  costFloorVnd: number | null;
  /** Calls whose `total_cost_vnd` was null or unparseable — missing, never 0. */
  unpricedCalls: number;
  /** `end_reason` over the calls that reached finalize, biggest first. */
  endReasons: VocabularyCount[];
  /** Calls with no `consent_record` row — a state of the call, never a refusal (trap 2). */
  notFinalized: number;
  /** `consent_record.outcome` over the calls that have a row, biggest first. */
  outcomes: VocabularyCount[];
  /** The same calls as `notFinalized`, said beside the outcomes: no row yet. */
  noRow: number;
  /** Turns with marks that failed, by `failed_leg · failed_stage`, biggest first. */
  turnFailures: TurnFailure[];
  /** How many turns with marks carry a `failed_leg` at all (trap 7's one test). */
  failedTurns: number;
  /** The four partition legs' P50s, in the order a turn passes through them. */
  medianReply: LegMedian[];
  /**
   * Turns with marks that carry `holding_line_out` (ADR 0030): on those the
   * caller heard a holding line before the answer, so `medianReply` — the
   * answer's four legs — is not their `caller_perceived_ms`.
   */
  holdingLineTurns: number;
  groups: DashboardGroup[];
  /** Only ever filled when grouping on the whole snapshot. */
  differingKeys: string[];
  outside: OutsideTurn[];
}

/** A turn whose answer never became audible, and whether a holding line played on it. */
export interface OutsideTurn extends DashboardTurn {
  /** The turn carries `holding_line_out`: the caller heard the line, never the answer. */
  holdingLine: boolean;
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

/** A distribution as rows, biggest first, ties by value so the order is stable. */
function counted(counts: Map<string, number>): VocabularyCount[] {
  return [...counts.entries()]
    .map(([value, calls]) => ({ value, calls }))
    .sort((a, b) => b.calls - a.calls || a.value.localeCompare(b.value));
}

/** A `YYYY-MM-DD` key as UTC midnight — a position on the calendar, not an instant. */
function dayMillis(day: string): number {
  const [year, month, date] = day.split('-');
  return Date.UTC(Number(year), Number(month) - 1, Number(date));
}

/**
 * Everything the Overview renders, from one window's calls and turns.
 *
 * `window` and `now` are here for the charts alone: the columns are the
 * window's own buckets, so an edge nobody rang in is drawn (`windowBuckets`).
 * `now` is passed in rather than read from the clock so the screen and its
 * tests agree on where an open-ended window ends.
 */
export function aggregate(
  calls: DashboardCall[],
  turns: DashboardTurn[],
  grouping: Grouping,
  window: Window,
  now: Date,
): Dashboard {
  const byId = new Map(calls.map((call) => [call.id, call]));
  const unit = bucketUnit(window, now);
  const buckets = windowBuckets(window, now, unit);

  const bucketKeys = buckets.map((bucket) => bucket.key);

  const overall = blankSamples();
  const latencyBuckets = new Map<string, Samples>();
  const groups = new Map<string, { samples: Samples; snapshot: Record<string, unknown> | null }>();
  const withTurns = new Set<string>();
  const outside: OutsideTurn[] = [];
  let holdingLineTurns = 0;
  const failures = new Map<string, TurnFailure>();
  let failedTurns = 0;

  for (const turn of turns) {
    const call = byId.get(turn.call_id);
    // The two result sets are read in one REPEATABLE READ transaction
    // (`dashboardWindow`, `src/queries/dashboard.ts`), so they are the same
    // snapshot of the database and a turn whose call is missing is a broken
    // foreign key rather than a call that started between the two statements.
    // It is skipped rather than counted into a total it has no day for.
    if (call === undefined) continue;
    withTurns.add(call.id);
    collect(overall, turn);

    // Folded onto a column rather than filed under a key of its own: a key
    // outside the window's columns would be drawn nowhere at all.
    const bucket = foldKey(bucketKey(unit, call.started_at), bucketKeys);
    if (bucket !== null) {
      let bucketS = latencyBuckets.get(bucket);
      if (bucketS === undefined) {
        bucketS = blankSamples();
        latencyBuckets.set(bucket, bucketS);
      }
      collect(bucketS, turn);
    }

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

    // `failed_leg IS NOT NULL` is the one test for a failed turn (trap 7);
    // `interrupted` alone does not separate a barge-in from a mid-reply
    // failure. Counted over turns with marks, the same population every other
    // number on the screen stands on, so the share reads against `turns`.
    if (turn.marks !== null && turn.failed_leg !== null) {
      failedTurns += 1;
      // A null stage under a set leg is a provider error (§3.1) — kept null
      // here and named on screen, so the two are never one bucket.
      const key = `${turn.failed_leg}\u0000${turn.failed_stage ?? ''}`;
      const failure = failures.get(key);
      if (failure === undefined) {
        failures.set(key, { leg: turn.failed_leg, stage: turn.failed_stage, turns: 1 });
      } else {
        failure.turns += 1;
      }
    }

    // The answer never became audible: no `first_audio_out`, so `pipeline_ms`
    // does not exist. A turn that spoke a holding line still has a
    // `caller_perceived_ms` (it ends at the line, contract §3 `turn`, ADR 0030)
    // and is inside that percentile; it is listed here all the same, because
    // the answer is what never arrived, and the row says the line played.
    const marks = parseMarks(turn.marks);
    const holdingLine = marks.holding_line_out !== undefined;
    if (turn.marks !== null && holdingLine) holdingLineTurns += 1;
    if (marks.first_audio_out === undefined) outside.push({ ...turn, holdingLine });
  }

  // The window's calls, read once for everything that is a fact about calls
  // rather than about turns: the day split, the cost floor, and the two
  // distributions. An unconsented call has no turn row and is in all of them.
  const callBuckets = new Map<string, { consented: number; notConsented: number }>();
  const endReasons = new Map<string, number>();
  const outcomes = new Map<string, number>();
  let costFloorVnd: number | null = null;
  let unpricedCalls = 0;
  let notFinalized = 0;

  for (const call of calls) {
    // The same fold the latency walk makes, so the columns of the calls chart
    // total to the "Calls" figure beside them.
    const key = foldKey(bucketKey(unit, call.started_at), bucketKeys);
    if (key !== null) {
      let bucket = callBuckets.get(key);
      if (bucket === undefined) {
        bucket = { consented: 0, notConsented: 0 };
        callBuckets.set(key, bucket);
      }
      if (isConsentGranted(call.outcome)) bucket.consented += 1;
      else bucket.notConsented += 1;
    }

    // Trap 3: `numeric` arrives as a string, an unparseable one is missing
    // rather than 0 — a real 0 already means "nothing on this call could be
    // priced", and adding a missing figure as 0 would hide that it is missing.
    const cost = parseCostVnd(call.total_cost_vnd);
    if (cost === null) unpricedCalls += 1;
    else costFloorVnd = (costFloorVnd ?? 0) + cost;

    // Trap 2: no `consent_record` row is a state of the call — in progress, or
    // the process died — and never a refusal, so it sits beside both
    // distributions rather than inside either.
    if (call.outcome === null) notFinalized += 1;
    else {
      outcomes.set(call.outcome, (outcomes.get(call.outcome) ?? 0) + 1);
      if (call.end_reason !== null) {
        endReasons.set(call.end_reason, (endReasons.get(call.end_reason) ?? 0) + 1);
      }
    }
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

  const legs = legPercentiles(overall.legs);

  return {
    calls: calls.length,
    consentedCalls: consented,
    turns: overall.turns,
    turnsWithoutMarks: overall.turnsWithoutMarks,
    legs,
    perceived: percentiles(overall.perceived),
    pipeline: percentiles(overall.pipeline),
    bucketUnit: unit,
    // The window's own columns, in order, each filled from what landed in it.
    // A bucket with no turn is a null P95 — not measured, never a fast bucket —
    // while a bucket with no call is a zero on the calls chart: nobody rang is
    // a measurement. That difference is the only one between the two walks.
    latencyByBucket: buckets.map(({ key, label, partial }) => {
      const samples = latencyBuckets.get(key);
      return {
        key,
        label,
        partial,
        turns: samples?.turns ?? 0,
        perceivedP95: samples === undefined ? null : percentiles(samples.perceived).p95,
        pipelineP95: samples === undefined ? null : percentiles(samples.pipeline).p95,
      };
    }),
    callsByBucket: buckets.map(({ key, label, partial }) => ({
      key,
      label,
      partial,
      consented: callBuckets.get(key)?.consented ?? 0,
      notConsented: callBuckets.get(key)?.notConsented ?? 0,
    })),
    costFloorVnd,
    unpricedCalls,
    endReasons: counted(endReasons),
    notFinalized,
    outcomes: counted(outcomes),
    noRow: notFinalized,
    turnFailures: [...failures.values()].sort(
      (a, b) => b.turns - a.turns || a.leg.localeCompare(b.leg),
    ),
    failedTurns,
    // The composition of a median reply: the four legs that tile
    // `caller_perceived_ms` exactly (`src/latency.ts` PARTITION_LEGS), laid end
    // to end. P50s do not add up to the P50 of the whole — said on the card.
    medianReply: PARTITION_LEGS.map((leg) => ({ leg, p50: legs[leg].p50 })),
    holdingLineTurns,
    groups: rows,
    differingKeys:
      grouping === 'config' ? differingKeys(rows.map((row) => row.snapshot)) : [],
    outside,
  };
}
