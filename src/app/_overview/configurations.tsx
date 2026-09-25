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
 *
 * The group-by control is `group-control.tsx`: changing it replaces the URL's
 * `group` and re-renders this screen in place (ADR 0006: the URL stays the
 * whole input).
 */

import { formatMs, formatNumber } from '@/calls';
import { type Grouping, type Dashboard, snapshotValue } from '@/dashboard';
import { TARGETS } from '@/latency';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import type { Term as GlossaryTerm } from '@/ui/glossary';
import HBar from '@/ui/hbar';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Term from '@/ui/term';
import GroupControl from './group-control';
import { groupingHeader, SPAN } from './overview';

export default function Configurations({
  data,
  grouping,
  hidden,
  scales,
}: {
  data: Dashboard;
  grouping: Grouping;
  /** The window keys, re-emitted by the control's scripts-off submit. */
  hidden: Record<string, string>;
  /** The headline's axes, so a group's gauge reads against the same target line. */
  scales: { pipeline: number; perceived: number };
}) {
  return (
    <Card
      title="Configurations compared"
      {...(grouping === 'config' ? { sub: 'Only the keys the snapshots disagree on' } : {})}
      actions={<GroupControl grouping={grouping} hidden={hidden} />}
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
                <Th>{groupingHeader(grouping)}</Th>
                {data.differingKeys.map((key) => (
                  <Th key={key} align="end">
                    <code className="font-num">{key}</code>
                  </Th>
                ))}
                {/* Group rows are built from turn rows, so an unconsented call
                    is in no group at all (trap 1). */}
                <Th align="end" hint="calls with turns on record">
                  Calls
                </Th>
                <Th align="end">Turns</Th>
                <Th>
                  <SpanHead term={SPAN.pipeline}>
                    P95 · target {formatNumber(TARGETS.pipelineP95Ms)}
                  </SpanHead>
                </Th>
                <Th>
                  <SpanHead term={SPAN.perceived}>
                    P95 · alarm {formatNumber(TARGETS.perceivedP95AlarmMs)}
                  </SpanHead>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((group) => (
                <tr key={group.key}>
                  <Td>
                    {/* A model id, a voice id or a build SHA: verbatim (ADR 0013 decision 2). */}
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
    </Card>
  );
}

/**
 * A headline span as a column header: its name over its pipeline term, then
 * the target. Without the span's description as a tooltip — the Reply latency
 * card carries it — because a header inside the table's scroll box, at its
 * right edge, would open one past the box and scroll it sideways.
 */
function SpanHead({ term, children }: { term: GlossaryTerm; children: string[] | string }) {
  return (
    <span className="flex flex-col items-start font-normal normal-case">
      <Term term={{ name: term.name, code: term.code }} />
      <span className="font-semibold">{children}</span>
    </span>
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
    <div className="min-w-[120px] pt-1">
      <HBar
        thick
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
