import { describe, expect, it } from 'vitest';

import type { AnnotationRow } from '@/queries/calls';
import {
  RETRACTION_LABEL,
  annotationCellItems,
  annotationHistory,
  annotationStanding,
  annotationsOn,
  currentAnnotations,
} from './annotations';

/*
 * The pipeline's own cases for the same rules, ported from
 * `../Fonnus/test/tools/call-evidence.test.ts` (the "annotations on the call's
 * own axis" describe block, :1099-1200) so that a §3 or §8 rule which drifts
 * from the pipeline's fails here rather than on screen (ADR 0010). The
 * reference asserts on the strings `intervals.txt` and `annotations.txt`
 * print; here the same strings come out of `annotationCellItems` and
 * `annotationHistory`, with the two deliberate differences of
 * `src/annotations.ts`: `bigint` ids are strings, and an interval cell wears
 * the bare `[expired]` marker while the history carries the instant.
 *
 * The overlap rule on a real trail — the annotation on every interval of call
 * 330052e1 it reaches — is pinned in `src/intervals.test.ts`, where that
 * trail's fixture lives.
 */

const UUID = '330052e1-0000-4000-8000-000000000000';

/** When a tester sat down with the recording — days after the call, at most. */
const ANNOTATED = new Date('2026-09-10T02:30:00.000Z');

/**
 * The annotation of call 330052e1 the feature was built for (pipeline ADR
 * 0027, `call-evidence.test.ts:141-156`): the caller spoke between 29.4 and
 * 39.6 s and the recogniser returned nothing, and a human who heard the
 * recording wrote down the words.
 */
function annotationRow(over: Partial<AnnotationRow> = {}): AnnotationRow {
  return {
    id: '1',
    call_id: UUID,
    from_ms: 29_400,
    to_ms: 39_600,
    label: 'stt_missed',
    caller_said: 'ok mình cảm ơn',
    note: null,
    supersedes: null,
    text_expired_at: null,
    created_by: 'console:tester',
    created_at: ANNOTATED,
    ...over,
  };
}

/** The interval the annotation sits squarely inside, in milliseconds. */
const SPAN = { fromMs: 29_000, toMs: 40_000 };

/** The cells of one interval on a consented call, with the gate on. */
function cellsOn(
  rows: AnnotationRow[],
  interval: { fromMs: number; toMs: number } = SPAN,
  showCaller = true,
) {
  return annotationCellItems(currentAnnotations(rows), interval, { showCaller });
}

function historyOf(rows: AnnotationRow[], outcome: string | null = 'granted') {
  return annotationHistory(rows, { outcome, gate: 'on' });
}

describe('annotationsOn — the overlap rule (contract §8)', () => {
  const row = annotationRow();

  it('shows the row on every interval it overlaps, and on no other', () => {
    // Overlap, not containment: the row reaches back into the interval before
    // it and forward into the one after it.
    expect(annotationsOn({ fromMs: 0, toMs: 29_920 }, [row])).toHaveLength(1);
    expect(annotationsOn({ fromMs: 29_920, toMs: 33_330 }, [row])).toHaveLength(1);
    expect(annotationsOn({ fromMs: 38_020, toMs: 42_890 }, [row])).toHaveLength(1);
    // The caller's stretch after the reprompt starts at 42.89, past 39.6.
    expect(annotationsOn({ fromMs: 42_890, toMs: 46_130 }, [row])).toEqual([]);
    // A half-open edge on either side touches nothing: `[from, to)`.
    expect(annotationsOn({ fromMs: 39_600, toMs: 41_000 }, [row])).toEqual([]);
    expect(annotationsOn({ fromMs: 20_000, toMs: 29_400 }, [row])).toEqual([]);
  });
});

describe('currentAnnotations and annotationStanding — the chain (contract §3)', () => {
  it('shows the correcting row in the cells and keeps the corrected one in the history', () => {
    const rows = [
      annotationRow(),
      annotationRow({
        id: '2',
        supersedes: '1',
        caller_said: 'ok mình cảm ơn nha',
        created_by: 'console:lan',
      }),
    ];
    expect(currentAnnotations(rows).map((a) => a.id)).toEqual(['2']);

    const cells = cellsOn(rows);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ id: '2', text: '"ok mình cảm ơn nha"', author: 'console:lan' });

    const history = historyOf(rows);
    expect(history[0]).toMatchObject({ id: '1', standing: 'superseded by #2', author: 'console:tester' });
    expect(history[0]?.callerSaid).toBe('ok mình cảm ơn');
    expect(history[1]).toMatchObject({ id: '2', standing: 'current', author: 'console:lan' });
  });

  it('drops a retracted annotation from the cells and names the retraction in the history', () => {
    const rows = [
      annotationRow(),
      annotationRow({ id: '2', label: null, caller_said: null, note: null, supersedes: '1' }),
    ];
    expect(currentAnnotations(rows)).toEqual([]);
    expect(annotationStanding(rows[1] as AnnotationRow, rows)).toBe('retraction of #1');
    expect(cellsOn(rows)).toEqual([]);

    const history = historyOf(rows);
    expect(history[0]?.standing).toBe('retracted by #2');
    // A labelless row prints the word, never a dash: it withdrew a fact.
    expect(history[1]?.label).toBeNull();
    expect(history[1]?.standing).toBe('retraction of #1');
    expect(RETRACTION_LABEL).toBe('(retraction)');
  });

  it('keeps one current row at the head of a chain, and un-retracts on a labelled successor', () => {
    const corrected = [
      annotationRow(),
      annotationRow({ id: '2', supersedes: '1', caller_said: 'ok mình cảm ơn nha' }),
      annotationRow({ id: '3', supersedes: '2', caller_said: 'ok mình cảm ơn nhé' }),
    ];
    expect(currentAnnotations(corrected).map((a) => a.id)).toEqual(['3']);
    expect(cellsOn(corrected).map((c) => c.id)).toEqual(['3']);

    // A retraction a later labelled row supersedes was un-retracted (§3).
    const unretracted = [
      annotationRow(),
      annotationRow({ id: '2', label: null, caller_said: null, note: null, supersedes: '1' }),
      annotationRow({ id: '3', supersedes: '2' }),
    ];
    expect(currentAnnotations(unretracted).map((a) => a.id)).toEqual(['3']);
    expect(historyOf(unretracted)[1]?.standing).toBe('superseded by #3');
  });

  it('names the shape the database CHECK refuses rather than guessing at it', () => {
    const orphan = annotationRow({ label: null, caller_said: null, note: null, supersedes: null });
    expect(annotationStanding(orphan, [orphan])).toContain('refuses');
  });
});

describe('the annotation texts under consent and the retention sweep', () => {
  it('withholds both texts on a call whose consent is not granted, and nothing else', () => {
    // The insert gate should leave no such row in the database (pipeline ADR
    // 0027), so this is trap 4 as defence in depth — the same rule
    // `turn.caller_text` gets.
    const rows = [annotationRow({ note: 'nghe rõ tiếng trẻ con' })];
    const cell = cellsOn(rows, SPAN, false)[0];
    expect(cell?.text).toBe('[withheld]');
    // The label, the interval and the author are not caller content.
    expect(cell).toMatchObject({ label: 'stt_missed', from: '29.40', to: '39.60', author: 'console:tester' });

    const history = historyOf(rows, 'hung_up_before_consent')[0];
    expect(history?.callerSaid).toBe('[withheld]');
    expect(history?.note).toBe('[withheld]');
    expect(history).toMatchObject({ label: 'stt_missed', from: '29.40', author: 'console:tester' });
  });

  it('shows the texts as written on that same call while CONSENT_GATE is off', () => {
    // The internal test phase (ADR 0005): the annotation's texts are shown
    // beside the caller text the same card already shows.
    const rows = [annotationRow({ note: 'nghe rõ tiếng trẻ con' })];
    const cells = annotationCellItems(currentAnnotations(rows), SPAN, { showCaller: true });
    expect(cells[0]?.text).toBe('"ok mình cảm ơn" — note: nghe rõ tiếng trẻ con');

    const history = annotationHistory(rows, { outcome: 'hung_up_before_consent', gate: 'off' })[0];
    expect(history?.callerSaid).toBe('ok mình cảm ơn');
    expect(history?.note).toBe('nghe rõ tiếng trẻ con');
  });

  it('says a text the retention sweep took is expired, not missing', () => {
    // What the sweep leaves behind: both texts null, the mark set (trap 13).
    const swept = new Date('2026-10-08T07:12:00.000Z');
    const rows = [annotationRow({ caller_said: null, note: null, text_expired_at: swept })];

    const cell = cellsOn(rows)[0];
    expect(cell?.text).toBe('[expired]');
    // The label and the interval outlive the words: the row still says the
    // recogniser missed something here.
    expect(cell?.label).toBe('stt_missed');

    const history = historyOf(rows)[0];
    const expired = `[expired ${swept.toISOString()}]`;
    expect(history?.callerSaid).toBe(expired);
    expect(history?.note).toBe(expired);
  });

  it('reads a text that was never written as a dash, and a note-only row as its note', () => {
    const never = [annotationRow({ label: 'bot_silent', caller_said: null, note: null })];
    expect(cellsOn(never)[0]?.text).toBe('—');
    expect(historyOf(never)[0]?.callerSaid).toBe('—');

    const noteOnly = [annotationRow({ label: 'other', caller_said: null, note: 'máy đọc số sai' })];
    expect(cellsOn(noteOnly)[0]?.text).toBe('note: máy đọc số sai');
    expect(historyOf(noteOnly)[0]?.note).toBe('máy đọc số sai');
  });

  it('shows both texts in the cell when a row carries both — the console departs from the reference here', () => {
    // `annotationCellText` in the pipeline prints the words alone; its note is
    // one `annotations.txt` away, while this card folds the history closed.
    const both = [annotationRow({ note: 'nói nhỏ, nền ồn' })];
    expect(cellsOn(both)[0]?.text).toBe('"ok mình cảm ơn" — note: nói nhỏ, nền ồn');
    expect(historyOf(both)[0]).toMatchObject({ callerSaid: 'ok mình cảm ơn', note: 'nói nhỏ, nền ồn' });
  });
});

describe('an unknown label (contract §3.1)', () => {
  it('is carried through as stored, marked as outside the vocabulary', () => {
    const rows = [annotationRow({ label: 'stt_late' })];
    expect(cellsOn(rows)[0]).toMatchObject({ label: 'stt_late', labelKnown: false });
    expect(historyOf(rows)[0]).toMatchObject({ label: 'stt_late', labelKnown: false });
    // A row with an unknown label is still a fact: it is current, and shown.
    expect(currentAnnotations(rows)).toHaveLength(1);
  });
});

describe('a call nobody annotated', () => {
  it('has no cell items and no history rows', () => {
    expect(cellsOn([])).toEqual([]);
    expect(historyOf([])).toEqual([]);
  });
});
