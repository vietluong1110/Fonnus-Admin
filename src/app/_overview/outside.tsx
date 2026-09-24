/*
 * "Turns outside the percentile" — the turns whose marks carry no
 * `first_audio_out` (the reply never became audible, so neither headline span
 * exists) and the turns whose `marks` column is null (nothing about the reply
 * is known). Layout: `docs/design/Main-html` band 5.
 *
 * Each row opens the call at that turn, which is where the loop continues: a
 * number on this screen becomes a hypothesis on the call review.
 */

import Link from 'next/link';
import {
  formatMs,
  formatNumber,
  formatWhen,
  isKnownFailedLeg,
  isKnownFailedStage,
} from '@/calls';
import type { DashboardCall, DashboardTurn } from '@/queries/dashboard';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import LinkRow from '@/ui/link-row';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Vocabulary from '@/ui/vocabulary';

/** How many rows the card shows before the operator asks for all of them. */
export const OUTSIDE_PREVIEW = 6;

export default function Outside({
  turns,
  callsById,
  showAll,
  allHref,
}: {
  turns: DashboardTurn[];
  callsById: Map<string, DashboardCall>;
  showAll: boolean;
  /** `?outside=all` with the window and the grouping kept (ADR 0006). */
  allHref: string;
}) {
  const shown = showAll ? turns : turns.slice(0, OUTSIDE_PREVIEW);

  return (
    <Card
      title="Turns outside the percentile"
      sub="the reply never became audible, or the turn carries no marks"
      actions={
        <span
          className={`font-num text-[20px] font-semibold tabular-nums ${turns.length > 0 ? 'text-warning' : ''}`}
        >
          {formatNumber(turns.length)}
        </span>
      }
    >
      {turns.length === 0 ? (
        <Caveat>none in this window</Caveat>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Call</Th>
                <Th align="end">Turn</Th>
                <Th>Failure</Th>
                <Th>
                  <code className="font-num">source</code>
                </Th>
                {/* Trap 7: the elapsed time, never the bound that tripped. */}
                <Th align="end" hint="elapsed since endpoint_decision, never the bound that tripped">
                  <code className="font-num">failed_after_ms</code>
                </Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((turn) => {
                const call = callsById.get(turn.call_id);
                const href = `/calls/${turn.call_id}?turn=${String(turn.idx)}`;
                return (
                  // The whole row opens the call, as the call list's rows do;
                  // the first cell keeps the real anchor.
                  <LinkRow key={`${turn.call_id}-${String(turn.idx)}`} href={href}>
                    <Td>
                      <Link href={href} className="text-text-link hover:underline">
                        {call === undefined ? turn.call_id : formatWhen(call.started_at)}
                      </Link>
                    </Td>
                    <Td num>{formatNumber(turn.idx)}</Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-2">
                        {turn.marks === null ? (
                          <Badge tone="warning" dot>
                            marks null
                          </Badge>
                        ) : turn.failed_leg === null ? (
                          <Caveat as="span">no failed leg</Caveat>
                        ) : (
                          <>
                            <Badge tone="error" dot>
                              <Vocabulary
                                value={turn.failed_leg}
                                known={isKnownFailedLeg(turn.failed_leg)}
                              />
                              {turn.failed_stage === null ? null : (
                                <>
                                  {' · '}
                                  <Vocabulary
                                    value={turn.failed_stage}
                                    known={isKnownFailedStage(turn.failed_stage)}
                                  />
                                </>
                              )}
                            </Badge>
                            {turn.failed_stage === null ? (
                              // §3.1: a null stage under a set leg is a
                              // provider error, which had no deadline to trip.
                              <Caveat as="span">provider error</Caveat>
                            ) : null}
                          </>
                        )}
                        {turn.interrupted ? <Badge>interrupted</Badge> : null}
                      </span>
                    </Td>
                    <Td>
                      {turn.source ?? '—'}
                    </Td>
                    <Td num>{turn.failed_after_ms === null ? '—' : formatMs(turn.failed_after_ms)}</Td>
                  </LinkRow>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      )}

      {showAll || turns.length <= OUTSIDE_PREVIEW ? null : (
        <div className="flex justify-end">
          <Link
            href={allHref}
            className="text-[length:var(--size-ui)] font-medium text-text-link hover:underline"
          >
            See all {formatNumber(turns.length)} →
          </Link>
        </div>
      )}
    </Card>
  );
}
