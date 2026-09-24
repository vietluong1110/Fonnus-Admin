'use client';

/*
 * The call as it was spoken: one pair of bubbles per turn, in `idx` order.
 *
 * The tints are the Web-UI's, not this console's invention: blush
 * (`--surface-warm`) is speech by the assistant and nothing else, the caller's
 * line sits on the card ground with a hairline
 * (../Fonnus-Web-UI/src/components/sections/CallDemoPlayer.module.css @ 302e3e8,
 * `design-reference/ui-ux-principles.md` §1).
 *
 * Caller text has already passed `showCallerData` on the server (trap 4, ADR
 * 0005): a withheld bubble receives no text at all, only the outcome to say in
 * its place.
 */

import type { ReactNode } from 'react';
import { formatClock, formatNumber } from '@/calls';
import { currentTurnIdx, type TurnBubbleView, type TurnSpan } from '@/playback';
import Badge from '@/ui/badge';
import Icon from '@/ui/icon';
import Vocabulary from '@/ui/vocabulary';
import { usePlayback } from './playback-provider';

export default function Transcript({
  turns,
  spans,
}: {
  turns: TurnBubbleView[];
  spans: TurnSpan[];
}) {
  const { playheadMs, selectedIdx, seek, select } = usePlayback();
  const currentIdx = currentTurnIdx(spans, playheadMs, selectedIdx, turns[0]?.idx ?? null);

  return (
    <div className="flex flex-col gap-4">
      {turns.map((turn) => (
        <div key={turn.idx} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[length:var(--size-eyebrow)] text-text-muted">
            <span>Turn {formatNumber(turn.idx)}</span>
            {turn.source === null ? null : <span>{turn.source}</span>}
          </div>

          <Bubble
            side="caller"
            current={turn.idx === currentIdx}
            lengthMs={turn.callerLengthMs}
            seekMs={turn.callerSeekMs}
            onSeek={seek}
            onSelect={() => {
              select(turn.idx);
            }}
            label={`turn ${formatNumber(turn.idx)}, the caller`}
          >
            {turn.callerWithheld ? (
              <p className="mb-0 text-text-muted">
                {turn.withheldByState ? (
                  <>
                    caller text withheld — the call is {turn.withheldReason}, no consent outcome
                    on record yet
                  </>
                ) : (
                  <>
                    caller text withheld — consent:{' '}
                    <Vocabulary value={turn.withheldReason} known={turn.withheldReasonKnown} />
                  </>
                )}
              </p>
            ) : (
              <p className="mb-0 whitespace-pre-wrap">
                {turn.callerText ?? <span className="text-text-muted">not on record</span>}
              </p>
            )}
          </Bubble>

          <Bubble
            side="assistant"
            current={turn.idx === currentIdx}
            lengthMs={turn.assistantLengthMs}
            seekMs={turn.assistantSeekMs}
            onSeek={seek}
            onSelect={() => {
              select(turn.idx);
            }}
            label={`turn ${formatNumber(turn.idx)}, the assistant`}
            pills={
              <>
                {turn.interrupted ? <Badge tone="terracotta">interrupted</Badge> : null}
                {turn.failure === null ? null : (
                  <>
                    <Badge tone="warning" title={turn.failure}>
                      failed
                    </Badge>
                    {/* The sentence itself, on screen rather than in a tooltip: a
                        pill is `whitespace-nowrap` and would run out of the
                        bubble. `failed_after_ms` is elapsed from
                        `endpoint_decision`, never the configured bound (trap 7),
                        which is what `failureLine` says. */}
                    <p className="mb-0 basis-full text-[length:var(--size-eyebrow)] text-text-muted">
                      {turn.failure}
                    </p>
                  </>
                )}
              </>
            }
          >
            <p className="mb-0 whitespace-pre-wrap">
              {turn.assistantText ?? <span className="text-text-muted">not on record</span>}
            </p>
          </Bubble>
        </div>
      ))}
    </div>
  );
}

const SIDE_CLASS = {
  caller: 'mr-6 self-start border border-border-hairline bg-surface-card',
  assistant: 'ml-6 self-end bg-surface-warm',
} as const;

const SIDE_LABEL = { caller: 'Caller', assistant: 'Assistant' } as const;

/**
 * One bubble. The current turn — under the playhead, or last clicked — wears a
 * ring rather than a fill: a fill would recolour speech, and the tint is what
 * says who is speaking.
 */
function Bubble({
  side,
  current,
  lengthMs,
  seekMs,
  onSeek,
  onSelect,
  label,
  pills,
  children,
}: {
  side: keyof typeof SIDE_CLASS;
  current: boolean;
  lengthMs: number | null;
  seekMs: number | null;
  onSeek: (ms: number) => void;
  onSelect: () => void;
  label: string;
  pills?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex max-w-[92%] flex-col gap-1.5 rounded-md px-[15px] py-[13px] ${SIDE_CLASS[side]} ${
        current ? 'ring-2 ring-[var(--action-primary)]' : ''
      }`}
    >
      <div className="text-[length:var(--size-eyebrow)] font-semibold tracking-[.06em] text-text-muted uppercase">
        {SIDE_LABEL[side]}
      </div>
      {children}
      {pills === undefined ? null : <div className="flex flex-wrap gap-2">{pills}</div>}
      {/* Always a button: a bubble that cannot be played is still the way this
          turn is chosen, which is the only selection there is on a call whose
          turns are not placed on the recording. Without a place to seek to it
          shows no clock and does not pretend to play. */}
      <button
        type="button"
        onClick={() => {
          // Seek first: a seek clears the selection (`playback-provider.tsx`),
          // and the click's own turn must be the one left standing.
          if (seekMs !== null) onSeek(seekMs);
          onSelect();
        }}
        aria-label={`${seekMs === null ? 'Select' : 'Play'} ${label}`}
        className="inline-flex w-fit items-center gap-1.5 rounded-pill border border-border-hairline px-2.5 py-1 font-num text-[length:var(--size-eyebrow)] tabular-nums text-text-link transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--action-ghost-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {seekMs === null ? (
          'select turn'
        ) : (
          <>
            <Icon name="play" size={14} />
            {/* No pair of marks to measure: the bubble plays, it just has no
                length to name. */}
            {lengthMs === null ? 'play' : formatClock(lengthMs)}
          </>
        )}
      </button>
    </div>
  );
}
