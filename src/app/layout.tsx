import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fonnus Admin',
  description: 'Read-only console over the Fonnus voice pipeline.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // No dark mode (CONTEXT.md §Look and feel): the warm cream ground is the page.
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-bg text-ink">
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
            {/* The brand lockup (CONTEXT.md §Look and feel); viewBox 339.3 × 108.9. */}
            <Image
              src="/fonnus-lockup-horizontal.svg"
              alt="Fonnus"
              width={112}
              height={36}
              priority
            />
            <span className="text-sm text-muted">Admin</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
