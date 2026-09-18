/**
 * What the Calls screen is looking at, read from the URL: the window or a
 * search, which chips narrow the list, and which page of it (ADR 0006). Pure
 * functions over the rows `callsInScope` returns, so the chip predicates run in
 * TypeScript beside the two functions that own the consent and bucket literals
 * (`isConsentGranted`, `isFetchable`) rather than as SQL twins that drift.
 *
 * The chip tokens are the console's own vocabulary, settled with the operator
 * and never renamed; everything they test is the pipeline's.
 */

import { isFetchable } from './artifacts';
import { isCapEndReason, isUnconsentedOutcome } from './calls';
import type { CallScopeRow } from './queries/calls';
import { parseWindow, type Window } from './window';

/** A query string key can arrive repeated; the first value is the answer. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type Scope =
  | { kind: 'window'; window: Window }
  | {
      kind: 'search';
      keyword: string;
      /** The keyword's digits, matched as a suffix of `caller_phone_e164`. */
      phoneDigits: string | null;
      /** The keyword lower-cased, matched as a prefix of `id::text`. */
      idPrefix: string | null;
    };

/** Everything but a digit stripped: `+84 90` searches for `8490`. */
const NON_DIGIT = /\D/g;

/** What a `uuid` cast to text can start with — and nothing a LIKE reads as a wildcard. */
const HEX_PREFIX = /^[0-9a-f-]{3,}$/;

/**
 * The scope of the screen. A keyword wins over the window and searches all
 * history (ADR 0006: the operator searches for a number remembered from last
 * month, and a search inside the window is the mode that silently misses it).
 *
 * A keyword under three characters is still a search — with no predicate at
 * all, so it matches nothing and the screen says why. Widening it to a
 * one-digit suffix would read the whole table to show a page of unrelated
 * calls.
 */
export function parseScope(
  params: Record<string, string | string[] | undefined>,
  now: Date,
): Scope {
  const keyword = (first(params.q) ?? '').trim();
  if (keyword === '') return { kind: 'window', window: parseWindow(params, now) };

  const digits = keyword.replace(NON_DIGIT, '');
  const lowered = keyword.toLowerCase();
  return {
    kind: 'search',
    keyword,
    phoneDigits: digits.length >= 3 ? digits : null,
    idPrefix: HEX_PREFIX.test(lowered) ? lowered : null,
  };
}

/**
 * The five exceptions worth filtering a list by. Tokens are the URL's (`f=`),
 * labels are the screen's (`Failed turn · Not finalized · Unconsented · Hit a
 * cap · Has recording`); neither is renamed.
 */
export const CHIPS = [
  'failed_turn',
  'not_finalized',
  'unconsented',
  'hit_cap',
  'has_recording',
] as const;

export type Chip = (typeof CHIPS)[number];

/** `f=a,b`; a token the vocabulary does not name is dropped, never an error. */
export function parseChips(params: Record<string, string | string[] | undefined>): Chip[] {
  const raw = (first(params.f) ?? '').split(',').map((token) => token.trim());
  return CHIPS.filter((chip) => raw.includes(chip));
}

/**
 * Whether one call satisfies one chip. Each predicate is the one the contract
 * gives (`docs/upstream.md` §Call list):
 *
 * - `failed_turn` — at least one turn with a non-null `failed_leg` (trap 7:
 *   `failed_leg` is the test for "failed", never `interrupted`). It counts
 *   calls, not turns (`docs/redesign.md` §2).
 * - `not_finalized` — no `consent_record` row (trap 2), which is a state of the
 *   call and never "no consent".
 * - `unconsented` — a finalized call whose outcome is one of the two hang-ups.
 * - `hit_cap` — an `end_reason` the pipeline applied on purpose.
 * - `has_recording` — the pipeline's own archived predicate, through the one
 *   function that owns it.
 */
export function chipHolds(row: CallScopeRow, chip: Chip): boolean {
  switch (chip) {
    case 'failed_turn':
      return row.failed_turn_idx.length > 0;
    case 'not_finalized':
      return row.outcome === null;
    case 'unconsented':
      return isUnconsentedOutcome(row.outcome);
    case 'hit_cap':
      return isCapEndReason(row.end_reason);
    case 'has_recording':
      return isFetchable(row.artifact_state, row.artifact_key_prefix);
  }
}

/** The rows satisfying every active chip — the chips intersect (ADR 0006). */
export function applyChips(rows: CallScopeRow[], active: Chip[]): CallScopeRow[] {
  return active.length === 0
    ? rows
    : rows.filter((row) => active.every((chip) => chipHolds(row, chip)));
}

/**
 * What each chip would leave. `all` is the scope without any chip — the number
 * the `All` pill carries and the one the cards and the histogram agree with;
 * `byChip[c]` is the count under the active set plus `c`, so a chip already
 * active shows the current count and an inactive one shows what clicking it
 * gives. A zero there is the answer "no call in this scope is like that", which
 * the screen shows rather than hiding the chip.
 */
export function chipCounts(
  rows: CallScopeRow[],
  active: Chip[],
): { all: number; byChip: Record<Chip, number> } {
  const byChip = {} as Record<Chip, number>;
  for (const chip of CHIPS) {
    const combination = active.includes(chip) ? active : [...active, chip];
    byChip[chip] = applyChips(rows, combination).length;
  }
  return { all: rows.length, byChip };
}

/** A page of the list. The scope is read whole and sliced (ADR 0006). */
export const PAGE_SIZE = 100;

/** `page=N`, one-based; anything else is the first page rather than an error. */
export function parsePage(params: Record<string, string | string[] | undefined>): number {
  const raw = (first(params.page) ?? '').trim();
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/**
 * One page of rows in the order they arrived (`started_at DESC`). A page past
 * the end is answered with its own empty slice and `hasOlder` false — the link
 * that leads there is never rendered, but a hand-typed `page=99` must not
 * silently show page 1's calls under a "page 99" heading.
 */
export function pageOf<T>(rows: T[], page: number): { rows: T[]; page: number; hasOlder: boolean } {
  const from = (page - 1) * PAGE_SIZE;
  return {
    rows: rows.slice(from, from + PAGE_SIZE),
    page,
    hasOlder: rows.length > from + PAGE_SIZE,
  };
}

/**
 * The link one chip's pill points at: the chip toggled in `f=`, every other key
 * of the screen kept, and the page dropped — page 3 of one filter is not page 3
 * of another, and a link that kept it would land on an empty page.
 */
export function chipHref(
  base: string,
  params: Record<string, string | string[] | undefined>,
  chip: Chip,
): string {
  const active = parseChips(params);
  const next = active.includes(chip)
    ? active.filter((token) => token !== chip)
    : CHIPS.filter((token) => token === chip || active.includes(token));

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'f' || key === 'page') continue;
    const single = first(value);
    if (single !== undefined && single !== '') search.set(key, single);
  }
  if (next.length > 0) search.set('f', next.join(','));

  const query = search.toString();
  return query === '' ? base : `${base}?${query}`;
}
