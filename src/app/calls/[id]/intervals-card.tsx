/*
 * "Intervals": the whole recording clock accounted for, one row per stretch —
 * who held the line, what the caller's line carried, what the recogniser
 * returned (PLAN row A1b, the requirement `../Fonnus/docs/console-call-view.md`).
 *
 * A sibling of `RecordingBlock`, never inside it (ADR 0010 decision 6): a call
 * whose recording is withheld, not archived or gone still has a trail in
 * `call_event`, and this table is the only place it can be read. The lane in
 * "The call" draws the same intervals, because it is an axis over audio.
 *
 * The verdict comes first (decision 3): how much of the trail is there is read
 * before any interval, because a trail missing its tail is not a shorter call
 * (trap 8).
 */

import {
  INTERVALS_CARD_TITLE,
  INTERVAL_CAVEATS,
  NO_CLOCK_NOTE,
  NO_CLOCK_TITLE,
  NO_TRAIL_TITLE,
  VERDICT_BADGE,
  gapNote,
  verdictNote,
} from '@/interval-lane';
import type { TrailVerdict } from '@/intervals';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import IntervalRows, { type IntervalRow } from './interval-rows';

export default function IntervalsCard({
  verdict,
  rows,
  cannedSilent,
  anyUnheard,
}: {
  verdict: TrailVerdict;
  rows: IntervalRow[];
  /** A canned line whose synthesis produced no audio — ISSUES L10-260917-1. */
  cannedSilent: boolean;
  /** Any interval whose caller sound fell inside a muted stretch. */
  anyUnheard: boolean;
}) {
  const badge = VERDICT_BADGE[verdict.kind];
  const note = verdictNote(verdict);
  const gap = verdict.kind === 'gap' ? gapNote(verdict.holeFromSeq) : null;

  return (
    <Card
      title={INTERVALS_CARD_TITLE}
      sub="who held the line, what the caller's line carried, what the recogniser returned"
    >
      {verdict.kind === 'absent' ? (
        // Trap 8: no row at all is `RECORD_CALLS` off, a mirror that failed, a
        // file that never opened, or a call that never reached consent — never
        // "nothing happened". The verdict's own text names all four.
        <EmptyState title={NO_TRAIL_TITLE}>{verdict.text}</EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {badge === undefined && note === null ? null : (
              <div className="flex flex-wrap items-baseline gap-2">
                {badge === undefined ? null : <Badge tone={badge.tone}>{badge.label}</Badge>}
                {note === null ? null : <Caveat as="span">{note}</Caveat>}
                {verdict.kind === 'gap' ? (
                  <Caveat as="span">
                    {verdict.text}
                    {gap}
                  </Caveat>
                ) : null}
              </div>
            )}
            <Caveat>{INTERVAL_CAVEATS.trail}</Caveat>
            <Caveat>{INTERVAL_CAVEATS.text}</Caveat>
            <Caveat>{INTERVAL_CAVEATS.withheld}</Caveat>
            {cannedSilent ? <Caveat>{INTERVAL_CAVEATS.cannedSilent}</Caveat> : null}
            {anyUnheard ? <Caveat>{INTERVAL_CAVEATS.unheard}</Caveat> : null}
          </div>

          {rows.length === 0 ? (
            // The trail is there and counted; it has no clock to sit on, so
            // nothing can be placed (contract §8 rule 1).
            <EmptyState title={NO_CLOCK_TITLE}>{NO_CLOCK_NOTE}</EmptyState>
          ) : (
            <IntervalRows rows={rows} />
          )}
        </>
      )}
    </Card>
  );
}
