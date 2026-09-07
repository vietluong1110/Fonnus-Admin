/** The skeleton the call detail is replaced by while the two queries run. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="h-6 w-64 animate-pulse rounded bg-border" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: 3 }, (_, card) => (
          <div key={card} className="rounded-xl border border-border bg-surface p-6">
            <div className="h-4 w-1/2 animate-pulse rounded bg-border" />
            <div className="mt-3 h-4 w-1/3 animate-pulse rounded bg-border" />
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">Reading the pipeline database…</p>
    </main>
  );
}
