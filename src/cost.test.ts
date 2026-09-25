import { describe, expect, it } from 'vitest';
import {
  callCostView,
  costCell,
  floorMark,
  floorSentence,
  formatVnd,
  turnCost,
  unpricedInWindow,
  VND_PER_USD,
  type TurnCostInput,
} from './cost';

const QWEN = 'qwen/qwen3.5-397b-a17b';

/**
 * Hand-computed from the copied table (ADR 0015): 800 fresh × 0.39/1e6 +
 * 200 cached × 0.39/1e6 + 300 out × 2.34/1e6 = 0.001092 USD → 28.938 VND at
 * 26 500; TTS 120 / 1 000 × 0.05 = 0.006 USD → 159 VND.
 */
const PRICED_TURN: TurnCostInput = {
  llm_model: QWEN,
  tokens_in: 1000,
  tokens_out: 300,
  tokens_cached: 200,
  tts_chars: 120,
};

const NULL_ACCOUNTING: TurnCostInput = {
  llm_model: null,
  tokens_in: null,
  tokens_out: null,
  tokens_cached: null,
  tts_chars: null,
};

describe('turnCost', () => {
  it('reproduces the pipeline arithmetic on a hand-computed turn', () => {
    expect(VND_PER_USD).toBe(26_500);
    const cost = turnCost(PRICED_TURN, 'sonic-3.6');
    expect(cost.llmVnd).toBeCloseTo(28.938, 9);
    expect(cost.ttsVnd).toBeCloseTo(159, 9);
    expect(cost.unpriced).toEqual([]);
  });

  it('prices an unknown LLM model as null and names it', () => {
    const cost = turnCost({ ...PRICED_TURN, llm_model: 'openai/gpt-oss-120b' }, 'sonic-3.6');
    expect(cost.llmVnd).toBeNull();
    expect(cost.ttsVnd).toBeCloseTo(159, 9);
    expect(cost.unpriced).toEqual(['openai/gpt-oss-120b']);
  });

  it('names an unknown TTS model when the turn has characters', () => {
    expect(turnCost(PRICED_TURN, 'sonic-9').unpriced).toEqual(['sonic-9']);
  });

  it('returns null without listing anything when the accounting is null', () => {
    expect(turnCost(NULL_ACCOUNTING, 'sonic-3.6')).toEqual({ llmVnd: null, ttsVnd: null, unpriced: [] });
    // One null counter is enough: the row carries no accounting (contract §3).
    expect(turnCost({ ...PRICED_TURN, tokens_out: null }, 'sonic-3.6').llmVnd).toBeNull();
  });

  it('prices a null tokens_cached as 0 cached tokens, as the pipeline does', () => {
    // openrouter-llm.ts starts tokensCached at 0 and keeps it when the
    // provider reports none; call-sink.ts prices the call from that 0.
    const unreported = turnCost({ ...PRICED_TURN, tokens_cached: null }, 'sonic-3.6');
    const zero = turnCost({ ...PRICED_TURN, tokens_cached: 0 }, 'sonic-3.6');
    expect(unreported.llmVnd).not.toBeNull();
    expect(unreported.llmVnd).toBe(zero.llmVnd);
  });
});

describe('callCostView', () => {
  const started = new Date('2026-09-05T07:00:00Z');
  const call = {
    total_cost_vnd: '120.5000',
    started_at: started,
    ended_at: new Date('2026-09-05T07:02:00Z'),
    stt_model: 'nova-3',
    tts_model: 'sonic-3.6',
  };

  it('takes the total from total_cost_vnd and divides it over the call minutes', () => {
    const view = callCostView(call, [PRICED_TURN], QWEN);
    expect(view.totalVnd).toBe(120.5);
    expect(view.perMinuteVnd).toBeCloseTo(60.25, 9);
  });

  it('never recomputes the total from the turns', () => {
    expect(callCostView(call, [PRICED_TURN, PRICED_TURN], QWEN).totalVnd).toBe(120.5);
  });

  it('has no per-minute figure while the call is in progress or unpriced', () => {
    expect(callCostView({ ...call, ended_at: null }, [], QWEN).perMinuteVnd).toBeNull();
    expect(callCostView({ ...call, total_cost_vnd: null }, [], QWEN).perMinuteVnd).toBeNull();
    expect(callCostView({ ...call, total_cost_vnd: 'abc' }, [], QWEN).totalVnd).toBeNull();
  });

  it('names the call and turn models without a price row, sorted', () => {
    const view = callCostView({ ...call, stt_model: 'mystery-stt' }, [
      { ...PRICED_TURN, llm_model: 'openai/gpt-oss-120b' },
      { ...PRICED_TURN, llm_model: 'openai/gpt-oss-120b' },
      NULL_ACCOUNTING,
    ], QWEN);
    expect(view.unpriced).toEqual(['mystery-stt', 'openai/gpt-oss-120b']);
  });

  it('names an unpriced configured OPENROUTER_MODEL on a call with no turn rows (trap 1)', () => {
    const view = callCostView(call, [], 'openai/gpt-oss-120b');
    expect(view.unpriced).toEqual(['openai/gpt-oss-120b']);
    expect(floorMark(view.unpriced)).toBe('floor');
    expect(floorSentence(view.unpriced)).toBe('a floor while these models are unpriced: openai/gpt-oss-120b');
  });

  it('is no floor on a call with no turn rows when the configured model is priced or absent', () => {
    expect(floorMark(callCostView(call, [], QWEN).unpriced)).toBeNull();
    expect(floorMark(callCostView(call, [], null).unpriced)).toBeNull();
  });

  it('returns the stored total and its caveat inputs only, no per-turn sums', () => {
    expect(Object.keys(callCostView(call, [PRICED_TURN], QWEN)).sort()).toEqual([
      'perMinuteVnd',
      'totalVnd',
      'unpriced',
    ]);
  });
});

describe('unpricedInWindow', () => {
  it('collects the distinct unpriced models of calls and turns', () => {
    expect(
      unpricedInWindow(
        [
          { stt_model: 'nova-3', tts_model: 'sonic-3.6', configured_llm: QWEN },
          { stt_model: null, tts_model: 'mystery-tts', configured_llm: null },
        ],
        [{ llm_model: QWEN }, { llm_model: 'openai/gpt-oss-120b' }, { llm_model: null }],
      ),
    ).toEqual(['mystery-tts', 'openai/gpt-oss-120b']);
  });

  it('names the unpriced configured OPENROUTER_MODEL of a call with no turn rows', () => {
    expect(
      unpricedInWindow([{ stt_model: 'nova-3', tts_model: 'sonic-3.6', configured_llm: 'openai/gpt-oss-120b' }], []),
    ).toEqual(['openai/gpt-oss-120b']);
  });

  it('reads an Object.prototype key as no row, not as a price', () => {
    expect(unpricedInWindow([], [{ llm_model: 'constructor' }])).toEqual(['constructor']);
  });
});

describe('formatVnd and costCell', () => {
  it('rounds to whole đồng and groups by spaces', () => {
    expect(formatVnd(1234567.6)).toBe('1 234 568 ₫');
    expect(formatVnd(null)).toBe('—');
  });

  it('says why a cell has no figure', () => {
    expect(costCell(28.938, [])).toBe('29 ₫');
    expect(costCell(null, ['openai/gpt-oss-120b'])).toBe('unpriced (openai/gpt-oss-120b)');
    expect(costCell(null, [])).toBe('not reported');
  });
});

describe('floorSentence and floorMark — a stored total beside an unpriced model (ADR 0015 D7)', () => {
  it("is D7's sentence and the word \"floor\" while a model is unpriced", () => {
    expect(floorSentence(['openai/gpt-oss-120b'])).toBe(
      'a floor while these models are unpriced: openai/gpt-oss-120b',
    );
    expect(floorMark(['openai/gpt-oss-120b'])).toBe('floor');
  });

  it('is nothing when every model is priced', () => {
    expect(floorSentence([])).toBeNull();
    expect(floorMark([])).toBeNull();
  });
});
