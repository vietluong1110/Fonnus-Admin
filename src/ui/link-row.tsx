'use client';

/*
 * A table row that is one click target, after the `.rowLink` idiom of
 * ../Fonnus-Web-UI/src/app/letan/Section.module.css @ 302e3e8 (the hub rows of
 * the clinic app, where the whole row is the link).
 *
 * The rule it enforces: the FIRST cell must contain a real `<Link href>` — the
 * caller renders it — so keyboard focus, middle-click and "open in new tab"
 * work as a browser's anchor does. The row's own `onClick` only covers a plain
 * click that landed on the other cells; `shouldFollowRow` says which those are.
 *
 * The Web-UI's row lifts by `--lift-hover` on hover. A `<tr>` is not a reliable
 * transform container across browsers, so here the lift is the hover surface
 * alone (`--action-secondary-hover`, the same token that row uses).
 */

import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';
import { INTERACTIVE_SELECTOR, shouldFollowRow } from './row-click';

export default function LinkRow({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLTableRowElement>) {
    const target = event.target;
    const follow = shouldFollowRow({
      button: event.button,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      defaultPrevented: event.defaultPrevented,
      onInteractive:
        target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null,
      hasTextSelection: window.getSelection()?.isCollapsed === false,
    });
    if (follow) router.push(href);
  }

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--action-secondary-hover)] ${className ?? ''}`}
    >
      {children}
    </tr>
  );
}
