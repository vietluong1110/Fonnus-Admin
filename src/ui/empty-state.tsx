/*
 * "Nothing here yet", after the empty block of
 * ../Fonnus-Web-UI/src/app/ui/Bits.module.css @ 302e3e8.
 * The rule it enforces: a dashed border means "no content yet" and nothing
 * else — it is never a button, and nothing clickable in this console is dashed.
 */

import type { ReactNode } from 'react';

export default function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-border-dashed px-5 py-[18px]">
      <p className="mb-0 font-medium text-text-body">{title}</p>
      {children === undefined ? null : (
        <div className="mt-1 text-[length:var(--size-ui)] text-text-muted">{children}</div>
      )}
    </div>
  );
}
