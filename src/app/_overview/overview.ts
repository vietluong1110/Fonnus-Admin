/*
 * The Overview's own pure helpers: how the group-by control builds its URL and
 * its option list, what the comparison table's value column is called, and the sentences that travel with a number. Kept apart from
 * the cards so `overview.test.ts` can pin them without React or Next.js.
 *
 * Every friendly name comes from `src/ui/glossary.ts` (ADR 0013); nothing here
 * writes one.
 */

import { formatNumber } from '@/calls';
import { floorSentence, STORED_COST_TIP } from '@/cost';
import type { Grouping } from '@/dashboard';
import type { DashboardCall, DashboardTurn } from '@/queries/dashboard';
import { GLOSSARY, OVERVIEW_GROUPINGS, type Term, termFor } from '@/ui/glossary';
import type { ListboxOption } from '@/ui/listbox';

/** A glossary entry the screen cannot render without; `glossary.test.ts` holds it present. */
function entry(term: Term | undefined): Term {
  if (term === undefined) throw new Error('a span the Overview names is missing from the glossary');
  return term;
}

/**
 * The spans the Overview labels, read from the glossary by property rather than
 * by a `'pipeline_ms'` literal, so the glossary scan finds no code written here.
 */
export const SPAN = {
  pipeline: entry(GLOSSARY.span.pipeline_ms),
  perceived: entry(GLOSSARY.span.caller_perceived_ms),
  failedAfter: entry(GLOSSARY.span.failed_after_ms),
} as const;

/**
 * The address the group-by control navigates to: the current one with `group`
 * set, every other key kept (the window, `outside`), so the URL stays the whole
 * input (ADR 0006) and a grouped screen is still a pasteable address.
 */
export function groupHref(href: string, group: string): string {
  const url = new URL(href);
  url.searchParams.set('group', group);
  return url.pathname + url.search;
}

/**
 * How a grouping the control does not offer reads, when the URL asks for one
 * (ADR 0009 keeps them parseable): the whole snapshot, one arbitrary key, or
 * one of the older fixed groupings by its raw value.
 */
function urlOnlyLabel(grouping: Grouping): string {
  if (grouping === 'none') return 'no grouping';
  if (grouping === 'config') return 'config_snapshot (the whole object)';
  if (grouping.startsWith('key:')) return `config_snapshot → ${grouping.slice('key:'.length)}`;
  return termFor('grouping', grouping)?.name ?? grouping;
}

/**
 * The eight groupings the control offers (ADR 0013 decision 6 of the brief),
 * plus — when the URL holds a grouping outside them — that one, last, so the
 * control always shows what is being rendered and never lies about it.
 */
export function groupOptions(grouping: Grouping): ListboxOption[] {
  const options: ListboxOption[] = OVERVIEW_GROUPINGS.map(({ value, term }) => ({
    value,
    label: term.name,
  }));
  if (!options.some((option) => option.value === grouping)) {
    options.push({ value: grouping, label: urlOnlyLabel(grouping) });
  }
  return options;
}

/**
 * The header of the comparison table's value column: the grouping's own name
 * ("LLM model", "Voice", …); the whole snapshot is a configuration; any other
 * grouping only the URL can ask for is a plain "Value".
 */
export function groupingHeader(grouping: Grouping): string {
  const term = termFor('grouping', grouping);
  if (term !== null) return term.name;
  return grouping === 'config' ? 'Configuration' : 'Value';
}

/**
 * How many turns the leg table stands on, said once in the card head now that
 * the per-leg column is gone. A leg's sample is the turns that stamped BOTH its
 * marks, so the legs can differ; then the range is said, never one of them.
 * Null when no leg has a sample (the card's empty state speaks instead).
 */
export function legTurnsCaveat(counts: readonly number[]): string | null {
  const sampled = counts.filter((count) => count > 0);
  if (sampled.length === 0) return null;
  const low = Math.min(...sampled);
  const high = Math.max(...sampled);
  return low === high
    ? `over ${formatNumber(high)} turns with both marks`
    : `over ${formatNumber(low)}–${formatNumber(high)} turns with both marks, by leg`;
}

/**
 * The one leg row's own sample, in the tooltip of its P95: the turns that
 * stamped both of the leg's marks, which differ from leg to leg.
 */
export function legP95Tip(count: number): string {
  return `P95 over ${formatNumber(count)} turn${count === 1 ? '' : 's'} with both marks`;
}

/**
 * The visible note beside a leg's P95 when its sample is under 20 turns: the
 * nearest-rank rank `min(n-1, ceil(0.95n)-1)` of `percentiles` (copied from
 * ../Fonnus/tools/lib/call-report.ts into `src/dashboard.ts`) is `n-1` for
 * every n below 20, so that P95 is the sample's maximum. Null otherwise, and on
 * an empty sample, whose P95 is already "—".
 */
export function smallSampleNote(count: number): string | null {
  return count > 0 && count < 20 ? `max of ${formatNumber(count)}` : null;
}

/**
 * The cost figure's tooltip (ADR 0015 decisions 6–7): who computed the stored
 * figure, then ADR 0015 D7's sentence — which models the window ran on without
 * a price row, so the figure is read as a floor exactly when it is one.
 */
export function costTip(unpriced: readonly string[]): string {
  return `${STORED_COST_TIP}; ${floorSentence(unpriced) ?? 'every model in the window is priced'}`;
}

/** The rule every P95 on the card follows, said where the P95 is read. */
export const P95_RULE =
  "nearest-rank P95 over every turn with marks in the window, the pipeline's own rule; with fewer than 20 turns it equals the maximum";

/**
 * The turns of "Turns that never became audible", newest first: by their
 * call's `started_at` (a turn has no timestamp of its own, contract §3), then
 * the later turn of one call first. A turn whose call is missing sorts last.
 */
export function newestFirst(
  turns: readonly DashboardTurn[],
  callsById: ReadonlyMap<string, Pick<DashboardCall, 'started_at'>>,
): DashboardTurn[] {
  const at = (turn: DashboardTurn): number =>
    callsById.get(turn.call_id)?.started_at.getTime() ?? Number.NEGATIVE_INFINITY;
  return [...turns].sort((a, b) => at(b) - at(a) || b.idx - a.idx);
}

/**
 * Lengths laid end to end on one track: each span starts where the last one
 * ended, so a share bar's segments tile it without a gap.
 */
export function endToEnd<T extends { length: number }>(
  items: readonly T[],
): (T & { from: number; to: number })[] {
  return items.reduce<(T & { from: number; to: number })[]>((spans, item) => {
    const from = spans.at(-1)?.to ?? 0;
    return [...spans, { ...item, from, to: from + item.length }];
  }, []);
}
