/*
 * One labelled value inside a definition list, after the field rows of
 * ../Fonnus-Web-UI/src/app/ui/Bits.module.css @ 302e3e8. Moved here from the
 * two call screens, unchanged in behaviour.
 * The rule it enforces: the label is muted and small, the value is body text —
 * the number is what the eye lands on, never its caption.
 */

import type { ReactNode } from 'react';
import { Hint } from './caveat';

export default function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** What the value is measured against, read once — the label's tooltip. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted">
        {hint === undefined ? label : <Hint hint={hint}>{label}</Hint>}
      </dt>
      <dd className="mt-0.5 text-[length:var(--size-ui)] leading-[1.5] break-words">{children}</dd>
    </div>
  );
}
