/*
 * A one-line form control, after the `.control` / `.input` rules of
 * ../Fonnus-Web-UI/src/app/ui/Field.module.css @ 302e3e8.
 * The rule it enforces: the box is drawn by a 1px INSET ring on the card
 * surface, never by a border — so focus can thicken the ring to 1.5px and add
 * the terracotta halo without the control changing size and nudging its row.
 * A disabled control drops to the page ground and stops reacting to hover:
 * read-only is a state, not a thing to click.
 *
 * `CONTROL` is the shell every control in this console shares; `select.tsx` and
 * `textarea.tsx` import it rather than restate it, so the three cannot drift.
 */

import type { InputHTMLAttributes } from 'react';

export const CONTROL =
  'w-full min-w-0 rounded-md bg-surface-card px-[14px] py-[11px] font-ui text-[length:var(--size-ui)] leading-[1.4] text-text-body' +
  ' shadow-[inset_0_0_0_1px_var(--border-strong)] transition-shadow duration-[var(--duration-fast)] ease-[var(--ease-out)]' +
  ' hover:shadow-[inset_0_0_0_1px_rgba(38,31,24,0.36)]' +
  ' focus:outline-none focus:shadow-[inset_0_0_0_1.5px_var(--focus-ring),0_0_0_3px_rgba(184,92,43,0.13)]' +
  ' disabled:bg-surface-page disabled:hover:shadow-[inset_0_0_0_1px_var(--border-strong)]';

/** Numbers are set in the numeric face so a column of them lines up. */
export default function Input({
  className,
  type = 'text',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const numeric = type === 'number' ? ' font-num tabular-nums' : '';
  return (
    <input
      type={type}
      className={`${CONTROL}${numeric}${className === undefined ? '' : ` ${className}`}`}
      {...rest}
    />
  );
}
