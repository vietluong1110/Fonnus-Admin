'use client';

/*
 * One sidebar destination, after the `.item` / `.itemOn` rules of
 * ../Fonnus-Web-UI/src/app/AppShell.module.css @ 302e3e8.
 * The only reason it is a client component: the active item is decided from the
 * pathname, which a layout (a server component) is not given. Everything else
 * in the shell stays on the server.
 * The rule it enforces: the active item's terracotta ground sets
 * `--icon-accent: currentColor`, so the glyph reads as one colour on it.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon, { type IconName } from './icon';

export default function NavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: IconName;
}) {
  const pathname = usePathname();
  // A call detail (`/calls/<uuid>`) keeps "Calls" lit, so the operator is never
  // on a page no nav item claims.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-[10px] rounded-[10px] px-3 py-[9px] text-[length:var(--size-ui)] leading-[1.4] whitespace-nowrap max-[900px]:justify-center max-[900px]:px-0 max-[900px]:py-[10px] ${
        active
          ? 'bg-action-primary font-semibold text-text-on-accent [--icon-accent:currentColor]'
          : 'font-medium text-text-muted hover:bg-[var(--action-ghost-hover)] hover:text-text-body'
      }`}
    >
      <Icon name={icon} size={18} />
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis max-[900px]:hidden">
        {label}
      </span>
    </Link>
  );
}
