/*
 * The top of a screen: the back link, the title, and whatever the screen wants
 * on the same line. After the page heads of ../Fonnus-Web-UI/src/app/ui @ 302e3e8.
 * The rule it enforces: one h1 per screen, in the display face at 24px, in
 * sentence case — the guide has no Title Case anywhere.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

export default function PageHead({
  title,
  back,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {back === undefined ? null : (
        <Link
          href={back.href}
          className="text-[length:var(--size-ui)] font-medium text-text-link hover:underline"
        >
          ‹ {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[24px] leading-[1.3] font-semibold tracking-[-.01em] text-text-heading">
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
