/*
 * The Calls screen (PLAN.md row A6), after `docs/design/Calls-html`: the window
 * or a search at the top, four cards and the calls-per-bucket chart over the scope, the
 * five chips over the list, and one page of 100 calls in day bands.
 *
 * The URL is the whole input (ADR 0006) — no client state, nothing to
 * rehydrate, and a filtered list is a pasteable address. One query reads the
 * scope whole; the cards, the chart and the chip counts stand on the same
 * rows the list is sliced from, so the header count and the cards can never
 * disagree.
 */

import Link from 'next/link';
import { callStats, callsTimeline, dayBands, scopeHeading } from '@/calls-stats';
import { applyChips, chipCounts, pageOf, parseChips, parsePage, parseScope } from '@/calls-scope';
import { getConfig } from '@/config';
import { callsInScope } from '@/queries/calls';
import { first, parseWindow } from '@/window';
import Card from '@/ui/card';
import { PILL, PILL_ON } from '@/ui/chip';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import PageHead from '@/ui/page-head';
import WindowControl from '@/ui/window-control';
import CallTable from './_list/call-table';
import ChipStrip from './_list/chip-strip';
import StatRow from './_list/stat-row';
import Timeline from './_list/timeline';

// The list is about the database right now; nothing here may be prerendered.
export const dynamic = 'force-dynamic';

const BASE = '/calls';

type Params = Record<string, string | string[] | undefined>;

/**
 * This screen's URL with some keys changed — the link every control points at.
 * An empty value drops the key, so "clear the search" and "the first page" are
 * the same operation as any other, and no link ever carries `q=`.
 */
function hrefWith(params: Params, changes: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = first(value);
    if (single !== undefined && single !== '') search.set(key, single);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === '') search.delete(key);
    else search.set(key, value);
  }
  const query = search.toString();
  return query === '' ? BASE : `${BASE}?${query}`;
}

const SEARCH_NOTE = 'search covers all history; clear it to use the window';

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const now = new Date();
  const scope = parseScope(params, now);
  const config = getConfig();

  const rows = await callsInScope(scope);
  const active = parseChips(params);
  const counts = chipCounts(rows, active);
  const filtered = applyChips(rows, active);
  const { rows: pageRows, page, hasOlder } = pageOf(filtered, parsePage(params));

  // The cards and the chart describe the scope, not the chip intersection
  // (ADR 0006): one stable population per screen, so they always agree with the
  // heading count above them.
  const stats = callStats(rows);
  const heading = scopeHeading(scope, rows.length);
  // The window the control draws even while a search ignores it — parsed from
  // the same URL, so clearing the keyword lands back on the operator's window.
  const window = parseWindow(params, now);
  const keyword = scope.kind === 'search' ? scope.keyword : '';
  // Under three characters there is no predicate at all, so the query was never
  // issued and the screen owes the operator the reason (ADR 0006).
  const tooShort =
    scope.kind === 'search' && scope.phonePatterns.length === 0 && scope.idPrefix === null;

  return (
    <>
      {/* The Overview's head shape, so the two screens carry the window in the
          same place: scope on the left, the window control and the search on
          the right, one under the other. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6 max-[900px]:grid-cols-1">
        <PageHead title="Calls">
          <Caveat as="span">{heading}</Caveat>
        </PageHead>

        <div className="flex flex-col items-end gap-2">
          <WindowControl
            base={BASE}
            window={window}
            extra={{ q: keyword, f: active.join(',') }}
            {...(scope.kind === 'search' ? { disabled: true, disabledNote: SEARCH_NOTE } : {})}
          />

          <form method="get" action={BASE} className="flex items-center gap-2">
            {/* The window rides along hidden, so a search does not forget which
                window the operator will come back to. */}
            {(['since', 'until'] as const).map((key) => {
              const value = first(params[key]);
              return value === undefined || value === '' ? null : (
                <input key={key} type="hidden" name={key} value={value} />
              );
            })}
            {active.length === 0 ? null : <input type="hidden" name="f" value={active.join(',')} />}
            <input
              type="search"
              name="q"
              defaultValue={keyword}
              placeholder="Phone number or call id"
              aria-label="Search by phone number or call id"
              className="w-[280px] rounded-pill border border-border-hairline bg-surface-card px-4 py-2 font-num text-[length:var(--size-ui)]"
            />
            <button type="submit" className={`${PILL} ${PILL_ON} cursor-pointer`}>
              Search
            </button>
            {/* A fixed slot: "Clear" appears only while searching, and an
                appearing link must not shift the row it sits in. */}
            <span className="inline-block w-[48px]">
              {scope.kind === 'search' ? (
                <Link
                  href={hrefWith(params, { q: '', page: '' })}
                  className="text-[length:var(--size-ui)] font-medium text-text-link hover:underline"
                >
                  Clear
                </Link>
              ) : null}
            </span>
          </form>
        </div>
      </div>

      {/* A rejected window is answered with the default window and the reason,
          never an empty screen (ADR 0006). */}
      {window.error === undefined ? null : <Caveat>{window.error}</Caveat>}

      {rows.length === 0 ? (
        <Card>
          {tooShort ? (
            <EmptyState title="A keyword under three characters matches nothing.">
              Type at least three digits of the number, or the first characters of the call id.
            </EmptyState>
          ) : scope.kind === 'search' ? (
            <EmptyState title={`No call matches “${scope.keyword}”.`}>
              The search covers all history. A number the retention sweep has already
              cleared from the call row cannot be found by it, however recent the call
              (trap 5) — search the call id instead.
            </EmptyState>
          ) : (
            <EmptyState title="No calls in this window.">
              The pipeline writes a row when a call starts. Widen the window, or check that the
              calls you expect are older than the retention sweep allows.
            </EmptyState>
          )}
        </Card>
      ) : (
        <>
          <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_444px]">
            <Timeline {...callsTimeline(rows, scope, now)} />
            <StatRow stats={stats} />
          </div>

          <ChipStrip
            base={BASE}
            params={params}
            active={active}
            counts={counts}
            allHref={hrefWith(params, { f: '', page: '' })}
          />

          <Card>
            {filtered.length === 0 && active.length > 0 ? (
              <EmptyState title="No call in this scope is like that.">
                The chips intersect. Drop one, or{' '}
                <Link href={hrefWith(params, { f: '', page: '' })} className="text-text-link">
                  show all {String(counts.all)}
                </Link>
                .
              </EmptyState>
            ) : pageRows.length === 0 ? (
              <EmptyState title={`Page ${String(page)} is past the end of this scope.`}>
                <Link href={hrefWith(params, { page: '' })} className="text-text-link">
                  Back to the first page
                </Link>
                .
              </EmptyState>
            ) : (
              <CallTable bands={dayBands(pageRows)} config={config} now={now} />
            )}

            {/* Paging is said only when there is more than one page; a list
                that fits needs no footer. */}
            {hasOlder || page > 1 ? (
              <div className="flex items-center justify-end border-t border-border-hairline pt-4">
                {hasOlder ? (
                  <Link
                    href={hrefWith(params, { page: String(page + 1) })}
                    className="text-[length:var(--size-ui)] font-medium text-text-link hover:underline"
                  >
                    Older calls →
                  </Link>
                ) : (
                  <Caveat>the oldest page of this list</Caveat>
                )}
              </div>
            ) : null}
          </Card>
        </>
      )}
    </>
  );
}
