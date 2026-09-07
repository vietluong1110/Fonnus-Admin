/*
 * The one block every screen is built from, after the card of
 * ../Fonnus-Web-UI/src/app/ui/Bits.module.css @ 302e3e8.
 * The rule it enforces: a light surface sits on the page by fill and a
 * hairline, never by a shadow — shadow is for true overlays only (shape.css).
 */

import type { ReactNode } from 'react';

const TONE_CLASS = {
  default: 'bg-surface-card',
  warm: 'bg-surface-warm',
  sage: 'bg-surface-sage',
  rose: 'bg-surface-rose',
} as const;

export default function Card({
  tone = 'default',
  title,
  level = 2,
  sub,
  actions,
  children,
}: {
  tone?: keyof typeof TONE_CLASS;
  title?: string;
  /** Heading level of `title`: 3 for a card nested under a page section's h2. */
  level?: 2 | 3;
  sub?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      className={`flex flex-col gap-[14px] rounded-[var(--radius-card)] border border-border-hairline p-[var(--pad-card)] ${TONE_CLASS[tone]}`}
    >
      {title === undefined && sub === undefined && actions === undefined ? null : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            {title === undefined ? null : (
              <Heading className="font-display text-[17px] leading-[1.3] font-semibold text-text-heading">
                {title}
              </Heading>
            )}
            {sub === undefined ? null : (
              <p className="mt-0.5 mb-0 text-[12.5px] text-text-muted">{sub}</p>
            )}
          </div>
          {actions ?? null}
        </div>
      )}
      {children}
    </section>
  );
}
