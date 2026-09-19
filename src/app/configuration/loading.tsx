import Card from '@/ui/card';
import PageHead from '@/ui/page-head';

/** The skeleton the form is replaced by while the four reads run. */
export default function Loading() {
  return (
    <>
      <PageHead title="Configuration" />
      <Card>
        {Array.from({ length: 6 }, (_, row) => (
          <div
            key={row}
            className="h-4 w-1/3 animate-pulse rounded-xs bg-[var(--border-hairline)]"
          />
        ))}
      </Card>
      <p className="mb-0 text-[length:var(--size-ui)] text-text-muted">
        Reading this tenant&apos;s runtime config rows…
      </p>
    </>
  );
}
