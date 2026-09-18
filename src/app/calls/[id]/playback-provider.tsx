'use client';

/*
 * One playhead for the whole screen (row A5): the player, the call strip, the
 * turn waterfall and the transcript all read this one number, so nothing on the
 * page can disagree with what is being heard.
 *
 * The position is held in milliseconds, the unit every mark and offset of the
 * read contract is in (`docs/upstream.md` §Artifacts) — the `<audio>` element's
 * seconds are converted at the one place they enter, in `Player`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

export interface Playback {
  /** Where the recording is, in ms from `call_log.recording_started_at`. */
  playheadMs: number;
  /**
   * The turn the operator clicked since the playhead last moved, or null. It is
   * what the transcript and the waterfall show until the next playhead move —
   * and the only thing they can follow on a call whose turns cannot be placed
   * on the recording at all (`currentTurnIdx`, `src/playback.ts`). Every seek
   * and every position the player reports clears it.
   */
  selectedIdx: number | null;
  /** The audio's own length once it reports one; null with no player, or before `loadedmetadata`. */
  durationMs: number | null;
  /**
   * Move the audio, if there is any, and the playhead regardless — a click on a
   * bubble still selects that turn's waterfall on a call whose recording is not
   * in the bucket, was withheld, or was never configured.
   */
  seek: (ms: number) => void;
  /** Mark a turn as the one being read; a bubble click always does this, after its seek. */
  select: (idx: number) => void;
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
  initialSelectedIdx = null,
}: {
  children: ReactNode;
  /**
   * The turn selected on arrival, from `?turn=<idx>` (ADR 0006) — how the
   * Overview's outside-the-percentile rows and the Calls tick strip link to one
   * turn of one call. It behaves like a click: the first playhead move clears
   * it, so a link does not pin the screen to a turn the audio has left.
   */
  initialSelectedIdx?: number | null;
}) {
  const [playheadMs, setPlayhead] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(initialSelectedIdx);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // A moved playhead ends the selection: what the screen follows is then the
  // turn under the audio, until the next click. Setting null again on every
  // frame of playback is a no-op for React.
  const setPlayheadMs = useCallback((ms: number) => {
    setPlayhead(ms);
    setSelectedIdx(null);
  }, []);

  const seek = useCallback(
    (ms: number) => {
      const at = Math.max(0, ms);
      const audio = audioRef.current;
      // Setting `currentTime` makes the element fire `timeupdate` itself, but the
      // state is set here too: with no element there is nothing to fire, and the
      // waterfall must still follow a click on a bubble.
      if (audio !== null) audio.currentTime = at / 1000;
      setPlayheadMs(at);
    },
    [setPlayheadMs],
  );

  const select = useCallback((idx: number) => {
    setSelectedIdx(idx);
  }, []);

  const value = useMemo<Playback>(
    () => ({
      playheadMs,
      selectedIdx,
      durationMs,
      seek,
      select,
      setPlayheadMs,
      setDurationMs,
      audioRef,
    }),
    [playheadMs, selectedIdx, durationMs, seek, select, setPlayheadMs],
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}
