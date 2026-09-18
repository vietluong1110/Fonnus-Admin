/*
 * "Configurations compared" — one row per group, the two headline P95s on the
 * headline's own scale, and only the settings the groups disagree on beside
 * them. Layout: `docs/design/Main-html` band 4.
 *
 * The comparison rules are ADR 0009: the differing columns are the top-level
 * flat keys plus the one derived `runtime.version`, never the `runtime.config`
 * leaves, and the three renamed Deepgram keys read either spelling. Two calls
 * on the same build with one changed key are the comparison the hypothesis loop
 * is made of (`CONTEXT.md` §Why now).
 */

import { formatMs, formatNumber } from '@/calls';
import {
  type Grouping,
  RUNTIME_VERSION_KEY,
  type Dashboard,
  snapshotValue,
} from '@/dashboard';
import { TARGETS } from '@/latency';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import HBar from '@/ui/hbar';
import { Table, TableScroll, Td, Th } from '@/ui/table';

/** How a grouping reads in the select and in the card's subtitle. */
export function groupingLabel(grouping: Grouping): string {
  if (grouping === 'none') return 'no grouping';
  if (grouping === 'config') return 'config_snapshot (the whole object)';
  if (grouping === `key:${RUNTIME_VERSION_KEY}`) return 'Runtime config row';
  if (grouping.startsWith('key:')) return `config_snapshot → ${grouping.slice('key:'.length)}`;
  return grouping;
}

export default function Configurations({
  data,
  grouping,
  options,
  hidden,
  scales,
  standsOn,
}: {
  data: Dashboard;
  grouping: Grouping;
  options: Grouping[];
  /** The window keys, re-emitted so changing the grouping keeps the window. */
  hidden: Record<string, string>;
  scales: { pipeline: number; perceived: number };
  standsOn: string;
}) {
  return (
    <Card
      title="Configurations compared"
      sub={
        grouping === 'config'
          ? `Grouped by ${groupingLabel(grouping)} — only the keys the snapshots disagree on`
          : `Grouped by ${groupingLabel(grouping)}`
      }
      actions={
        // A GET form, not a scripted control: the URL is the whole input
        // (ADR 0006), so a grouped screen is a pasteable address.
        <form method="get" action="/" className="flex flex-wrap items-end gap-2">
          {Object.entries(hidden).map(([key, value]) =>
            value === '' ? null : <input key={key} type="hidden" name={key} value={value} />,
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[length:var(--size-eyebrow)] text-text-muted">group by</span>
            <select
              name="group"
              defaultValue={grouping}
              className="w-64 rounded-sm border border-border-hairline bg-surface-card px-3 py-2 text-[length:var(--size-ui)]"
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {groupingLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-pill border border-border-hairline bg-surface-card px-[14px] py-2 font-ui text-[length:var(--size-ui)] font-medium text-text-muted hover:bg-[var(--action-secondary-hover)]"
          >
            Show
          </button>
        </form>
      }
    >
      {grouping === 'none' ? (
        <Caveat>Nothing is grouped. Pick a setting above to compare configurations.</Caveat>
      ) : data.groups.length === 0 ? (
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
                    <code className="font-num">{key}</code>
                  </Th>
                ))}
                <Th align="end">
                  Calls
                  {/* Group rows are built from turn rows, so an unconsented call
                      is in no group at all (trap 1). */}
                  <Caveat>calls with turns on record</Caveat>
                </Th>
                <Th align="end">Turns</Th>
                <Th>
                  <code className="font-num">pipeline_ms</code> P95 · target{' '}
                  {formatNumber(TARGETS.pipelineP95Ms)}
                </Th>
                <Th>
                  <code className="font-num">caller_perceived_ms</code> P95 · alarm{' '}
                  {formatNumber(TARGETS.perceivedP95AlarmMs)}
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((group) => (
                <tr key={group.key}>
                  <Td>
                    <span className="font-num text-[13px]">{group.label}</span>
                  </Td>
                  {data.differingKeys.map((key) => (
                    <Td key={key} num>
                      {snapshotValue(group.snapshot, key)}
                    </Td>
                  ))}
                  <Td num>{formatNumber(group.calls)}</Td>
                  <Td num>{formatNumber(group.turns)}</Td>
                  <Td>
                    <GroupGauge
                      p95={group.pipeline.p95}
                      target={TARGETS.pipelineP95Ms}
                      scale={scales.pipeline}
                    />
                  </Td>
                  <Td>
                    <GroupGauge
                      p95={group.perceived.p95}
                      target={TARGETS.perceivedP95AlarmMs}
                      scale={scales.perceived}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
      <Caveat>
        Both gauges share the scale of the headline above, so a group reads against the same
        target line. {standsOn}
      </Caveat>
    </Card>
  );
}

/** One group's P95 on the headline axis, with the target as the same notch. */
function GroupGauge({
  p95,
  target,
  scale,
}: {
  p95: number | null;
  target: number;
  scale: number;
}) {
  if (p95 === null) return <Caveat as="span">no sample</Caveat>;
  const over = p95 > target;
  return (
    <div className="min-w-[120px]">
      <HBar
        from={0}
        to={p95}
        scaleMax={scale}
        tone={over ? 'var(--error)' : 'var(--chart-1)'}
        target={target}
      />
      <div
        className={`mt-1.5 font-num text-[14px] font-semibold tabular-nums ${over ? 'text-error' : 'text-success'}`}
      >
        {formatMs(p95)}
      </div>
    </div>
  );
}
