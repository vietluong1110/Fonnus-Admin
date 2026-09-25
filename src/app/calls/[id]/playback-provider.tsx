'use client';

/*
 * One playhead for the whole screen (row A5): the player, the call strip, the
 * Selected turn card and the transcript all read this one number, so nothing on the
 * page can disagree with what is being heard.
 *
 * The position is held in milliseconds, the unit every mark and offset of the
 * read contract is in (`docs/upstream.md` §Artifacts) — the `<audio>` element's
 * seconds are converted at the one place they enter, in `Player`.
 */

import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { leavesSelection, watchRangeEnd, type TurnSpan } from '@/playback';

export interface Playback {
  /** Where the recording is, in ms from `call_log.recording_started_at`. */
  playheadMs: number;
  /**
   * The turn the operator clicked, or null. It is what the transcript and the
   * Selected turn card show while the playhead stays inside that turn's block — and the
   * only thing they can follow on a call whose turns cannot be placed on the
   * recording at all (`currentTurnIdx`, `src/playback.ts`). A seek or a
   * reported position that leaves the block clears it (`leavesSelection`).
   */
  selectedIdx: number | null;
  /** The audio's own length once it reports one; null with no player, or before `loadedmetadata`. */
  durationMs: number | null;
  /**
   * Move the audio, if there is any, and the playhead regardless — a click on a
   * bubble still selects that turn in the Selected turn card on a call whose recording is not
   * in the bucket, was withheld, or was never configured.
   */
  seek: (ms: number) => void;
  /**
   * Seek to `fromMs`, play, and pause once the audio reaches `toMs` — one
   * utterance heard on its own. Checked once a frame and on `timeupdate`
   * (`watchRangeEnd`); any other seek — this provider's, or the element's own
   * `seeking` from its native controls — or a pause ends the range without a
   * pause of its own. Does nothing but the seek when there is no audio element.
   */
  playRange: (fromMs: number, toMs: number) => void;
  /**
   * Mark a turn as the one being read, or clear it with null; a bubble click
   * does this after its seek. The address bar follows (`?turn=`, ADR 0006),
   * replacing the history entry, so a reload or a copied link opens on it.
   */
  select: (idx: number | null) => void;
  /** The player reporting where the audio actually is; never writes back to the element. */
  setPlayheadMs: (ms: number) => void;
  setDurationMs: (ms: number | null) => void;
  /** The `<audio>` element, owned by `Player` and set through this ref. */
  audioRef: RefObject<HTMLAudioElement | null>;
}

const PlaybackContext = createContext<Playback | null>(null);

export function usePlayback(): Playback {
  const value = useContext(PlaybackContext);
  if (value === null) {
    throw new Error('usePlayback must be used inside PlaybackProvider');
  }
  return value;
}

/**
 * Wraps the server-rendered work area. Everything it receives as children is
 * rendered on the server and passed down as props, so no query and no
 * date object crosses this boundary — only numbers, strings and booleans.
 */
export default function PlaybackProvider({
  children,
  spans,
  initialSelectedIdx = null,
}: {
  children: ReactNode;
  /** The placed turns — what "the playhead left the selected turn" is measured against. */
  spans: TurnSpan[];
  /**
   * The turn selected on arrival, from `?turn=<idx>` (ADR 0006) — how the
   * Overview's outside-the-percentile rows and the Calls tick strip link to one
   * turn of one call. It behaves like a click: a playhead move out of the turn
   * clears it, so a link does not pin the screen to a turn the audio has left.
   */
  initialSelectedIdx?: number | null;
}) {
  const [playheadMs, setPlayhead] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(initialSelectedIdx);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Read inside callbacks that must not change identity on every render.
  const spansRef = useRef(spans);
  useEffect(() => {
    spansRef.current = spans;
  }, [spans]);
  /** Ends the range `playRange` is watching, if any. */
  const stopRangeRef = useRef<(() => void) | null>(null);

  const stopRange = useCallback(() => {
    stopRangeRef.current?.();
    stopRangeRef.current = null;
  }, []);
  // A range still watching when the screen goes away must not keep a frame loop.
  useEffect(() => stopRange, [stopRange]);

  // A playhead that leaves the selected turn ends the selection: what the
  // screen follows is then the turn under the audio, until the next click.
  // Returning the same value on every frame inside the turn is a no-op for React.
  const setPlayheadMs = useCallback((ms: number) => {
    setPlayhead(ms);
    setSelectedIdx((current) => (leavesSelection(spansRef.current, current, ms) ? null : current));
  }, []);

  const seek = useCallback(
    (ms: number) => {
      stopRange();
      const at = Math.max(0, ms);
      const audio = audioRef.current;
      // Setting `currentTime` makes the element fire `timeupdate` itself, but the
      // state is set here too: with no element there is nothing to fire, and the
      // Selected turn card must still follow a click on a bubble.
      if (audio !== null) audio.currentTime = at / 1000;
      setPlayheadMs(at);
    },
    [setPlayheadMs, stopRange],
  );

  const playRange = useCallback(
    (fromMs: number, toMs: number) => {
      seek(fromMs);
      const audio = audioRef.current;
      if (audio === null || toMs <= fromMs) return;
      const cancelWatch = watchRangeEnd(
        {
          positionMs: () => audio.currentTime * 1000,
          pause: () => {
            audio.pause();
          },
          frame: (callback) => window.requestAnimationFrame(callback),
          cancelFrame: (handle) => {
            window.cancelAnimationFrame(handle);
          },
          on: (event, callback) => {
            audio.addEventListener(event, callback);
            return () => {
              audio.removeEventListener(event, callback);
            };
          },
        },
        fromMs,
        toMs,
      );
      // A pause from anywhere — the player's button, the end of the file, the
      // range's own stop — ends the watch.
      const onPause = (): void => {
        stopRange();
      };
      audio.addEventListener('pause', onPause);
      stopRangeRef.current = () => {
        cancelWatch();
        audio.removeEventListener('pause', onPause);
      };
      // A refusal (autoplay policy, a source that never loaded) is the
      // player's to say — its own play button reports it; the range just ends.
      void audio.play().catch(() => {
        stopRange();
      });
    },
    [seek, stopRange],
  );

  const select = useCallback((idx: number | null) => {
    setSelectedIdx(idx);
    const url = new URL(window.location.href);
    if (idx === null) url.searchParams.delete('turn');
    else url.searchParams.set('turn', String(idx));
    window.history.replaceState(null, '', url);
  }, []);

  const value = useMemo<Playback>(
    () => ({
      playheadMs,
      selectedIdx,
      durationMs,
      seek,
      playRange,
      select,
      setPlayheadMs,
      setDurationMs,
      audioRef,
    }),
    [playheadMs, selectedIdx, durationMs, seek, playRange, select, setPlayheadMs],
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}
