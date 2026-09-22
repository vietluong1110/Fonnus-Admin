/*
 * The label and value rules of the fluid bar chart, plus the rule for which
 * hour of a rolling window carries a label.
 * The density rules are pure functions of the column count because a server
 * component cannot measure the box it will be rendered into.
 */

import { describe, expect, it } from 'vitest';
import { hourLabelAt, labelEvery, labelShown, valuesShown } from './vbars';
import type { VBar } from './vbars';

describe('labelEvery', () => {
  it('labels every column of a window the artboard\'s width can carry', () => {
    expect(labelEvery(1)).toBe(1);
    expect(labelEvery(7)).toBe(1);
    expect(labelEvery(12)).toBe(1);
  });

  it('labels a month of days once a week, anchored on the newest day', () => {
    expect(labelEvery(13)).toBe(3);
    expect(labelEvery(24)).toBe(3);
    expect(labelEvery(31)).toBe(7);
    expect(labelEvery(45)).toBe(7);
    // The `30d` preset draws 31 columns; today is labelled and the rest fall a
    // week apart from it, so no two labels are ever closer than seven columns.
    const shown = [...Array(31).keys()].filter((i) => labelShown(i, 31, labelEvery(31)));
    expect(shown).toEqual([2, 9, 16, 23, 30]);
  });

  it('keeps anything longer to about seven labels', () => {
    expect(labelEvery(53)).toBe(8);
    expect(labelEvery(367)).toBe(53);
    const shown = [...Array(53).keys()].filter((i) => labelShown(i, 53, labelEvery(53)));
    expect(shown.length).toBeLessThanOrEqual(7);
    expect(shown.at(-1)).toBe(52);
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

function bar(label: string): VBar {
  return { label, value: 1 };
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
