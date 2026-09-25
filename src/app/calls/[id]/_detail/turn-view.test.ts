import { describe, expect, it } from 'vitest';
import { LEGS, type Stage } from '@/latency';
import {
  playheadOnScale,
  selectedTurnView,
  TURN_COUNT_HINT,
  turnCostCells,
  turnCountView,
  type SelectedTurnInput,
} from './turn-view';

const ORIGIN = 1_757_000_000_000;
const STARTED_AT = new Date(ORIGIN);

/** Marks as wall-clock instants, written as offsets from the recorder's origin. */
function marksAt(offsets: Partial<Record<Stage, number>>): Partial<Record<Stage, number>> {
  return Object.fromEntries(
    Object.entries(offsets).map(([stage, ms]) => [stage, ORIGIN + ms]),
  );
}

/** FULL with one mark never stamped. */
function without(stage: Stage): Partial<Record<Stage, number>> {
  return Object.fromEntries(Object.entries(FULL).filter(([name]) => name !== stage));
}

const FULL = marksAt({
  speech_end: 10_000,
  stt_final: 10_200,
  endpoint_decision: 10_400,
  llm_first_token: 10_900,
  llm_last_token: 11_500,
  tts_first_byte: 11_100,
  tts_last_byte: 11_900,
  first_audio_out: 11_200,
  playback_start: 11_300,
  playback_end: 14_000,
});

function input(over: Partial<SelectedTurnInput> = {}): SelectedTurnInput {
  return {
    marks: FULL,
    pipeline_ms: 800,
    caller_perceived_ms: 1_200,
    interrupted: false,
    reopened: false,
    ...over,
  };
}

describe('selectedTurnView — the capsule stack of one turn', () => {
  it('lays the rows in the screen order: headlines, the six legs, the three end-of-turn spans', () => {
    const view = selectedTurnView(input(), STARTED_AT);
    expect(view?.rows.map((row) => row.key)).toEqual([
      'pipeline_ms',
      'caller_perceived_ms',
      ...LEGS.map((leg) => leg.name),
      'llm_first_token → llm_last_token',
      'tts_first_byte → tts_last_byte',
      'playback_start → playback_end',
    ]);
  });

  it('shares one scale: earliest mark to playback_end, every span measured from the earliest mark', () => {
    const view = selectedTurnView(input(), STARTED_AT);
    expect(view?.scaleMax).toBe(4_000);
    const llm = view?.rows.find((row) => row.key === 'llm_ttft');
    expect(llm?.span).toEqual({ from: 400, to: 900 });
    expect(llm?.value).toBe('500 ms');
    // The playhead's origin is the earliest mark's place on the recording.
    expect(view?.scaleStartOnRecordingMs).toBe(10_000);
  });

  it('ends the scale at the latest mark when playback_end was never stamped', () => {
    const rest = without('playback_end');
    expect(selectedTurnView(input({ marks: rest }), STARTED_AT)?.scaleMax).toBe(1_900);
  });

  it('takes the headline number from the stored column and the target from the span start', () => {
    const view = selectedTurnView(input(), STARTED_AT);
    const pipeline = view?.rows[0];
    expect(pipeline?.value).toBe('800 ms');
    // endpoint_decision sits 400 ms in; the 1 200 ms target falls at 1 600.
    expect(pipeline?.target).toBe(1_600);
    expect(pipeline?.term.name).toBe('Pipeline latency');
    // The perceived alarm (3 600 ms from speech_end) is inside a 4 000 ms scale.
    expect(view?.rows[1]?.target).toBe(3_600);
  });

  it('drops a target that falls past the scale rather than pinning it to the edge', () => {
    const rest = without('playback_end');
    const view = selectedTurnView(input({ marks: rest }), STARTED_AT);
    expect(view?.rows[1]?.target).toBeUndefined();
  });

  it('marks a headline over its target in the error tone', () => {
    const view = selectedTurnView(input({ pipeline_ms: 1_500 }), STARTED_AT);
    expect(view?.rows[0]?.tone).toBe('var(--error)');
  });

  it('tones a headline taken from the marks by the number it shows', () => {
    // Stored column null: endpoint_decision 10 400 → first_audio_out 11 800
    // gives 1 400 ms from the marks, over the 1 200 ms target.
    const late = marksAt({ ...Object.fromEntries(Object.entries(FULL).map(([k, v]) => [k, v - ORIGIN])), first_audio_out: 11_800 });
    const over = selectedTurnView(input({ pipeline_ms: null, marks: late }), STARTED_AT);
    expect(over?.rows[0]?.value).toBe('1 400 ms');
    expect(over?.rows[0]?.tone).toBe('var(--error)');
  });

  it('renders a missing mark as "—" and names the absent mark in the tooltip', () => {
    const rest = without('first_audio_out');
    const view = selectedTurnView(input({ marks: rest, pipeline_ms: null }), STARTED_AT);
    const send = view?.rows.find((row) => row.key === 'send');
    expect(send?.value).toBe('—');
    expect(send?.span).toBeNull();
    expect(send?.term.description).toContain('no first_audio_out mark');
    expect(view?.rows[0]?.value).toBe('—');
    expect(view?.rows[0]?.term.description).toContain('no first_audio_out mark');
  });

  it('says "not measured" for a reversed pair and a negative stored headline', () => {
    const view = selectedTurnView(
      input({ marks: { ...FULL, stt_final: (FULL.speech_end ?? 0) - 50 }, pipeline_ms: -20 }),
      STARTED_AT,
    );
    expect(view?.rows.find((row) => row.key === 'stt_emit')?.value).toBe('not measured');
    expect(view?.rows[0]?.value).toBe('not measured');
  });

  it('draws no bar beside a negative stored headline, even with valid marks', () => {
    const view = selectedTurnView(input({ pipeline_ms: -20 }), STARTED_AT);
    expect(view?.rows[0]?.value).toBe('not measured');
    expect(view?.rows[0]?.span).toBeNull();
    expect(view?.rows[0]?.term.description).toContain('negative');
  });

  it('takes the number from the marks when the stored column is null, and says so', () => {
    const view = selectedTurnView(input({ pipeline_ms: null }), STARTED_AT);
    // endpoint_decision 10 400 → first_audio_out 11 200.
    expect(view?.rows[0]?.value).toBe('800 ms');
    expect(view?.rows[0]?.span).toEqual({ from: 400, to: 1_200 });
    expect(view?.rows[0]?.term.description).toContain('from marks; stored column null');
    // A stored value never carries the note.
    expect(selectedTurnView(input(), STARTED_AT)?.rows[0]?.term.description).not.toContain(
      'from marks',
    );
  });

  it('outlines the two legs outside the partition', () => {
    const view = selectedTurnView(input(), STARTED_AT);
    const outlined = view?.rows.filter((row) => row.outlined).map((row) => row.key);
    expect(outlined).toEqual(['stt_emit', 'playback']);
  });

  it('adds model reasoning after the legs only when both of its marks are stamped', () => {
    const withReasoning = selectedTurnView(
      input({ marks: { ...FULL, llm_first_reasoning: ORIGIN + 10_500 } }),
      STARTED_AT,
    );
    const keys = withReasoning?.rows.map((row) => row.key) ?? [];
    expect(keys[8]).toBe('llm_first_reasoning → llm_first_token');
    expect(withReasoning?.rows[8]?.term.name).toBe('Model reasoning');
    expect(selectedTurnView(input(), STARTED_AT)?.rows.some((row) => row.key.startsWith('llm_first_reasoning'))).toBe(false);
  });

  it('carries the interrupted and reopen readings on the end-of-turn rows', () => {
    const view = selectedTurnView(input({ interrupted: true, reopened: true }), STARTED_AT);
    const playback = view?.rows.find((row) => row.key === 'playback_start → playback_end');
    expect(playback?.term.description).toContain('last lull before the barge-in');
    expect(playback?.term.description).toContain('last generation');
  });

  it('has no stack for a turn with no readable mark', () => {
    expect(selectedTurnView(input({ marks: {} }), STARTED_AT)).toBeNull();
  });

  it('has no playhead origin when the call has no recorder clock', () => {
    expect(selectedTurnView(input(), null)?.scaleStartOnRecordingMs).toBeNull();
  });
});

describe('playheadOnScale', () => {
  const view = selectedTurnView(input(), STARTED_AT);
  if (view === null) throw new Error('fixture has marks');

  it('places the recording playhead on the turn scale', () => {
    expect(playheadOnScale(view, 11_000)).toBe(1_000);
  });

  it('draws nothing when the audio is off the turn', () => {
    expect(playheadOnScale(view, 9_000)).toBeUndefined();
    expect(playheadOnScale(view, 14_500)).toBeUndefined();
    expect(playheadOnScale({ ...view, scaleStartOnRecordingMs: null }, 11_000)).toBeUndefined();
  });
});

describe('turnCostCells — the turn table and the selected-turn footer (ADR 0015)', () => {
  const PRICED = {
    llm_model: 'qwen/qwen3.5-397b-a17b',
    tokens_in: 1000,
    tokens_out: 300,
    tokens_cached: 200,
    tts_chars: 120,
  };

  it('prices both legs of a priced turn; STT has no per-turn figure', () => {
    expect(turnCostCells(PRICED, 'sonic-3.6')).toEqual({ stt: '—', llm: '29 ₫', tts: '159 ₫' });
  });

  it('names only its own unpriced model in each cell', () => {
    const cells = turnCostCells({ ...PRICED, llm_model: 'openai/gpt-oss-120b' }, 'sonic-9');
    expect(cells.llm).toBe('unpriced (openai/gpt-oss-120b)');
    expect(cells.tts).toBe('unpriced (sonic-9)');
    expect(turnCostCells({ ...PRICED, llm_model: 'openai/gpt-oss-120b' }, 'sonic-3.6').tts).toBe('159 ₫');
  });

  it('says "not reported" when the accounting is null', () => {
    const cells = turnCostCells({ ...PRICED, tokens_in: null, tts_chars: null }, 'sonic-3.6');
    expect(cells).toEqual({ stt: '—', llm: 'not reported', tts: 'not reported' });
  });
});

describe('turnCountView — "Number of turns" beside the rows on record (trap 1)', () => {
  it('names the call\'s own state when turn_count reads 0 beside real turn rows', () => {
    expect(turnCountView(0, 3, 'not_finalized')).toEqual({ note: 'not finalized' });
    // A call still running has rows and no count yet: the head says "in progress", so does the note.
    expect(turnCountView(0, 3, 'in_progress')).toEqual({ note: 'in progress' });
  });

  it('says nothing when the count is written, or when there are no rows at all', () => {
    expect(turnCountView(3, 3, 'finalized')).toEqual({ note: null });
    expect(turnCountView(0, 0, 'in_progress')).toEqual({ note: null });
  });

  it('names both branches of trap 1 and points at the rows', () => {
    expect(TURN_COUNT_HINT).toContain('0 while the call is not finalized');
    expect(TURN_COUNT_HINT).toContain('none on an unconsented call');
    expect(TURN_COUNT_HINT).toContain('Turns on record');
  });
});
