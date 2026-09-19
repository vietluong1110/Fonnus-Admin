/*
 * The native checkbox with its label, painted terracotta the way
 * ../Fonnus-Web-UI/src/app/ui/Bits.module.css `.range` @ 302e3e8 paints the
 * slider: `accent-color` on the native control, not a drawn box.
 * The rule it enforces: one accent for anything the operator acts on (ADR 0003),
 * and a form control that the browser still renders with JavaScript off — the
 * Web-UI's drawn `Choice` is a scripted component and is deliberately not
 * copied (ADR 0011 decision 10).
 *
 * The `set:<path>` box is the only checkbox on this screen: every boolean LEAF
 * is a two-option select instead, because an unticked checkbox submits nothing
 * and `on` is not a value the copied schema accepts.
 */

import type { InputHTMLAttributes } from 'react';

export default function Checkbox({
  label,
  labelHidden = false,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /**
   * The label still names the box for a screen reader, but nothing is drawn:
   * for a row where the box sits in a column of its own and the text beside it
   * would be 54 repetitions of the same word.
   */
  labelHidden?: boolean;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted${
        labelHidden ? '' : ' gap-1.5'
      }${className === undefined ? '' : ` ${className}`}`}
    >
      <input
        type="checkbox"
        className="size-[15px] cursor-pointer accent-[var(--action-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-default"
        {...rest}
      />
      {labelHidden ? <span className="sr-only">{label}</span> : label}
    </label>
  );
}
