'use client';

/*
 * The intervals as a table, one row per stretch of the recording clock (PLAN row
 * A1b, ADR 0010): from, to, who held the line, and what was heard in it. The
 * row under the playhead wears an accent bar, and a click on a row seeks the
 * recording to where that interval starts — and selects the turn when the
 * interval has one, so the transcript and the selected turn follow, the same
 * `?turn=` contract the turn blocks use (ADR 0006).
 *
 * Every cell arrives as strings built on the server by `intervalCells`
 * (`src/intervals.ts`): the consent gate ran there, once, and no recogniser
 * text reaches this file that the gate did not pass (ADR 0005, trap 4). The
 * annotations the cells also carry are listed under the table by
 * `intervals-card.tsx`, not here.
 */

import type { MouseEvent } from 'react';
import {
  DEAF_EXPLANATION,
  EMPTY_CELL,
  INTERVAL_CAVEATS,
  UNSUPPORTED_OPACITY,
  holderTone,
  rowAtPlayhead,
  rowTint,
  rowTitle,
} from '@/interval-lane';
import type { IntervalCell } from '@/intervals';
import Badge from '@/ui/badge';
import Caveat from '@/ui/caveat';
import { holderTerm } from '@/ui/glossary';
import { INTERACTIVE_SELECTOR, shouldFollowRow } from '@/ui/row-click';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Term from '@/ui/term';
import { usePlayback } from './playback-provider';

/** One interval as the card prints it, plus what the playhead and the note need. */
export interface IntervalRow extends IntervalCell {
  /** On the recording clock, unclamped — `seekMs` is the clamped one. */
  fromMs: number;
  toMs: number;
  /** The sound-instant fact, when it is one (`heardNote`); else null. */
  heardNote: string | null;
}

/** The playhead's row: a bar down its left edge, so the side's tint still reads. */
const PLAYHEAD_ACCENT = 'inset 3px 0 0 var(--action-primary)';

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
        {/* The times and the holder take what they need; the heard text, the
            one column read as prose, takes the rest. */}
        <colgroup>
          <col className="w-20" />
          <col className="w-20" />
          <col className="w-64" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <Th align="end" hint={INTERVAL_CAVEATS.trail}>
              From
            </Th>
            <Th align="end">To</Th>
            <Th>Who</Th>
            <Th hint={INTERVAL_CAVEATS.text}>What was heard</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const unsupported = rowTitle(row);
            return (
              <tr
                key={`${String(row.fromMs)}-${String(index)}`}
                onClick={(event) => {
                  onRowClick(event, row);
                }}
                aria-current={index === currentIndex ? 'true' : undefined}
                style={{
                  backgroundColor: rowTint(row.holderKind),
                  ...(index === currentIndex ? { boxShadow: PLAYHEAD_ACCENT } : {}),
                  ...(row.unsupported ? { opacity: UNSUPPORTED_OPACITY } : {}),
                }}
                className="cursor-pointer hover:[background-image:linear-gradient(var(--action-ghost-hover),var(--action-ghost-hover))]"
              >
                <Td num>
                  {/* The row's keyboard path: a real button, in the first cell,
                      doing exactly what a click on the row does. The cell's own
                      left padding is zero, so the accent bar gets a gutter. */}
                  <button
                    type="button"
                    onClick={() => {
                      go(row);
                    }}
                    aria-label={`Seek to ${row.from} s, ${row.holder}`}
                    className="pl-2 font-num tabular-nums underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                  >
                    {row.from}
                  </button>
                </Td>
                <Td num>{row.to}</Td>
                <Td>
                  <Badge tone={holderTone(row.holderKind)}>
                    <Term
                      term={holderTerm({
                        kind: row.holderKind,
                        label: row.holder,
                        turnIdx: row.turnIdx,
                      })}
                      layout="inline"
                      {...(row.holderKind === 'deaf' ? { hint: DEAF_EXPLANATION } : {})}
                    />
                  </Badge>
                  {/* Past the trail's hole nothing is supported (§8 rule 7). */}
                  {unsupported === undefined ? null : <Caveat>{unsupported}</Caveat>}
                </Td>
                <Td>
                  {row.botText === null ? null : (
                    // What the bot said, in the bot's voice. A bot interval can
                    // still carry a recogniser record: a canned line that
                    // produced no audio swallows the caller's records under it
                    // (ISSUES L10-260917-1).
                    <div className="italic">{row.botText}</div>
                  )}
                  {row.botText !== null && row.recogniser === EMPTY_CELL ? null : (
                    <div>{row.recogniser}</div>
                  )}
                  {row.heardNote === null ? null : <Caveat>{row.heardNote}</Caveat>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableScroll>
  );
}
