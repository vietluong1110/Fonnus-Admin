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
 * A click anywhere on a bubble selects its turn and puts the audio, paused, at
 * the turn's start; the play glyph plays that one utterance and stops at its
 * end (`playRange`), and is drawn only when the recording is playable. The turn's own heading is the same selection for the
 * keyboard, so no bubble is a control wrapped around another control.
 *
 * Caller text has already passed `showCallerData` on the server (trap 4, ADR
 * 0005): a withheld bubble receives no text at all, only the outcome to say in
 * its place.
 */

import type { ReactNode } from 'react';
import { formatClock, formatNumber } from '@/calls';
import { currentTurnIdx, type PlayRange, type TurnBubbleView, type TurnSpan } from '@/playback';
import Badge from '@/ui/badge';
import { failureChip, termFor, turnSourceTerm } from '@/ui/glossary';
import Icon from '@/ui/icon';
import Term from '@/ui/term';
import Vocabulary from '@/ui/vocabulary';
import { usePlayback } from './playback-provider';

export default function Transcript({
  turns,
  spans,
  playable,
}: {
  turns: TurnBubbleView[];
  spans: TurnSpan[];
  /**
   * `recordingAccess(...) === 'playable'` — the page renders an `<audio>` only
   * then. Otherwise no bubble draws a play glyph: there is nothing to play, and
   * on a withheld call a glyph would suggest the caller's audio can be heard.
   */
  playable: boolean;
}) {
  const { playheadMs, selectedIdx, seek, playRange, select, audioRef } = usePlayback();
  const currentIdx = currentTurnIdx(spans, playheadMs, selectedIdx, turns[0]?.idx ?? null);

  /** Select the turn and park the audio, paused, at its start. */
  const choose = (turn: TurnBubbleView): void => {
    audioRef.current?.pause();
    // Seek first: a seek that leaves the previous selection clears it
    // (`leavesSelection`), and the clicked turn must be the one left standing.
    if (turn.seekMs !== null) seek(turn.seekMs);
    select(turn.idx);
  };
  const play = (turn: TurnBubbleView, range: PlayRange): void => {
    playRange(range.fromMs, range.toMs);
    select(turn.idx);
  };

  return (
    <div className="flex flex-col gap-4">
      {turns.map((turn) => {
        const source = turnSourceTerm(turn.source);
        const chip = failureChip(turn.failedLeg, turn.failedStage);
        const current = turn.idx === currentIdx;
        return (
          <div key={turn.idx} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[length:var(--size-eyebrow)] text-text-muted">
              <button
                type="button"
                onClick={() => {
                  choose(turn);
                }}
                aria-pressed={current}
                className="rounded-sm font-semibold text-text-muted hover:text-text-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                Turn {formatNumber(turn.idx)}
              </button>
              {source === null ? null : <Term term={source} layout="inline" />}
            </div>

            <Bubble
              side="caller"
              current={current}
              lengthMs={turn.callerLengthMs}
              range={playable ? turn.callerRange : null}
              onChoose={() => {
                choose(turn);
              }}
              onPlay={(range) => {
                play(turn, range);
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
                      caller text withheld —{' '}
                      <Vocabulary
                        value={turn.withheldReason}
                        known={turn.withheldReasonKnown}
                        of="consentOutcome"
                      />
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
              current={current}
              lengthMs={turn.assistantLengthMs}
              range={playable ? turn.assistantRange : null}
              onChoose={() => {
                choose(turn);
              }}
              onPlay={(range) => {
                play(turn, range);
              }}
              label={`turn ${formatNumber(turn.idx)}, the assistant`}
              pills={
                turn.interrupted || chip !== null ? (
                  <>
                    {turn.interrupted ? <Badge tone="terracotta">interrupted</Badge> : null}
                    {chip === null ? null : (
                      <Badge tone="error" dot>
                        {/* The sentence is the chip's tooltip: `failed_after_ms`
                            is elapsed from `endpoint_decision`, never the
                            configured bound (trap 7), which is what it says. */}
                        <Term
                          term={chip}
                          layout="inline"
                          {...(turn.failure === null ? {} : { hint: turn.failure })}
                        />
                      </Badge>
                    )}
                  </>
                ) : undefined
              }
            >
              <p className="mb-0 whitespace-pre-wrap">
                {turn.assistantText ?? <span className="text-text-muted">not on record</span>}
              </p>
            </Bubble>
          </div>
        );
      })}
    </div>
  );
}

const SIDE_CLASS = {
  caller: 'mr-6 self-start border border-border-hairline bg-surface-card',
  assistant: 'ml-6 self-end bg-surface-warm',
} as const;

// The caller's side is the glossary's caller holder; the assistant's side has
// no single holder (reply, canned, greeting), so it is named here.
const SIDE_LABEL = {
  caller: termFor('holder', 'caller')?.name ?? '',
  assistant: 'Assistant',
} as const;

/**
 * One bubble. The current turn — under the playhead, or last clicked — wears a
 * ring rather than a fill: a fill would recolour speech, and the tint is what
 * says who is speaking.
 */
function Bubble({
  side,
  current,
  lengthMs,
  range,
  onChoose,
  onPlay,
  label,
  pills,
  children,
}: {
  side: keyof typeof SIDE_CLASS;
  current: boolean;
  lengthMs: number | null;
  range: PlayRange | null;
  onChoose: () => void;
  onPlay: (range: PlayRange) => void;
  label: string;
  pills?: ReactNode;
  children: ReactNode;
}) {
  return (
    // The pointer's shortcut to the turn heading's button above, which is the
    // keyboard's; the play glyph stops its own click before it gets here.
    <div
      onClick={onChoose}
      className={`flex max-w-[92%] cursor-pointer flex-col gap-1.5 rounded-md px-[15px] py-[13px] transition-shadow duration-[var(--duration-fast)] ${SIDE_CLASS[side]} ${
        current ? 'ring-2 ring-[var(--action-primary)]' : 'hover:ring-1 hover:ring-[var(--border-strong)]'
      }`}
    >
      <div className="flex items-center gap-2">
        {range === null ? null : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPlay(range);
            }}
            aria-label={`Play ${label}`}
            className="inline-flex items-center gap-1 rounded-pill border border-border-hairline bg-surface-card px-2 py-0.5 font-num text-[length:var(--size-eyebrow)] tabular-nums text-text-link transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--action-ghost-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <Icon name="play" size={12} />
            {lengthMs === null ? 'play' : formatClock(lengthMs)}
          </button>
        )}
        <span className="text-[length:var(--size-eyebrow)] font-semibold tracking-[.06em] text-text-muted uppercase">
          {SIDE_LABEL[side]}
        </span>
      </div>
      {children}
      {pills === undefined ? null : <div className="flex flex-wrap gap-2">{pills}</div>}
    </div>
  );
}
