/*
 * The one component every caveat on every screen is written with — the cost
 * floor, "consented calls only", "first sentence only", the retention age.
 * The rule it enforces (CONTEXT.md §Look and feel, ADR 0003): a caveat is
 * muted 12px sitting beside the number it qualifies, never accent-coloured —
 * the accent is for what the operator acts on, and a caveat is not that.
 */

import type { ReactNode } from 'react';

export default function Caveat({
  children,
  as = 'p',
  className,
  title,
}: {
  children: ReactNode;
  as?: 'span' | 'p';
  /** Layout only — `truncate` on a one-line meta row, never a colour. */
  className?: string;
  /** The untruncated text, for the caveats a row truncates to one line. */
  title?: string;
}) {
  const tone = 'text-[length:var(--size-eyebrow)] leading-[1.4] font-normal text-text-muted';
  const extra = className === undefined ? '' : ` ${className}`;
  if (as === 'span')
    return (
      <span className={`${tone}${extra}`} title={title}>
        {children}
      </span>
    );
  return (
    <p className={`mb-0 ${tone}${extra}`} title={title}>
      {children}
    </p>
  );
}
