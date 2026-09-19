/*
 * A native `<select>`, wearing the shell of
 * ../Fonnus-Web-UI/src/app/ui/Field.module.css `.control` @ 302e3e8 (imported
 * from `input.tsx`, which copied it).
 * The Web-UI's drawn listbox is deliberately NOT copied (ADR 0011 decision 10):
 * nothing here needs type-ahead over a handful of options, and a native control
 * is the only one that still works with JavaScript off — which is the fallback
 * the Configuration form is built to keep.
 */

import type { SelectHTMLAttributes } from 'react';
import { CONTROL } from './input';

export default function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`${CONTROL} appearance-none bg-[right_14px_center] bg-no-repeat pr-9${
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
