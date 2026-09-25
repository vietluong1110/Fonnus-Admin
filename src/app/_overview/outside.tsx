/*
 * "Turns that never became audible" — the turns whose marks carry no
 * `first_audio_out` (the reply never became audible, so neither headline span
 * exists) and the turns whose `marks` column is null (nothing about the reply
 * is known). Layout: `docs/design/Main-html` band 5.
 *
 * Each row opens the call at that turn, which is where the loop continues: a
 * number on this screen becomes a hypothesis on the call review. Newest first,
 * so the preview is the turns the last change produced.
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
import { failureChip, turnSourceTerm } from '@/ui/glossary';
import LinkRow from '@/ui/link-row';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Term from '@/ui/term';
import Vocabulary from '@/ui/vocabulary';
import { newestFirst, SPAN } from './overview';

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
  const ordered = newestFirst(turns, callsById);
  const shown = showAll ? ordered : ordered.slice(0, OUTSIDE_PREVIEW);

  return (
    <Card
      title="Turns that never became audible"
      sub="no first audio out, or the turn carries no marks — outside every percentile"
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
                <Th>What failed</Th>
                <Th>Turn ended by</Th>
                {/* Trap 7: the elapsed time, never the bound that tripped. The
                    table's right edge, so the tooltip ends there. */}
                <Th align="end" hint={SPAN.failedAfter.description ?? SPAN.failedAfter.name}>
                  {/* The header's own tooltip carries the description, so the
                      term shows name and code only. */}
                  <Term
                    term={{ name: SPAN.failedAfter.name, code: SPAN.failedAfter.code }}
                    align="end"
                  />
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
                          <WhatFailed leg={turn.failed_leg} stage={turn.failed_stage} />
                        )}
                        {turn.interrupted ? <Badge>interrupted</Badge> : null}
                      </span>
                    </Td>
                    <Td>
                      <TurnEndedBy source={turn.source} />
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

/**
 * The failure as one chip (ADR 0013 §Turn failure): "LLM · provider error"
 * with the pipeline's `llm` beside it. A leg or stage outside the contract's
 * list keeps its ⚠ badge instead (contract §4: the vocabularies grow).
 */
function WhatFailed({ leg, stage }: { leg: string; stage: string | null }) {
  const legKnown = isKnownFailedLeg(leg);
  const stageKnown = stage === null || isKnownFailedStage(stage);
  const chip = failureChip(leg, stage);
  if (legKnown && stageKnown && chip !== null) {
    return (
      <Badge tone="error" dot>
        <Term term={chip} layout="inline" />
      </Badge>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Vocabulary value={leg} known={legKnown} of="failedLeg" />
      <span className="text-text-muted">·</span>
      {/* §3.1: a null stage under a set leg is a provider error. */}
      {stage === null ? (
        <Caveat as="span">provider error</Caveat>
      ) : (
        <Vocabulary value={stage} known={stageKnown} of="failedStage" />
      )}
    </span>
  );
}

/**
 * `turn.source`, the open vocabulary: its two fixed values by name, any other
 * value as the vendor's end-of-speech signal with the value inside the name
 * (contract §3.1 — printed as-is, never ⚠). Null is no source on record.
 */
function TurnEndedBy({ source }: { source: string | null }) {
  const term = turnSourceTerm(source);
  return term === null ? <>—</> : <Term term={term} />;
}
