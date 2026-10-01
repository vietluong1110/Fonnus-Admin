import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOLDER_KINDS, type HolderKind, type TrailVerdict } from './intervals';
import {
  anyWithheld,
  DEAF_EXPLANATION,
  INTERVAL_CAVEATS,
  UNSUPPORTED_OPACITY,
  VERDICT_BADGE,
  annotationHistorySummary,
  gapNote,
  heardNote,
  holderTone,
  laneLegend,
  rowTint,
  rowAtPlayhead,
  segmentLabel,
  segmentStyle,
  segmentTitle,
  rowTitle,
  verdictNote,
} from './interval-lane';

/** Every holder kind, so a kind added upstream is covered by every loop below. */
const KINDS: readonly HolderKind[] = HOLDER_KINDS;

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

  it('draws a holding line in the bot voice, distinct from its reply and its wait (ADR 0030)', () => {
    const line = segmentStyle('holding', false);
    expect(line.background).toContain('var(--chart-1)');
    expect(line.background).not.toContain('repeating-linear-gradient');
    expect(line).not.toEqual(segmentStyle('reply', false));
    expect(line).not.toEqual(segmentStyle('waiting', false));
    expect(line.border).toContain('var(--chart-1)');
    // Dashed is the lower lane's "a reply never audible"; the line is audible.
    expect(line.border).not.toContain('dashed');
  });

  it('gives a failed turn\'s reply, wait and holding line the error tone, and no other kind (trap 7)', () => {
    expect(segmentStyle('reply', true).background).toBe('var(--error)');
    expect(segmentStyle('holding', true).background).toContain('var(--error)');
    expect(segmentStyle('holding', true).background).not.toContain('var(--chart-1)');
    expect(segmentStyle('waiting', true).background).toContain('repeating-linear-gradient');
    expect(segmentStyle('waiting', true).background).toContain('var(--error)');
    expect(segmentStyle('waiting', true).background).not.toContain('var(--chart-1)');
    for (const kind of KINDS.filter((each) => each !== 'reply' && each !== 'waiting' && each !== 'holding')) {
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
    expect(holderTone('holding')).toBe(holderTone('reply'));
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

describe('laneLegend — one swatch per holder kind the call has', () => {
  it('lists the kinds present, in HOLDER_KINDS order, labelled by the glossary', () => {
    const legend = laneLegend([{ kind: 'caller' }, { kind: 'reply' }, { kind: 'greeting' }, { kind: 'reply' }]);
    expect(legend.swatches.map((swatch) => swatch.kind)).toEqual(['greeting', 'reply', 'caller']);
    expect(legend.swatches.map((swatch) => swatch.term.name)).toEqual([
      'Fonnus · greeting',
      'Fonnus · reply',
      'Caller',
    ]);
    expect(legend.swatches[0]?.style).toEqual(segmentStyle('greeting', false));
    expect(legend.hatch).toBe(false);
  });

  it('lists a holding line between the wait and the reply, named by the glossary', () => {
    const legend = laneLegend([{ kind: 'reply' }, { kind: 'holding' }, { kind: 'waiting' }]);
    expect(legend.swatches.map((swatch) => swatch.term.name)).toEqual([
      'Fonnus · preparing reply',
      'Fonnus · holding line',
      'Fonnus · reply',
    ]);
    expect(legend.swatches[1]?.style).toEqual(segmentStyle('holding', false));
    // The line is audible: it wears no hatch of its own.
    expect(laneLegend([{ kind: 'holding' }]).hatch).toBe(false);
  });

  it('keys the hatch only when a waiting or deaf segment wears it', () => {
    expect(laneLegend([{ kind: 'waiting' }]).hatch).toBe(true);
    expect(laneLegend([{ kind: 'deaf' }]).hatch).toBe(true);
    expect(laneLegend([{ kind: 'silence' }]).hatch).toBe(false);
  });

  it('has no swatch at all for a lane with no intervals', () => {
    expect(laneLegend([])).toEqual({ swatches: [], hatch: false });
  });
});

describe('rowTint — the Intervals row ground by side', () => {
  it('puts every bot kind on the card ground, the caller on a wash, silence and deaf neutral', () => {
    for (const kind of ['greeting', 'canned', 'waiting', 'holding', 'reply'] as const) {
      expect(rowTint(kind)).toBe('var(--surface-card)');
    }
    expect(rowTint('caller')).toContain('var(--chart-2)');
    expect(rowTint('silence')).toBe('var(--surface-page)');
    expect(rowTint('deaf')).toBe('var(--surface-page)');
    // Alias tokens only (ADR 0003).
    for (const kind of KINDS) expect(rowTint(kind)).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe('heardNote — the sound-instant fact as a note under "What was heard"', () => {
  const line = 'sound at 1.20';
  const base = { energyMs: [1_200], unheard: false, finals: [] as unknown[], overtaken: [] as unknown[] };

  it('notes sound the recogniser recognised nothing in', () => {
    expect(heardNote(base, line)).toBe(line);
  });

  it('notes sound that fell while the feed was muted, even beside a recognised text', () => {
    const muted = 'sound at 1.20 (unheard — feed muted)';
    expect(heardNote({ ...base, unheard: true, finals: [{}] }, muted)).toBe(muted);
  });

  it('says nothing when the sound is behind a recognised text, or there was no sound', () => {
    expect(heardNote({ ...base, finals: [{}] }, line)).toBeNull();
    expect(heardNote({ ...base, overtaken: [{}] }, line)).toBeNull();
    expect(heardNote({ ...base, energyMs: [] }, '—')).toBeNull();
  });
});

describe('the chart library is gone (ADR 0014)', () => {
  /*
   * Every chart of the console is CSS boxes over offsets the server already
   * computed (the capsule tracks of ADR 0014 decision 7); recharts left
   * package.json with the waterfall, and an import of it would be a second
   * layout pass that can disagree with the axis about where a millisecond sits.
   */
  it('no file under src/ imports recharts', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          if (/from ['"]recharts(\/[^'"]*)?['"]|import\(['"]recharts/.test(readFileSync(full, 'utf8'))) {
            offenders.push(`src/${relative(root, full).split(sep).join('/')}`);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('recharts is not a dependency', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })).not.toContain('recharts');
  });
});
