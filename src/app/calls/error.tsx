'use client';

import Card from '@/ui/card';
import PageHead from '@/ui/page-head';

/**
 * The database is on the other side of a network path that can be down (an SSH
 * tunnel from a laptop, the compose bridge on the box). The message says that
 * much and no more: a stack trace would carry the connection string's host.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <PageHead title="Calls" />
      <Card>
        <p className="mb-0">The database could not be read.</p>
        <p className="mb-0 text-[length:var(--size-ui)] text-text-muted">
          The console reads the pipeline&apos;s Postgres as the role <code>console</code>. Check
          that the connection is up, then try again.
        </p>
        <div>
          <button
            type="button"
            onClick={reset}
            className="rounded-sm bg-action-primary px-4 py-2 text-[length:var(--size-ui)] font-medium text-text-on-accent hover:bg-action-primary-hover"
          >
            Try again
          </button>
        </div>
      </Card>
    </>
  );
}
