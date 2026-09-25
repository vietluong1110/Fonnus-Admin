/*
 * The drawn tooltip's two trigger modes (A19 D2) and the `align` its wrappers
 * pass through (A19 D3), checked on the server markup.
 */

import { createElement, type FunctionComponent, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Hint } from './caveat';
import { Th } from './table';
import Term from './term';
import Tooltip from './tooltip';

/** `createElement` typed on the component's props, children passed as arguments (react/no-children-prop). */
function el<P>(type: FunctionComponent<P>, props: Omit<P, 'children'>, ...children: ReactNode[]) {
  return createElement(type as FunctionComponent<Omit<P, 'children'>>, props, ...children);
}

describe('Tooltip', () => {
  it('wraps plain content in a focusable trigger that names the tooltip', () => {
    const html = renderToStaticMarkup(el(Tooltip, { tip: 'why' }, 'label'));
    expect(html).toMatch(/<span class="tip-trigger" tabindex="0" aria-describedby="([^"]+)">label<\/span>/);
    expect(html).toContain('role="tooltip"');
  });

  it('makes a focusable child the trigger itself, with no second tab stop', () => {
    const html = renderToStaticMarkup(
      el(Tooltip, { tip: 'why', asChild: true }, createElement('button', { type: 'button' }, 'Go')),
    );
    expect(html).not.toContain('tip-trigger');
    expect(html).not.toContain('tabindex');
    const describedBy = /<button type="button" aria-describedby="([^"]+)">Go<\/button>/.exec(html)?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`id="${describedBy ?? ''}"`);
  });
});

describe('align passes through to the tooltip', () => {
  it('Hint', () => {
    expect(renderToStaticMarkup(el(Hint, { hint: 'h', align: 'end' }, 'x'))).toContain(
      'data-tip-align="end"',
    );
    expect(renderToStaticMarkup(el(Hint, { hint: 'h' }, 'x'))).toContain('data-tip-align="center"');
  });

  it('Th: a right-aligned header ends its tooltip at its right edge', () => {
    const end = renderToStaticMarkup(el(Th, { align: 'end', hint: 'h' }, 'Calls'));
    expect(end).toContain('data-tip-align="end"');
    expect(end).toContain('data-tip-side="bottom"');
    const start = renderToStaticMarkup(el(Th, { hint: 'h' }, 'Calls'));
    expect(start).toContain('data-tip-align="center"');
  });

  it('Term: an end-aligned term ends its lines and its tooltip', () => {
    const html = renderToStaticMarkup(
      createElement(Term, { term: { name: 'N', code: 'n', description: 'd' }, align: 'end' }),
    );
    expect(html).toContain('items-end');
    expect(html).toContain('data-tip-align="end"');
  });
});
