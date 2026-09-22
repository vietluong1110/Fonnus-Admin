import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HolderKind, TrailVerdict } from './intervals';
import {
  anyWithheld,
  DEAF_EXPLANATION,
  INTERVAL_CAVEATS,
  UNSUPPORTED_OPACITY,
  VERDICT_BADGE,
  annotationHistorySummary,
  gapNote,
  holderTone,
  rowAtPlayhead,
  segmentLabel,
  segmentStyle,
  segmentTitle,
  rowTitle,
  verdictNote,
} from './interval-lane';

const KINDS: HolderKind[] = [
  'greeting',
  'canned',
  'waiting',
  'reply',
  'caller',
  'silence',
  'deaf',
];

function segment(over: Partial<Parameters<typeof segmentLabel>[0]> = {}) {
  return {
    fromMs: 1_000,
    toMs: 2_500,
    kind: 'caller' as HolderKind,
    label: 'caller',
    turnIdx: null as number | null,
    unsupported: false,
    failed: false,
    ...over,
  };
}

describe('segmentStyle — the lane draws the holder (ADR 0003 point 1)', () => {
  it('paints every holder kind with alias tokens only, never a hex', () => {
    for (const kind of KINDS) {
      for (const failed of [false, true]) {
        const style = segmentStyle(kind, failed);
        expect(style.background).not.toMatch(/#[0-9a-f]{3}/i);
        expect(style.background).toMatch(/var\(--/);
        if (style.border !== null) expect(style.border).toMatch(/var\(--/);
      }
    }
  });

  it('gives the bot one voice, the caller the second, and silence the page ground', () => {
    expect(segmentStyle('greeting', false).background).toBe('var(--chart-1)');
    expect(segmentStyle('canned', false).background).toBe('var(--chart-1)');
    expect(segmentStyle('reply', false).background).toBe('var(--chart-1)');
    expect(segmentStyle('caller', false).background).toBe('var(--chart-2)');
    expect(segmentStyle('silence', false)).toEqual({
      background: 'var(--surface-page)',
      border: '1px solid var(--border-hairline)',
    });
  });

  it('hatches the two stretches nobody audible held — a wait and a deaf recogniser', () => {
    expect(segmentStyle('waiting', false).background).toContain('repeating-linear-gradient');
    expect(segmentStyle('waiting', false).background).toContain('var(--chart-1)');
    expect(segmentStyle('deaf', false).background).toContain('repeating-linear-gradient');
    expect(segmentStyle('deaf', false).background).toContain('var(--chart-3)');
  });

  it('gives a reply and its wait on a failed turn the error tone, and no other kind (trap 7)', () => {
    expect(segmentStyle('reply', true).background).toBe('var(--error)');
    expect(segmentStyle('waiting', true).background).toContain('repeating-linear-gradient');
    expect(segmentStyle('waiting', true).background).toContain('var(--error)');
    expect(segmentStyle('waiting', true).background).not.toContain('var(--chart-1)');
    for (const kind of KINDS.filter((each) => each !== 'reply' && each !== 'waiting')) {
      expect(segmentStyle(kind, true)).toEqual(segmentStyle(kind, false));
    }
  });

  it('fades an unsupported interval rather than hiding it (§8 rule 7)', () => {
    expect(UNSUPPORTED_OPACITY).toBeGreaterThan(0);
    expect(UNSUPPORTED_OPACITY).toBeLessThan(1);
  });
});

describe('segmentLabel / segmentTitle', () => {
  it('reads out the holder and the two instants in seconds', () => {
    expect(segmentLabel(segment({ kind: 'reply', label: 'bot: reply 2', turnIdx: 2 }))).toBe(
      'bot: reply 2 1.00–2.50 s',
    );
  });

  it('keeps a negative offset in the label — the trail can precede the recorder', () => {
    expect(segmentLabel(segment({ fromMs: -120, toMs: 400, label: 'silence' }))).toBe(
      'silence -0.12–0.40 s',
    );
  });

  it('says what colour cannot: the deaf explanation and the trail’s hole', () => {
    expect(segmentTitle(segment({ kind: 'deaf', label: 'deaf' }))).toContain(DEAF_EXPLANATION);
    expect(segmentTitle(segment({ unsupported: true }))).toContain(
      "after the trail's hole — unsupported",
    );
    expect(segmentTitle(segment())).toBe(segmentLabel(segment()));
  });

  it('gives a card row the same note, and no empty tooltip on a supported one', () => {
    expect(rowTitle({ unsupported: true })).toBe("after the trail's hole — unsupported");
    expect(rowTitle({ unsupported: false })).toBeUndefined();
  });
});

describe('holderTone \u2014 the holder\u2019s pill', () => {
  it('gives every kind a tone, the bot kinds one and the caller another', () => {
    for (const kind of KINDS) expect(typeof holderTone(kind)).toBe('string');
    expect(holderTone('greeting')).toBe(holderTone('reply'));
    expect(holderTone('canned')).toBe(holderTone('waiting'));
    expect(holderTone('caller')).not.toBe(holderTone('reply'));
    expect(holderTone('silence')).toBe('neutral');
    expect(holderTone('deaf')).toBe('neutral');
  });
});

describe('rowAtPlayhead — which interval the playhead is inside', () => {
  const rows = [
    { fromMs: -100, toMs: 1_000 },
    { fromMs: 1_000, toMs: 2_000 },
    { fromMs: 2_000, toMs: 3_000 },
  ];

  it('is half-open: the instant on a boundary belongs to the interval it opens', () => {
    expect(rowAtPlayhead(rows, 0)).toBe(0);
    expect(rowAtPlayhead(rows, 1_000)).toBe(1);
    expect(rowAtPlayhead(rows, 1_999)).toBe(1);
    expect(rowAtPlayhead(rows, 2_000)).toBe(2);
  });

  it('keeps the last instant of the call on the last interval', () => {
    expect(rowAtPlayhead(rows, 3_000)).toBe(2);
    expect(rowAtPlayhead(rows, 3_001)).toBe(-1);
  });

  it('highlights nothing before the first interval, and nothing at all with no rows', () => {
    expect(rowAtPlayhead(rows, -500)).toBe(-1);
    expect(rowAtPlayhead([], 0)).toBe(-1);
  });
});

describe('the card’s fixed wording', () => {
  const verdict = (over: Partial<TrailVerdict>): TrailVerdict => ({
    kind: 'complete',
    text: '',
    holeFromSeq: null,
    records: 72,
    ...over,
  });

  it('states the verdict above the table, in the pipeline’s five words', () => {
    expect(verdictNote(verdict({ kind: 'complete', records: 72 }))).toBe(
      'Trail complete — 72 records, first to recorder/finalized.',
    );
    expect(verdictNote(verdict({ kind: 'open' }))).toBe(
      'Trail open — no recorder/finalized and no ended_at: the call is running, or died before it could finalize; intervals end at the last record.',
    );
    expect(verdictNote(verdict({ kind: 'truncated' }))).toBe(
      'Trail truncated — the call ended with no recorder/finalized; nothing past the last record is supported.',
    );
  });

  it('leaves gap and absent to the pipeline’s own paragraph', () => {
    expect(verdictNote(verdict({ kind: 'gap' }))).toBeNull();
    expect(verdictNote(verdict({ kind: 'absent', records: 0 }))).toBeNull();
  });

  it('pills the three verdicts that are not the plain case, and only those', () => {
    expect(VERDICT_BADGE.open?.tone).toBe('info');
    expect(VERDICT_BADGE.truncated?.tone).toBe('warning');
    expect(VERDICT_BADGE.gap?.tone).toBe('warning');
    expect(VERDICT_BADGE.complete).toBeUndefined();
    expect(VERDICT_BADGE.absent).toBeUndefined();
  });

  it('names the seq a gap starts at, and says nothing when the hole has none', () => {
    expect(gapNote(48)).toBe(' Intervals from seq 48 on are shown muted and unsupported.');
    // The `count(*) ≠ max(seq)` gap knows writes are missing, not where: no
    // interval is marked unsupported for it, so no sentence claims one is.
    expect(gapNote(null)).toBeNull();
  });

  it('carries each caveat with the thing it qualifies (CONTEXT.md §Look and feel)', () => {
    expect(INTERVAL_CAVEATS.withheld).toContain('[withheld]');
    expect(INTERVAL_CAVEATS.withheld).toContain('[expired]');
    // Trap 2: no consent row is a state, not a refusal — the caveat claims neither.
    expect(INTERVAL_CAVEATS.withheld).not.toContain('did not reach consent');
    expect(INTERVAL_CAVEATS.withheld).toContain('not yet on record');
    expect(INTERVAL_CAVEATS.cannedSilent).toContain('L10-260917-1');
    expect(INTERVAL_CAVEATS.unheard).toContain('unheard');
    expect(INTERVAL_CAVEATS.trail).toContain('100 ms');
    // The annotation column's two facts: only current rows are shown, and a
    // call with no rows is the insert gate, not a call nothing went wrong on.
    expect(INTERVAL_CAVEATS.annotation).toContain('current rows only');
    expect(INTERVAL_CAVEATS.annotation).toContain('insert gate');
    expect(INTERVAL_CAVEATS.annotation).toContain('overlaps');
  });

  it('owes the [withheld] and [expired] key only to a card that prints one', () => {
    const row = { callerLine: 'speech', recogniser: '—', botText: null, annotations: [] };
    expect(anyWithheld([row])).toBe(false);
    expect(anyWithheld([row, { ...row, recogniser: '[withheld]' }])).toBe(true);
    expect(anyWithheld([{ ...row, annotations: [{ text: '[expired]' }] }])).toBe(true);
  });

  it('counts both the rows and the current ones in the history summary', () => {
    // The difference between the two numbers is the block's reason to exist:
    // the rows the table does not show are the corrections and retractions.
    expect(annotationHistorySummary(3, 1)).toBe('Annotation history — 3 rows, 1 current');
    expect(annotationHistorySummary(1_200, 1_000)).toContain('1 200 rows');
  });
});

describe('the chart library stays in the one chart (ADR 0001)', () => {
  /*
   * The lanes, the interval segments and the bars are CSS boxes over offsets the
   * server already computed; Recharts is an SVG chart library with its own
   * layout pass, and a second file importing it is a second way this screen can
   * disagree with the axis about where a millisecond sits.
   */
  const ALLOWED = new Set(['src/app/calls/[id]/waterfall.tsx']);

  it('imports recharts in the waterfall alone', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        const rel = `src/${relative(root, full).split(sep).join('/')}`;
        if (entry.isDirectory()) walk(full);
        else if (
          /\.tsx?$/.test(entry.name) &&
          !entry.name.endsWith('.test.ts') &&
          !ALLOWED.has(rel)
        ) {
          if (/from 'recharts'|from "recharts"/.test(readFileSync(full, 'utf8'))) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
