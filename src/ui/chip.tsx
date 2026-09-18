/*
 * One filter pill of the Calls screen, after the `.pillbtn` / `.pillbtn-on`
 * rules of the artboard (`docs/design/Calls-html`).
 * The rule it enforces: a chip is a link, never a client-side toggle — the URL
 * is the whole input (ADR 0006), so a filtered list is a pasteable address.
 * The count sits inside the pill and is set in the numeric face, because it
 * changes with the chips and a proportional figure would make the row twitch.
 */

import Link from 'next/link';

const BASE =
  'inline-flex items-center gap-[7px] rounded-pill border px-[14px] py-[7px] font-ui text-[length:var(--size-ui)] leading-[1.4] whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

const OFF =
  'border-border-hairline bg-surface-card font-medium text-text-muted hover:bg-[var(--action-secondary-hover)] hover:text-text-body';

const ON = 'border-transparent bg-action-primary font-semibold text-text-on-accent';

export default function Chip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`${BASE} ${active ? ON : OFF}`}
    >
      {label}
      <span className={`font-num tabular-nums${active ? ' opacity-75' : ''}`}>{count}</span>
    </Link>
  );
}
