/*
 * A native `<select>`, wearing the shell of
 * ../Fonnus-Web-UI/src/app/ui/Field.module.css `.control` @ 302e3e8 (imported
 * from `input.tsx`, which copied it).
 * It is the form control; `listbox.tsx` draws the Web-UI's listbox over it as
 * its face once scripts run (ADR 0014 decision 3, revising ADR 0011 decision
 * 10), and with scripts off this native control is what the operator gets —
 * the fallback the Configuration form is built to keep.
 */

import type { ComponentProps } from 'react';
import { CONTROL } from './input';

export default function Select({
  className,
  ...rest
}: ComponentProps<'select'>) {
  return (
    <select
      // `pr-9!`: CONTROL's `px-[14px]` otherwise wins, and a long option runs
      // under the chevron.
      className={`${CONTROL} appearance-none truncate bg-[right_14px_center] bg-no-repeat pr-9!${
        className === undefined ? '' : ` ${className}`
      }`}
      style={{
        // The chevron the appearance reset removes, drawn back as the same
        // stroked shape the icon set uses (`src/ui/icon.tsx`), in ink.
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none' stroke='%23261f18' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1.5 6 6.5l5-5'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    />
  );
}
