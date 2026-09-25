import { describe, expect, it } from 'vitest';
import { STORED_COST_TIP } from '@/cost';
import { percentiles } from '@/dashboard';
import type { DashboardTurn } from '@/queries/dashboard';
import { OVERVIEW_GROUPINGS } from '@/ui/glossary';
import {
  costTip,
  endToEnd,
  groupHref,
  groupingHeader,
  groupOptions,
  legP95Tip,
  legTurnsCaveat,
  newestFirst,
  smallSampleNote,
  SPAN,
} from './overview';

describe('groupHref', () => {
  it('sets group and keeps the window and the other keys', () => {
    expect(
      groupHref('http://localhost:3000/?since=30d&group=stt_model&outside=all', 'voice'),
    ).toBe('/?since=30d&group=voice&outside=all');
  });

  it('adds group to an address that has none', () => {
    expect(groupHref('http://localhost:3000/?since=7d', 'tts_model')).toBe(
      '/?since=7d&group=tts_model',
    );
    expect(groupHref('http://localhost:3000/', 'tts_model')).toBe('/?group=tts_model');
  });

  it('encodes a key grouping and drops the fragment', () => {
    expect(groupHref('http://localhost:3000/?since=7d#x', 'key:runtime.version')).toBe(
      '/?since=7d&group=key%3Aruntime.version',
    );
  });
});

describe('groupOptions', () => {
  it('offers the eight glossary groupings, by name, in order', () => {
    const options = groupOptions('stt_model');
    expect(options.map((option) => option.value)).toEqual(
      OVERVIEW_GROUPINGS.map((grouping) => grouping.value),
    );
    expect(options.map((option) => option.label)).toEqual(
      OVERVIEW_GROUPINGS.map((grouping) => grouping.term.name),
    );
  });

  it('adds a URL-only grouping last, so the control shows what is rendered', () => {
    expect(groupOptions('key:DEEPGRAM_MODEL').at(-1)).toEqual({
      value: 'key:DEEPGRAM_MODEL',
      label: 'config_snapshot → DEEPGRAM_MODEL',
    });
    expect(groupOptions('config').at(-1)?.label).toBe('config_snapshot (the whole object)');
    expect(groupOptions('none').at(-1)?.label).toBe('no grouping');
    expect(groupOptions('llm_model').at(-1)).toEqual({ value: 'llm_model', label: 'llm_model' });
    expect(groupOptions('none')).toHaveLength(OVERVIEW_GROUPINGS.length + 1);
  });
});

describe('groupingHeader', () => {
  it("is the chosen grouping's glossary name", () => {
    for (const { value, term } of OVERVIEW_GROUPINGS) {
      expect(groupingHeader(value)).toBe(term.name);
    }
  });

  it('falls back to "Value" for a URL-only key, and names the whole snapshot', () => {
    expect(groupingHeader('key:DEEPGRAM_MODEL')).toBe('Value');
    expect(groupingHeader('llm_model')).toBe('Value');
    expect(groupingHeader('config')).toBe('Configuration');
  });
});

describe('legTurnsCaveat', () => {
  it('says one count when every sampled leg stands on the same turns', () => {
    expect(legTurnsCaveat([1234, 1234, 0, 1234])).toBe('over 1 234 turns with both marks');
  });

  it('says the range when the legs differ, ignoring legs with no sample', () => {
    expect(legTurnsCaveat([40, 52, 0, 51])).toBe('over 40–52 turns with both marks, by leg');
  });

  it('is null when no leg has a sample', () => {
    expect(legTurnsCaveat([0, 0])).toBeNull();
    expect(legTurnsCaveat([])).toBeNull();
  });
});

describe('costTip', () => {
  it('ends "every model in the window is priced" when no model is unpriced', () => {
    expect(costTip([])).toBe(`${STORED_COST_TIP}; every model in the window is priced`);
  });

  it("ends on ADR 0015 D7's sentence naming the unpriced models", () => {
    expect(costTip(['openai/gpt-oss-120b', 'sonic-9'])).toBe(
      `${STORED_COST_TIP}; a floor while these models are unpriced: openai/gpt-oss-120b, sonic-9`,
    );
  });
});

describe('legP95Tip and smallSampleNote — each leg row names its own sample', () => {
  it("names the leg's turns with both marks in the P95 tooltip", () => {
    expect(legP95Tip(6)).toBe('P95 over 6 turns with both marks');
    expect(legP95Tip(40)).toBe('P95 over 40 turns with both marks');
    expect(legP95Tip(1)).toBe('P95 over 1 turn with both marks');
  });

  it('says "max of N" under 20 turns and nothing from 20 on, or on an empty sample', () => {
    expect(smallSampleNote(6)).toBe('max of 6');
    expect(smallSampleNote(19)).toBe('max of 19');
    expect(smallSampleNote(20)).toBeNull();
    expect(smallSampleNote(40)).toBeNull();
    expect(smallSampleNote(0)).toBeNull();
  });

  it("agrees with the pipeline's nearest-rank rule: the P95 is the max exactly below 20", () => {
    for (let n = 1; n <= 40; n += 1) {
      const sample = Array.from({ length: n }, (_, i) => i + 1);
      const { p95, max } = percentiles(sample);
      expect(smallSampleNote(n) !== null).toBe(p95 === max);
    }
  });
});

describe('newestFirst', () => {
  const turn = (call_id: string, idx: number): DashboardTurn => ({
    call_id,
    idx,
    marks: null,
    caller_perceived_ms: null,
    pipeline_ms: null,
    llm_model: null,
    interrupted: false,
    source: null,
    failed_leg: null,
    failed_stage: null,
    failed_after_ms: null,
  });

  it("orders by the call's start, newest first, then the later turn first", () => {
    const calls = new Map([
      ['a', { started_at: new Date('2026-09-01T10:00:00Z') }],
      ['b', { started_at: new Date('2026-09-02T10:00:00Z') }],
    ]);
    const ordered = newestFirst([turn('a', 1), turn('a', 3), turn('b', 2), turn('x', 9)], calls);
    expect(ordered.map((t) => `${t.call_id}${String(t.idx)}`)).toEqual(['b2', 'a3', 'a1', 'x9']);
  });

  it('sorts turns whose call is absent from callsById last, the later turn first', () => {
    const calls = new Map([['a', { started_at: new Date('2026-09-01T10:00:00Z') }]]);
    const ordered = newestFirst(
      [turn('x', 1), turn('a', 2), turn('y', 4), turn('x', 3), turn('a', 5)],
      calls,
    );
    expect(ordered.map((t) => `${t.call_id}${String(t.idx)}`)).toEqual([
      'a5',
      'a2',
      'y4',
      'x3',
      'x1',
    ]);
  });
});

describe('SPAN', () => {
  it('reads the three spans from the glossary', () => {
    expect([SPAN.pipeline.code, SPAN.perceived.code, SPAN.failedAfter.code]).toEqual([
      'pipeline_ms',
      'caller_perceived_ms',
      'failed_after_ms',
    ]);
  });
});

describe('endToEnd', () => {
  it('starts each span where the last one ended, keeping its fields', () => {
    expect(
      endToEnd([
        { length: 3, tone: 'a' },
        { length: 0, tone: 'b' },
        { length: 2, tone: 'c' },
      ]),
    ).toEqual([
      { length: 3, tone: 'a', from: 0, to: 3 },
      { length: 0, tone: 'b', from: 3, to: 3 },
      { length: 2, tone: 'c', from: 3, to: 5 },
    ]);
    expect(endToEnd([])).toEqual([]);
  });
});
