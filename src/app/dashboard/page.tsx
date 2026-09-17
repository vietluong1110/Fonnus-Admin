import Link from 'next/link';
import {
  formatMs,
  formatNumber,
  formatWhen,
  isKnownFailedLeg,
  isKnownFailedStage,
  isKnownTurnSource,
} from '@/calls';
import {
  DEFAULT_SINCE,
  GROUPINGS,
  type Grouping,
  type Percentiles,
  aggregate,
  parseGroup,
  parseSince,
  snapshotKeys,
  snapshotValue,
} from '@/dashboard';
import { LEGS, TARGETS } from '@/latency';
import { dashboardSince } from '@/queries/dashboard';
import Badge from '@/ui/badge';
import Button from '@/ui/button';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import LinkRow from '@/ui/link-row';
import PageHead from '@/ui/page-head';
import Stat from '@/ui/stat';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Vocabulary from '@/ui/vocabulary';
import Trend from './trend';

// The dashboard is about the database right now; nothing here may be prerendered.
export const dynamic = 'force-dynamic';

/** A query string key can arrive repeated; the first value is the answer. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** How a grouping reads in the select. `key:` options name the snapshot key. */
function groupingLabel(grouping: Grouping): string {
  if (grouping === 'none') return 'no grouping';
  if (grouping === 'config') return 'config_snapshot (the whole object)';
  if (grouping.startsWith('key:')) return `config_snapshot → ${grouping.slice('key:'.length)}`;
  return grouping;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sinceSpec = first(params.since);
  const window = parseSince(sinceSpec, new Date());
  const grouping = parseGroup(first(params.group));

  // One client, one REPEATABLE READ transaction: the calls and the turns are
  // the same snapshot of the database (`src/queries/dashboard.ts`).
  const { calls, turns } = await dashboardSince(window.since);
  const data = aggregate(calls, turns, grouping);
  const callsById = new Map(calls.map((call) => [call.id, call]));

  // The `key:` options are the keys the window's own snapshots carry; a grouping
  // asked for by hand that none of them has is kept in the list so the select
  // still shows what the page is actually rendering.
  const options: Grouping[] = [
    ...GROUPINGS,
    ...snapshotKeys(calls).map((key): Grouping => `key:${key}`),
  ];
  if (!options.includes(grouping)) options.push(grouping);

  // Trap 1 / CONTEXT.md trap 6: every percentile below is drawn from turn rows,
  // and an unconsented call has none. The sentence travels with the numbers.
  const standsOn = `consented calls only — ${formatNumber(data.consentedCalls)} of ${formatNumber(
    data.calls,
  )} calls in the window, ${formatNumber(data.turns)} turns${
    // A turn whose `marks` column is null is in no percentile and in no count
    // above — the same rows the pipeline's own reader filters out — so the
    // caveat says how many were set aside rather than leaving them invisible.
    data.turnsWithoutMarks > 0
      ? ` (${formatNumber(data.turnsWithoutMarks)} more without marks, excluded from every number)`
      : ''
  }`;

  return (
    <>
      <PageHead title="Latency dashboard">
        <Caveat as="span">
          calls answered since {formatWhen(window.since)}
        </Caveat>
      </PageHead>

      {window.error === undefined ? null : (
        <div>
          <Badge tone="warning">{window.error}</Badge>
        </div>
      )}

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-[length:var(--size-eyebrow)] text-text-muted">
              since — <code>7d</code>, <code>36h</code>, <code>90m</code> or an ISO instant
            </span>
            <input
              type="text"
              name="since"
              defaultValue={sinceSpec ?? ''}
              placeholder={DEFAULT_SINCE}
              className="w-56 rounded-sm border border-border-hairline bg-surface-card px-3 py-2 font-num text-[length:var(--size-ui)]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[length:var(--size-eyebrow)] text-text-muted">group by</span>
            <select
              name="group"
              defaultValue={grouping}
              className="w-72 rounded-sm border border-border-hairline bg-surface-card px-3 py-2 text-[length:var(--size-ui)]"
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {groupingLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Show</Button>
        </form>
      </Card>

      {data.calls === 0 ? (
        <Card>
          <EmptyState title="No calls in this window.">
            Nothing was answered since {formatWhen(window.since)}. Widen the window, or check
            that the pipeline is taking calls.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title="Headline spans" sub="P95 over the window, against the ADR 0007 targets">
            <div className="grid grid-cols-2 gap-6 max-[700px]:grid-cols-1">
              <Headline
                label="pipeline_ms P95 — the tuning target"
                p95={data.pipeline.p95}
                target={TARGETS.pipelineP95Ms}
              />
              <Headline
                label="caller_perceived_ms P95 — the alarm budget"
                p95={data.perceived.p95}
                target={TARGETS.perceivedP95AlarmMs}
              />
            </div>
            <Caveat>{standsOn}</Caveat>
          </Card>

          <Card title="Per leg" sub="nearest-rank percentiles, the pipeline's own rule">
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <Th>Leg</Th>
                    <Th align="end">
                      Count
                      {/* The sample is turns that stamped BOTH marks of the leg,
                          which is never the turn count. */}
                      <Caveat>turns with both marks, not turns</Caveat>
                    </Th>
                    <Th align="end">P50</Th>
                    <Th align="end">P95</Th>
                    <Th align="end">Max</Th>
                  </tr>
                </thead>
                <tbody>
                  {LEGS.map((leg) => {
                    const pct = data.legs[leg.name];
                    return (
                      <tr key={leg.name}>
                        <Td>
                          <code>{leg.name}</code>
                          {leg.name === 'tts_ttfb' ? (
                            // CONTEXT.md trap 7: later sentences synthesize
                            // behind the one playing and are not in this leg.
                            <Caveat>first sentence of the reply only</Caveat>
                          ) : null}
                        </Td>
                        <Td num>{formatNumber(pct.count)}</Td>
                        <Td num>{formatMs(pct.p50)}</Td>
                        <Td num>{formatMs(pct.p95)}</Td>
                        <Td num>{formatMs(pct.max)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableScroll>
            <Caveat>{standsOn}</Caveat>
          </Card>

          <Card title="Trend by day" sub="P95 per day, in Asia/Ho_Chi_Minh">
            {data.turns === 0 ? (
              <EmptyState title="No turns in this window.">
                Every call in the window is unconsented, still running, or has only turns without
                marks, so there is nothing to measure.
              </EmptyState>
            ) : (
              <Trend days={data.byDay} />
            )}
          </Card>

          {grouping === 'none' ? null : (
            <Card
              title={`Grouped by ${groupingLabel(grouping)}`}
              {...(grouping === 'config'
                ? { sub: 'only the keys the configurations disagree on are shown' }
                : {})}
            >
              {data.groups.length === 0 ? (
                <EmptyState title="No turns to group.">
                  The window holds no turn row with marks, so no group can be formed.
                </EmptyState>
              ) : (
                <TableScroll>
                  <Table>
                    <thead>
                      <tr>
                        <Th>{grouping === 'config' ? 'Configuration' : 'Value'}</Th>
                        {data.differingKeys.map((key) => (
                          <Th key={key} align="end">
                            <code>{key}</code>
                          </Th>
                        ))}
                        <Th align="end">
                          Calls
                          <Caveat>calls with turns on record</Caveat>
                        </Th>
                        <Th align="end">Turns</Th>
                        <Th align="end">
                          <code>pipeline_ms</code> P95
                        </Th>
                        <Th align="end">
                          <code>caller_perceived_ms</code> P95
                        </Th>
                        {LEGS.map((leg) => (
                          <Th key={leg.name} align="end">
                            <code>{leg.name}</code> P95
                            {leg.name === 'tts_ttfb' ? (
                              <Caveat>first sentence only</Caveat>
                            ) : null}
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.groups.map((group) => (
                        <tr key={group.key}>
                          <Td>{group.label}</Td>
                          {data.differingKeys.map((key) => (
                            <Td key={key} num>
                              {snapshotValue(group.snapshot, key)}
                            </Td>
                          ))}
                          <Td num>{formatNumber(group.calls)}</Td>
                          <Td num>{formatNumber(group.turns)}</Td>
                          <Td num>{formatMs(group.pipeline.p95)}</Td>
                          <Td num>{formatMs(group.perceived.p95)}</Td>
                          {LEGS.map((leg) => (
                            <Td key={leg.name} num>
                              {legP95(group.legs[leg.name])}
                            </Td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableScroll>
              )}
              <Caveat>{standsOn}</Caveat>
            </Card>
          )}

          <Card
            title="Turns outside the percentile"
            sub="no first_audio_out mark — the reply never became audible — or no marks at all (the marks column is null, so nothing about the reply is known)"
          >
            {data.outside.length === 0 ? (
              <p className="mb-0 text-[length:var(--size-ui)] text-text-muted">
                none in this window
              </p>
            ) : (
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <Th>Call</Th>
                      <Th align="end">Turn</Th>
                      <Th>
                        <code>source</code>
                      </Th>
                      <Th>
                        <code>interrupted</code>
                      </Th>
                      <Th>
                        <code>failed_leg</code>
                      </Th>
                      <Th>
                        <code>failed_stage</code>
                      </Th>
                      <Th align="end">
                        <code>failed_after_ms</code>
                        {/* Trap 7: the elapsed time, never the bound that tripped. */}
                        <Caveat>elapsed since endpoint_decision, not the bound</Caveat>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.outside.map((turn) => {
                      const call = callsById.get(turn.call_id);
                      return (
                        // The whole row opens the call, as the call list's rows
                        // do; the first cell keeps the real anchor.
                        <LinkRow
                          key={`${turn.call_id}-${String(turn.idx)}`}
                          href={`/calls/${turn.call_id}`}
                        >
                          <Td>
                            <Link
                              href={`/calls/${turn.call_id}`}
                              className="text-text-link hover:underline"
                            >
                              {call === undefined ? turn.call_id : formatWhen(call.started_at)}
                            </Link>
                          </Td>
                          <Td num>
                            {formatNumber(turn.idx)}
                            {turn.marks === null ? <Caveat as="span"> (marks: null)</Caveat> : null}
                          </Td>
                          <Td>
                            <Vocabulary
                              value={turn.source}
                              known={turn.source !== null && isKnownTurnSource(turn.source)}
                            />
                          </Td>
                          <Td>{turn.interrupted ? 'yes' : 'no'}</Td>
                          <Td>
                            <Vocabulary
                              value={turn.failed_leg}
                              known={turn.failed_leg !== null && isKnownFailedLeg(turn.failed_leg)}
                            />
                          </Td>
                          <Td>
                            {turn.failed_leg !== null && turn.failed_stage === null ? (
                              // §3.1: a null stage under a leg is a provider
                              // error, which has no deadline stage — a dash
                              // would read as a missing measurement.
                              'provider error'
                            ) : (
                              <Vocabulary
                                value={turn.failed_stage}
                                known={
                                  turn.failed_stage !== null && isKnownFailedStage(turn.failed_stage)
                                }
                              />
                            )}
                          </Td>
                          <Td num>{formatMs(turn.failed_after_ms)}</Td>
                        </LinkRow>
                      );
                    })}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/**
 * One headline span against its ADR 0007 target. Over the target is `error`,
 * under it `success`; a window whose turns stamped no `first_audio_out` has no
 * P95 at all and gets no verdict, because "not measured" is not "fast".
 */
function Headline({ label, p95, target }: { label: string; p95: number | null; target: number }) {
  if (p95 === null) return <Stat label={label} value="not measured" />;
  const delta = p95 - target;
  const sign = delta > 0 ? '+' : delta < 0 ? '\u2212' : '\u00b1';
  return (
    <Stat
      label={label}
      value={formatNumber(p95)}
      unit="ms"
      delta={`${sign}${formatNumber(Math.abs(delta))} ms against the ${formatNumber(target)} ms target`}
      deltaTone={delta > 0 ? 'error' : 'success'}
    />
  );
}

/** A group's leg cell: the P95, or the reason there is none. */
function legP95(pct: Percentiles): string {
  return pct.count === 0 ? 'no sample' : formatMs(pct.p95);
}
