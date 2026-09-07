import Card from '@/ui/card';
import PageHead from '@/ui/page-head';

/** The skeleton the call detail is replaced by while the two queries run. */
export default function Loading() {
  return (
    <>
      <PageHead title="Call" back={{ href: '/calls', label: 'Calls' }} />
      {Array.from({ length: 3 }, (_, card) => (
        <Card key={card}>
          <div className="h-4 w-1/2 animate-pulse rounded-xs bg-[var(--border-hairline)]" />
          <div className="h-4 w-1/3 animate-pulse rounded-xs bg-[var(--border-hairline)]" />
        </Card>
      ))}
      <p className="mb-0 text-[length:var(--size-ui)] text-text-muted">
        Reading the pipeline database…
      </p>
    </>
  );
}
