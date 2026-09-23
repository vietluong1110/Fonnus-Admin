/*
 * A panel above the page — centred, or a sheet on the right edge — drawn with
 * the HTML `popover` attribute.
 * The rules it enforces: an overlay is opened and closed by `popovertarget`
 * buttons, so it works with no script, and Escape or a click outside closes
 * it; its content stays in the DOM where it is written, so a control inside a
 * <form> is still submitted with that form; and it is the one surface that
 * carries a shadow (shape.css: shadow is for true overlays only).
 *
 * The popover element itself never takes a `display` class: the browser hides
 * a closed popover with `display: none`, and an author `flex` would override
 * that and leave it open. The layout is the inner box's.
 */

import type { ReactNode } from 'react';

const FRAME = {
  center:
    'm-auto max-h-[calc(100dvh-48px)] w-[min(880px,calc(100vw-32px))] rounded-[var(--radius-card)] border',
  right: 'my-0 mr-0 ml-auto h-dvh max-h-none w-[min(600px,100vw)] border-l',
} as const;

/** The button that closes the overlay `id`, for its footer. */
export function closeProps(id: string) {
  return { type: 'button', popoverTarget: id, popoverTargetAction: 'hide' } as const;
}

export default function Overlay({
  id,
  title,
  side = 'center',
  children,
}: {
  id: string;
  title: ReactNode;
  side?: keyof typeof FRAME;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      popover="auto"
      aria-labelledby={`${id}:title`}
      className={`${FRAME[side]} border-border-hairline bg-surface-card p-0 text-text-body shadow-[var(--shadow-overlay)] backdrop:bg-[rgba(38,31,24,0.32)]`}
    >
      <div className="flex flex-col gap-[14px] p-[var(--pad-card)]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <h2
            id={`${id}:title`}
            className="min-w-0 font-display text-[17px] leading-[1.3] font-semibold break-words text-text-heading"
          >
            {title}
          </h2>
          <button
            {...closeProps(id)}
            className="cursor-pointer text-[length:var(--size-ui)] font-medium text-text-link hover:underline"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
