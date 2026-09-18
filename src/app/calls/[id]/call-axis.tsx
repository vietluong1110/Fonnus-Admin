'use client';

/*
 * "The call": one axis, two lanes. The upper lane is the recording's time axis
 * with one block per placed turn (and the greeting before them) and the seek
 * control the player has instead of a waveform — the browser cannot read the
 * file's bytes (ADR 0004), so the lane is drawn from the row's own offsets,
 * never from an amplitude trace. The lower lane is one `pipeline_ms` bar per
 * turn on the same axis, against the target of ADR 0007, so a slow reply is
 * read under the moment it was spoken.
 *
 * The placement rules are `src/playback.ts`'s (`docs/upstream.md` §Artifacts,
 * "Audio ↔ marks", and §Call detail for the greeting block and the bars); this
 * file only draws what that module decided.
 */

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { formatClock, formatNumber } from '@/calls';
import { TARGETS } from '@/latency';
import { barScaleMs, type GreetingSpan, type TurnBar, type TurnSpan } from '@/playback';
import Caveat from '@/ui/caveat';
import { usePlayback } from './playback-provider';

/** Arrow keys move by five seconds, page keys by fifteen — a review's step sizes. */
const STEP_MS = 5_000;
const PAGE_MS = 15_000;

/** The artboard's geometry: the lane label column, the two lanes, the gutter. */
const LABEL_WIDTH = 112;
const COLUMN_GAP = 14;
const BLOCK_LANE_HEIGHT = 34;
const BAR_LANE_HEIGHT = 64;
/** How much of the bar lane the target line leaves above it for the overshoot. */
const BAR_PLOT_HEIGHT = 40;

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

export default function CallAxis({
  spans,
  greeting,
  bars,
  unplaced,
  fallbackEndMs,
}: {
  spans: TurnSpan[];
  /** The greeting's block, or null — no `greeting_marks`, or no recorder clock. */
  greeting: GreetingSpan | null;
  bars: TurnBar[];
  /** `idx` of every turn with no place on the axis — named, never drawn at 0. */
  unplaced: number[];
  /** The axis length before the audio reports its own, and when there is none. */
  fallbackEndMs: number;
}) {
  const { playheadMs, durationMs, seek, select } = usePlayback();
  const trackRef = useRef<HTMLDivElement | null>(null);

  // The audio's own length is the truth once it arrives; until then the turns
  // themselves (and the call's own end) set the axis, so the lanes are readable
  // on a call whose recording never loads.
  const axisMs = Math.max(1, durationMs ?? fallbackEndMs);
  const pct = (ms: number): number => Math.min(100, Math.max(0, (ms / axisMs) * 100));
  const scaleMs = barScaleMs(bars);
  const barHeight = (ms: number): number =>
    Math.max(2, Math.min(1, ms / scaleMs) * BAR_PLOT_HEIGHT);

  function seekToPointer(event: PointerEvent<HTMLDivElement>): void {
    const track = trackRef.current;
    if (track === null) return;
    const box = track.getBoundingClientRect();
    if (box.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    seek(ratio * axisMs);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    // Captured so a drag that leaves the lane keeps scrubbing, and released
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

  /** A turn's block, so its bar sits exactly under it. */
  const spanOfTurn = (idx: number): TurnSpan | undefined =>
    spans.find((span) => span.idx === idx);

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative grid items-center gap-y-2.5"
        style={{
          gridTemplateColumns: `${String(LABEL_WIDTH)}px minmax(0,1fr)`,
          columnGap: `${String(COLUMN_GAP)}px`,
        }}
      >
        <div className="flex flex-col">
          <span className="text-[length:var(--size-ui)] font-semibold">Turns</span>
          <Caveat as="span">one block each</Caveat>
        </div>

        <div
          ref={trackRef}
          // A slider rather than a native range input wrapped in blocks: the
          // lane needs its own children (one block per turn) and a value read
          // out as a clock, which `aria-valuetext` gives and an `<input>` would
          // need a parallel label for anyway.
          role="slider"
          tabIndex={0}
          aria-label="The call — seek the recording"
          aria-valuemin={0}
          aria-valuemax={Math.round(axisMs)}
          aria-valuenow={Math.round(playheadMs)}
          aria-valuetext={`${formatClock(playheadMs)} of ${formatClock(axisMs)}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
          style={{ height: `${String(BLOCK_LANE_HEIGHT)}px` }}
          className="relative w-full cursor-pointer touch-none overflow-hidden rounded-xs border border-border-hairline bg-surface-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          {/* What has been heard, behind the blocks. */}
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-[var(--action-ghost-hover)]"
            style={{ width: `${String(pct(playheadMs))}%` }}
          />
          {greeting === null ? null : (
            // The greeting has no `turn` row and no `pipeline_ms`: a quieter
            // block, and no bar under it.
            <div
              aria-hidden="true"
              className="absolute inset-y-0 min-w-px"
              style={{
                left: `${String(pct(greeting.startMs))}%`,
                width: `${String(Math.max(0.4, pct(greeting.endMs) - pct(greeting.startMs)))}%`,
                background: 'var(--action-ghost-hover)',
                borderRight: '1px solid var(--border-strong)',
              }}
              title={`Greeting · ${formatClock(greeting.startMs)} → ${formatClock(greeting.endMs)}`}
            />
          )}
          {spans.map((span) => (
            <button
              key={span.idx}
              type="button"
              // Seek first: a seek clears the selection (`playback-provider.tsx`),
              // and the click's own turn must be the one left standing.
              onClick={() => {
                seek(span.startMs);
                select(span.idx);
              }}
              aria-label={`Play turn ${formatNumber(span.idx)}`}
              // A one-pixel minimum: a turn whose block collapsed (a reversed
              // clock, `src/playback.ts`) is still a turn that happened.
              className="absolute top-1.5 bottom-1.5 grid min-w-px place-items-center rounded-[1px] font-num text-[length:var(--size-eyebrow)] font-semibold text-text-on-accent"
              style={{
                left: `${String(pct(span.startMs))}%`,
                width: `${String(Math.max(0.4, pct(span.endMs) - pct(span.startMs)))}%`,
                background: blockColour(span),
              }}
              title={`Turn ${formatNumber(span.idx)} · ${formatClock(span.startMs)} → ${formatClock(span.endMs)}`}
            >
              <span className="overflow-hidden">{formatNumber(span.idx)}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col">
          <code className="text-[length:var(--size-ui)] font-semibold">pipeline_ms</code>
          <Caveat as="span">bar height = ms</Caveat>
        </div>

        <div className="relative w-full" style={{ height: `${String(BAR_LANE_HEIGHT)}px` }}>
          {/* The target, drawn once across the lane: anything above it missed it. */}
          <div
            aria-hidden="true"
            className="absolute right-0 left-0 border-t border-dashed border-border-strong"
            style={{ bottom: `${String(barHeight(TARGETS.pipelineP95Ms))}px` }}
          />
          <span
            className="absolute right-0 bg-surface-card px-0.5 font-num text-[length:var(--size-eyebrow)] text-text-muted"
            style={{ bottom: `${String(barHeight(TARGETS.pipelineP95Ms) + 2)}px` }}
          >
            target {formatNumber(TARGETS.pipelineP95Ms)} ms
          </span>
          {bars.map((bar) => {
            const span = spanOfTurn(bar.idx);
            if (span === undefined) return null;
            const left = pct(span.startMs);
            const width = Math.max(0.4, pct(span.endMs) - left);
            const targetHeight = barHeight(TARGETS.pipelineP95Ms);
            const height = bar.measured && bar.pipelineMs !== null ? barHeight(bar.pipelineMs) : targetHeight;
            const over = bar.measured && bar.pipelineMs !== null && bar.pipelineMs > TARGETS.pipelineP95Ms;
            return (
              <button
                key={bar.idx}
                type="button"
                onClick={() => {
                  seek(span.startMs);
                  select(bar.idx);
                }}
                aria-label={`Turn ${formatNumber(bar.idx)}, pipeline_ms ${
                  bar.measured && bar.pipelineMs !== null
                    ? `${formatNumber(bar.pipelineMs)} ms`
                    : 'not measured'
                }`}
                title={
                  bar.measured && bar.pipelineMs !== null
                    ? `Turn ${formatNumber(bar.idx)} · ${formatNumber(bar.pipelineMs)} ms`
                    : `Turn ${formatNumber(bar.idx)} · not measured`
                }
                className="absolute bottom-0 flex flex-col justify-end"
                style={{ left: `${String(left)}%`, width: `${String(width)}%`, height: '100%' }}
              >
                {/* The value over its bar, as the artboard writes it: a number
                    read off a height is a number nobody quotes. */}
                <span
                  className={`mb-0.5 truncate text-center font-num text-[length:var(--size-eyebrow)] leading-[1.3] tabular-nums ${
                    over ? 'font-semibold text-error' : 'text-text-muted'
                  }`}
                >
                  {bar.measured && bar.pipelineMs !== null ? formatNumber(bar.pipelineMs) : '—'}
                </span>
                {bar.measured ? (
                  <span
                    className="relative w-full rounded-t-xs"
                    style={{ height: `${String(height)}px`, background: 'var(--chart-1)' }}
                  >
                    {over ? (
                      // The overshoot on top of the bar, not beside it: the
                      // bar's height is still the value.
                      <span
                        aria-hidden="true"
                        className="absolute top-0 right-0 left-0 rounded-t-xs bg-error"
                        style={{ height: `${String(height - targetHeight)}px` }}
                      />
                    ) : null}
                  </span>
                ) : (
                  // A reply that never became audible, or a negative value
                  // (contract §3.2): an outline to the target's height, never a
                  // bar of zero, which would read as an instant reply.
                  <span
                    className="w-full rounded-t-xs border border-b-0 border-dashed border-border-dashed"
                    style={{ height: `${String(height)}px` }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <span />
        <div className="relative h-4">
          {[0, 0.25, 0.5, 0.75].map((at) => (
            <span
              key={at}
              className="absolute font-num text-[length:var(--size-eyebrow)] text-text-muted tabular-nums"
              style={{ left: `${String(at * 100)}%` }}
            >
              {formatClock(axisMs * at)}
            </span>
          ))}
          <span className="absolute right-0 font-num text-[length:var(--size-eyebrow)] text-text-muted tabular-nums">
            {formatClock(axisMs)}
          </span>
        </div>

        {/* One playhead across both lanes: the lanes share an axis, so they
            share the line that says where the audio is. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 w-px bg-action-primary"
          style={{
            left: `calc(${String(LABEL_WIDTH + COLUMN_GAP)}px + (100% - ${String(
              LABEL_WIDTH + COLUMN_GAP,
            )}px) * ${String(pct(playheadMs) / 100)})`,
            height: `${String(BLOCK_LANE_HEIGHT + BAR_LANE_HEIGHT + 10)}px`,
          }}
        />
      </div>

      <Caveat>
        The upper lane is one block per turn, from <code>speech_start_ms</code> to the place of{' '}
        <code>playback_end</code>; blocks are placed to within ~100 ms of the audio and can only
        drift late. The lower lane is one bar per turn: taller is slower, and anything above the
        dashed line missed the {formatNumber(TARGETS.pipelineP95Ms)} ms target — a P95 target over
        a call set, so on one turn it is a hint, not a verdict. A dashed outline is a turn with no{' '}
        <code>pipeline_ms</code>: a reply that never became audible, never a zero.
      </Caveat>
      {greeting === null ? (
        <Caveat>
          no greeting block: the call carries no readable <code>greeting_marks</code> (written
          before the pipeline&rsquo;s migration 0008, never finalized, or ended before the greeting
          was dispatched), or it has no <code>recording_started_at</code>
        </Caveat>
      ) : (
        <Caveat>
          the first block is the greeting, from <code>answered</code> — it has no{' '}
          <code>turn</code> row and no <code>pipeline_ms</code> of its own, so it has no bar
        </Caveat>
      )}
      {unplaced.length === 0 ? null : (
        <Caveat>
          not placed on the recording: turn{unplaced.length === 1 ? '' : 's'}{' '}
          {unplaced.map((idx) => formatNumber(idx)).join(', ')} — no{' '}
          <code>speech_start_ms</code>, or the call has no <code>recording_started_at</code>
        </Caveat>
      )}
    </div>
  );
}
