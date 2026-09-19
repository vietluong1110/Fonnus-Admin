/*
 * A multi-line control, wearing the shell of
 * ../Fonnus-Web-UI/src/app/ui/Field.module.css `.control` / `.textarea`
 * @ 302e3e8 (the shell imported from `input.tsx`, which copied it).
 * The rule the source adds for this one: the box grows only by the operator's
 * drag on the vertical axis — a control that widens itself breaks the column
 * the fields are laid out in.
 */

import type { TextareaHTMLAttributes } from 'react';
import { CONTROL } from './input';

export default function Textarea({
  className,
  rows = 3,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={`${CONTROL} resize-y${className === undefined ? '' : ` ${className}`}`}
      {...rest}
    />
  );
}
