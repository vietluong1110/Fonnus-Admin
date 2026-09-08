'use client';

/*
 * The recording, played straight from the bucket: the element's `src` is this
 * app's own `/calls/<id>/recording`, which redirects to a freshly presigned GET
 * on every media request (ADR 0004) — first byte and every seek — so a page
 * left open keeps playing and this app never carries a byte of audio.
 *
 * The presigned URL expires (ADR 0004) and the browser keeps it: it follows the
 * 302 once and then sends its Range requests straight to the bucket, so a play
 * or a seek into an unbuffered region after the expiry gets a 403 and the
 * element stalls on MEDIA_ERR_NETWORK. That one error is answered by reloading
 * through the route — see `onError` below.
 *
 * The transport is the Web-UI's "hear a call" pattern
 * (../Fonnus-Web-UI/src/components/sections/CallDemoPlayer.tsx): a 46 px
 * terracotta disc, the clock in the numeric face, and the progress bar — here
 * the call strip, because a waveform cannot be drawn from bytes the browser
 * will not hand over.
 */

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { formatClock } from '@/calls';
import type { TurnSpan } from '@/playback';
import Icon from '@/ui/icon';
import CallStrip from './call-strip';
import { usePlayback } from './playback-provider';

/**
 * `timeupdate` fires about four times a second, which the playhead line and the
 * transcript highlight visibly step through; while the audio runs the position
 * is read once per frame instead, and `timeupdate` keeps the two agreeing after
 * a seek or a pause.
 */
function useFramePlayhead(
  playing: boolean,
  audioRef: { current: HTMLAudioElement | null },
  report: (ms: number) => void,
): void {
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (): void => {
      const audio = audioRef.current;
      if (audio !== null) report(audio.currentTime * 1000);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [playing, audioRef, report]);
}

/**
 * What the browser said, said back — the route may have answered 503/404/403,
 * or the browser may refuse `audio/wav` inline. This is the observation the
 * console owes the pipeline runbook (`../Fonnus/docs/runbook.md` §2.5 row 30),
 * so it is never swallowed.
 */
function mediaErrorLine(error: MediaError | null): string {
  const detail = error === null || error.message === '' ? '' : ` — ${error.message}`;
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return `Playback was stopped before the audio loaded${detail}`;
    case MediaError.MEDIA_ERR_NETWORK:
      return `The recording could not be fetched${detail}`;
    case MediaError.MEDIA_ERR_DECODE:
      return `The recording could not be decoded${detail}`;
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return `The recording did not load: /calls/<id>/recording answered with an error, or this browser will not play audio/wav inline${detail}`;
    default:
      return `The recording did not load${detail}`;
  }
}

export default function Player({
  callId,
  spans,
  unplaced,
  fallbackEndMs,
}: {
  callId: string;
  spans: TurnSpan[];
  unplaced: number[];
  fallbackEndMs: number;
}) {
  const { playheadMs, durationMs, setPlayheadMs, setDurationMs, audioRef } = usePlayback();
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elementRef = useRef<HTMLAudioElement | null>(null);
  // One reload per error episode: a bucket that is genuinely broken answers the
  // reload with another error, and a loop would hammer it. Cleared when the
  // reloaded source is readable again (`loadedmetadata`) and when audio actually
  // plays (`playing`), which is what makes it "per episode".
  const reloadedRef = useRef(false);
  // Where to come back to after that reload, captured before `load()` resets
  // the element to 0.
  const resumeRef = useRef<{ atMs: number; playing: boolean } | null>(null);
  // `playing` as the event handlers see it: the pause the browser fires with the
  // error can land before the state update does.
  const playingRef = useRef(false);

  function setPlayingState(value: boolean): void {
    playingRef.current = value;
    setPlaying(value);
  }

  useFramePlayhead(playing, elementRef, setPlayheadMs);

  function attach(element: HTMLAudioElement | null): void {
    elementRef.current = element;
    audioRef.current = element;
  }

  function toggle(): void {
    const audio = elementRef.current;
    if (audio === null) return;
    if (playing) {
      audio.pause();
      return;
    }
    play(audio);
  }

  /**
   * `play()` rejects on an autoplay policy or a source that never loaded; said,
   * not swallowed. One rejection is the player's own doing: the `load()` of a
   * reload aborts the play that was pending, and the position it will resume at
   * is already remembered — that AbortError is not the operator's to see.
   */
  function play(audio: HTMLAudioElement): void {
    void audio.play().catch((reason: unknown) => {
      if (reason instanceof Error && reason.name === 'AbortError' && resumeRef.current !== null) return;
      setError(
        `The browser refused to play the recording: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    });
  }

  function onLoadedMetadata(event: SyntheticEvent<HTMLAudioElement>): void {
    const audio = event.currentTarget;
    const length = audio.duration;
    // A stream of unknown length reports Infinity; the strip then keeps the
    // axis it was rendered with rather than dividing by it.
    setDurationMs(Number.isFinite(length) ? length * 1000 : null);
    setError(null);
    // The route answered with a source the browser could read: the episode is
    // over even if nobody presses play before the next expiry.
    reloadedRef.current = false;

    const resume = resumeRef.current;
    if (resume === null) return;
    resumeRef.current = null;
    audio.currentTime = resume.atMs / 1000;
    if (resume.playing) play(audio);
  }

  /**
   * A network error is the expired presigned URL until proven otherwise: the
   * element is pointed back at `/calls/<id>/recording`, which mints a fresh one,
   * and the position and play state are restored on `loadedmetadata`. Every
   * other error code is the operator's to see, unchanged.
   */
  function onError(event: SyntheticEvent<HTMLAudioElement>): void {
    const audio = event.currentTarget;
    const mediaError = audio.error;
    const wasPlaying = playingRef.current;
    setPlayingState(false);
    if (mediaError?.code === MediaError.MEDIA_ERR_NETWORK && !reloadedRef.current) {
      reloadedRef.current = true;
      resumeRef.current = { atMs: audio.currentTime * 1000, playing: wasPlaying };
      setError(null);
      audio.load();
      return;
    }
    // The reload failed too, or this was never a network error: no position to
    // come back to, and the line the operator reads instead.
    resumeRef.current = null;
    setError(mediaErrorLine(mediaError));
  }

  const axisMs = durationMs ?? fallbackEndMs;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause the recording' : 'Play the recording'}
          // The Web-UI's disc: 46 px, the primary ground, the glyph in cream.
          // `--icon-accent: currentColor` so the glyph does not lose its accent
          // part into a terracotta ground (src/ui/icon.tsx).
          style={{ ['--icon-accent' as string]: 'currentColor' }}
          className="grid size-[46px] shrink-0 place-items-center rounded-full bg-action-primary text-text-on-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <span className="font-num text-[length:var(--size-body-sm)] tabular-nums">
          {formatClock(playheadMs)} / {formatClock(axisMs)}
        </span>
      </div>

      <CallStrip spans={spans} unplaced={unplaced} fallbackEndMs={fallbackEndMs} />

      {error === null ? null : (
        <p className="mb-0 text-[length:var(--size-ui)] text-error">{error}</p>
      )}

      {/* No caption track: the transcript beside the player is this recording's
          text, and there is no WebVTT file to point at. */}
      <audio
        ref={attach}
        src={`/calls/${callId}/recording`}
        // Metadata only: the length is what the strip's axis wants, and the
        // bytes are fetched when the operator presses play.
        preload="metadata"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={(event) => {
          setPlayheadMs(event.currentTarget.currentTime * 1000);
        }}
        onPlay={() => {
          setPlayingState(true);
        }}
        // Audio is actually coming out: the episode the reload answered is over,
        // so the next expiry gets its own reload.
        onPlaying={() => {
          reloadedRef.current = false;
          setPlayingState(true);
        }}
        onPause={() => {
          setPlayingState(false);
        }}
        onEnded={() => {
          setPlayingState(false);
        }}
        onError={onError}
        className="hidden"
      />
    </div>
  );
}
