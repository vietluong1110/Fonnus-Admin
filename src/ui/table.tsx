/*
 * A real <table>, styled to the list values of
 * ../Fonnus-Web-UI/src/app/ui/Bits.module.css @ 302e3e8 (which draws its lists
 * as CSS grid; nothing here is edited, so the element gives row and column
 * semantics for free — ADR 0003 point 4).
 * The rule it enforces: a numeric cell is set in the numeric face with tabular
 * figures and aligned to the end, so the digits of a column line up.
 */

import type { ReactNode } from 'react';
import { Hint } from './caveat';

/** Lets a wide table scroll sideways inside a card instead of widening it. */
export function TableScroll({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-[var(--pad-card)] overflow-x-auto px-[var(--pad-card)]">{children}</div>
  );
}

export function Table({
  fixed = false,
  children,
}: {
  /** Column widths from the first row (a `<colgroup>`), never from the content. */
  fixed?: boolean;
  children: ReactNode;
}) {
  return (
    <table className={`w-full min-w-0 border-collapse${fixed ? ' table-fixed' : ''}`}>{children}</table>
  );
}

export function Th({
  align = 'start',
  hint,
  children,
}: {
  align?: 'start' | 'end';
  /** What the column counts, as the header's tooltip — never a second line. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <th
      className={`border-b border-border-strong px-3.5 py-2 align-bottom text-[12px] leading-[1.4] font-semibold tracking-[.04em] text-text-muted first:pl-0 last:pr-0 ${
        align === 'end' ? 'text-right' : 'text-left'
      }`}
    >
      {hint === undefined ? children : <Hint hint={hint}>{children}</Hint>}
    </th>
  );
}

export function Td({
  num = false,
  align,
  children,
}: {
  num?: boolean;
  align?: 'start' | 'end';
  children: ReactNode;
}) {
  const end = align === undefined ? num : align === 'end';
  return (
    <td
      className={`border-b border-border-hairline px-3.5 py-2.5 align-top text-[length:var(--size-ui)] leading-[1.5] first:pl-0 last:pr-0 ${
        num ? 'font-num tabular-nums' : ''
      } ${end ? 'text-right' : 'text-left'}`}
    >
      {children}
    </td>
  );
}
