/*
 * One pipeline concept as the console labels it (ADR 0013 decision 1): the
 * plain-language name first, the pipeline's own term beside it in the muted
 * monospace of `--size-eyebrow`, every time. `stacked` puts the term on a
 * second line (a track row, a form row); `inline` puts it in parentheses after
 * the name (a table cell, a chip). The name carries the description, or the
 * caller's `hint`, as its tooltip.
 *
 * The term comes from `src/ui/glossary.ts` only — this component writes no
 * name of its own. Server-safe: no state, no effect.
 */

import type { Term as GlossaryTerm } from './glossary';
import Tooltip from './tooltip';

const CODE = 'font-num text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted';

export default function Term({
  term,
  layout = 'stacked',
  hint,
  align = 'start',
  tipAlign,
}: {
  term: GlossaryTerm;
  layout?: 'stacked' | 'inline';
  /** Replaces the glossary's description as the tooltip. */
  hint?: string;
  /** `end` for a term at the right edge (a numeric header): lines and tooltip end there. */
  align?: 'start' | 'end';
  /**
   * Where the tooltip sits against the name, when `align` alone would centre it
   * past the window's edge — a term at a narrow card's left edge.
   */
  tipAlign?: 'start' | 'center' | 'end';
}) {
  const tip = hint ?? term.description;
  const name =
    tip === undefined ? (
      <span>{term.name}</span>
    ) : (
      <Tooltip tip={tip} align={tipAlign ?? (align === 'end' ? 'end' : 'center')}>
        <span className="cursor-help underline decoration-border-strong decoration-dotted underline-offset-[3px]">
          {term.name}
        </span>
      </Tooltip>
    );
  if (layout === 'inline') {
    return (
      <span>
        {name} <code className={CODE}>({term.code})</code>
      </span>
    );
  }
  return (
    <span className={`flex min-w-0 flex-col ${align === 'end' ? 'items-end text-right' : 'items-start'}`}>
      {name}
      <code className={`${CODE} max-w-full [overflow-wrap:anywhere]`}>{term.code}</code>
    </span>
  );
}
