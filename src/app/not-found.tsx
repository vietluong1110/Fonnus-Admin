import Card from '@/ui/card';
import EmptyState from '@/ui/empty-state';
import PageHead from '@/ui/page-head';

/**
 * The console's 404, for a path no route of this app answers. (A call id that
 * names no row has its own, `src/app/calls/[id]/not-found.tsx`.)
 *
 * `/_not-found` is the one route Next.js puts on the static path by default,
 * which would freeze the shell's consent-gate caveat to whatever the Docker
 * build machine had — nothing (ADR 0005: every screen says so while the gate is
 * off). The `connection()` call in `src/app/layout.tsx` is what keeps this page
 * rendered per request instead.
 */
export default function NotFound() {
  return (
    <>
      <PageHead title="Page not found" back={{ href: '/calls', label: 'Calls' }} />
      <Card>
        <EmptyState title="No such page.">
          This address names nothing in the console. The console has three screens: the call
          list, one call, and the latency dashboard.
        </EmptyState>
      </Card>
    </>
  );
}
