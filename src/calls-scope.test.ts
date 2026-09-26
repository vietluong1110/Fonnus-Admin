import { describe, expect, it } from 'vitest';
import {
  CHIPS,
  PAGE_SIZE,
  applyChips,
  chipCounts,
  chipHolds,
  chipHref,
  pageOf,
  parseChips,
  parsePage,
  parseScope,
  phonePatterns,
} from './calls-scope';
import type { CallScopeRow } from './queries/calls';

const NOW = new Date('2026-09-07T10:00:00Z');

function row(over: Partial<CallScopeRow> & { id: string }): CallScopeRow {
  return {
    started_at: new Date('2026-09-05T07:00:00Z'),
    ended_at: new Date('2026-09-05T07:03:00Z'),
    end_reason: 'caller_hangup',
    turn_count: 4,
    total_cost_vnd: '9240.0000',
    caller_phone_e164: '+84901234417',
    artifact_state: null,
    artifact_key_prefix: null,
    outcome: 'granted',
    failed_turns: [],
    ...over,
  };
}

/*
 * Six calls, one per exception plus two ordinary ones — the fixture the chip
 * counts are read off:
 *   a  ordinary, archived recording
 *   b  a failed turn, archived recording
 *   c  no consent row at all (trap 2)
 *   d  hung up before consent
 *   e  hit max_duration, and a failed turn
 *   f  ordinary, nothing in the bucket
 */
const ROWS: CallScopeRow[] = [
  row({ id: 'a', artifact_state: 'archived', artifact_key_prefix: 'calls/a' }),
  row({
    id: 'b',
    failed_turns: [{ idx: 2, failed_leg: 'llm', failed_stage: 'idle' }],
    artifact_state: 'archived',
    artifact_key_prefix: 'calls/b',
  }),
  row({ id: 'c', outcome: null, end_reason: null }),
  row({ id: 'd', outcome: 'hung_up_before_consent', turn_count: 0 }),
  row({ id: 'e', end_reason: 'max_duration', failed_turns: [
      { idx: 0, failed_leg: 'tts', failed_stage: null },
      { idx: 3, failed_leg: 'llm', failed_stage: 'total' },
    ],
  }),
  row({ id: 'f' }),
];

describe('parseScope — window or search (ADR 0006)', () => {
  it('is the window when no keyword is present', () => {
    const scope = parseScope({ since: '24h' }, NOW);
    expect(scope.kind).toBe('window');
    if (scope.kind === 'window') expect(scope.window.preset).toBe('24h');
  });

  it('reads a digit run as both a number suffix and an id prefix', () => {
    const scope = parseScope({ q: '4417' }, NOW);
    expect(scope).toEqual({
      kind: 'search',
      keyword: '4417',
      phonePatterns: ['%4417'],
      idPrefix: '4417',
    });
  });

  it('reads a number typed with its + as a prefix, and is no id then', () => {
    const scope = parseScope({ q: '+84 90' }, NOW);
    if (scope.kind !== 'search') throw new Error('expected a search');
    expect(scope.phonePatterns).toEqual(['+8490%']);
    expect(scope.idPrefix).toBeNull();
  });

  it('lower-cases a uuid prefix, and still keeps its digits as a number suffix', () => {
    // The two predicates are ORed (ADR 0006): a keyword that can be either is
    // looked for as both rather than guessed at.
    const scope = parseScope({ q: '330052E1-' }, NOW);
    if (scope.kind !== 'search') throw new Error('expected a search');
    expect(scope.idPrefix).toBe('330052e1-');
    expect(scope.phonePatterns).toEqual(['%3300521']);
  });

  it('is no id prefix when the keyword holds a letter outside hex', () => {
    const scope = parseScope({ q: '0912 xyz' }, NOW);
    if (scope.kind !== 'search') throw new Error('expected a search');
    expect(scope.idPrefix).toBeNull();
  });

  it('matches nothing under three characters, and says so by holding no predicate', () => {
    const scope = parseScope({ q: 'ab' }, NOW);
    if (scope.kind !== 'search') throw new Error('expected a search');
    expect(scope.phonePatterns).toEqual([]);
    expect(scope.idPrefix).toBeNull();
  });

  it('is the window again once the keyword is only whitespace', () => {
    expect(parseScope({ q: '   ' }, NOW).kind).toBe('window');
  });
});

describe('phonePatterns — how a typed number meets caller_phone_e164', () => {
  it('reads the masked form pasted back as its visible head and tail', () => {
    expect(phonePatterns('+84 90 ••• 4417')).toEqual(['+8490%4417']);
    expect(phonePatterns('••• 4417')).toEqual(['%4417']);
    expect(phonePatterns('090***4417')).toEqual(['+8490%4417']);
  });

  it('reads a domestic number as +84 in place of its 0, and still as a suffix', () => {
    expect(phonePatterns('0901 234 417')).toEqual(['+84901234417%', '%0901234417']);
  });

  it('never lets a typed wildcard reach the LIKE', () => {
    for (const pattern of phonePatterns('%_44\\17')) expect(pattern).toMatch(/^[+%0-9]*$/);
    expect(phonePatterns('%_44\\17')).toEqual(['%4417']);
  });

  it('holds no pattern under three digits', () => {
    expect(phonePatterns('+8')).toEqual([]);
    expect(phonePatterns('••• 41')).toEqual([]);
  });
});

describe('parseChips', () => {
  it('reads the tokens in the vocabulary’s order and drops the rest', () => {
    expect(parseChips({ f: 'has_recording,failed_turn,tenant_x' })).toEqual([
      'failed_turn',
      'has_recording',
    ]);
  });

  it('deduplicates and answers an empty list for no key at all', () => {
    expect(parseChips({ f: 'hit_cap,hit_cap' })).toEqual(['hit_cap']);
    expect(parseChips({})).toEqual([]);
  });
});

describe('chipHolds — the five predicates of docs/upstream.md §Call list', () => {
  it('reads each exception off the row it belongs to', () => {
    expect(ROWS.filter((r) => chipHolds(r, 'failed_turn')).map((r) => r.id)).toEqual(['b', 'e']);
    expect(ROWS.filter((r) => chipHolds(r, 'not_finalized')).map((r) => r.id)).toEqual(['c']);
    expect(ROWS.filter((r) => chipHolds(r, 'unconsented')).map((r) => r.id)).toEqual(['d']);
    expect(ROWS.filter((r) => chipHolds(r, 'hit_cap')).map((r) => r.id)).toEqual(['e']);
    expect(ROWS.filter((r) => chipHolds(r, 'has_recording')).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('does not read a call with no consent row as unconsented (trap 2)', () => {
    const notFinalized = row({ id: 'x', outcome: null });
    expect(chipHolds(notFinalized, 'unconsented')).toBe(false);
    expect(chipHolds(notFinalized, 'not_finalized')).toBe(true);
  });
});

describe('chipCounts and applyChips', () => {
  it('counts what adding each chip to the active set would leave', () => {
    const counts = chipCounts(ROWS, []);
    expect(counts.all).toBe(6);
    expect(counts.byChip).toEqual({
      failed_turn: 2,
      not_finalized: 1,
      unconsented: 1,
      hit_cap: 1,
      has_recording: 2,
    });
  });

  it('counts over the active combination, and the chips intersect', () => {
    const counts = chipCounts(ROWS, ['failed_turn']);
    // The scope's count never moves with the chips: the cards and the header
    // describe the population, the chips narrow the list (ADR 0006).
    expect(counts.all).toBe(6);
    // Already active: the count is what the list shows now.
    expect(counts.byChip.failed_turn).toBe(2);
    // `b` is the only failed-turn call in the bucket; `e` hit a cap.
    expect(counts.byChip.has_recording).toBe(1);
    expect(counts.byChip.hit_cap).toBe(1);
    expect(counts.byChip.not_finalized).toBe(0);

    expect(applyChips(ROWS, ['failed_turn', 'has_recording']).map((r) => r.id)).toEqual(['b']);
    expect(applyChips(ROWS, []).map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
  });

  it('gives every chip in the vocabulary a count, including a zero one', () => {
    const counts = chipCounts([], []);
    for (const chip of CHIPS) expect(counts.byChip[chip]).toBe(0);
  });
});

describe('paging', () => {
  const many = Array.from({ length: 250 }, (_, index) => index);

  it('slices a page of 100 and says whether older calls remain', () => {
    expect(PAGE_SIZE).toBe(100);
    const second = pageOf(many, 2);
    expect(second.rows).toHaveLength(100);
    expect(second.rows[0]).toBe(100);
    expect(second.hasOlder).toBe(true);

    const third = pageOf(many, 3);
    expect(third.rows).toHaveLength(50);
    expect(third.hasOlder).toBe(false);
  });

  it('answers a page past the end with nothing, not with page one', () => {
    expect(pageOf(many, 9).rows).toEqual([]);
    expect(pageOf(many, 9).hasOlder).toBe(false);
  });

  it('reads a garbage page as the first one', () => {
    expect(parsePage({ page: '3' })).toBe(3);
    for (const page of ['0', '-2', '2.5', 'many', '', undefined]) {
      expect(parsePage({ page })).toBe(1);
    }
  });
});

describe('chipHref', () => {
  it('adds a chip, keeps the scope and drops the page', () => {
    expect(chipHref('/calls', { since: '30d', page: '4' }, 'hit_cap')).toBe(
      '/calls?since=30d&f=hit_cap',
    );
  });

  it('removes a chip that is already on, and drops f when none is left', () => {
    expect(chipHref('/calls', { f: 'hit_cap' }, 'hit_cap')).toBe('/calls');
    expect(chipHref('/calls', { f: 'hit_cap,failed_turn' }, 'hit_cap')).toBe(
      '/calls?f=failed_turn',
    );
  });

  it('keeps the tokens in the vocabulary’s order however they arrived', () => {
    expect(chipHref('/calls', { f: 'has_recording' }, 'failed_turn')).toBe(
      '/calls?f=failed_turn%2Chas_recording',
    );
  });
});
