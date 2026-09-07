/** The skeleton the call list is replaced by while the query runs. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-xl font-semibold">Calls</h1>
      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
        {Array.from({ length: 8 }, (_, row) => (
          <div key={row} className="border-b border-border px-4 py-4 last:border-b-0">
            <div className="h-4 w-1/3 animate-pulse rounded bg-border" />
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">Reading the pipeline database…</p>
    </main>
  );
}
