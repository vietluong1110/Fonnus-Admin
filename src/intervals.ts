/**
 * The call timeline: the trail verdict and the intervals of the recording clock
 * (PLAN row A1b, ADR 0010). A **copy**, function by function, of the pipeline's
 * own reader `../Fonnus/tools/call-evidence.ts` — the one runnable enforcer of
 * `../Fonnus/docs/read-contract.md` §8 — with the source line cited at each
 * copied rule; never imported across repos (pipeline ADR 0013), never
 * re-expressed in SQL. The tests port the reference's own cases, so a rule that
 * drifts from the pipeline's fails here rather than on screen.
 *
 * Two departures from the reference, both ADR 0010's:
 *
 *  - offsets are milliseconds on the recording clock, not seconds, and a
 *    negative one is kept rather than clamped (`call-evidence.ts:622-624`); the
 *    cells print seconds with the reference's own `toFixed(2)` so a card and an
 *    `intervals.txt` of the same call read the same;
 *  - an `Interval` carries facts and never caller text. Text is resolved once,
 *    in `intervalCells`, through the single gate `showCallerData` (ADR 0005);
 *    the derivation has nothing to leak.
 *
 * This module is pure: no Next.js, no React, no database.
 */
import { annotationCellItems, currentAnnotations, type AnnotationCellItem } from '@/annotations';
import { isConsentGranted, showCallerData } from '@/calls';
import type { ConsentGate } from '@/config';
import { EMPTY_CELL, EXPIRED, WITHHELD, seconds } from '@/interval-lane';
import type { AnnotationRow, CallEventRow } from '@/queries/calls';

// ── the trail: rows as this module reads them ───────────────────────────

/** One `call_event` row, past the trust boundary below. */
export interface EventRow {
  seq: number;
  ts: Date;
  kind: string;
  type: string;
  gen: number | null;
  turnIdx: number | null;
  phase: string | null;
  sensitive: boolean;
  data: Record<string, unknown> | null;
}

/**
 * The jsonb trust boundary, in the shape of `parseMarks` in `src/latency.ts`: a
 * row whose identity columns are not what the contract promises is not read at
 * all, and a `data` that is not a plain object is dropped to null — a payload
 * key of the wrong shape is treated as absent, never thrown on. The caller
 * drops a null row; nothing here throws on a malformed one, because the row set
 * grows additively (§3.1) and a database this reader cannot parse is still a
 * screen it must render.
 */
export function parseEventRow(value: unknown): EventRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Partial<CallEventRow>;
  const { seq, ts, kind, type } = row;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return null;
  if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) return null;
  if (typeof kind !== 'string' || typeof type !== 'string') return null;
  return {
    seq,
    ts,
    kind,
    type,
    gen: typeof row.gen === 'number' ? row.gen : null,
    turnIdx: typeof row.turn_idx === 'number' ? row.turn_idx : null,
    phase: typeof row.phase === 'string' ? row.phase : null,
    sensitive: row.sensitive === true,
    // `fields` in the reference (`call-evidence.ts:1036-1038`): a payload that
    // is not an object has no fields to read by name.
    data:
      typeof row.data === 'object' && row.data !== null && !Array.isArray(row.data)
        ? (row.data as Record<string, unknown>)
        : null,
  };
}

/** A record's payload as fields to read by name (`call-evidence.ts:1036-1038`). */
function fields(data: Record<string, unknown> | null): Record<string, unknown> {
  return data ?? {};
}

// ── the verdict: how much of the trail is there ─────────────────────────

export type TrailVerdictKind = 'complete' | 'open' | 'truncated' | 'gap' | 'absent';

export interface TrailVerdict {
  kind: TrailVerdictKind;
  /** The verdict and what it costs the reader, in one paragraph. */
  text: string;
  /**
   * Where the hole starts, on a `gap` the terminal record can name — the
   * earlier of the recorder's and the mirror's when both apply. Null on every
   * other verdict and on the `count(*) ≠ max(seq)` gap, which knows only that
   * writes are missing, not where.
   */
  holeFromSeq: number | null;
  /** `count(*)` of the trail, taken from the array (ADR 0010 decision 2). */
  records: number;
}

/**
 * Copied from `call-evidence.ts:389-476`. The verdict is a state of the trail,
 * never an error: a running call is `open` by design, and `complete` needs both
 * halves — the `recorder/finalized` record AND `count(*) = max(seq)` — because
 * the mirror latches off after its first failed insert, so the rows that are
 * there stay contiguous and the count still matches (trap 8).
 */
export function trailVerdict(
  rows: EventRow[],
  call: { recordCalls: string | null; ended: boolean },
): TrailVerdict {
  if (rows.length === 0) {
    return {
      kind: 'absent',
      text:
        `absent — this call has no call_event rows. Four causes (read-contract trap 8): ` +
        `RECORD_CALLS=off, so there was no recorder (config_snapshot.RECORD_CALLS = ` +
        `${call.recordCalls ?? 'not in the snapshot'}); the mirror failed for this call; ` +
        `events.jsonl could never be opened on the box, so no line was ever minted; ` +
        `or the call never reached consent and never finalized.`,
      holeFromSeq: null,
      records: 0,
    };
  }
  const count = rows.length;
  const maxSeq = rows.reduce((max, r) => Math.max(max, r.seq), 0);
  const terminal = rows.find((r) => r.kind === 'recorder' && r.type === 'finalized');
  const finalized = terminal !== undefined;
  const arithmetic = `(count(*) = ${String(count)}, max(seq) = ${String(maxSeq)}.)`;
  if (!finalized && !call.ended) {
    return {
      kind: 'open',
      text:
        `open — ${String(count)} record(s), no recorder/finalized record, and call_log.ended_at ` +
        `is null: the call has not finalized. This is NOT evidence of a mirror failure — the ` +
        `record is written at finalize and is not due yet. The call is still running, or it died ` +
        `before finalize; read what is here as a partial trail. ` +
        arithmetic,
      holeFromSeq: null,
      records: count,
    };
  }
  if (!finalized) {
    return {
      kind: 'truncated',
      text:
        `truncated — ${String(count)} record(s), no recorder/finalized record. The mirror latches ` +
        `off after its first failed insert and drops every later row of the call silently, and it ` +
        `makes one last attempt to write the terminal record anyway — so a call that ended without ` +
        `one is a mirror that latched AND an attempt that failed too, or a recorder that never ` +
        `finalized at all. What is missing cannot be read off the trail either way: the absence of ` +
        `a record here is NOT evidence that it did not happen. ` +
        `(count(*) = ${String(count)}, max(seq) = ${String(maxSeq)} — the count check passes on a ` +
        `truncated trail, which is why it is not the test.)`,
      holeFromSeq: null,
      records: count,
    };
  }
  // Both halves of the trail can be holed at once — a disk that died and a
  // database that died — and a reader told about one and not the other reads
  // the rest of the trail as evidence it is not.
  const holes: string[] = [];
  const holeSeqs: number[] = [];
  if (recorderFailed(terminal)) {
    holeSeqs.push(maxSeq - 1);
    holes.push(
      `the recorder itself failed and stopped writing after seq ${String(maxSeq - 1)}, the last ` +
        `record before recorder/finalized: what is here is every record it minted a seq for ` +
        `before the latch and nothing after — records already queued behind the failing write ` +
        `were dropped without a seq, so the latch fell somewhere after that record's ts, not at ` +
        `it, and whatever the call did past that record reached neither the file nor the table ` +
        `(recorder/finalized says failed: true; read-contract trap 8).`,
    );
  }
  const mirror = mirrorVerdict(terminal);
  if (mirror !== null && mirror.dropped > 0) {
    if (mirror.fromSeq !== null) holeSeqs.push(mirror.fromSeq);
    holes.push(
      `${String(mirror.dropped)} row(s) the mirror could not write, from seq ` +
        `${mirror.fromSeq === null ? 'unknown' : String(mirror.fromSeq)}; the terminal record ` +
        `landed on the mirror's one last attempt, so the hole's start is known ` +
        `(read-contract trap 8).`,
    );
  }
  if (holes.length > 0) {
    return {
      kind: 'gap',
      text: `gap — ${holes.join(' ')} ${arithmetic}`,
      // The earliest hole wins: every interval after it is unsupported (§8
      // rule 7), and the earlier of two holes is the earlier loss of evidence.
      holeFromSeq: holeSeqs.length === 0 ? null : Math.min(...holeSeqs),
      records: count,
    };
  }
  if (count !== maxSeq) {
    return {
      kind: 'gap',
      text:
        `gap — recorder/finalized is there, but count(*) = ${String(count)} against ` +
        `max(seq) = ${String(maxSeq)}: ${String(maxSeq - count)} lost write(s) somewhere in the ` +
        `middle. Read the seq column for the holes.`,
      holeFromSeq: null,
      records: count,
    };
  }
  return {
    kind: 'complete',
    text:
      `complete — ${String(count)} record(s), recorder/finalized present, ` +
      `count(*) = max(seq) = ${String(maxSeq)}.`,
    holeFromSeq: null,
    records: count,
  };
}

/**
 * What the terminal record says about the recorder that minted it: whether its
 * disk latched off mid-call (`call-evidence.ts:486-489`). Where the hole starts
 * needs no field — nothing is routed after the latch, and the terminal record
 * is the last one of the trail, so the record before it is the last real one.
 */
function recorderFailed(terminal: EventRow | undefined): boolean {
  if (terminal === undefined) return false;
  return fields(terminal.data)['failed'] === true;
}

/**
 * What the terminal record says about the mirror that wrote it: how many rows
 * it could not write and where the hole starts (`call-evidence.ts:497-505`).
 * Null — absent — on a call recorded before the record carried the key and on
 * one that ran under no mirror, and absent is not zero: it is "this trail
 * cannot say", so a `finalized` record with no `mirror` key is no gap on that
 * ground.
 */
function mirrorVerdict(terminal: EventRow | undefined): { dropped: number; fromSeq: number | null } | null {
  if (terminal === undefined) return null;
  const mirror = fields(terminal.data)['mirror'];
  if (typeof mirror !== 'object' || mirror === null) return null;
  const dropped = (mirror as Record<string, unknown>)['dropped'];
  const fromSeq = (mirror as Record<string, unknown>)['fromSeq'];
  if (typeof dropped !== 'number') return null;
  return { dropped, fromSeq: typeof fromSeq === 'number' ? fromSeq : null };
}

// ── the intervals: the whole recording clock, accounted for ─────────────

/** Who held the line (`../Fonnus/docs/console-call-view.md` holder vocabulary). */
export type HolderKind = 'greeting' | 'canned' | 'waiting' | 'reply' | 'caller' | 'silence' | 'deaf';

/** Every holder kind, in the order a legend lists them. */
export const HOLDER_KINDS = [
  'greeting',
  'canned',
  'waiting',
  'reply',
  'caller',
  'silence',
  'deaf',
] as const satisfies readonly HolderKind[];

export interface Holder {
  kind: HolderKind;
  /** The pipeline's own string: `bot: reply 3`, `bot: farewell`, `caller`, `silence`, `deaf`. */
  label: string;
  turnIdx: number | null;
  gen: number | null;
  /** Whether the bot span had an `event/first_audible`; null off a bot span. */
  audible: boolean | null;
}

/**
 * A pointer at one recogniser record — which record, and whether it is
 * `sensitive`. It carries NO text: the whole point of ADR 0010 decision 5 is
 * that this module cannot leak what it never holds. `intervalCells` resolves
 * it through the one consent gate, reading the payload only there.
 */
export interface TextRef {
  seq: number;
  sensitive: boolean;
}

/** One interval of the recording clock, `[fromMs, toMs)`. */
export interface Interval {
  /** `ts − recording_started_at` in ms, NOT clamped at 0 (ADR 0010 decision 4). */
  fromMs: number;
  toMs: number;
  holder: Holder;
  /** `event/caller_energy` instants inside the interval, on the same clock. */
  energyMs: number[];
  /** Any of those instants fell in a stretch the feed to the recogniser was muted. */
  unheard: boolean;
  finals: TextRef[];
  /** The partial no final ever replaced before the bot spoke again. */
  overtaken: TextRef[];
  /** `event/turn_end` runs, by `data.source` verbatim — empty when the recogniser produced words. */
  signalRuns: { source: string | null; count: number }[];
  /** An `event/timer_fired` with `data.id = 'no_input'`. */
  watchdog: boolean;
  /** The interval starts at or after the trail's hole — §8 rule 7. */
  unsupported: boolean;
}

/** A record with its place on the recording clock and its `{kind, type}` joined. */
interface Placed {
  r: EventRow;
  t: number;
  key: string;
}

/** An interval before its holder is decided — a bot span knows its own. */
interface Span {
  from: number;
  to: number;
  /** Null on a stretch whose holder the records inside it decide. */
  holder: Holder | null;
  deaf: boolean;
}

/** A stretch of the recording clock, `[from, to)` in ms. */
interface Stretch {
  from: number;
  to: number;
}

/**
 * The three records that open a bot interval, all of them carrying `gen`: the
 * greeting (`speak_text`), a canned line, and a committed turn — only the third
 * has a `turn` row (`call-evidence.ts:555`).
 */
const INTENTS = new Set(['effect/speak_text', 'effect/speak_canned', 'effect/start_reply']);

/** Evidence a stretch was the caller's rather than silence (`:558-563`). */
const HEARD = new Set([
  'event/caller_energy',
  'event/stt_partial',
  'event/stt_final',
  'event/turn_end',
]);

/** More instants than a reader takes in one glance collapse to a count (`:569`). */
const ENERGY_SHOWN = 6;
/**
 * A payload that is there but carries no `text` — the ASSUMED key was not
 * found (`docs/upstream.md` §The call timeline). Trap 10 is about a null
 * payload only, so this is named as its own thing rather than read as the TTL.
 */
const NO_TEXT = '[no text in payload]';

/**
 * The call's recording clock as intervals — contiguous, non-overlapping, from
 * the first record to `recorder/finalized` (or to the last record when there is
 * none). Copied from `call-evidence.ts:610-665`; the rules are read-contract §8:
 *
 *  1. Order by `seq`, place by `ts − recording_started_at`; never re-sort by `ts`.
 *  2. A bot interval opens at the intent, becomes audible at
 *     `event/first_audible` of that `gen` and ends at the LAST
 *     `event/playback_completed` for it; a `playback_completed` of another
 *     generation is a dead one's drain. A later intent or a `barge_in/detected`
 *     ends it where it lands; on a reply that never became audible
 *     `event/reply_failed` ends the wait, and so does `event/synthesis_complete`.
 *  3. A committed turn shows its wait — intent → first audible byte — as
 *     `bot: waiting on reply N`: that stretch is silence the caller sits through.
 *  4. Between bot intervals the line is the caller's, cut at each
 *     `event/turn_end`; a segment with any sound or text is `caller`, one with
 *     none is `silence`.
 *  5. After `stt/reconnect_exhausted` every non-bot interval is `deaf`.
 *
 * A `{kind, type}` this function does not know is ignored, never an error
 * (§3.1) — it still counts for the verdict. A call with no
 * `recording_started_at` yields no intervals: nothing on it can be placed.
 */
export function callIntervals(
  rows: EventRow[],
  opts: { recordingStartedAt: Date | null; holeFromSeq: number | null },
): Interval[] {
  const anchor = opts.recordingStartedAt;
  if (anchor === null) return [];
  const placed: Placed[] = rows
    .map((r) => ({ r, t: r.ts.getTime() - anchor.getTime(), key: `${r.kind}/${r.type}` }))
    .sort((a, b) => a.r.seq - b.r.seq);
  const first = placed[0];
  const last = placed[placed.length - 1];
  if (first === undefined || last === undefined) return [];
  // Records before `recorder/started` are placed as they are: a negative t is a
  // fact about the call, not an error to clamp away (`:622-624`).
  const clockStart = first.t;
  const finalized = placed.find((p) => p.key === 'recorder/finalized');
  const clockEnd = Math.max(clockStart, finalized?.t ?? last.t);
  const exhausted = placed.find((p) => p.key === 'stt/reconnect_exhausted');
  const deafFrom =
    exhausted === undefined ? null : Math.min(Math.max(exhausted.t, clockStart), clockEnd);

  const spans: Span[] = [];
  let cursor = clockStart;
  for (const bot of botSpans(placed, clockStart, clockEnd)) {
    if (bot.to <= cursor) continue;
    const from = Math.max(bot.from, cursor);
    if (from > cursor) spans.push(...callerSpans(placed, cursor, from, deafFrom));
    spans.push({ ...bot, from });
    cursor = bot.to;
  }
  if (cursor < clockEnd) spans.push(...callerSpans(placed, cursor, clockEnd, deafFrom));
  // A trail whose every span collapsed — one record, or a bot intent stamped at
  // the last instant of the call — still accounts for its clock with one line.
  if (spans.length === 0) {
    spans.push({
      from: clockStart,
      to: clockEnd,
      holder: null,
      deaf: deafFrom !== null && clockStart >= deafFrom,
    });
  }

  const overtaken = overtakenPartials(placed);
  const muted = mutedStretches(placed, clockStart, clockEnd);
  const holeAt = holeAtMs(placed, opts.holeFromSeq);
  return spans.map((span, i) => {
    const owned = recordsOf(placed, span, { first: i === 0, last: i === spans.length - 1 });
    const energyMs = owned.filter((p) => p.key === 'event/caller_energy').map((p) => p.t);
    const finals = owned.filter((p) => p.key === 'event/stt_final').map(textRef);
    const produced = owned.some((p) => p.key === 'event/stt_partial' || p.key === 'event/stt_final');
    return {
      fromMs: span.from,
      toMs: span.to,
      holder: span.holder ?? holderOf(owned, span.deaf),
      energyMs,
      unheard: energyMs.some((t) => unheardAt(t, muted)),
      finals,
      // The first overtaken partial only, as the reference reads it (`:857`,
      // `find`): two intents in the same instant (trap 9) can leave one
      // interval owning two, and the card and `intervals.txt` must agree.
      overtaken: owned
        .filter((p) => p.key === 'event/stt_partial' && overtaken.has(p.r.seq))
        .slice(0, 1)
        .map(textRef),
      // The signatures of a recogniser that produced nothing are what a reader
      // comes here for — and they are only a finding where nothing came out
      // (`:864-870`).
      signalRuns: produced ? [] : signalRuns(owned),
      watchdog: owned.some(
        (p) => p.key === 'event/timer_fired' && fields(p.r.data)['id'] === 'no_input',
      ),
      unsupported: holeAt !== null && span.from >= holeAt,
    };
  });
}

/** A recogniser record as a pointer — which record, never its words. */
function textRef(p: Placed): TextRef {
  return { seq: p.r.seq, sensitive: p.r.sensitive };
}

/**
 * Where on the clock the trail's hole falls: the last record still known to
 * have been written at or before `holeFromSeq`. The two hole kinds name their
 * seq differently — the recorder's is the last record it minted, the mirror's
 * is the first row it lost — and both land between the same two present
 * records, so both are read the same way here. Every interval from that instant
 * on is unsupported (§8 rule 7).
 */
function holeAtMs(placed: Placed[], holeFromSeq: number | null): number | null {
  if (holeFromSeq === null) return null;
  let at: number | null = null;
  for (const p of placed) {
    if (p.r.seq <= holeFromSeq) at = p.t;
  }
  // A hole at or before the first record leaves nothing supported at all.
  return at ?? placed[0]?.t ?? null;
}

/**
 * The stretches the feed to the recogniser was muted across — where the
 * caller's sound reached nobody. Copied from `call-evidence.ts:683-698`, and
 * read off the trail itself because the trail carries the state: every change
 * of it is an engine effect. So: from the call's birth — the shell starts
 * muted, so the greeting plays into a dead feed — to the first
 * `effect/unmute_stt`, and from each `effect/mute_stt` to the next
 * `effect/unmute_stt`, the last one running to the end of the clock. Never
 * re-derived from `STT_MUTE_ON_FIRST_AUDIO` or from the bot's intervals.
 */
function mutedStretches(placed: Placed[], clockStart: number, clockEnd: number): Stretch[] {
  const out: Stretch[] = [];
  let openedAt: number | null = clockStart;
  for (const p of placed) {
    const t = Math.min(Math.max(p.t, clockStart), clockEnd);
    if (p.key === 'effect/mute_stt' && openedAt === null) openedAt = t;
    else if (p.key === 'effect/unmute_stt' && openedAt !== null) {
      out.push({ from: openedAt, to: Math.max(t, openedAt) });
      openedAt = null;
    }
  }
  // Still muted when the trail ends: the stretch has no closing instant, so it
  // covers everything after it rather than stopping at the last record.
  if (openedAt !== null) out.push({ from: openedAt, to: Number.POSITIVE_INFINITY });
  return out;
}

/** Whether the caller's line was unheard at one instant (`:701-703`). */
function unheardAt(t: number, muted: Stretch[]): boolean {
  return muted.some((s) => t >= s.from && t < s.to);
}

/**
 * Every stretch the bot held the line, in order, clamped to the clock
 * (`call-evidence.ts:710-757`). Whether the caller's sound was heard across any
 * of them is not decided here: `mutedStretches` reads that off the trail.
 *
 * Known reference bug carried as written (`../Fonnus/ISSUES.md` L10-260917-1,
 * ADR 0010 decision 7): the `synthesis_complete` cut applies to `start_reply`
 * only, so a canned line whose synthesis returned no bytes holds the line until
 * the next intent and the caller's energy and `turn_end` under it are
 * swallowed. The fix is the pipeline's; a copy that fixed it here would
 * disagree with `call-evidence` on the same trail.
 */
function botSpans(placed: Placed[], clockStart: number, clockEnd: number): Span[] {
  const intents = placed.filter((p) => INTENTS.has(p.key));
  const out: Span[] = [];
  for (const [i, intent] of intents.entries()) {
    const next = intents[i + 1];
    const from = Math.min(Math.max(intent.t, clockStart), clockEnd);
    // The next intent is a hard bound: a bot line cannot outlive the one that
    // replaced it, whether a barge-in, a limit or a failure put it there.
    const windowEnd = Math.min(next === undefined ? clockEnd : Math.max(next.t, from), clockEnd);
    const gen = intent.r.gen;
    const mine = (p: Placed, key: string): boolean =>
      p.key === key && gen !== null && p.r.gen === gen && p.t >= from && p.t <= windowEnd;
    const audible = placed.find((p) => mine(p, 'event/first_audible'));
    const drains = placed.filter((p) => mine(p, 'event/playback_completed'));
    const lastDrain = drains[drains.length - 1];
    const barge = placed.find((p) => p.key === 'barge_in/detected' && p.t > from && p.t <= windowEnd);
    const failed = placed.find((p) => mine(p, 'event/reply_failed'));
    // A reply that synthesized no audio at all: the engine unmutes and gives
    // the line back to the caller right there, so the wait ends there too.
    const synthesized =
      intent.key === 'effect/start_reply'
        ? placed.find((p) => mine(p, 'event/synthesis_complete'))
        : undefined;
    let to = windowEnd;
    if (barge !== undefined) to = barge.t;
    else if (lastDrain !== undefined) to = lastDrain.t;
    else if (audible === undefined && failed !== undefined) to = failed.t;
    else if (audible === undefined && synthesized !== undefined) to = synthesized.t;
    to = Math.min(Math.max(to, from), windowEnd);
    const audibleAt = audible === undefined ? null : Math.min(Math.max(audible.t, from), to);
    const heard = audible !== undefined;
    if (intent.key === 'effect/start_reply') {
      const n = intent.r.turnIdx ?? gen;
      const idx = intent.r.turnIdx;
      const reply = n === null ? 'bot: reply' : `bot: reply ${String(n)}`;
      const waiting = n === null ? 'bot: waiting on reply' : `bot: waiting on reply ${String(n)}`;
      const holder = (kind: HolderKind, label: string): Holder => ({
        kind,
        label,
        turnIdx: idx,
        gen,
        audible: heard,
      });
      if (audibleAt === null) {
        out.push({ from, to, holder: holder('waiting', waiting), deaf: false });
        continue;
      }
      out.push({ from, to: audibleAt, holder: holder('waiting', waiting), deaf: false });
      out.push({ from: audibleAt, to, holder: holder('reply', reply), deaf: false });
      continue;
    }
    const greeting = intent.key === 'effect/speak_text';
    out.push({
      from,
      to,
      holder: {
        kind: greeting ? 'greeting' : 'canned',
        label: greeting ? 'bot: greeting' : cannedHolder(intent.r),
        turnIdx: intent.r.turnIdx,
        gen,
        audible: heard,
      },
      deaf: false,
    });
  }
  return out.filter((s) => s.to > s.from);
}

/** `effect/speak_canned` says which of the three lines it was (`:760-763`). */
function cannedHolder(r: EventRow): string {
  const line = fields(r.data)['line'];
  return typeof line === 'string' ? `bot: ${line}` : 'bot: canned line';
}

/**
 * A stretch between two bot intervals, cut at the recogniser's own segmentation
 * — and at the instant the STT socket gave up, so that no interval is half deaf
 * and half not (`call-evidence.ts:771-785`). No finer boundary is invented: the
 * pipeline knows of no other instant at which the line changed hands.
 */
function callerSpans(placed: Placed[], from: number, to: number, deafFrom: number | null): Span[] {
  const cuts = [
    ...placed.filter((p) => p.key === 'event/turn_end' && p.t > from && p.t < to).map((p) => p.t),
    ...(deafFrom !== null && deafFrom > from && deafFrom < to ? [deafFrom] : []),
  ].sort((a, b) => a - b);
  const bounds = [from, ...cuts, to];
  const out: Span[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (a === undefined || b === undefined || b <= a) continue;
    out.push({ from: a, to: b, holder: null, deaf: deafFrom !== null && a >= deafFrom });
  }
  return out;
}

/**
 * Copied from `call-evidence.ts:787-790`. The label is the contract's word
 * `deaf` (`console-call-view.md` holder vocabulary); the reference prints
 * `deaf (stt exhausted)`, which this console renders as the explanation beside
 * the label rather than as the label (ADR 0010).
 */
function holderOf(owned: Placed[], deaf: boolean): Holder {
  const kind: HolderKind = deaf
    ? 'deaf'
    : owned.some((p) => HEARD.has(p.key))
      ? 'caller'
      : 'silence';
  return { kind, label: kind, turnIdx: null, gen: null, audible: null };
}

/**
 * The records one interval owns (`call-evidence.ts:798-805`). `[from, to)`,
 * with two edges: a turn-end signal belongs to the interval it ended — it sits
 * exactly on that interval's `to` whenever the segmentation cut there — and the
 * last interval keeps a record stamped at its very end, which is where
 * `recorder/finalized` sits.
 */
function recordsOf(
  placed: Placed[],
  span: { from: number; to: number },
  o: { first: boolean; last: boolean },
): Placed[] {
  return placed.filter((p) => {
    if (p.key === 'event/turn_end') {
      return (o.first ? p.t >= span.from : p.t > span.from) && p.t <= span.to;
    }
    return p.t >= span.from && (o.last ? p.t <= span.to : p.t < span.to);
  });
}

/**
 * The partials no final ever replaced before the bot spoke again
 * (`call-evidence.ts:813-826`) — the caller's words were on their way and the
 * farewell went out over them. Only the trailing one of a run is named: the
 * earlier ones were superseded by the partials that followed, which is the
 * recogniser working as designed.
 */
function overtakenPartials(placed: Placed[]): Set<number> {
  const out = new Set<number>();
  let pending: Placed | undefined;
  for (const p of placed) {
    if (p.key === 'event/stt_partial') pending = p;
    else if (p.key === 'event/stt_final') pending = undefined;
    else if (INTENTS.has(p.key)) {
      if (pending !== undefined) out.add(pending.r.seq);
      pending = undefined;
    }
  }
  if (pending !== undefined) out.add(pending.r.seq);
  return out;
}

/**
 * The turn-end signals of one interval, grouped in order
 * (`call-evidence.ts:878-888`). The label is the vendor's own name for the
 * frame it promoted (`turn_end.source` is an open vocabulary, §3.1): printed,
 * never switched on.
 */
function signalRuns(owned: Placed[]): { source: string | null; count: number }[] {
  const out: { source: string | null; count: number }[] = [];
  for (const p of owned.filter((r) => r.key === 'event/turn_end')) {
    const raw = fields(p.r.data)['source'];
    const source = typeof raw === 'string' ? raw : null;
    const open = out[out.length - 1];
    if (open !== undefined && open.source === source) open.count += 1;
    else out.push({ source, count: 1 });
  }
  return out;
}

// ── the cells: the one place text is resolved ───────────────────────────

/** One interval as the card prints it — every cell a string, text already gated. */
export interface IntervalCell {
  /** Seconds on the recording clock, as `intervals.txt` prints them (`:1041-1043`). */
  from: string;
  to: string;
  holder: string;
  holderKind: HolderKind;
  turnIdx: number | null;
  callerLine: string;
  recogniser: string;
  botText: string | null;
  unsupported: boolean;
  /**
   * The current annotations this interval overlaps — a fourth fact beside the
   * holder, the caller line and the recogniser, never a replacement for the
   * recogniser column (contract §8; PLAN row A7).
   */
  annotations: AnnotationCellItem[];
  /** Where the player seeks to; the axis has no negative side (ADR 0006). */
  seekMs: number;
}

/**
 * The intervals as cells, with every text resolved here and nowhere else (ADR
 * 0010 decision 5, trap 4): `showCallerData` is called once, and the derivation
 * above never held a word to leak. The signatures themselves — "segmented,
 * returned nothing", the energy instants, the holder — are shown on every call,
 * consented or not, because they carry no words.
 */
export function intervalCells(
  intervals: Interval[],
  rows: EventRow[],
  ctx: {
    outcome: string | null;
    gate: ConsentGate;
    assistantText: ReadonlyMap<number, string | null>;
    /** Every `call_annotation` row of the call; "current" is derived here, once. */
    annotations: AnnotationRow[];
  },
): IntervalCell[] {
  const showCaller = showCallerData(ctx.outcome, ctx.gate);
  // Trap 10: a null payload under a granted outcome is the transcript TTL, not
  // a refusal — the two are told apart here and nowhere else.
  const granted = isConsentGranted(ctx.outcome);
  const bySeq = new Map(rows.map((r) => [r.seq, r]));
  // Contract §3's current rule, applied once for the whole table rather than
  // per interval: an annotation lands on every interval it overlaps.
  const current = currentAnnotations(ctx.annotations);
  const text = (ref: TextRef): string => sttText(ref, bySeq, { showCaller, granted });
  return intervals.map((interval) => ({
    from: seconds(interval.fromMs),
    to: seconds(interval.toMs),
    holder: interval.holder.label,
    holderKind: interval.holder.kind,
    turnIdx: interval.holder.turnIdx,
    callerLine: callerLineCell(interval),
    recogniser: recogniserCell(interval, text),
    botText: botTextOf(interval, rows, { assistantText: ctx.assistantText }),
    unsupported: interval.unsupported,
    annotations: annotationCellItems(current, interval, { showCaller }),
    seekMs: Math.max(0, interval.fromMs),
  }));
}

/**
 * What the caller's line carried (`call-evidence.ts:836-846`).
 * `event/caller_energy` is measured before the mute gate, so it exists inside
 * bot intervals too — there it is speech the pipeline never heard. The note is
 * added for energy that fell inside a muted stretch, whatever kind of interval
 * it lands in: a stretch can reach past a bot interval into the caller's own,
 * because the engine unmutes only after the last drain.
 */
function callerLineCell(interval: Interval): string {
  const energy = interval.energyMs;
  const firstAt = energy[0];
  const lastAt = energy[energy.length - 1];
  if (firstAt === undefined || lastAt === undefined) return EMPTY_CELL;
  const shown =
    energy.length > ENERGY_SHOWN
      ? `sound ×${String(energy.length)} (${seconds(firstAt)}…${seconds(lastAt)})`
      : `sound at ${energy.map(seconds).join(', ')}`;
  return interval.unheard ? `${shown} (unheard — feed muted)` : shown;
}

/**
 * What the recogniser produced in this interval (`call-evidence.ts:854-870`) —
 * including the two ways it produced nothing, which are the findings a reader
 * comes here for: a turn-end signal with no partial and no final behind it (it
 * segmented speech and returned no words), and a partial no final ever replaced.
 */
function recogniserCell(interval: Interval, text: (ref: TextRef) => string): string {
  const parts: string[] = [];
  for (const ref of interval.finals) parts.push(text(ref));
  for (const ref of interval.overtaken) parts.push(`partial overtaken: ${text(ref)}`);
  for (const run of interval.signalRuns) {
    const named = run.source === null ? '' : ` (${run.source})`;
    parts.push(`segmented, returned nothing${named}${run.count > 1 ? ` ×${String(run.count)}` : ''}`);
  }
  if (interval.watchdog) parts.push('no-input watchdog fired');
  return parts.length === 0 ? EMPTY_CELL : parts.join(' · ');
}

/**
 * One recogniser text under the consent rule (`call-evidence.ts:897-901`). A
 * `sensitive` payload is withheld unless the gate opens; a payload that is not
 * there at all still proves the recogniser produced words, and trap 10 says
 * which of the two erasures it was — the refusal stripped it at write time, or
 * the transcript TTL nulled it later. The reference writes `[withheld]` for
 * both; this console tells them apart (ADR 0010 decision 5).
 */
function sttText(
  ref: TextRef,
  bySeq: ReadonlyMap<number, EventRow>,
  o: { showCaller: boolean; granted: boolean },
): string {
  if (ref.sensitive && !o.showCaller) return WITHHELD;
  const data = bySeq.get(ref.seq)?.data ?? null;
  const raw = fields(data)['text'];
  if (typeof raw === 'string') return `"${raw}"`;
  if (!o.granted) return WITHHELD;
  return data === null ? EXPIRED : NO_TEXT;
}

/**
 * What the bot said in this interval: the greeting from
 * `effect/speak_text.data.text` — an ASSUMED key, read per
 * `../Fonnus/app/src/recording/artifact-recorder.ts:963` and not named by
 * contract §3 — and a reply from `turn.assistant_text` via `turn_idx`, under
 * the same gate as the transcript. A canned line shows its holder label only
 * (§8 rule 2: it owns no turn), and so does a wait, which is by definition the
 * stretch before any audio.
 */
function botTextOf(
  interval: Interval,
  rows: EventRow[],
  o: { assistantText: ReadonlyMap<number, string | null> },
): string | null {
  const { kind, gen, turnIdx } = interval.holder;
  if (kind === 'greeting') {
    const intent = rows.find(
      (r) => r.kind === 'effect' && r.type === 'speak_text' && (gen === null || r.gen === gen),
    );
    const raw = fields(intent?.data ?? null)['text'];
    return typeof raw === 'string' ? raw : null;
  }
  if (kind === 'reply') {
    // The reply is the bot's own words: contract trap 4 gates `turn.caller_text`
    // only, and the Transcript card on the same screen shows `assistant_text`
    // ungated (`docs/upstream.md` §Call detail) — the two surfaces must agree.
    if (turnIdx === null) return null;
    return o.assistantText.get(turnIdx) ?? null;
  }
  return null;
}
