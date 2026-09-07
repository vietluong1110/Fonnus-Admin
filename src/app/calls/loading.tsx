import Card from '@/ui/card';
import PageHead from '@/ui/page-head';

/** The skeleton the call list is replaced by while the query runs. */
export default function Loading() {
  return (
    <>
      <PageHead title="Calls" />
      <Card>
        {Array.from({ length: 8 }, (_, row) => (
          <div
            key={row}
            className="h-4 w-1/3 animate-pulse rounded-xs bg-[var(--border-hairline)]"
          />
        ))}
      </Card>
      <p className="mb-0 text-[length:var(--size-ui)] text-text-muted">
        Reading the pipeline database…
      </p>
    </>
  );
}
