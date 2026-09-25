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
  RETRACTION_LABEL,
  STANDING_CURRENT,
  type AnnotationCellItem,
  type AnnotationHistoryRow,
} from '@/annotations';
import { formatWhen } from '@/calls';
import {
  INTERVALS_CARD_TITLE,
  INTERVAL_CAVEATS,
  NO_CLOCK_NOTE,
  NO_CLOCK_TITLE,
  NO_TRAIL_TITLE,
  VERDICT_BADGE,
  annotationHistorySummary,
  anyWithheld,
  gapNote,
  verdictNote,
} from '@/interval-lane';
import type { TrailVerdict } from '@/intervals';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import Vocabulary from '@/ui/vocabulary';
import IntervalRows, { type IntervalRow } from './interval-rows';

/** One current annotation and the intervals it lands on (contract §8: every one it overlaps). */
export interface CurrentAnnotation {
  item: AnnotationCellItem;
  /** `from–to` of each overlapped interval, in seconds, as the table prints them. */
  overlaps: string[];
}

export default function IntervalsCard({
  verdict,
  rows,
  current,
  history,
  cannedSilent,
  anyUnheard,
}: {
  verdict: TrailVerdict;
  rows: IntervalRow[];
  /** The current annotations, texts already gated by `intervalCells`. */
  current: CurrentAnnotation[];
  /** Every `call_annotation` row of the call, current and history (PLAN row A7). */
  history: AnnotationHistoryRow[];
  /** A canned line whose synthesis produced no audio — ISSUES L10-260917-1. */
  cannedSilent: boolean;
  /** Any interval whose caller sound fell inside a muted stretch. */
  anyUnheard: boolean;
}) {
  const badge = VERDICT_BADGE[verdict.kind];
  const note = verdictNote(verdict);
  const gap = verdict.kind === 'gap' ? gapNote(verdict.holeFromSeq) : null;

  return (
    <Card title={INTERVALS_CARD_TITLE}>
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
            {/* The standing explanations are the column headers' tooltips
                (`interval-rows.tsx`); only what this call's rows need is said. */}
            {anyWithheld(rows) ? <Caveat>{INTERVAL_CAVEATS.withheld}</Caveat> : null}
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

      {/*
       * The annotations on demand, under the table (`console-call-view.md`
       * §Annotations): the current rows with the intervals they land on, then
       * the whole history — who corrected or withdrew which row is what an
       * investigator opens this for. Rendered only when the call has a row at
       * all, and outside the verdict branch, so a call whose trail is absent
       * still shows what a person wrote.
       */}
      {history.length === 0 ? null : (
        <details className="text-[length:var(--size-ui)]">
          <summary className="cursor-pointer text-text-link">
            {annotationHistorySummary(
              history.length,
              history.filter((row) => row.standing === STANDING_CURRENT).length,
            )}
          </summary>
          <Caveat>{INTERVAL_CAVEATS.annotation}</Caveat>
          {current.length === 0 ? null : (
            <div className="mt-2 flex flex-col gap-3">
              {current.map(({ item, overlaps }) => (
                <div key={item.id}>
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-num tabular-nums">#{item.id}</span>
                    <Vocabulary value={item.label} known={item.labelKnown} tone="info" />
                    <span className="font-num tabular-nums">
                      {item.from}–{item.to} s
                    </span>
                    <span className="text-text-muted">{item.author}</span>
                  </div>
                  <div>{item.text}</div>
                  <Caveat>
                    on {overlaps.length === 1 ? 'interval' : 'intervals'}{' '}
                    {overlaps.map((span) => `${span} s`).join(', ')}
                  </Caveat>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-col gap-3 border-t border-border-hairline pt-3">
            {history.map((row) => (
              <div key={row.id}>
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-num tabular-nums">#{row.id}</span>
                  <span className="text-text-muted">·</span>
                  <span className="font-num tabular-nums">{formatWhen(row.createdAt)}</span>
                  <span className="text-text-muted">·</span>
                  <span>{row.author}</span>
                  <span className="text-text-muted">·</span>
                  <span className="font-num tabular-nums">
                    {row.from}–{row.to} s
                  </span>
                  <span className="text-text-muted">·</span>
                  {row.label === null ? (
                    <span>{RETRACTION_LABEL}</span>
                  ) : (
                    <Vocabulary value={row.label} known={row.labelKnown} tone="info" />
                  )}
                  <span className="text-text-muted">·</span>
                  <span className="text-text-muted">{row.standing}</span>
                </div>
                <div>caller_said: {row.callerSaid}</div>
                <div>note: {row.note}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
