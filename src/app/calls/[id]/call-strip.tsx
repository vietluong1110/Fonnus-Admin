'use client';

/*
 * The call strip: the recording's time axis with one block per placed turn, the
 * playhead on it, and the seek control the player has instead of a waveform —
 * the browser cannot read the file's bytes (ADR 0004), so the strip is drawn
 * from the row's own offsets, never from an amplitude trace.
 *
 * The placement rules are `src/playback.ts`'s (`docs/upstream.md` §Artifacts,
 * "Audio ↔ marks"); this file only draws what that module decided.
 */

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { formatClock, formatNumber } from '@/calls';
import type { TurnSpan } from '@/playback';
import Caveat from '@/ui/caveat';
import { usePlayback } from './playback-provider';

/** Arrow keys move by five seconds, page keys by fifteen — a review's step sizes. */
const STEP_MS = 5_000;
const PAGE_MS = 15_000;

/**
 * A turn's block wears the state the operator is looking for: an ordinary turn
 * is muted (`--chart-3`), an `interrupted` one takes the second chart voice, a
 * failed one the error tone. `failed` wins over `interrupted`, because a turn
 * that failed mid-reply is the one being looked for (trap 7).
 */
function blockColour(span: TurnSpan): string {
  if (span.failed) return 'var(--error)';
  if (span.interrupted) return 'var(--chart-2)';
  return 'var(--chart-3)';
}

export default function CallStrip({
  spans,
  unplaced,
  fallbackEndMs,
}: {
  spans: TurnSpan[];
  /** `idx` of every turn with no place on the axis — named, never drawn at 0. */
  unplaced: number[];
  /** The axis length before the audio reports its own, and when there is none. */
  fallbackEndMs: number;
}) {
  const { playheadMs, durationMs, seek } = usePlayback();
  const trackRef = useRef<HTMLDivElement | null>(null);

  // The audio's own length is the truth once it arrives; until then the turns
  // themselves (and the call's own end) set the axis, so the strip is readable
  // on a call whose recording never loads.
  const axisMs = Math.max(1, durationMs ?? fallbackEndMs);
  const pct = (ms: number): number => Math.min(100, Math.max(0, (ms / axisMs) * 100));

  function seekToPointer(event: PointerEvent<HTMLDivElement>): void {
    const track = trackRef.current;
    if (track === null) return;
    const box = track.getBoundingClientRect();
    if (box.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    seek(ratio * axisMs);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    // Captured so a drag that leaves the strip keeps scrubbing, and released
    // by the browser on pointerup.
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToPointer(event);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    seekToPointer(event);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const by = (ms: number): void => {
      event.preventDefault();
      seek(Math.min(axisMs, playheadMs + ms));
    };
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        by(-STEP_MS);
        return;
      case 'ArrowRight':
      case 'ArrowUp':
        by(STEP_MS);
        return;
      case 'PageDown':
        by(-PAGE_MS);
        return;
      case 'PageUp':
        by(PAGE_MS);
        return;
      case 'Home':
        event.preventDefault();
        seek(0);
        return;
      case 'End':
        event.preventDefault();
        seek(axisMs);
        return;
      default:
        return;
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={trackRef}
        // A slider rather than a native range input wrapped in blocks: the
        // strip needs its own children (one block per turn) and a value read
        // out as a clock, which `aria-valuetext` gives and an `<input>` would
        // need a parallel label for anyway.
        role="slider"
        tabIndex={0}
        aria-label="Call strip — seek the recording"
        aria-valuemin={0}
        aria-valuemax={Math.round(axisMs)}
        aria-valuenow={Math.round(playheadMs)}
        aria-valuetext={`${formatClock(playheadMs)} of ${formatClock(axisMs)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        className="relative h-9 w-full cursor-pointer touch-none rounded-xs border border-border-hairline bg-surface-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        {/* What has been heard, behind the blocks. */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-[var(--action-ghost-hover)]"
          style={{ width: `${String(pct(playheadMs))}%` }}
        />
        {spans.map((span) => (
          <div
            key={span.idx}
            aria-hidden="true"
            // A one-pixel minimum: a turn whose block collapsed (a reversed
            // clock, `src/playback.ts`) is still a turn that happened.
            className="absolute top-1.5 bottom-1.5 min-w-px rounded-[1px]"
            style={{
              left: `${String(pct(span.startMs))}%`,
              width: `${String(Math.max(0.4, pct(span.endMs) - pct(span.startMs)))}%`,
              background: blockColour(span),
            }}
            title={`Turn ${formatNumber(span.idx)} · ${formatClock(span.startMs)} → ${formatClock(span.endMs)}`}
          />
        ))}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-action-primary"
          style={{ left: `${String(pct(playheadMs))}%` }}
        />
      </div>
      <Caveat>
        one block per turn, from <code>speech_start_ms</code> to the place of{' '}
        <code>playback_end</code>; blocks are placed to within ~100 ms of the audio and can
        only drift late
      </Caveat>
      {unplaced.length === 0 ? null : (
        <Caveat>
          not placed on the recording: turn{unplaced.length === 1 ? '' : 's'}{' '}
          {unplaced.map((idx) => formatNumber(idx)).join(', ')} — no{' '}
          <code>speech_start_ms</code>, or the call has no{' '}
          <code>recording_started_at</code>
        </Caveat>
      )}
    </div>
  );
}
