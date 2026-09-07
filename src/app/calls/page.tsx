import Link from 'next/link';
import {
  CALL_STATE_TONE,
  callState,
  consentOutcomeTone,
  endReasonTone,
  formatCount,
  formatDuration,
  formatNumber,
  formatWhen,
  isKnownConsentOutcome,
  isKnownEndReason,
  parseCostVnd,
} from '@/calls';
import { CALL_LIST_LIMIT, listCalls } from '@/queries/calls';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import PageHead from '@/ui/page-head';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Vocabulary from '@/ui/vocabulary';

// The list is about the database right now; nothing here may be prerendered.
export const dynamic = 'force-dynamic';

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
                  <Th align="end">Duration</Th>
                  <Th>End reason</Th>
                  <Th>Consent</Th>
                  <Th align="end">
                    Turns on record
                    {/* Trap 1: rows written, not turns spoken. The caveat sits in
                        the header once, not on every row. */}
                    <Caveat>turns written; an unconsented call has none</Caveat>
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
                  const state = callState(call.ended_at, call.outcome);
                  const stateTone = CALL_STATE_TONE[state];
                  const cost = parseCostVnd(call.total_cost_vnd);
                  return (
                    <tr key={call.id}>
                      <Td>
                        <Link href={`/calls/${call.id}`} className="text-text-link hover:underline">
                          {formatWhen(call.started_at)}
                        </Link>
                        <span className="block text-text-muted">
                          {call.did ?? 'no DID on record'} · {call.stt_model ?? 'stt not reported'}{' '}
                          · {call.tts_model ?? 'tts not reported'}
                        </span>
                      </Td>
                      <Td num>{formatDuration(call.started_at, call.ended_at)}</Td>
                      <Td>
                        <Vocabulary
                          value={call.end_reason}
                          known={call.end_reason !== null && isKnownEndReason(call.end_reason)}
                          tone={
                            call.end_reason === null ? undefined : endReasonTone(call.end_reason)
                          }
                        />
                      </Td>
                      <Td>
                        {call.outcome === null ? (
                          <>
                            {stateTone === null ? null : (
                              <Badge tone={stateTone}>
                                {state === 'in_progress' ? 'in progress' : 'not finalized'}
                              </Badge>
                            )}
                            <Caveat>
                              {state === 'in_progress'
                                ? 'the consent row is written at finalize'
                                : 'process died or finish failed'}
                            </Caveat>
                          </>
                        ) : (
                          <Vocabulary
                            value={call.outcome}
                            known={isKnownConsentOutcome(call.outcome)}
                            tone={consentOutcomeTone(call.outcome)}
                          />
                        )}
                      </Td>
                      <Td num>{formatCount(call.turn_count)}</Td>
                      <Td num>{cost === null ? 'unpriced' : `≥ ${formatNumber(cost)} VND`}</Td>
                    </tr>
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
