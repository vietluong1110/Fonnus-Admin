/*
 * Overview (`/`) — what the operator reads after a deploy or a configuration
 * edit: whether the reply got faster, where its time goes, how calls ended,
 * which turns failed where, and which configuration group is winning. The loop
 * this screen serves is `CONTEXT.md` §Why now; the layout is the artboard
 * `docs/design/Main-html`.
 *
 * The URL is the whole input (ADR 0006): `since` / `until` for the window,
 * `group` for the comparison (ADR 0009), `outside=all` for the full list of
 * turns outside the percentile. Nothing is held in component state, so a screen
 * pasted into chat is the screen the next reader sees.
 */

import { formatNumber, formatWhen } from '@/calls';
import { GROUPINGS, type Grouping, RUNTIME_VERSION_KEY, aggregate, parseGroup, snapshotKeys } from '@/dashboard';
import { TARGETS } from '@/latency';
import { dashboardWindow } from '@/queries/dashboard';
import Badge from '@/ui/badge';
import Caveat from '@/ui/caveat';
import PageHead from '@/ui/page-head';
import WindowControl from '@/ui/window-control';
import { parseWindow } from '@/window';
import CallsPerDay from './_overview/calls-per-day';
import Configurations from './_overview/configurations';
import HowCallsEnded from './_overview/how-calls-ended';
import Outside from './_overview/outside';
import ReplyComposition from './_overview/reply-composition';
import ReplyLatency, { gaugeScale } from './_overview/reply-latency';
import TurnFailures from './_overview/turn-failures';

// The Overview is about the database right now; nothing here may be prerendered.
export const dynamic = 'force-dynamic';

/** A query string key can arrive repeated; the first value is the answer. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const window = parseWindow(params, new Date());
  const grouping = parseGroup(first(params.group));
  const showAll = first(params.outside) === 'all';

  // One client, one REPEATABLE READ transaction: the calls and the turns are
  // the same snapshot of the database (`src/queries/dashboard.ts`).
  const { calls, turns } = await dashboardWindow(window);
  const data = aggregate(calls, turns, grouping);
  const callsById = new Map(calls.map((call) => [call.id, call]));

  // The `key:` options are the keys the window's own snapshots carry, plus the
  // one derived path (ADR 0009). A grouping asked for by hand that none of them
  // has is kept in the list, so the select still shows what is being rendered.
  const options: Grouping[] = [
    ...GROUPINGS,
    `key:${RUNTIME_VERSION_KEY}`,
    ...snapshotKeys(calls).map((key): Grouping => `key:${key}`),
  ];
  if (!options.includes(grouping)) options.push(grouping);

  // Trap 1 / CONTEXT.md trap 6: every percentile on this screen is drawn from
  // turn rows, and an unconsented call has none. The sentence travels with the
  // numbers, on the card, never in a footnote.
  const standsOn = `consented calls only — ${formatNumber(data.consentedCalls)} of ${formatNumber(
    data.calls,
  )} calls, ${formatNumber(data.turns)} turns${
    // A turn whose `marks` column is null is in no percentile and in no count
    // above — the same rows the pipeline's own reader filters out — so the
    // caveat says how many were set aside rather than leaving them invisible.
    data.turnsWithoutMarks > 0
      ? `. ${formatNumber(data.turnsWithoutMarks)} more without marks, excluded from every number`
      : ''
  }`;

  // One axis per headline span, wide enough for the headline and for every
  // group, so a group's gauge reads against the same target line.
  const scales = {
    pipeline: gaugeScale(TARGETS.pipelineP95Ms, [
      data.pipeline.p95,
      ...data.groups.map((group) => group.pipeline.p95),
    ]),
    perceived: gaugeScale(TARGETS.perceivedP95AlarmMs, [
      data.perceived.p95,
      ...data.groups.map((group) => group.perceived.p95),
    ]),
  };

  // The screen's other keys, re-emitted by every control that navigates.
  const carried: Record<string, string> = {
    ...(grouping === 'none' ? {} : { group: grouping }),
    ...(showAll ? { outside: 'all' } : {}),
  };
  const allOutside = new URLSearchParams({
    since: window.spec,
    ...(window.until === null ? {} : { until: first(params.until) ?? '' }),
    ...(grouping === 'none' ? {} : { group: grouping }),
    outside: 'all',
  });

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6 max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-1.5">
          <PageHead title="Overview" />
          <Caveat>
            {standsOn}. Calls answered since {formatWhen(window.since)}
            {window.until === null ? '' : `, up to ${formatWhen(window.until)}`}.
          </Caveat>
        </div>
        <WindowControl base="/" window={window} extra={carried} />
      </div>

      {window.error === undefined ? null : (
        <div>
          <Badge tone="warning">{window.error}</Badge>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-stretch gap-[18px] max-[1100px]:grid-cols-1">
        <ReplyLatency data={data} standsOn={standsOn} scales={scales} />
        <CallsPerDay data={data} />
      </div>

      <ReplyComposition data={data} standsOn={standsOn} />

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-stretch gap-[18px] max-[1100px]:grid-cols-1">
        <HowCallsEnded data={data} />
        <TurnFailures data={data} />
      </div>

      <Configurations
        data={data}
        grouping={grouping}
        options={options}
        hidden={{
          since: window.spec,
          ...(window.until === null ? {} : { until: first(params.until) ?? '' }),
          ...(showAll ? { outside: 'all' } : {}),
        }}
        scales={scales}
        standsOn={standsOn}
      />

      <Outside
        turns={data.outside}
        callsById={callsById}
        showAll={showAll}
        allHref={`/?${allOutside.toString()}`}
      />
    </>
  );
}
