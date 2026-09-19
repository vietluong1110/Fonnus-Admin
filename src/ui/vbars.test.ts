/*
 * The label and value rules of the fluid bar chart, plus the two rules the
 * partial edge columns brought: which hour carries a label, and the line the
 * card prints when the window only reaches into its first or last column.
 * The density rules are pure functions of the column count because a server
 * component cannot measure the box it will be rendered into.
 */

import { describe, expect, it } from 'vitest';
import { hourLabelAt, labelEvery, labelShown, partialNote, valuesShown } from './vbars';
import type { VBar } from './vbars';

describe('labelEvery', () => {
  it('labels every column of a window the artboard\'s width can carry', () => {
    expect(labelEvery(1)).toBe(1);
    expect(labelEvery(7)).toBe(1);
    expect(labelEvery(12)).toBe(1);
  });

  it('thins a month of days to every fifth, and keeps the last', () => {
    expect(labelEvery(13)).toBe(5);
    expect(labelEvery(24)).toBe(5);
    expect(labelEvery(30)).toBe(5);
    expect(labelEvery(31)).toBe(5);
    const shown = [...Array(30).keys()].filter((i) => labelShown(i, 30, labelEvery(30)));
    expect(shown).toEqual([0, 5, 10, 15, 20, 25, 29]);
  });

  it('thins a year of weeks to every seventh and anything longer to eight labels', () => {
    expect(labelEvery(53)).toBe(7);
    expect(labelEvery(54)).toBe(7);
    expect(labelEvery(80)).toBe(10);
    expect(labelEvery(367)).toBe(46);
  });

  it('never skips a label when every column carries one', () => {
    expect([...Array(7).keys()].every((i) => labelShown(i, 7, 1))).toBe(true);
  });
});

describe('valuesShown', () => {
  it('writes the values while the columns are wide enough for a number', () => {
    expect(valuesShown(7)).toBe(true);
    expect(valuesShown(16)).toBe(true);
  });

  it('drops them past 16 columns, where the title tooltip carries them', () => {
    expect(valuesShown(17)).toBe(false);
    expect(valuesShown(24)).toBe(false);
    expect(valuesShown(30)).toBe(false);
  });
});

function bar(label: string, partial = false): VBar {
  return { label, value: 1, partial };
}

describe('hourLabelAt', () => {
  it('marks the quarters of the day wherever they fall', () => {
    // The histogram's 24 columns start at `00`, so the rule picks the same
    // four positions the old count-based spacing did.
    const hours = [...Array(24).keys()].map((h) => bar(String(h).padStart(2, '0')));
    expect(hours.filter(hourLabelAt).map((b) => b.label)).toEqual(['00', '06', '12', '18']);
    expect(hours.map((b, i) => (hourLabelAt(b) ? i : -1)).filter((i) => i >= 0)).toEqual([
      0, 6, 12, 18,
    ]);
  });

  it('follows the clock on a rolling window that does not start at midnight', () => {
    // The `24h` preset's 25 columns run 17 … 17: the quarters land where the
    // clock puts them — 18 at the second column, midnight at the eighth —
    // rather than every sixth column from the left.
    const rolling = [...Array(25).keys()].map((i) => bar(String((17 + i) % 24).padStart(2, '0')));
    expect(rolling.map((b, i) => (hourLabelAt(b) ? i : -1)).filter((i) => i >= 0)).toEqual([
      1, 7, 13, 19,
    ]);
    expect(rolling.filter(hourLabelAt).map((b) => b.label)).toEqual(['18', '00', '06', '12']);
  });
});

describe('partialNote', () => {
  it('names whichever edges the window only reaches into', () => {
    expect(partialNote([bar('17', true), bar('18'), bar('19', true)], 'hour')).toBe(
      'first and last columns are partial hours',
    );
    expect(partialNote([bar('5/9', true), bar('6/9')], 'day')).toBe(
      'first column is a partial day',
    );
    expect(partialNote([bar('5/9'), bar('6/9', true)], 'week')).toBe(
      'last column is a partial week',
    );
  });

  it('says nothing when every column stands on a whole bucket', () => {
    expect(partialNote([bar('5/9'), bar('6/9')], 'day')).toBeNull();
    expect(partialNote([], 'day')).toBeNull();
  });
});
