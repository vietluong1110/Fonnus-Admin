/*
 * `TrackRow`'s label column (A19 D4): a caller sets its width, and the value
 * may carry its own tooltip.
 */

import { createElement, type FunctionComponent, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Hint } from './caveat';
import HBar, { TrackRow } from './hbar';

/** `createElement` typed on the component's props, children passed as arguments (react/no-children-prop). */
function el<P>(type: FunctionComponent<P>, props: Omit<P, 'children'>, ...children: ReactNode[]) {
  return createElement(type as FunctionComponent<Omit<P, 'children'>>, props, ...children);
}

const TERM = { name: 'Some span', code: 'some_span' };

describe('TrackRow', () => {
  it('keeps the 12rem label column by default', () => {
    const html = renderToStaticMarkup(el(TrackRow, { term: TERM, value: '10 ms' }));
    expect(html).toContain('grid-template-columns:12rem minmax(0, 1fr) 5rem');
  });

  it('takes the label width a caller gives it', () => {
    const html = renderToStaticMarkup(
      el(TrackRow, { term: TERM, value: '10 ms', labelWidth: '7.5rem' }),
    );
    expect(html).toContain('grid-template-columns:7.5rem minmax(0, 1fr) 5rem');
  });

  it('renders a value that carries its own tooltip', () => {
    const value = el(Hint, { hint: 'the rule', align: 'end' }, '10 ms');
    const html = renderToStaticMarkup(el(TrackRow, { term: TERM, value }));
    expect(html).toContain('data-tip-align="end"');
    expect(html).toContain('the rule');
  });
});

describe('TrackRow layout="above"', () => {
  const html = renderToStaticMarkup(
    el(TrackRow, { term: { ...TERM, description: 'd' }, value: '10 ms', layout: 'above' }, el(HBar, { from: 0, to: 5, scaleMax: 10, thick: true, playhead: 5 })),
  );

  it('gives the label its own line, the track and the value sharing the next', () => {
    expect(html).not.toContain('grid-template-columns');
    expect(html).toMatch(/^<div class="flex flex-col[^"]*">.*Some span.*some_span.*<div class="grid grid-cols-\[minmax\(0,1fr\)_5rem\]/);
  });

  it('keeps the playhead inside the track row, off the label line', () => {
    const trackRow = html.slice(html.indexOf('grid-cols-[minmax(0,1fr)_5rem]'));
    expect(trackRow).toContain('bg-action-primary');
    expect(html.indexOf('bg-action-primary')).toBeGreaterThan(html.indexOf('some_span'));
  });

  it('starts the label tooltip at the label', () => {
    expect(html).toContain('data-tip-align="start"');
  });
});
