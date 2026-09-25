/*
 * The console's tooltip, drawn rather than the browser's `title` (ADR 0014
 * decisions 1–2): no delay, the house look, and shown on keyboard focus too.
 *
 * CSS-only and stateless, so it renders in a server component: the tooltip
 * node is always in the DOM and hidden by `.tip-body` in globals.css until the
 * wrapper is hovered or holds focus. The trigger is focusable and names the
 * node with `aria-describedby`, so a screen reader announces the text whether
 * or not it is on screen — what `title` gave, kept.
 *
 * It is `position: absolute` inside the wrapper, so an `overflow: hidden`
 * ancestor clips it: a caller near the top of a clipping box (a table's first
 * row, the page head) passes `side="bottom"`. The trigger takes the wrapper's
 * display, so `className` sizes and lays out what it wraps. Wrap content that
 * is not focusable itself: a link or a button inside would be a second tab
 * stop for one control — for those, `asChild` makes the one child element the
 * trigger (it gets `aria-describedby`; no extra focusable span is added).
 *
 * Centred on the trigger by default; `align="end"` pins the tooltip's right
 * edge to the trigger's, for a trigger at the right edge of a card or a table
 * (a right-aligned numeric header), where a centred tooltip would run past the
 * page and make it scroll sideways. `align="start"` pins the left edges, for a
 * trigger at the left edge of the window (the sidebar's icon rail).
 *
 * The wrapper's `position: relative` and `display: inline-flex` live in the
 * `.tip` rule of globals.css, in the components layer, so a `className`
 * utility (`flex`, `w-full`) overrides them reliably.
 */

import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';

type Common = {
  tip: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  /** Layout of the wrapper (and so of the trigger inside it); never a colour. */
  className?: string;
};

export default function Tooltip(
  props: Common &
    (
      | { asChild?: false; children: ReactNode }
      /** The child is focusable itself (a link, a button) and is the trigger. */
      | { asChild: true; children: ReactElement<Record<string, unknown>> }
    ),
) {
  const { tip, side = 'top', align = 'center', className } = props;
  const id = useId();
  return (
    <span
      className={`tip${className === undefined ? '' : ` ${className}`}`}
      data-tip-side={side}
      data-tip-align={align}
    >
      {props.asChild === true ? (
        cloneElement(props.children, { 'aria-describedby': id })
      ) : (
        <span className="tip-trigger" tabIndex={0} aria-describedby={id}>
          {props.children}
        </span>
      )}
      <span role="tooltip" id={id} className="tip-body">
        {tip}
      </span>
    </span>
  );
}
