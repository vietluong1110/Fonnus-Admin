'use client';

/**
 * The database is on the other side of a network path that can be down (an SSH
 * tunnel from a laptop, the compose bridge on the box). The message says that
 * much and no more: a stack trace would carry the connection string's host.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-xl font-semibold">Calls</h1>
      <div className="mt-6 rounded-xl border border-border bg-surface p-6">
        <p>The database could not be read.</p>
        <p className="mt-2 text-sm text-muted">
          The console reads the pipeline&apos;s Postgres as the role <code>console</code>. Check
          that the connection is up, then try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-accent-strong px-4 py-2 text-sm text-surface"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
