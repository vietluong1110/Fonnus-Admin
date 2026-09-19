'use client';

/*
 * The intervals as a table, one row per stretch of the recording clock (PLAN row
 * A1b, ADR 0010). The row under the playhead is highlighted and a click on a row
 * seeks the recording to where that interval starts — and selects the turn when
 * the interval has one, so the transcript and the waterfall follow, the same
 * `?turn=` contract the turn blocks use (ADR 0006).
 *
 * Every cell arrives as strings built on the server by `intervalCells`
 * (`src/intervals.ts`) — the annotation column as one already-rendered item per
 * row: the consent gate ran there, once, and no recogniser text and no
 * annotation text reaches this file that the gate did not pass (ADR 0005,
 * trap 4).
 */

import type { MouseEvent } from 'react';
import {
  DEAF_EXPLANATION,
  EMPTY_CELL,
  UNSUPPORTED_OPACITY,
  holderTone,
  rowAtPlayhead,
  rowTitle,
} from '@/interval-lane';
import type { IntervalCell } from '@/intervals';
import Badge from '@/ui/badge';
import { INTERACTIVE_SELECTOR, shouldFollowRow } from '@/ui/row-click';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Vocabulary from '@/ui/vocabulary';
import { usePlayback } from './playback-provider';

/** One interval as the card prints it, plus the two instants the playhead needs. */
export interface IntervalRow extends IntervalCell {
  /** On the recording clock, unclamped — `seekMs` is the clamped one. */
  fromMs: number;
  toMs: number;
}

export default function IntervalRows({ rows }: { rows: IntervalRow[] }) {
  const { playheadMs, seek, select } = usePlayback();
  const currentIndex = rowAtPlayhead(rows, playheadMs);

  /** Seek first: a seek clears the selection, so the click's own turn must follow it. */
  function go(row: IntervalRow): void {
    seek(row.seekMs);
    if (row.turnIdx !== null) select(row.turnIdx);
  }

  function onRowClick(event: MouseEvent<HTMLTableRowElement>, row: IntervalRow): void {
    const target = event.target;
    const follow = shouldFollowRow({
      button: event.button,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      defaultPrevented: event.defaultPrevented,
      onInteractive: target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null,
      hasTextSelection: window.getSelection()?.isCollapsed === false,
    });
    if (follow) go(row);
  }

  return (
    <TableScroll>
      <Table>
        <thead>
          <tr>
            <Th align="end">from</Th>
            <Th align="end">to</Th>
            <Th>holder</Th>
            <Th>caller line</Th>
            <Th>recogniser</Th>
            <Th>annotation</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${String(row.fromMs)}-${String(index)}`}
              onClick={(event) => {
                onRowClick(event, row);
              }}
              aria-current={index === currentIndex ? 'true' : undefined}
              title={rowTitle(row)}
              style={row.unsupported ? { opacity: UNSUPPORTED_OPACITY } : undefined}
              className={`cursor-pointer transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--action-ghost-hover)] ${
                index === currentIndex ? 'bg-[var(--action-ghost-hover)]' : ''
              }`}
            >
              <Td num>
                {/* The row's keyboard path: a real button, in the first cell,
                    doing exactly what a click on the row does. */}
                <button
                  type="button"
                  onClick={() => {
                    go(row);
                  }}
                  aria-label={`Seek to ${row.from} s, ${row.holder}`}
                  className="font-num tabular-nums underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  {row.from}
                </button>
              </Td>
              <Td num>{row.to}</Td>
              <Td>
                <Badge
                  tone={holderTone(row.holderKind)}
                  {...(row.holderKind === 'deaf' ? { title: DEAF_EXPLANATION } : {})}
                >
                  {row.holder}
                </Badge>
              </Td>
              <Td>{row.callerLine}</Td>
              <Td>
                {row.botText === null ? (
                  row.recogniser
                ) : (
                  // A bot interval has no recogniser output of its own, so the
                  // column carries what the bot said, in the bot's voice. It can
                  // still carry a signature: a canned line that produced no audio
                  // swallows the caller's records under it (ISSUES L10-260917-1).
                  <>
                    <span className="text-text-muted italic">{row.botText}</span>
                    {row.recogniser === EMPTY_CELL ? null : <div>{row.recogniser}</div>}
                  </>
                )}
              </Td>
              <Td>
                {/* What a person who heard the call wrote about this stretch
                    (contract §8; PLAN row A7). Current rows only, and the same
                    row appears on every interval it overlaps — an empty column
                    says so rather than leaving the cell blank. */}
                {row.annotations.length === 0 ? (
                  <span className="text-text-muted">{EMPTY_CELL}</span>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {row.annotations.map((annotation) => (
                      <div key={annotation.id}>
                        <div className="flex flex-wrap items-baseline gap-1.5">
                          <span className="font-num text-text-muted tabular-nums">
                            #{annotation.id}
                          </span>
                          <Vocabulary
                            value={annotation.label}
                            known={annotation.labelKnown}
                            tone="info"
                          />
                          <span className="font-num tabular-nums">
                            {annotation.from}–{annotation.to} s
                          </span>
                          <span className="text-text-muted">{annotation.author}</span>
                        </div>
                        <div>{annotation.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}
