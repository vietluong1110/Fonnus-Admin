import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { Baloo_2, Be_Vietnam_Pro, IBM_Plex_Sans } from 'next/font/google';
import Image from 'next/image';
import { currentAccount } from '@/account';
import { getConfig } from '@/config';
import Caveat, { Hint } from '@/ui/caveat';
import NavLink from '@/ui/nav-link';
import './globals.css';

/*
 * The three faces of the design system (ADR 0003 point 2), loaded by next/font
 * rather than by the Web-UI's Google Fonts @import: self-hosted at build time,
 * no render-blocking request to a third party. The `vietnamese` subset is the
 * reason these faces were chosen — without it every accented glyph falls back
 * to a system font mid-word. Weights are those of
 * ../Fonnus-Web-UI/src/styles/tokens/fonts.css.
 */
const baloo = Baloo_2({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-baloo',
});

const beVietnam = Be_Vietnam_Pro({
  subsets: ['vietnamese', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-be-vietnam',
});

const plex = IBM_Plex_Sans({
  subsets: ['vietnamese', 'latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-plex',
});

export const metadata: Metadata = {
  title: 'Fonnus Admin',
  description:
    'The internal console over the Fonnus voice pipeline: it reads the pipeline’s database and appends the two rows the read contract allows.',
};

/** The console's destinations. */
const NAV = [
  { href: '/', label: 'Overview', icon: 'report' },
  { href: '/calls', label: 'Calls', icon: 'answered' },
  { href: '/configuration', label: 'Configuration', icon: 'settings' },
] as const;

/*
 * The shell is ../Fonnus-Web-UI/src/app/AppShell.tsx: a 216px card-surface
 * sidebar on the left, paper content on the right, the sidebar narrowing to a
 * 64px icon rail below 900px. The Web-UI's phone tab bar is not copied — one
 * operator, on a laptop (ADR 0003 point 5).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Awaited before anything is read: it opts every route that renders inside
  // this shell out of prerendering, `/_not-found` included — the one route
  // Next.js otherwise puts on the static path, and a page prerendered inside
  // the Docker build would carry the build machine's environment, which has no
  // `.env` at all. Putting it in `src/app/not-found.tsx` is too late: the shell
  // renders first, and it is the shell that reads the configuration.
  await connection();

  // ADR 0005: while the gate is open every screen says so, so the line is the
  // shell's and no page can forget it. Read per request, so the line follows
  // the running box's `.env` rather than whatever the image was built with.
  const gate = getConfig().consentGate;

  // The account Caddy authenticated, read once for the whole shell (ADR 0007).
  // Absent on `pnpm dev` and over the tunnel, where no reverse proxy sits in
  // front — the trust model's honest consequence, not a failure.
  const account = await currentAccount();

  // No dark mode (CONTEXT.md §Look and feel): the warm cream ground is the page.
  return (
    <html
      lang="en"
      className={`h-full ${baloo.variable} ${beVietnam.variable} ${plex.variable}`}
    >
      <body className="min-h-full">
        <div className="grid min-h-screen grid-cols-[216px_minmax(0,1fr)] bg-surface-page max-[900px]:grid-cols-[64px_minmax(0,1fr)]">
          <aside
            aria-label="Console"
            className="sticky top-0 z-10 flex h-screen flex-col gap-[3px] overflow-x-visible overflow-y-clip border-r border-border-hairline bg-surface-card px-[14px] pt-[22px] pb-[18px] max-[900px]:px-[10px] max-[900px]:pt-[18px] max-[900px]:pb-[14px]"
          >
            {/* The brand lockup (CONTEXT.md §Look and feel); viewBox 339.3 × 108.9.
                On the icon rail the wordmark would shrink past reading size, so
                the rail shows the square mark instead — the same glyph the
                lockup carries over its "o", and the tab's favicon (src/app/icon.svg). */}
            <div className="flex items-center px-[10px] pb-5 max-[900px]:hidden">
              <Image
                src="/fonnus-lockup-horizontal.svg"
                alt="Fonnus"
                width={112}
                height={36}
                priority
              />
            </div>
            <div className="hidden items-center justify-center pb-5 max-[900px]:flex">
              <Image src="/fonnus-mark.svg" alt="Fonnus" width={28} height={28} priority />
            </div>

            <nav className="flex flex-col gap-[3px]">
              {NAV.map((entry) => (
                <NavLink key={entry.href} href={entry.href} label={entry.label} icon={entry.icon} />
              ))}
            </nav>

            {/* What this console is and who it is doing it as. Muted, never the
                accent: the accent is for what the operator acts on, and this is
                not an action (ADR 0003). "read-only" left the line when the
                first write module landed (ADR 0007 decision 6); "edits" does not
                replace it, because decision 1 allows two inserts, not editing.
                Hidden on the 64px rail, like every other piece of sidebar text. */}
            <footer className="mt-auto px-3 pt-4 text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted max-[900px]:hidden">
              console ·{' '}
              {account ?? (
                <Hint
                  hint="no account: this request did not come through the reverse proxy (local development or the tunnel)"
                  align="start"
                >
                  no account
                </Hint>
              )}
            </footer>
          </aside>

          <main className="flex min-w-0 flex-col gap-[18px] px-9 pt-7 pb-10 max-[900px]:px-5 max-[900px]:pt-5 max-[900px]:pb-8">
            {/* Centred rather than capped-and-left: a wide window otherwise puts
                36px of margin on one side and 300px on the other. */}
            <div className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-[18px]">
              {gate === 'off' ? (
                <Caveat>
                  consent gate off: caller text and recordings are shown for every call
                  (internal test phase)
                </Caveat>
              ) : null}
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
