'use client';

/** Same posture as the list: say the read failed, never print the stack. */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-xl font-semibold">Call</h1>
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
