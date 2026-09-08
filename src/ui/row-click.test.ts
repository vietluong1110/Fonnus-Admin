import { describe, expect, it } from 'vitest';
import { INTERACTIVE_SELECTOR, type RowClick, shouldFollowRow } from './row-click';

/** A plain left click on a cell that is only text. */
const PLAIN: RowClick = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  onInteractive: false,
  hasTextSelection: false,
};

describe('shouldFollowRow', () => {
  it('navigates on a plain left click on the row', () => {
    expect(shouldFollowRow(PLAIN)).toBe(true);
  });

  for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const) {
    it(`leaves a ${key} click to the first cell's link`, () => {
      expect(shouldFollowRow({ ...PLAIN, [key]: true })).toBe(false);
    });
  }

  for (const [label, button] of [
    ['middle', 1],
    ['right', 2],
  ] as const) {
    it(`does not intercept a ${label} click`, () => {
      expect(shouldFollowRow({ ...PLAIN, button })).toBe(false);
    });
  }

  it('does not navigate a second time when the click landed on a link or button', () => {
    expect(shouldFollowRow({ ...PLAIN, onInteractive: true })).toBe(false);
  });

  it('does not navigate when the operator was selecting text in a cell', () => {
    expect(shouldFollowRow({ ...PLAIN, hasTextSelection: true })).toBe(false);
  });

  it('respects a handler inside the row that already took the click', () => {
    expect(shouldFollowRow({ ...PLAIN, defaultPrevented: true })).toBe(false);
  });
});

describe('INTERACTIVE_SELECTOR', () => {
  // The row's own link lives in the first cell; every other control a cell can
  // carry must be in this list or the row would navigate on top of it.
  for (const element of ['a', 'button', 'input', 'select', 'textarea', 'label']) {
    it(`names ${element}`, () => {
      expect(INTERACTIVE_SELECTOR.split(', ')).toContain(element);
    });
  }
});
