import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { AnnotationRow } from '@/queries/calls';
import {
  callIntervals,
  ANSWER_NEVER_AUDIBLE,
  intervalCells,
  parseEventRow,
  trailVerdict,
  type EventRow,
  type Interval,
  type IntervalCell,
} from './intervals';

/*
 * The pipeline's own cases for the same rules, ported from
 * `../Fonnus/test/tools/call-evidence.test.ts` (the `callIntervals` describe
 * block, :595-1047) so that a §8 rule which drifts from the pipeline's fails
 * here rather than on screen (ADR 0010). The reference asserts on the strings
 * `intervals.txt` prints; here the same strings come out of `intervalCells`,
 * with two deliberate differences: the holder of a deaf stretch is the
 * contract's word `deaf` rather than the reference's `deaf (stt exhausted)`,
 * and a missing payload under a granted outcome reads `[expired]`.
 */

const RECORDING_STARTED = new Date('2026-09-08T07:12:00.100Z');

/** A `call_event` row with the defaults of the reference's `record` (:80-93). */
function record(over: Partial<EventRow> & { seq: number }): EventRow {
  return {
    ts: new Date(RECORDING_STARTED.getTime() + over.seq * 1_000),
    kind: 'event',
    type: 'answered',
    gen: null,
    turnIdx: null,
    phase: null,
    sensitive: false,
    data: null,
    ...over,
  };
}

/**
 * A trail written on the recording clock: one row per `[t seconds, kind/type,
 * the rest of the row]`, numbered in the order it is written — `seq` is the
 * order and `t` is the axis, exactly as a reader of the real table has them
 * (`call-evidence.test.ts:521-532`).
 */
function trailAt(...rows: [number, string, Partial<EventRow>?][]): EventRow[] {
  return rows.map(([t, key, over], i) => {
    const [kind = '', type = ''] = key.split('/');
    return record({
      seq: i + 1,
      ts: new Date(RECORDING_STARTED.getTime() + Math.round(t * 1000)),
      kind,
      type,
      ...over,
    });
  });
}

/** The empty cell — a column that has nothing says so. */
const NOTHING_CELL = '—';

function intervalsOf(events: EventRow[], holeFromSeq: number | null = null): Interval[] {
  return callIntervals(events, { recordingStartedAt: RECORDING_STARTED, holeFromSeq });
}

/**
 * The cells of a call's intervals. `granted` stands for the whole gate: a
 * refused call is `hung_up_before_consent`, the outcome a real refused call
 * carries.
 */
function cellsOf(
  events: EventRow[],
  granted = true,
  assistantText: ReadonlyMap<number, string | null> = new Map(),
): IntervalCell[] {
  return intervalCells(intervalsOf(events), events, {
    outcome: granted ? 'granted' : 'hung_up_before_consent',
    gate: 'on',
    assistantText,
    annotations: [],
  });
}

function holders(events: EventRow[]): string[] {
  return intervalsOf(events).map((i) => i.holder.label);
}

/**
 * The claim the whole file exists for: every instant between the first record
 * and the end of the clock is inside exactly one interval
 * (`call-evidence.test.ts:547-558`). Seconds in, as the reference writes them.
 */
function expectContiguous(list: Interval[], from: number, to: number): void {
  expect(list.length).toBeGreaterThan(0);
  expect(list[0]?.fromMs).toBe(Math.round(from * 1000));
  expect(list[list.length - 1]?.toMs).toBe(Math.round(to * 1000));
  for (const [i, span] of list.entries()) {
    expect(span.toMs).toBeGreaterThan(span.fromMs);
    const next = list[i + 1];
    if (next !== undefined) expect(next.fromMs).toBe(span.toMs);
  }
}

/**
 * The tail of call 330052e1 (`call-evidence.test.ts:560-593`), which is why
 * this file exists: the caller spoke at t ≈ 31.4 and the recogniser returned
 * nothing, and a partial at 45.78 was overtaken by the farewell. The instants
 * are the real call's; the greeting is folded to its two ends. The mute effects
 * are the engine's own shape around them.
 */
function tail330052e1(): EventRow[] {
  return trailAt(
    [0, 'recorder/started'],
    [0.05, 'effect/speak_text', { gen: 1, data: { text: 'Xin chào…' } }],
    [1.2, 'event/first_audible', { gen: 1 }],
    [29.9, 'event/playback_completed', { gen: 1 }],
    [29.92, 'effect/unmute_stt', { gen: 1 }],
    [31.4, 'event/caller_energy', { data: { suppressed: 0 } }],
    [31.47, 'event/turn_end', { data: { source: 'speech_final' } }],
    [31.7, 'event/caller_energy', { data: { suppressed: 2 } }],
    [33.33, 'event/turn_end', { data: { source: 'speech_final' } }],
    [38, 'event/timer_fired', { data: { id: 'no_input' } }],
    [38.02, 'effect/speak_canned', { gen: 2, data: { line: 'reprompt' } }],
    [38.9, 'event/first_audible', { gen: 2 }],
    [38.91, 'effect/mute_stt', { gen: 2 }],
    [42.89, 'event/playback_completed', { gen: 2 }],
    [42.9, 'effect/unmute_stt', { gen: 2 }],
    [45.78, 'event/stt_partial', { sensitive: true, data: { text: 'ok mình cảm ơn', words: 4 } }],
    [46.13, 'effect/speak_canned', { gen: 3, data: { line: 'farewell' } }],
    [46.9, 'event/first_audible', { gen: 3 }],
    [46.91, 'effect/mute_stt', { gen: 3 }],
    [51.2, 'event/playback_completed', { gen: 3 }],
    [51.4, 'recorder/finalized', { data: { reason: 'caller_hangup', consented: true, failed: false } }],
  );
}

describe('callIntervals', () => {
  it('shows, on call 330052e1, that the caller spoke and the recogniser returned nothing', () => {
    const list = intervalsOf(tail330052e1());
    const cells = cellsOf(tail330052e1());
    expect(cells.map((c) => c.holder)).toEqual([
      // The 50 ms before the greeting effect: nobody held the line yet.
      'silence',
      'bot: greeting',
      // The caller's stretch is cut at the recogniser's own segmentation, so
      // each turn-end signal carries the sound that produced it.
      'caller',
      'caller',
      'silence',
      'bot: reprompt',
      'caller',
      'bot: farewell',
      'silence',
    ]);
    const spoke = cells.filter((c) => c.holder === 'caller');
    expect(spoke[0]?.callerLine).toBe('sound at 31.40');
    expect(spoke[0]?.recogniser).toBe('segmented, returned nothing (speech_final)');
    expect(spoke[1]?.callerLine).toBe('sound at 31.70');
    expect(spoke[1]?.recogniser).toBe('segmented, returned nothing (speech_final)');
    // F3: the words were on their way and the farewell went out over them.
    expect(spoke[2]?.recogniser).toBe('partial overtaken: "ok mình cảm ơn"');
    // The watchdog that produced the reprompt, on the silence that armed it.
    expect(cells[4]?.recogniser).toBe('no-input watchdog fired');
    // The greeting's own words, from the ASSUMED `speak_text.data.text`.
    expect(cells[1]?.botText).toBe('Xin chào…');
    // Every second from the first record to recorder/finalized, exactly once.
    expectContiguous(list, 0, 51.4);
  });

  it('separates the wait for a reply from the reply itself, and calls the rest silence', () => {
    const trail = trailAt(
      [0, 'recorder/started'],
      [0.05, 'effect/speak_text', { gen: 1, data: { text: 'Xin chào…' } }],
      [1.2, 'event/first_audible', { gen: 1 }],
      [10, 'event/playback_completed', { gen: 1 }],
      [12, 'event/stt_partial', { sensitive: true, data: { text: 'cho em', words: 2 } }],
      [13, 'event/stt_final', { sensitive: true, data: { text: 'cho em hỏi giờ khám', words: 5 } }],
      [13.1, 'event/turn_end', { data: { source: 'utterance_end' } }],
      [13.1, 'effect/start_reply', {
        gen: 2,
        turnIdx: 1,
        sensitive: true,
        data: { source: 'utterance_end', transcript: 'cho em hỏi giờ khám' },
      }],
      [14.3, 'event/first_audible', { gen: 2 }],
      [20, 'event/playback_completed', { gen: 2 }],
      [25, 'recorder/finalized', { data: { reason: 'caller_hangup', consented: true, failed: false } }],
    );
    const list = intervalsOf(trail);
    const cells = cellsOf(trail, true, new Map([[1, 'Phòng khám mở cửa 7h30.']]));
    expect(cells.map((c) => c.holder)).toEqual([
      'silence',
      'bot: greeting',
      'caller',
      // The pipeline's think-time: the caller has stopped and hears nothing yet.
      'bot: waiting on reply 1',
      'bot: reply 1',
      'silence',
    ]);
    expect(cells[2]?.recogniser).toBe('"cho em hỏi giờ khám"');
    // The partial was replaced by a final, so it is not overtaken.
    expect(cells[2]?.recogniser).not.toContain('partial overtaken');
    expect(cells[3]?.from).toBe('13.10');
    expect(cells[4]?.from).toBe('14.30');
    // The reply's own words come from the turn, joined by turn_idx.
    expect(cells[4]?.botText).toBe('Phòng khám mở cửa 7h30.');
    expect(cells[4]?.turnIdx).toBe(1);
    expectContiguous(list, 0, 25);
  });

  it("shows the reply's own words on a call that did not reach consent", () => {
    // Trap 4 gates `caller_text` only; the bot's words are not the caller's, and
    // the Transcript card shows `assistant_text` ungated on the same screen.
    const trail = trailAt(
      [0, 'recorder/started'],
      [1, 'event/stt_final', { sensitive: true, data: null }],
      [1.1, 'event/turn_end', { data: { source: 'speech_final' } }],
      [1.1, 'effect/start_reply', { gen: 1, turnIdx: 0, sensitive: true, data: null }],
      [2, 'event/first_audible', { gen: 1 }],
      [5, 'event/playback_completed', { gen: 1 }],
      [6, 'recorder/finalized', { data: { reason: 'caller_hangup', consented: false, failed: false } }],
    );
    const cells = cellsOf(trail, false, new Map([[0, 'Dạ, 7h30 ạ.']]));
    const reply = cells.find((c) => c.holder === 'bot: reply 0');
    expect(reply?.botText).toBe('Dạ, 7h30 ạ.');
    expect(cells.find((c) => c.holder === 'caller')?.recogniser).toBe('[withheld]');
  });

  it('returns one cell per interval, in interval order', () => {
    // The card joins cells to intervals by index (`page.tsx`); a filter here
    // would put a row on another interval's clock.
    const trail = tail330052e1();
    const list = intervalsOf(trail);
    const cells = cellsOf(trail);
    expect(cells.length).toBe(list.length);
    expect(cells.map((c) => c.seekMs)).toEqual(list.map((i) => Math.max(0, i.fromMs)));
  });

  it('withholds every recogniser text on a call that did not reach consent', () => {
    // What a refused call actually carries: the record, its timing, and no
    // payload at all — the gate stripped it at write time (trap 10).
    const stripped = tail330052e1().map((r) => (r.sensitive ? { ...r, data: null } : r));
    const spoke = cellsOf(stripped, false).filter((c) => c.holder === 'caller');
    expect(spoke[2]?.recogniser).toBe('partial overtaken: [withheld]');
    // The F4 signature needs no payload, so a refused call still shows it.
    expect(spoke[0]?.recogniser).toBe('segmented, returned nothing (speech_final)');
    // And a granted call whose payload is there still reads it.
    expect(cellsOf(tail330052e1())[6]?.recogniser).toContain('ok mình cảm ơn');
  });

  it('withholds the text of a final the console was not allowed to show', () => {
    const cells = cellsOf(
      trailAt(
        [0, 'recorder/started'],
        [1, 'event/stt_final', { sensitive: true, data: { text: 'cho em hỏi', words: 3 } }],
        [2, 'recorder/finalized'],
      ),
      false,
    );
    expect(cells[0]?.recogniser).toBe('[withheld]');
  });

  it('counts turn-end signals that landed in the same millisecond', () => {
    const cells = cellsOf(
      trailAt(
        [0, 'recorder/started'],
        [1, 'event/caller_energy', { data: { suppressed: 0 } }],
        [2, 'event/turn_end', { data: { source: 'speech_final' } }],
        [2, 'event/turn_end', { data: { source: 'speech_final' } }],
        [3, 'recorder/finalized'],
      ),
    );
    expect(cells[0]?.recogniser).toBe('segmented, returned nothing (speech_final) ×2');
  });

  it('names a turn-end signal the row did not record, rather than inventing one', () => {
    const cells = cellsOf(
      trailAt([0, 'recorder/started'], [1, 'event/turn_end'], [2, 'recorder/finalized']),
    );
    expect(cells[0]?.recogniser).toBe('segmented, returned nothing');
  });

  it("marks the greeting deaf from the call's birth until the trail says the feed opened", () => {
    // Energy is measured before the mute gate, so it exists inside bot
    // intervals — and there the pipeline dropped the frames it came from. The
    // shell starts muted, so the greeting's whole stretch is unheard without
    // any mute effect of its own; the first effect/unmute_stt ends it.
    const cells = cellsOf(
      trailAt(
        [0, 'effect/speak_text', { gen: 1, data: { text: 'Xin chào…' } }],
        [0.4, 'event/caller_energy', { data: { suppressed: 0 } }],
        [1, 'event/first_audible', { gen: 1 }],
        [2, 'event/caller_energy', { data: { suppressed: 0 } }],
        [8, 'event/playback_completed', { gen: 1 }],
        [8.02, 'effect/unmute_stt', { gen: 1 }],
        [8.5, 'event/caller_energy', { data: { suppressed: 0 } }],
        [9, 'recorder/finalized'],
      ),
    );
    expect(cells[0]?.holder).toBe('bot: greeting');
    expect(cells[0]?.callerLine).toBe('sound at 0.40, 2.00 (unheard — feed muted)');
    // The feed is open from there: the same kind of sound, now heard.
    expect(cells[1]?.holder).toBe('caller');
    expect(cells[1]?.callerLine).toBe('sound at 8.50');
  });

  it('collapses a long run of caller-line sound to a count and its two ends', () => {
    const energy: [number, string, Partial<EventRow>?][] = [0, 1, 2, 3, 4, 5, 6].map((n) => [
      1 + n * 0.3,
      'event/caller_energy',
      { data: { suppressed: 0 } },
    ]);
    const cells = cellsOf(
      trailAt(
        [0, 'recorder/started'],
        [0.5, 'effect/unmute_stt', { gen: 1 }],
        ...energy,
        [5, 'recorder/finalized'],
      ),
    );
    expect(cells[0]?.callerLine).toBe('sound ×7 (1.00…2.80)');
  });

  it('ends a bot interval at a barge-in and ignores the drain of the generation it killed', () => {
    const trail = trailAt(
      [0, 'effect/start_reply', { gen: 1, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
      [1, 'event/first_audible', { gen: 1 }],
      [3, 'barge_in/detected', { gen: 1, phase: 'listening', data: { trigger: 'caller_energy' } }],
      [3.5, 'event/stt_final', { sensitive: true, data: { text: 'khoan đã', words: 2 } }],
      [3.6, 'event/turn_end', { data: { source: 'speech_final' } }],
      [3.6, 'effect/start_reply', { gen: 2, turnIdx: 2, sensitive: true, data: { source: 'reopen', transcript: 'y' } }],
      // The killed generation's queue drains after the successor started: it is
      // not the end of the live reply.
      [3.8, 'event/playback_completed', { gen: 1 }],
      [4.2, 'event/first_audible', { gen: 2 }],
      [9, 'event/playback_completed', { gen: 2 }],
      [10, 'recorder/finalized'],
    );
    const list = intervalsOf(trail);
    expect(holders(trail)).toEqual([
      'bot: waiting on reply 1',
      'bot: reply 1',
      'caller',
      'bot: waiting on reply 2',
      'bot: reply 2',
      'silence',
    ]);
    expect(list[1]?.toMs).toBe(3000);
    // The stale drain at 3.8 did not cut the wait for reply 2 short.
    expect(list[4]?.fromMs).toBe(4200);
    expectContiguous(list, 0, 10);
  });

  it('ends the wait for a reply that failed, and hands the line to the degraded line', () => {
    const trail = trailAt(
      [0, 'effect/start_reply', { gen: 1, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
      [2, 'event/reply_failed', { gen: 1, data: { leg: 'llm', stage: 'ttfb', ms: 2000 } }],
      [2.1, 'effect/speak_canned', { gen: 2, data: { line: 'degraded' } }],
      [2.6, 'event/first_audible', { gen: 2 }],
      [6, 'event/playback_completed', { gen: 2 }],
      [7, 'recorder/finalized'],
    );
    const list = intervalsOf(trail);
    expect(holders(trail)).toEqual([
      'bot: waiting on reply 1',
      'silence',
      'bot: degraded',
      'silence',
    ]);
    expect(list[0]?.toMs).toBe(2000);
    expectContiguous(list, 0, 7);
  });

  it('ends the wait for a reply that produced no audio at synthesis_complete', () => {
    // The engine unmutes and hands the line back to the caller there, so
    // everything after it is the caller's — including the speech the recogniser
    // then segmented and returned nothing for.
    const trail = trailAt(
      [0, 'recorder/started'],
      [0.5, 'effect/unmute_stt', { gen: 1 }],
      [1, 'effect/start_reply', { gen: 2, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
      [2.5, 'event/synthesis_complete', { gen: 2 }],
      // Nothing was ever audible, so nothing ever muted the feed; `afterReply`
      // emits its unmute all the same, and re-opening an open feed is a no-op.
      [2.51, 'effect/unmute_stt', { gen: 2 }],
      [3.2, 'event/caller_energy', { data: { suppressed: 0 } }],
      [4, 'event/turn_end', { data: { source: 'speech_final' } }],
      [6, 'effect/speak_canned', { gen: 3, data: { line: 'reprompt' } }],
      [6.5, 'event/first_audible', { gen: 3 }],
      [9, 'event/playback_completed', { gen: 3 }],
      [9.5, 'recorder/finalized'],
    );
    const list = intervalsOf(trail);
    const cells = cellsOf(trail);
    expect(cells.map((c) => c.holder)).toEqual([
      'silence',
      'bot: waiting on reply 1',
      'caller',
      'silence',
      'bot: reprompt',
      'silence',
    ]);
    expect(list[1]?.toMs).toBe(2500);
    expect(cells[2]?.callerLine).toBe('sound at 3.20');
    expect(cells[2]?.recogniser).toBe('segmented, returned nothing (speech_final)');
    expectContiguous(list, 0, 9.5);
  });

  it("keeps a reply's wait heard and its playback deaf, the way the default gate mutes", () => {
    // The shipped shape: the feed is open across the wait and shuts at the
    // reply's first audible byte. Nothing here is read from a setting — the two
    // effects on the trail are the whole evidence.
    const trail = trailAt(
      [0, 'recorder/started'],
      [0.05, 'effect/unmute_stt', { gen: 1 }],
      [1, 'event/caller_energy', { data: { suppressed: 0 } }],
      [1.5, 'event/turn_end', { data: { source: 'speech_final' } }],
      [1.5, 'effect/start_reply', { gen: 2, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
      [1.8, 'event/caller_energy', { data: { suppressed: 0 } }],
      [2.5, 'event/first_audible', { gen: 2 }],
      [2.5, 'effect/mute_stt', { gen: 2 }],
      [3, 'event/caller_energy', { data: { suppressed: 0 } }],
      [6, 'event/playback_completed', { gen: 2 }],
      [6.5, 'event/caller_energy', { data: { suppressed: 0 } }],
      [6.6, 'effect/unmute_stt', { gen: 2 }],
      [6.8, 'event/turn_end', { data: { source: 'speech_final' } }],
      [7, 'event/caller_energy', { data: { suppressed: 0 } }],
      [8, 'recorder/finalized'],
    );
    const cells = cellsOf(trail);
    expect(cells.map((c) => c.holder)).toEqual([
      'caller',
      'bot: waiting on reply 1',
      'bot: reply 1',
      'caller',
      'caller',
    ]);
    expect(cells[0]?.callerLine).toBe('sound at 1.00');
    // The wait keeps the feed open, so the caller talking over it was heard.
    expect(cells[1]?.callerLine).toBe('sound at 1.80');
    expect(cells[2]?.callerLine).toBe('sound at 3.00 (unheard — feed muted)');
    // The engine unmutes at `speakingDone`, AFTER the last drain: the first
    // instants of the caller's own interval were still unheard.
    expect(cells[3]?.callerLine).toBe('sound at 6.50 (unheard — feed muted)');
    expect(cells[4]?.callerLine).toBe('sound at 7.00');
    expectContiguous(intervalsOf(trail), 0, 8);
  });

  it("marks a reply's wait unheard when the trail shows the feed shut at the turn commit", () => {
    // The rollback shape (`STT_MUTE_ON_FIRST_AUDIO=false`): `commitTurn` emits
    // mute_stt beside start_reply, so the wait itself is deaf. The console is
    // told nothing about the call's configuration — the effect record says it.
    const cells = cellsOf(
      trailAt(
        [0, 'recorder/started'],
        [0.1, 'effect/unmute_stt', { gen: 1 }],
        [1, 'event/caller_energy', { data: { suppressed: 0 } }],
        [2, 'effect/mute_stt', { gen: 2 }],
        [2, 'effect/start_reply', { gen: 2, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
        [2.5, 'event/caller_energy', { data: { suppressed: 0 } }],
        [3, 'event/first_audible', { gen: 2 }],
        [6, 'event/playback_completed', { gen: 2 }],
        [6.05, 'effect/unmute_stt', { gen: 2 }],
        [7, 'recorder/finalized'],
      ),
    );
    expect(cells[0]?.callerLine).toBe('sound at 1.00');
    expect(cells[1]?.holder).toBe('bot: waiting on reply 1');
    expect(cells[1]?.callerLine).toBe('sound at 2.50 (unheard — feed muted)');
  });

  it('carries a muted feed into a canned line the bot entered without unmuting', () => {
    // The degraded line after a reply that failed while audible: the engine
    // never unmutes in between, so the wait for the canned line's own first
    // byte was deaf too — which no per-line rule about canned lines could say.
    const trail = trailAt(
      [0, 'recorder/started'],
      [0.05, 'effect/unmute_stt', { gen: 1 }],
      [1, 'effect/start_reply', { gen: 2, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
      [1.5, 'event/first_audible', { gen: 2 }],
      [1.5, 'effect/mute_stt', { gen: 2 }],
      [3, 'event/reply_failed', { gen: 2, data: { leg: 'tts', stage: 'idle', ms: 1500 } }],
      [3.1, 'effect/speak_canned', { gen: 3, data: { line: 'degraded' } }],
      [3.4, 'event/caller_energy', { data: { suppressed: 0 } }],
      [4, 'event/first_audible', { gen: 3 }],
      [4, 'effect/mute_stt', { gen: 3 }],
      [7, 'event/playback_completed', { gen: 3 }],
      [7.05, 'effect/unmute_stt', { gen: 3 }],
      [8, 'recorder/finalized'],
    );
    const cells = cellsOf(trail);
    expect(cells.map((c) => c.holder)).toEqual([
      'silence',
      'bot: waiting on reply 1',
      'bot: reply 1',
      'bot: degraded',
      'silence',
    ]);
    expect(cells[3]?.callerLine).toBe('sound at 3.40 (unheard — feed muted)');
    expectContiguous(intervalsOf(trail), 0, 8);
  });

  it('keeps a canned line the bot entered from listening heard until its own first byte', () => {
    // The reprompt after the no-input watchdog: the feed was open across the
    // silence that armed it and shuts only at the reprompt's first audible byte.
    const cells = cellsOf(
      trailAt(
        [0, 'recorder/started'],
        [0.05, 'effect/unmute_stt', { gen: 1 }],
        [0.4, 'event/caller_energy', { data: { suppressed: 0 } }],
        [1, 'effect/speak_canned', { gen: 2, data: { line: 'reprompt' } }],
        [1.4, 'event/caller_energy', { data: { suppressed: 0 } }],
        [2, 'event/first_audible', { gen: 2 }],
        [2, 'effect/mute_stt', { gen: 2 }],
        [6, 'event/playback_completed', { gen: 2 }],
        [6.05, 'effect/unmute_stt', { gen: 2 }],
        [7, 'recorder/finalized'],
      ),
    );
    expect(cells[0]?.callerLine).toBe('sound at 0.40');
    expect(cells[1]?.holder).toBe('bot: reprompt');
    expect(cells[1]?.callerLine).toBe('sound at 1.40');
  });

  it('calls every stretch after the STT socket gave up deaf, and keeps the bot lines', () => {
    const trail = trailAt(
      [0, 'recorder/started'],
      [0.2, 'effect/unmute_stt', { gen: 1 }],
      [1, 'event/caller_energy', { data: { suppressed: 0 } }],
      [2, 'stt/error', { data: { code: 1006 } }],
      [3, 'stt/reconnect', { data: { attempt: 3 } }],
      [4, 'stt/reconnect_exhausted', { data: { attempts: 3 } }],
      [5, 'event/caller_energy', { data: { suppressed: 0 } }],
      [6, 'effect/speak_canned', { gen: 2, data: { line: 'farewell' } }],
      [6.5, 'event/first_audible', { gen: 2 }],
      [6.51, 'effect/mute_stt', { gen: 2 }],
      [9, 'event/playback_completed', { gen: 2 }],
      [10, 'recorder/finalized'],
    );
    const list = intervalsOf(trail);
    const cells = cellsOf(trail);
    // The reference prints `deaf (stt exhausted)`; the contract's word is `deaf`
    // and the explanation travels beside it on screen (ADR 0010).
    expect(cells.map((c) => c.holder)).toEqual(['caller', 'deaf', 'bot: farewell', 'deaf']);
    expect(list.map((i) => i.holder.kind)).toEqual(['caller', 'deaf', 'canned', 'deaf']);
    // The sound is still on the line — it is the pipeline that could not hear it.
    expect(cells[1]?.callerLine).toBe('sound at 5.00');
    expect(list[0]?.toMs).toBe(4000);
    expectContiguous(list, 0, 10);
  });

  it('ignores a {kind, type} it does not know rather than failing on it', () => {
    // §3.1: the record set grows additively and a reader must tolerate a type it
    // has never seen — ignored by every rule, still counted for the verdict.
    const withUnknown = [
      ...tail330052e1().map((r) => ({ ...r, seq: r.seq + 2 })),
      record({ seq: 1, kind: 'quantum', type: 'entangled', ts: RECORDING_STARTED, data: { x: 1 } }),
      record({
        seq: 2,
        kind: 'llm',
        type: 'request_sent',
        ts: new Date(RECORDING_STARTED.getTime() + 35_000),
        data: { model: 'openai/gpt-oss-120b', fallback: false },
      }),
    ];
    // Out of seq order on purpose: the axis is seq, and the derivation sorts by it.
    expect(holders(withUnknown)).toEqual(holders(tail330052e1()));
    expect(trailVerdict(withUnknown, { recordCalls: 'full', ended: true }).records).toBe(23);
  });

  it('places no interval at all when the call has no recording_started_at', () => {
    // Every boundary here is a subtraction from that instant; without it there
    // is nothing to place (the card then lists no interval and says why).
    expect(
      callIntervals(tail330052e1(), { recordingStartedAt: null, holeFromSeq: null }),
    ).toEqual([]);
  });

  it('keeps the first record where it is when it precedes the recording origin', () => {
    // The recorder takes ~100 ms to open, so the first record can sit before the
    // origin; clamping would hide it and break contiguity (ADR 0010 decision 4).
    const list = intervalsOf(
      trailAt(
        [-0.1, 'event/answered'],
        [0.5, 'effect/speak_text', { gen: 1, data: { text: 'Xin chào…' } }],
        [1, 'event/first_audible', { gen: 1 }],
        [4, 'event/playback_completed', { gen: 1 }],
        [5, 'recorder/finalized'],
      ),
    );
    expect(list[0]?.fromMs).toBe(-100);
    expect(intervalCells(list, [], {
      outcome: 'granted',
      gate: 'on',
      assistantText: new Map(),
      annotations: [],
    })[0]).toMatchObject({ from: '-0.10', seekMs: 0 });
    expectContiguous(list, -0.1, 5);
  });

  // The holding line (pipeline ADR 0030): the four cases of
  // `call-evidence.test.ts:805-899`, with the same holders and bounds.
  it('splits the wait at the holding line, and ends nothing at a failed one (ADR 0030)', () => {
    const reply = { sensitive: true, data: { source: 'speech_final', transcript: 'x' } };
    const trail = trailAt(
      [0, 'effect/start_reply', { gen: 1, turnIdx: 1, ...reply }],
      [2.1, 'effect/speak_holding_line', { gen: 1, turnIdx: 1 }],
      [2.4, 'event/holding_line_audible', { gen: 1 }],
      [2.41, 'effect/mute_stt', { gen: 1 }],
      // The line's own drain, while the answer is still coming: not the end
      // of the reply.
      [4, 'event/playback_completed', { gen: 1 }],
      [5, 'event/first_audible', { gen: 1 }],
      [9, 'event/playback_completed', { gen: 1 }],
      [9.02, 'effect/unmute_stt', { gen: 1 }],
      // Turn 2: its line failed, so the caller only ever waited.
      [10, 'effect/start_reply', { gen: 2, turnIdx: 2, ...reply }],
      [12.1, 'effect/speak_holding_line', { gen: 2, turnIdx: 2 }],
      [12.5, 'event/holding_line_failed', { gen: 2, data: {} }],
      [13, 'event/first_audible', { gen: 2 }],
      [15, 'event/playback_completed', { gen: 2 }],
      [16, 'recorder/finalized'],
    );
    const list = intervalsOf(trail);
    expect(list.map((i) => i.holder.label)).toEqual([
      'bot: waiting on reply 1',
      'bot: holding line 1',
      'bot: reply 1',
      'silence',
      'bot: waiting on reply 2',
      'bot: reply 2',
      'silence',
    ]);
    expect(list[1]?.holder).toMatchObject({ kind: 'holding', turnIdx: 1, gen: 1 });
    expect(list[0]?.toMs).toBe(2400);
    expect(list[1]?.toMs).toBe(5000);
    expect(list[2]?.toMs).toBe(9000);
    expect(list[4]?.toMs).toBe(13000);
    expectContiguous(list, 0, 16);
    // The answer was heard: the line's row carries no note.
    expect(cellsOf(trail).map((c) => c.botNote)).toEqual(Array(7).fill(null));
  });

  it('runs a holding line to the end of a reply whose answer never became audible', () => {
    const trail = trailAt(
      [0, 'effect/start_reply', { gen: 1, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
      [2.4, 'event/holding_line_audible', { gen: 1 }],
      [4, 'event/playback_completed', { gen: 1 }],
      [6, 'event/reply_failed', { gen: 1, data: { leg: 'llm', stage: 'idle', ms: 5000 } }],
      [6.1, 'effect/speak_canned', { gen: 2, data: { line: 'degraded' } }],
      [6.5, 'event/first_audible', { gen: 2 }],
      [9, 'event/playback_completed', { gen: 2 }],
      [10, 'recorder/finalized'],
    );
    const list = intervalsOf(trail);
    expect(list.map((i) => i.holder.label)).toEqual([
      'bot: waiting on reply 1',
      'bot: holding line 1',
      'silence',
      'bot: degraded',
      'silence',
    ]);
    // The line's drain at 4 did not end the reply; the failure at 6 did.
    expect(list[1]?.toMs).toBe(6000);
    expectContiguous(list, 0, 10);
    // The failure says so in the error tone and the line's row says it in words.
    const cells = cellsOf(trail);
    expect(cells.find((c) => c.holderKind === 'holding')?.botNote).toBe(ANSWER_NEVER_AUDIBLE);
    expect(cells.filter((c) => c.botNote !== null)).toHaveLength(1);
  });

  it('says the answer never became audible on a holding line the caller barged into', () => {
    // `botSpans` cuts the line at `barge_in/detected` with no `first_audible`
    // of the gen, so the holder's `audible` is false — the same note as a
    // failed or empty answer, pinned here so the barge-in branch keeps it.
    const trail = trailAt(
      [0, 'effect/start_reply', { gen: 1, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
      [2.4, 'event/holding_line_audible', { gen: 1 }],
      [3.5, 'barge_in/detected', { gen: 1, phase: 'listening', data: { trigger: 'caller_energy' } }],
      [4, 'event/playback_completed', { gen: 1 }],
      [10, 'recorder/finalized'],
    );
    const list = intervalsOf(trail);
    expect(list.map((i) => i.holder.label)).toEqual(['bot: waiting on reply 1', 'bot: holding line 1', 'silence']);
    expect(list[1]?.toMs).toBe(3500);
    expectContiguous(list, 0, 10);
    const cells = cellsOf(trail);
    expect(cells.find((c) => c.holderKind === 'holding')?.botNote).toBe(ANSWER_NEVER_AUDIBLE);
  });

  it('holds an empty answer behind a line until its drain, when the drain comes last', () => {
    const trail = trailAt(
      [0, 'effect/start_reply', { gen: 1, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
      [2.4, 'event/holding_line_audible', { gen: 1 }],
      // The model answered nothing while the line was still playing.
      [3, 'event/synthesis_complete', { gen: 1 }],
      [4.5, 'event/playback_completed', { gen: 1 }],
      [4.52, 'effect/unmute_stt', { gen: 1 }],
      [6, 'recorder/finalized'],
    );
    const list = intervalsOf(trail);
    expect(list.map((i) => i.holder.label)).toEqual([
      'bot: waiting on reply 1',
      'bot: holding line 1',
      'silence',
    ]);
    // The line's last 1.5 s are the bot's, not the caller's.
    expect(list[1]?.toMs).toBe(4500);
    expectContiguous(list, 0, 6);
    const cells = cellsOf(trail);
    expect(cells.find((c) => c.holderKind === 'holding')?.botNote).toBe(ANSWER_NEVER_AUDIBLE);
    expect(cells.find((c) => c.holderKind === 'waiting')?.botNote).toBeNull();
  });

  it('holds an empty answer behind a line until synthesis_complete, when that comes last', () => {
    const list = intervalsOf(
      trailAt(
        [0, 'effect/start_reply', { gen: 1, turnIdx: 1, sensitive: true, data: { source: 'speech_final', transcript: 'x' } }],
        [2.4, 'event/holding_line_audible', { gen: 1 }],
        [4.5, 'event/playback_completed', { gen: 1 }],
        // Silence after the line, while the model still produced nothing.
        [7, 'event/synthesis_complete', { gen: 1 }],
        [7.02, 'effect/unmute_stt', { gen: 1 }],
        [9, 'recorder/finalized'],
      ),
    );
    expect(list.map((i) => i.holder.label)).toEqual([
      'bot: waiting on reply 1',
      'bot: holding line 1',
      'silence',
    ]);
    expect(list[1]?.toMs).toBe(7000);
    expectContiguous(list, 0, 9);
  });

  it('counts the four holding-line records for the verdict and changes nothing else', () => {
    // The four types are §3.1 records like any other: counted for completeness,
    // no verdict of their own.
    const trail = trailAt(
      [0, 'effect/start_reply', { gen: 1, turnIdx: 1 }],
      [1, 'event/first_sentence_queued', { gen: 1 }],
      [2.1, 'effect/speak_holding_line', { gen: 1, turnIdx: 1 }],
      [2.4, 'event/holding_line_audible', { gen: 1 }],
      [2.5, 'event/holding_line_failed', { gen: 1, data: {} }],
      [5, 'event/first_audible', { gen: 1 }],
      [9, 'event/playback_completed', { gen: 1 }],
      [10, 'recorder/finalized'],
    );
    expect(trailVerdict(trail, { recordCalls: 'full', ended: true })).toMatchObject({
      kind: 'complete',
      records: 8,
    });
  });
});

describe('the holding line on the card', () => {
  /** A reply with a holding line, and the flagged `tts/sentence` that carried it. */
  function lineTrail(sentence: Partial<EventRow>): EventRow[] {
    return trailAt(
      [0, 'effect/start_reply', { gen: 1, turnIdx: 1, sensitive: true }],
      [2.1, 'effect/speak_holding_line', { gen: 1, turnIdx: 1 }],
      [2.15, 'tts/sentence', { gen: 1, turnIdx: 1, ...sentence }],
      [2.4, 'event/holding_line_audible', { gen: 1 }],
      [3, 'tts/sentence', { gen: 1, turnIdx: 1, sensitive: true, data: { text: 'Dạ, 7h30 ạ.' } }],
      [4, 'event/playback_completed', { gen: 1 }],
      [5, 'event/first_audible', { gen: 1 }],
      [9, 'event/playback_completed', { gen: 1 }],
      [10, 'recorder/finalized'],
    );
  }
  const LINE = 'Dạ, anh chị chờ em một lát ạ';
  const flagged = { sensitive: false, data: { text: LINE, holding_line: true } };
  const assistant = new Map([[1, 'Dạ, phòng khám mở cửa 7h30 ạ.']]);

  it("shows the line's text on its own row, and the reply's row keeps assistant_text only", () => {
    const cells = cellsOf(lineTrail(flagged), false, assistant);
    const line = cells.find((c) => c.holderKind === 'holding');
    expect(line).toMatchObject({ holder: 'bot: holding line 1', turnIdx: 1, botText: LINE });
    const reply = cells.find((c) => c.holderKind === 'reply');
    expect(reply?.botText).toBe('Dạ, phòng khám mở cửa 7h30 ạ.');
    expect(reply?.botText).not.toContain(LINE);
  });

  it('shows no text when the flagged record is absent', () => {
    const cells = cellsOf(
      lineTrail({ sensitive: true, data: { text: 'Dạ, 7h30 ạ.' } }),
      true,
      assistant,
    );
    expect(cells.find((c) => c.holderKind === 'holding')?.botText).toBeNull();
  });

  it('reads a payload of the wrong shape as absent', () => {
    for (const data of [
      { text: 42, holding_line: true },
      { text: LINE, holding_line: 'yes' },
      null,
    ]) {
      const cells = cellsOf(lineTrail({ sensitive: false, data }), true, assistant);
      expect(cells.find((c) => c.holderKind === 'holding')?.botText).toBeNull();
    }
  });

  it('never prints a sensitive record as the line, even when it is flagged', () => {
    const cells = cellsOf(
      lineTrail({ sensitive: true, data: { text: 'caller words', holding_line: true } }),
      false,
      assistant,
    );
    expect(cells.find((c) => c.holderKind === 'holding')?.botText).toBeNull();
  });
});

describe('trailVerdict', () => {
  const complete = tail330052e1();

  it('reads a finalized trail whose count matches max(seq) as complete', () => {
    const verdict = trailVerdict(complete, { recordCalls: 'full', ended: true });
    expect(verdict.kind).toBe('complete');
    expect(verdict.records).toBe(21);
    expect(verdict.holeFromSeq).toBeNull();
  });

  it('names the snapshot key and the four causes when the call has no record at all', () => {
    const verdict = trailVerdict([], { recordCalls: 'off', ended: true });
    expect(verdict.kind).toBe('absent');
    expect(verdict.records).toBe(0);
    expect(verdict.text).toContain('RECORD_CALLS = off');
    expect(verdict.text).toContain('trap 8');
    // Not "nothing happened": four causes, and the snapshot may not carry the key.
    expect(trailVerdict([], { recordCalls: null, ended: true }).text).toContain(
      'not in the snapshot',
    );
  });

  it('reads a running call with no terminal record as open, never truncated', () => {
    const running = complete.filter((r) => r.type !== 'finalized');
    expect(trailVerdict(running, { recordCalls: 'full', ended: false }).kind).toBe('open');
    expect(trailVerdict(running, { recordCalls: 'full', ended: true }).kind).toBe('truncated');
  });

  it('calls a recorder that latched off a gap, from the record before the terminal one', () => {
    const failed = complete.map((r) =>
      r.type === 'finalized' ? { ...r, data: { reason: 'caller_hangup', failed: true } } : r,
    );
    const verdict = trailVerdict(failed, { recordCalls: 'full', ended: true });
    expect(verdict.kind).toBe('gap');
    expect(verdict.holeFromSeq).toBe(20);
    expect(verdict.text).toContain('the recorder itself failed');
  });

  it('calls rows the mirror could not write a gap, from the seq it names', () => {
    const dropped = complete.map((r) =>
      r.type === 'finalized'
        ? { ...r, data: { reason: 'caller_hangup', failed: false, mirror: { dropped: 4, fromSeq: 12 } } }
        : r,
    );
    const verdict = trailVerdict(dropped, { recordCalls: 'full', ended: true });
    expect(verdict.kind).toBe('gap');
    expect(verdict.holeFromSeq).toBe(12);
    expect(verdict.text).toContain('4 row(s) the mirror could not write');
  });

  it('lists both holes when the disk and the database failed, and keeps the earlier seq', () => {
    const both = complete.map((r) =>
      r.type === 'finalized'
        ? { ...r, data: { reason: 'caller_hangup', failed: true, mirror: { dropped: 2, fromSeq: 9 } } }
        : r,
    );
    const verdict = trailVerdict(both, { recordCalls: 'full', ended: true });
    expect(verdict.kind).toBe('gap');
    expect(verdict.text).toContain('the recorder itself failed');
    expect(verdict.text).toContain('2 row(s) the mirror could not write');
    // The earlier hole wins: it is the earlier loss of evidence.
    expect(verdict.holeFromSeq).toBe(9);
  });

  it('is complete when the terminal record reports a mirror that dropped nothing', () => {
    const clean = complete.map((r) =>
      r.type === 'finalized'
        ? { ...r, data: { reason: 'caller_hangup', failed: false, mirror: { dropped: 0, fromSeq: null } } }
        : r,
    );
    expect(trailVerdict(clean, { recordCalls: 'full', ended: true }).kind).toBe('complete');
  });

  it('reads a trail whose terminal row survived its own failed batch as a gap', () => {
    // The drain-failure shape (`call-evidence.test.ts:386-404`): the mirror
    // landed `recorder/finalized` on its one attempt, but the row was minted
    // before the failure — it honestly says `dropped: 0` and the arithmetic is
    // what sees the hole.
    const held = complete
      .filter((r) => r.type === 'finalized')
      .map((r) => ({
        ...r,
        data: { reason: 'caller_hangup', failed: false, mirror: { dropped: 0, fromSeq: null } },
      }));
    const verdict = trailVerdict(held, { recordCalls: 'full', ended: true });
    expect(verdict.kind).toBe('gap');
    expect(verdict.text).toContain('somewhere in the middle');
    expect(verdict.holeFromSeq).toBeNull();
  });

  it('reads a finalized trail with a seq hole as a gap it cannot place', () => {
    const holed = complete.filter((r) => r.seq !== 10);
    const verdict = trailVerdict(holed, { recordCalls: 'full', ended: true });
    expect(verdict.kind).toBe('gap');
    expect(verdict.text).toContain('lost write(s) somewhere in the middle');
    expect(verdict.holeFromSeq).toBeNull();
  });

  it('takes a terminal record with no mirror key as "cannot say", not as a gap', () => {
    // Absent is not zero (`call-evidence.ts:497-505`): a call recorded before
    // the key existed, or one that ran under no mirror.
    const noKey = complete.map((r) =>
      r.type === 'finalized' ? { ...r, data: { reason: 'caller_hangup' } } : r,
    );
    expect(trailVerdict(noKey, { recordCalls: 'full', ended: true }).kind).toBe('complete');
    const shapeless = complete.map((r) =>
      r.type === 'finalized' ? { ...r, data: { mirror: 'dropped some' } } : r,
    );
    expect(trailVerdict(shapeless, { recordCalls: 'full', ended: true }).kind).toBe('complete');
  });

  it('marks every interval from the hole on as unsupported, and none before it', () => {
    const list = intervalsOf(tail330052e1(), 12);
    // seq 12 is `event/first_audible` of the reprompt at 38.9 s: the intervals
    // that start at or after it stand on a trail with a hole in it (§8 rule 7).
    expect(list.filter((i) => !i.unsupported).every((i) => i.fromMs < 38_900)).toBe(true);
    expect(list.filter((i) => i.unsupported).every((i) => i.fromMs >= 38_900)).toBe(true);
    expect(list.some((i) => i.unsupported)).toBe(true);
    expect(intervalsOf(tail330052e1()).some((i) => i.unsupported)).toBe(false);
  });
});

describe('no interval carries caller text', () => {
  it('holds no word of the trail anywhere in its values', () => {
    // The enforcer of ADR 0010 decision 5: the derivation has nothing to leak,
    // whatever the consent outcome, because it never read a payload's words.
    const refused = tail330052e1();
    const json = JSON.stringify(intervalsOf(refused));
    for (const word of ['Xin chào…', 'ok mình cảm ơn']) expect(json).not.toContain(word);
  });

  it('passes every text through the one gate, called once', () => {
    // ADR 0005: one enforcement point. The gate is called where the cells are
    // built and nowhere else in this module, so there is nothing to bypass.
    const source = readFileSync(new URL('./intervals.ts', import.meta.url), 'utf8');
    expect(source.match(/showCallerData\(/g)).toHaveLength(1);
  });

  it('resolves a payload that aged out as expired, and a refused one as withheld', () => {
    // Trap 10: the record proves the recogniser produced words; which erasure
    // took them is the consent outcome's answer.
    const gone = trailAt(
      [0, 'recorder/started'],
      [1, 'event/stt_final', { sensitive: true, data: null }],
      [2, 'recorder/finalized'],
    );
    expect(cellsOf(gone, true)[0]?.recogniser).toBe('[expired]');
    expect(cellsOf(gone, false)[0]?.recogniser).toBe('[withheld]');
  });

  it('names a payload that is present but has no text, rather than calling it expired', () => {
    // Trap 10 is about a null payload; a payload of another shape is the
    // ASSUMED `text` key not being there, which must surface as itself.
    const trail = trailAt(
      [0, 'effect/speak_text', { gen: 1, data: { text: 'Xin chào' } }],
      [1, 'event/playback_completed', { gen: 1 }],
      [2, 'event/stt_final', { sensitive: true, data: { words: 3 } }],
      [3, 'event/turn_end', { data: { source: 'speech_final' } }],
      [4, 'recorder/finalized', { data: { reason: 'caller_hangup' } }],
    );
    const caller = cellsOf(trail, true).find((c) => c.holderKind === 'caller');
    expect(caller?.recogniser).toBe('[no text in payload]');
    expect(caller?.recogniser).not.toContain('[expired]');
    const aged = trail.map((r) => (r.type === 'stt_final' ? { ...r, data: null } : r));
    expect(cellsOf(aged, true).find((c) => c.holderKind === 'caller')?.recogniser).toBe('[expired]');
  });

  it('lists one overtaken partial per interval, as the reference does', () => {
    // Two intents in the same instant (trap 9: ts can tie) leave the canned
    // line's span empty, so the caller interval before it owns both partials.
    const trail = trailAt(
      [0, 'effect/speak_text', { gen: 1, data: { text: 'Xin chào' } }],
      [1, 'event/playback_completed', { gen: 1 }],
      [2, 'event/stt_partial', { sensitive: true, data: { text: 'một' } }],
      [5, 'effect/speak_canned', { gen: 2, data: { line: 'reprompt' } }],
      [4.999, 'event/stt_partial', { sensitive: true, data: { text: 'hai' } }],
      [5, 'effect/start_reply', { gen: 3, turnIdx: 0, sensitive: true }],
      [5.5, 'event/first_audible', { gen: 3 }],
      [6, 'event/playback_completed', { gen: 3 }],
      [7, 'recorder/finalized', { data: { reason: 'caller_hangup' } }],
    );
    const cells = cellsOf(trail, true);
    const overtaken = cells.filter((c) => c.recogniser.includes('partial overtaken'));
    expect(overtaken).toHaveLength(1);
    expect(overtaken[0]?.recogniser.match(/partial overtaken/g)).toHaveLength(1);
  });

  it('shows an interval with nothing to say as the empty cell, never blank', () => {
    const cells = cellsOf(
      trailAt([0, 'recorder/started'], [3, 'recorder/finalized']),
    );
    expect(cells[0]?.holder).toBe('silence');
    expect(cells[0]?.callerLine).toBe(NOTHING_CELL);
    expect(cells[0]?.recogniser).toBe(NOTHING_CELL);
    expect(cells[0]?.botText).toBeNull();
  });
});

describe('parseEventRow', () => {
  const row = {
    seq: 4,
    ts: new Date(RECORDING_STARTED.getTime() + 1_000),
    kind: 'event',
    type: 'turn_end',
    gen: 2,
    turn_idx: 1,
    phase: 'listening',
    sensitive: false,
    data: { source: 'speech_final' },
  };

  it('reads a contract-shaped row into the module\'s own names', () => {
    expect(parseEventRow(row)).toEqual({
      seq: 4,
      ts: row.ts,
      kind: 'event',
      type: 'turn_end',
      gen: 2,
      turnIdx: 1,
      phase: 'listening',
      sensitive: false,
      data: { source: 'speech_final' },
    });
  });

  it('drops a row whose identity columns are not what the contract promises', () => {
    expect(parseEventRow({ ...row, seq: 0 })).toBeNull();
    expect(parseEventRow({ ...row, seq: 1.5 })).toBeNull();
    expect(parseEventRow({ ...row, ts: new Date('nope') })).toBeNull();
    expect(parseEventRow({ ...row, ts: '2026-09-08T07:12:01.100Z' })).toBeNull();
    expect(parseEventRow({ ...row, kind: null })).toBeNull();
    expect(parseEventRow(null)).toBeNull();
    expect(parseEventRow('a row')).toBeNull();
  });

  it('treats a payload of the wrong shape as absent rather than throwing on it', () => {
    expect(parseEventRow({ ...row, data: 'speech_final' })?.data).toBeNull();
    expect(parseEventRow({ ...row, data: ['speech_final'] })?.data).toBeNull();
    expect(parseEventRow({ ...row, gen: 'two', turn_idx: null, phase: 7 })).toMatchObject({
      gen: null,
      turnIdx: null,
      phase: null,
    });
  });
});

describe('intervalCells — the annotation column (PLAN row A7)', () => {
  /** The annotation of call 330052e1 the feature was built for (pipeline ADR 0027). */
  const annotation: AnnotationRow = {
    id: '1',
    call_id: '330052e1-0000-4000-8000-000000000000',
    from_ms: 29_400,
    to_ms: 39_600,
    label: 'stt_missed',
    caller_said: 'ok mình cảm ơn',
    note: null,
    supersedes: null,
    text_expired_at: null,
    created_by: 'console:tester',
    created_at: new Date('2026-09-10T02:30:00.000Z'),
  };

  it('attaches a current row to every interval it overlaps, and to no other', () => {
    const events = tail330052e1();
    const cells = intervalCells(intervalsOf(events), events, {
      outcome: 'granted',
      gate: 'on',
      assistantText: new Map(),
      annotations: [annotation],
    });
    // 29.4–39.6 s reaches back into the greeting and forward past the reprompt;
    // the rule is overlap, not containment (contract §8).
    const on = cells.map((cell) => cell.annotations.length > 0);
    for (const [i, cell] of cells.entries()) {
      const overlaps = Number(cell.from) < 39.6 && Number(cell.to) > 29.4;
      expect(on[i]).toBe(overlaps);
    }
    expect(cells[0]?.annotations).toEqual([]);
    expect(cells[1]?.holder).toBe('bot: greeting');
    expect(cells[1]?.annotations[0]).toMatchObject({
      id: '1',
      label: 'stt_missed',
      labelKnown: true,
      from: '29.40',
      to: '39.60',
      author: 'console:tester',
      text: '"ok mình cảm ơn"',
    });
    // Beside, never instead of, what the machine produced.
    const spoke = cells.filter((cell) => cell.holder === 'caller');
    expect(spoke[1]?.recogniser).toContain('segmented, returned nothing');
    expect(spoke[1]?.annotations).toHaveLength(1);
  });

  it('withholds the annotation text on an unconsented call, and nothing else', () => {
    const events = tail330052e1();
    const cells = intervalCells(intervalsOf(events), events, {
      outcome: 'hung_up_before_consent',
      gate: 'on',
      assistantText: new Map(),
      annotations: [annotation],
    });
    const item = cells[1]?.annotations[0];
    expect(item?.text).toBe('[withheld]');
    expect(item?.label).toBe('stt_missed');
    expect(item?.from).toBe('29.40');
    expect(item?.author).toBe('console:tester');
  });
});
