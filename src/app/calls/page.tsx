import Link from 'next/link';
import { isFetchable } from '@/artifacts';
import {
  callState,
  consentOutcomeTone,
  endReasonTone,
  formatCount,
  formatDuration,
  formatNumber,
  formatWhen,
  isConsentGranted,
  isKnownConsentOutcome,
  isKnownEndReason,
  isOrdinaryEnding,
  parseCostVnd,
} from '@/calls';
import { CALL_LIST_LIMIT, type CallListRow, listCalls } from '@/queries/calls';
import CallStateBlock from '@/ui/call-state';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import Icon from '@/ui/icon';
import LinkRow from '@/ui/link-row';
import PageHead from '@/ui/page-head';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Vocabulary from '@/ui/vocabulary';

// The list is about the database right now; nothing here may be prerendered.
export const dynamic = 'force-dynamic';

/**
 * How the call ended, in one cell: the consent outcome and the end reason
 * together. The ordinary ending is said quietly and every exception wears the
 * tone it already had elsewhere (`docs/upstream.md` §Call list). Only the
 * exceptional half is drawn — a consented call that hit `max_duration` shows
 * the end reason alone, because a granted consent was never the news.
 */
function Ending({ call }: { call: CallListRow }) {
  const { outcome, end_reason: endReason } = call;

  if (isOrdinaryEnding(outcome, endReason)) {
    // The pipeline's own word, not a translation of it (CONTEXT.md §Language);
    // the gloss sits once in the column header.
    return <span className="text-text-muted">caller_hangup</span>;
  }

  const state = callState(call.ended_at, outcome);

  return (
    <div className="flex flex-col items-start gap-1">
      {outcome === null ? (
        // Trap 2: no consent row is a state of the call, never "no consent".
        <CallStateBlock state={state} />
      ) : isConsentGranted(outcome) ? null : (
        <Vocabulary
          value={outcome}
          known={isKnownConsentOutcome(outcome)}
          tone={consentOutcomeTone(outcome)}
        />
      )}
      {endReason === null || endReason === 'caller_hangup' ? null : (
        <Vocabulary
          value={endReason}
          known={isKnownEndReason(endReason)}
          tone={endReasonTone(endReason)}
        />
      )}
      {endReason === null && state === 'finalized' ? (
        <span className="text-text-muted">end reason not on record</span>
      ) : null}
    </div>
  );
}

export default async function CallsPage() {
  const calls = await listCalls(CALL_LIST_LIMIT);

  return (
    <>
      <PageHead title="Calls">
        <Caveat as="span">
          the {formatNumber(CALL_LIST_LIMIT)} most recent calls, newest first
        </Caveat>
      </PageHead>

      {calls.length === 0 ? (
        <Card>
          <EmptyState title="No calls on record.">
            The pipeline writes a row when a call starts; none has yet, or the retention sweep
            has taken them.
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>
                    Caller
                    {/* Trap 5: a null number may be the retention sweep's work. */}
                    <Caveat>not on record = expired by retention, or never written</Caveat>
                  </Th>
                  <Th align="end">Duration</Th>
                  <Th>
                    How it ended
                    {/* The gloss for the quiet default, said once (§Language). */}
                    <Caveat>quiet = granted, then caller_hangup — the caller hung up</Caveat>
                  </Th>
                  <Th align="end">
                    Turns on record
                    {/* Trap 1: rows written, not turns spoken. The caveat sits in
                        the header once, not on every row. */}
                    <Caveat>turns written; an unconsented call has none</Caveat>
                  </Th>
                  <Th>
                    Recording
                    {/* ADR 0004: a signal only — the player lives on the detail page. */}
                    <Caveat>in the bucket; open the call to play it</Caveat>
                  </Th>
                  <Th align="end">
                    Cost
                    {/* Trap 3: the column keeps no trace of the unpriced legs. */}
                    <Caveat>floor — unpriced models count 0</Caveat>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => {
                  const cost = parseCostVnd(call.total_cost_vnd);
                  return (
                    // The whole row is the click target; the first cell carries
                    // the real anchor the keyboard and a middle click use.
                    <LinkRow key={call.id} href={`/calls/${call.id}`}>
                      <Td>
                        <Link href={`/calls/${call.id}`} className="text-text-link hover:underline">
                          {formatWhen(call.started_at)}
                        </Link>
                      </Td>
                      <Td>
                        {call.caller_phone_e164 === null ? (
                          <span className="text-text-muted">not on record</span>
                        ) : (
                          <span className="font-num">{call.caller_phone_e164}</span>
                        )}
                      </Td>
                      <Td num>{formatDuration(call.started_at, call.ended_at)}</Td>
                      <Td>
                        <Ending call={call} />
                      </Td>
                      <Td num>{formatCount(call.turn_count)}</Td>
                      <Td>
                        {isFetchable(call.artifact_state, call.artifact_key_prefix) ? (
                          <span className="text-text-body" title="recording available">
                            <Icon name="play" size={16} />
                            <span className="sr-only">recording available</span>
                          </span>
                        ) : (
                          <span className="text-text-muted">not yet</span>
                        )}
                      </Td>
                      <Td num>{cost === null ? 'unpriced' : `≥ ${formatNumber(cost)} VND`}</Td>
                    </LinkRow>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      )}
    </>
  );
}
