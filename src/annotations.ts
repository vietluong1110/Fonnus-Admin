/**
 * What a person who heard the call said was wrong at a stretch of it: the
 * `call_annotation` rows of one call, on the same axis as the intervals
 * (`../Fonnus/docs/read-contract.md` §3 and §8 "Annotations on the same axis",
 * pipeline ADR 0027). PLAN row A7 — the showing half; the form that writes a
 * row is row A10.
 *
 * A **copy**, function by function, of the pipeline's own reader
 * `../Fonnus/tools/call-evidence.ts` with the source line cited at each copied
 * rule, exactly as `src/intervals.ts` copies its half of §8: never imported
 * across repos (pipeline ADR 0013), never re-expressed in SQL. `annotations.txt`
 * in an evidence bundle is the reference rendering of the history, so a call's
 * history block and its `annotations.txt` must agree.
 *
 * Three departures from the reference, all this console's:
 *
 *  - `id` and `supersedes` are `bigint`, which `pg` hands over as strings; the
 *    chain is followed by string comparison rather than by number;
 *  - the consent rule is `showCallerData` (ADR 0005), so the test phase's
 *    `CONSENT_GATE=off` shows an annotation's texts beside the caller text the
 *    same card already shows, and an interval cell wears the bare `[expired]`
 *    marker the recogniser column wears — the instant the sweep set has room
 *    only in the history;
 *  - a cell shows both texts of a row that carries both, where the reference
 *    prints the words alone — see `annotationCellText`.
 *
 * This module is pure: no Next.js, no React, no database.
 */
import { isKnownAnnotationLabel, showCallerData } from '@/calls';
import type { ConsentGate } from '@/config';
import { EMPTY_CELL, EXPIRED, WITHHELD, seconds } from '@/interval-lane';
import type { AnnotationRow } from '@/queries/calls';

/** The standing of a row nothing has replaced and that states a fact (`:928`). */
export const STANDING_CURRENT = 'current';

/** What a labelless row prints where a label would be (`call-evidence.ts:1025`). */
export const RETRACTION_LABEL = '(retraction)';

/**
 * The **current** rows of a call — the only ones a reader may take as true
 * (contract §3, which gives the same rule as SQL): a row that carries a label
 * and that no other row supersedes. A labelless row is a retraction and a
 * superseded row is history; both stay in the history block, and neither is a
 * fact about the call. Copied from `call-evidence.ts:911-913`; run here rather
 * than in SQL so the rule the tests pin is the rule that runs.
 */
export function currentAnnotations(rows: AnnotationRow[]): AnnotationRow[] {
  return rows.filter((a) => a.label !== null && !rows.some((s) => s.supersedes === a.id));
}

/**
 * Where one row stands in its chain, in the words `annotations.txt` prints. The
 * successor decides first — a labelless one withdrew the row, a labelled one
 * replaced it whole — and a row with no successor is either a fact that still
 * stands or the retraction it was written as. Copied from
 * `call-evidence.ts:921-930`.
 */
export function annotationStanding(row: AnnotationRow, rows: AnnotationRow[]): string {
  const successor = rows.find((s) => s.supersedes === row.id);
  if (successor !== undefined) {
    return `${successor.label === null ? 'retracted' : 'superseded'} by #${successor.id}`;
  }
  if (row.label !== null) return STANDING_CURRENT;
  return row.supersedes === null
    ? 'retraction of no row — a shape the database CHECK refuses'
    : `retraction of #${row.supersedes}`;
}

/**
 * The current rows shown on one interval: every one whose interval overlaps it
 * (`call-evidence.ts:971`, contract §8 `from_ms / 1000 < interval.to AND
 * to_ms / 1000 > interval.from` — the same arithmetic without the division,
 * because an `Interval` here is already in milliseconds, `src/intervals.ts:14-18`).
 * Overlap, not containment: the caller's stretch is cut at each `turn_end`
 * (§8 rule 5), so one annotation of one utterance usually spans several
 * intervals and a reader of any one of them must see it.
 */
export function annotationsOn(
  interval: { fromMs: number; toMs: number },
  current: AnnotationRow[],
): AnnotationRow[] {
  return current.filter((a) => a.from_ms < interval.toMs && a.to_ms > interval.fromMs);
}

/**
 * Why an annotation text may not be shown as written, or null when it may.
 * Copied from `call-evidence.ts:941-944`, with this console's gate in place of
 * the reference's bare `granted`: the consent rule is `turn.caller_text`'s own
 * (trap 4), and `text_expired_at` is the retention sweep's mark — it nulled
 * both texts at `TRANSCRIPT_TTL_DAYS` counted from the CALL's `started_at`
 * (trap 13), so a null text with no mark was never written. The label, the
 * interval and the author are not caller content and are never withheld.
 */
function textCover(
  row: AnnotationRow,
  o: { showCaller: boolean; withInstant: boolean },
): string | null {
  if (!o.showCaller) return WITHHELD;
  if (row.text_expired_at === null) return null;
  // The cell has room for the marker alone; the history carries the instant the
  // sweep wrote, as the reference prints it (`call-evidence.ts:943`).
  return o.withInstant
    ? `${EXPIRED.replace(']', '')} ${row.text_expired_at.toISOString()}]`
    : EXPIRED;
}

/** One annotation text as the history shows it (`call-evidence.ts:947-949`). */
function annotationText(
  row: AnnotationRow,
  value: string | null,
  showCaller: boolean,
): string {
  return textCover(row, { showCaller, withInstant: true }) ?? value ?? EMPTY_CELL;
}

/**
 * The text line of an interval cell, from `call-evidence.ts:956-961` with one
 * departure: the reference prints the caller's words alone when a row carries
 * both, its note being one `annotations.txt` away, while here the history is a
 * collapsed block, so a row with both texts shows both — the words first,
 * then the note. A row labelled `other` or `bot_silent` often says everything
 * in its note alone.
 */
function annotationCellText(row: AnnotationRow, showCaller: boolean): string {
  const cover = textCover(row, { showCaller, withInstant: false });
  if (cover !== null) return cover;
  const note = row.note === null ? null : `note: ${row.note}`;
  if (row.caller_said === null) return note ?? EMPTY_CELL;
  const said = `"${row.caller_said}"`;
  return note === null ? said : `${said} — ${note}`;
}

/** One current annotation as an interval cell prints it — text already gated. */
export interface AnnotationCellItem {
  /** `bigint` as `pg` returns it; the `#N` a later row's `supersedes` names. */
  id: string;
  label: string | null;
  /** Contract §3.1: an unfamiliar value is shown with a warning, never dropped. */
  labelKnown: boolean;
  /** Seconds on the recording clock, as every offset of the card prints them. */
  from: string;
  to: string;
  /** `created_by` verbatim — opaque text (§3), never re-derived from the session. */
  author: string;
  text: string;
}

/**
 * The annotation column of one interval (`call-evidence.ts:970-980`), as items
 * rather than one joined string: the card stacks them, and only the current
 * rows are placed at all.
 */
export function annotationCellItems(
  current: AnnotationRow[],
  interval: { fromMs: number; toMs: number },
  ctx: { showCaller: boolean },
): AnnotationCellItem[] {
  return annotationsOn(interval, current).map((row) => ({
    id: row.id,
    label: row.label,
    labelKnown: row.label === null || isKnownAnnotationLabel(row.label),
    from: seconds(row.from_ms),
    to: seconds(row.to_ms),
    author: row.created_by,
    text: annotationCellText(row, ctx.showCaller),
  }));
}

/** One row of the call's annotation history — every row, in the query's `id` order. */
export interface AnnotationHistoryRow {
  id: string;
  createdAt: Date;
  author: string;
  from: string;
  to: string;
  /** Null is a retraction, printed `(retraction)` — never a dash (trap 13). */
  label: string | null;
  labelKnown: boolean;
  standing: string;
  callerSaid: string;
  note: string;
}

/**
 * Every annotation of the call, history included, one block per row
 * (`call-evidence.ts:989-1033`). The investigator needs the history — who said
 * what about this call, and who changed it — which is exactly what the interval
 * cells must not show, so the card splits the table between them the way the
 * bundle splits it between `intervals.txt` and `annotations.txt`.
 *
 * The order is the query's `id` order and is not re-sorted here: `id` is a
 * `bigint` read as a string, so sorting it here would order it as text.
 *
 * This is the second and last place the consent gate runs for annotations (the
 * first is `intervalCells`); nothing downstream of either sees an ungated text.
 */
export function annotationHistory(
  rows: AnnotationRow[],
  ctx: { outcome: string | null; gate: ConsentGate },
): AnnotationHistoryRow[] {
  const showCaller = showCallerData(ctx.outcome, ctx.gate);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    author: row.created_by,
    from: seconds(row.from_ms),
    to: seconds(row.to_ms),
    label: row.label,
    labelKnown: row.label === null || isKnownAnnotationLabel(row.label),
    standing: annotationStanding(row, rows),
    callerSaid: annotationText(row, row.caller_said, showCaller),
    note: annotationText(row, row.note, showCaller),
  }));
}
