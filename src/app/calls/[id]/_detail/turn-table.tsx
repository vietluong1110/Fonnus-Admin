'use client';

/*
 * Every turn of the call as one table — one row each, not one card each. A
 * click on a row selects that turn, as a click on its bubble does: the audio
 * pauses at the turn's start and the Selected turn card follows.
 *
 * The caller's preview has already passed `showCallerData` on the server
 * (trap 4, ADR 0005): a withheld row receives no caller text at all, only the
 * outcome to say in its place. The timings and costs are never withheld — a
 * latency is not caller speech.
 */

import { Fragment } from 'react';
import { formatCount, formatMs, formatNumber } from '@/calls';
import { PRICE_SOURCE_TIP, STT_PER_TURN_TIP } from '@/cost';
import { TARGETS } from '@/latency';
import { currentTurnIdx, type TurnSpan } from '@/playback';
import Badge from '@/ui/badge';
import Caveat from '@/ui/caveat';
import { termFor, type Term as GlossaryTerm } from '@/ui/glossary';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Term from '@/ui/term';
import Tooltip from '@/ui/tooltip';
import Vocabulary from '@/ui/vocabulary';
import { usePlayback } from '../playback-provider';
import type { TurnCostCells } from './turn-view';

/** One row, prepared on the server: no query result crosses the boundary. */
export interface TurnTableRow {
  idx: number;
  interrupted: boolean;
  /** `failureChip(...)`, or null when `failed_leg` is null (trap 7). */
  failure: GlossaryTerm | null;
  /** `failureLine(...)` — the chip's tooltip, elapsed from `endpoint_decision`. */
  failureLine: string | null;
  /** The first words of the turn, caller then assistant; null = nothing to show. */
  preview: string | null;
  /** True when the consent gate withholds the caller's side of the preview. */
  callerWithheld: boolean;
  /** What to say in place of withheld text: the outcome, or the call's state. */
  withheldReason: string;
  withheldReasonKnown: boolean;
  /** True when the reason is the call's state, not a consent outcome (trap 2). */
  withheldByState: boolean;
  costs: TurnCostCells;
  tokensIn: number | null;
  tokensOut: number | null;
  /** A share of `tokens_in`, never on top of it (`docs/upstream.md`). */
  tokensCached: number | null;
  perceivedMs: number | null;
  pipelineMs: number | null;
}

/** ADR 0015 decision 5's sentence, verbatim: why the per-turn cells never add up to the total. */
const TURN_COST_NOTE =
  "Per-turn figures are list price over the turns on record; the call total above is the pipeline's figure at finalize and also covers speech-to-text and the greeting and canned lines.";

const PIPELINE = termFor('span', 'pipeline_ms');
const PERCEIVED = termFor('span', 'caller_perceived_ms');

/**
 * A glossary term as a column header: name over code, its description as the
 * header's tooltip. The `Th` hint is used rather than `Term`'s own tooltip,
 * which opens above and would be clipped by the table's scroll wrapper.
 */
function HeadTerm({ term, align }: { term: GlossaryTerm | null; align: 'start' | 'end' }) {
  if (term === null) return null;
  return (
    <Th align={align} {...(term.description === undefined ? {} : { hint: term.description })}>
      <span className="inline-flex flex-col items-end">
        <span>{term.name}</span>
        {/* A narrow column breaks the code after an underscore, never mid-word;
            `<wbr>` adds no character, so a copied code is still the code. */}
        <code className="font-num text-[length:var(--size-eyebrow)] font-normal tracking-normal">
          {term.code.split('_').map((part, index) => (
            <Fragment key={index}>
              {index === 0 ? null : (
                <>
                  _<wbr />
                </>
              )}
              {part}
            </Fragment>
          ))}
        </code>
      </span>
    </Th>
  );
}

export default function TurnTable({ rows, spans }: { rows: TurnTableRow[]; spans: TurnSpan[] }) {
  const { playheadMs, selectedIdx, seek, select, audioRef } = usePlayback();
  const currentIdx = currentTurnIdx(spans, playheadMs, selectedIdx, rows[0]?.idx ?? null);

  const choose = (idx: number): void => {
    // Paused at the turn's start, as a click on its bubble leaves it. Seek
    // first: a seek that leaves a selected turn clears the selection, and this
    // row's turn must be the one left standing. A turn with no place on the
    // recording still selects — the only selection such a call has.
    audioRef.current?.pause();
    const span = spans.find((each) => each.idx === idx);
    if (span !== undefined) seek(span.startMs);
    select(idx);
  };

  return (
    <>
      <TableScroll>
        <div className="min-w-[880px]">
          <Table>
            {/* The numbers take what they need; Said, the one prose column, takes the rest. */}
            <colgroup>
              <col className="w-14" />
              <col />
              <col span={7} className="w-20" />
            </colgroup>
            <thead>
              <tr>
                <Th align="end">Turn</Th>
                <Th>Said</Th>
                <Th align="end" hint={STT_PER_TURN_TIP}>
                  STT cost
                </Th>
                <Th align="end" hint={PRICE_SOURCE_TIP}>
                  <span className="inline-flex flex-col items-end">
                    LLM cost
                    {/* Once for the three cost columns, on the middle one. */}
                    <Caveat as="span">list price</Caveat>
                  </span>
                </Th>
                <Th align="end" hint={PRICE_SOURCE_TIP}>
                  TTS cost
                </Th>
                <Th align="end" hint="tokens_in; of which cached in each cell's tooltip">
                  LLM tokens in
                </Th>
                <Th align="end" hint="tokens_out">
                  LLM tokens out
                </Th>
                <HeadTerm term={PIPELINE} align="end" />
                <HeadTerm term={PERCEIVED} align="end" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const current = row.idx === currentIdx;
                return (
                  <tr
                    key={row.idx}
                    onClick={() => {
                      choose(row.idx);
                    }}
                    aria-current={current ? 'true' : undefined}
                    className={`cursor-pointer hover:bg-[var(--action-ghost-hover)] ${
                      current ? 'bg-[var(--action-ghost-hover)]' : ''
                    }`}
                  >
                    <Td num>
                      {/* The keyboard's way to the same selection; the row's
                          click is the pointer's. */}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          choose(row.idx);
                        }}
                        aria-pressed={current}
                        className="rounded-[var(--radius-pill)] font-num font-medium text-text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                      >
                        {formatNumber(row.idx)}
                      </button>
                    </Td>
                    <Td>
                      {/* The turn's state over its words: the chip is wide, and
                          this is the one column with room for it. */}
                      {row.interrupted || row.failure !== null ? (
                        <span className="mb-1 flex flex-wrap gap-1">
                          {row.interrupted ? <Badge tone="terracotta">interrupted</Badge> : null}
                          {row.failure === null ? null : (
                            <Badge tone="error" dot>
                              <Term
                                term={row.failure}
                                layout="inline"
                                {...(row.failureLine === null ? {} : { hint: row.failureLine })}
                              />
                            </Badge>
                          )}
                        </span>
                      ) : null}
                      <span className="line-clamp-2 text-text-muted">
                        {row.callerWithheld ? (
                          row.withheldByState ? (
                            // Trap 2: no consent row is a state of the call, never a refusal.
                            <>caller text withheld — the call is {row.withheldReason}</>
                          ) : (
                            <>
                              caller text withheld —{' '}
                              <Vocabulary
                                value={row.withheldReason}
                                known={row.withheldReasonKnown}
                                of="consentOutcome"
                              />
                            </>
                          )
                        ) : (
                          (row.preview ?? 'not on record')
                        )}
                      </span>
                    </Td>
                    {/* The header's tooltip says why; one per row would be a tab stop each. */}
                    <Td num>{row.costs.stt}</Td>
                    <Td num>{row.costs.llm}</Td>
                    <Td num>{row.costs.tts}</Td>
                    <Td num>
                      {row.tokensCached === null ? (
                        formatCount(row.tokensIn)
                      ) : (
                        <Tooltip
                          tip={`of which cached: ${formatCount(row.tokensCached)}`}
                          align="end"
                        >
                          {formatCount(row.tokensIn)}
                        </Tooltip>
                      )}
                    </Td>
                    <Td num>{formatCount(row.tokensOut)}</Td>
                    <Td num>
                      <span
                        className={
                          row.pipelineMs !== null && row.pipelineMs > TARGETS.pipelineP95Ms
                            ? 'font-semibold text-error'
                            : ''
                        }
                      >
                        {formatMs(row.pipelineMs)}
                      </span>
                    </Td>
                    <Td num>{formatMs(row.perceivedMs)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </TableScroll>
      {/* ADR 0015 decision 5: the per-turn cells never add up to the stored
          total, and this sentence says why — only under rows it qualifies. */}
      {rows.length === 0 ? null : (
        <Caveat className="mt-2">{TURN_COST_NOTE}</Caveat>
      )}
    </>
  );
}
