/*
 * The drawn listbox (ADR 0014 decision 3): its keyboard arithmetic, the one
 * write it makes to the native select, and the HTML the server sends before
 * any script runs. There is no DOM in this suite, so the hydrated half — the
 * combobox button and the portalled panel — is checked in the browser, not here.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Listbox, { commitSelect, followSelect, stepOption, typeAheadMatch } from './listbox';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo', disabled: true },
  { value: 'c', label: 'Charlie' },
  { value: 'd', label: 'Delta', group: 'Later' },
];

describe('stepOption — arrow keys', () => {
  it('skips a disabled option and wraps at both ends', () => {
    expect(stepOption(OPTIONS, 0, 1)).toBe(2);
    expect(stepOption(OPTIONS, 2, -1)).toBe(0);
    expect(stepOption(OPTIONS, 3, 1)).toBe(0);
    expect(stepOption(OPTIONS, 0, -1)).toBe(3);
  });

  it('stays put when there is nowhere to go', () => {
    expect(stepOption([], 0, 1)).toBe(0);
    expect(stepOption([{ disabled: true }, {}], 1, 1)).toBe(1);
  });
});

describe('typeAheadMatch — typing a label', () => {
  it('finds the first enabled label that starts with the query, ignoring case', () => {
    expect(typeAheadMatch(OPTIONS, 'ch')).toBe(2);
    expect(typeAheadMatch(OPTIONS, 'DEL')).toBe(3);
  });

  it('never lands on a disabled option, and says -1 for no match', () => {
    expect(typeAheadMatch(OPTIONS, 'bra')).toBe(-1);
    expect(typeAheadMatch(OPTIONS, 'zulu')).toBe(-1);
  });
});

describe('commitSelect — a choice goes through the native select', () => {
  it('sets the value, then dispatches one bubbling change event', () => {
    // React fires `onChange` for EVERY `change` event on a <select>: its change
    // plugin maps `change` straight to the target for `select` and skips the
    // value tracker that text inputs dedupe through
    // (react-dom 19.2.8 `getTargetInstForChangeEvent`,
    // cjs/react-dom-client.development.js). So this event is what reaches the
    // caller's handler, and a form submit reads the value set here.
    const seen: { type: string; bubbles: boolean; valueThen: string }[] = [];
    const select = {
      value: 'a',
      dispatchEvent(event: Event): boolean {
        seen.push({ type: event.type, bubbles: event.bubbles, valueThen: select.value });
        return true;
      },
    };
    commitSelect(select, 'c');
    expect(select.value).toBe('c');
    expect(seen).toEqual([{ type: 'change', bubbles: true, valueThen: 'c' }]);
  });
});

describe('followSelect — the face shows the value the select settled on', () => {
  /**
   * A select whose `change` reaches the face's listener first, then a stand-in
   * for React's root listener and its controlled-state restore, which puts
   * `controlled` back before the dispatch returns — as react-dom does.
   */
  function controlledSelect(controlled: string | null) {
    const listeners: (() => void)[] = [];
    const select = {
      value: controlled ?? 'a',
      dispatchEvent(): boolean {
        for (const listener of listeners) listener();
        if (controlled !== null) select.value = controlled;
        return true;
      },
    };
    return { select, listen: (listener: () => void) => listeners.push(listener) };
  }

  function run(controlled: string | null): string[] {
    const shown: string[] = [];
    const tasks: (() => void)[] = [];
    const { select, listen } = controlledSelect(controlled);
    listen(followSelect(select, (value) => shown.push(value), (task) => tasks.push(task)));
    commitSelect(select, 'c');
    for (const task of tasks) task();
    return shown;
  }

  it('shows the old value when a controlled parent keeps it', () => {
    expect(run('a')).toEqual(['a']);
  });

  it('shows the chosen value when nothing puts the select back', () => {
    expect(run(null)).toEqual(['c']);
  });
});

describe('Listbox — the server HTML', () => {
  const html = renderToStaticMarkup(
    createElement(Listbox, {
      name: 'group',
      options: OPTIONS,
      defaultValue: 'c',
      'aria-label': 'Group by',
    }),
  );

  it('is a plain, visible select that submits without script', () => {
    expect(html).toMatch(/<select[^>]*name="group"/);
    expect(html).not.toContain('sr-only');
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('role="listbox"');
  });

  it('carries every option, the disabled one disabled, a group as an optgroup', () => {
    expect(html).toContain('<option value="a">Alpha</option>');
    expect(html).toMatch(/<option value="b" disabled="">Bravo<\/option>/);
    expect(html).toMatch(/<optgroup label="Later"><option value="d">Delta<\/option><\/optgroup>/);
    expect(html).toMatch(/<option value="c" selected="">Charlie<\/option>/);
  });
});
