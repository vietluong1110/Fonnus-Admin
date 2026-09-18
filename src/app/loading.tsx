import Card from '@/ui/card';
import PageHead from '@/ui/page-head';

/** The skeleton the overview is replaced by while the two queries run. */
export default function Loading() {
  return (
    <>
      <PageHead title="Overview" />
      <Card>
        {Array.from({ length: 6 }, (_, row) => (
          <div
            key={row}
            className="h-4 w-1/3 animate-pulse rounded-xs bg-[var(--border-hairline)]"
          />
        ))}
      </Card>
      <p className="mb-0 text-[length:var(--size-ui)] text-text-muted">
        Reading every turn in the window…
      </p>
    </>
  );
}
