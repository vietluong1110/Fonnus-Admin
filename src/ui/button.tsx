/*
 * The one button, after the primary/secondary pair of
 * ../Fonnus-Web-UI/src/app/ui/Bits.module.css @ 302e3e8.
 * The rule it enforces: one accent for anything clickable (ADR 0003) — the
 * primary carries the terracotta ground, the secondary the card ground and a
 * hairline, and both keep the same geometry so they line up side by side.
 * No hooks, so a server component and a `'use client'` one can both render it.
 */

import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary';

/** Same box in both variants: the primary's border is transparent, not absent. */
const BASE =
  'rounded-sm border px-4 py-2 text-[length:var(--size-ui)] font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-action-primary text-text-on-accent hover:bg-action-primary-hover',
  secondary:
    'border-border-hairline bg-surface-card text-text-body hover:bg-[var(--action-secondary-hover)]',
};

export default function Button({
  variant = 'primary',
  type = 'button',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANT_CLASS[variant]}${className === undefined ? '' : ` ${className}`}`}
      {...rest}
    />
  );
}
