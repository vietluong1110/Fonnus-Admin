import Card from '@/ui/card';
import EmptyState from '@/ui/empty-state';
import PageHead from '@/ui/page-head';

/** A malformed id (no query was run) or an id no `call_log` row carries. */
export default function NotFound() {
  return (
    <>
      <PageHead title="No such call" back={{ href: '/calls', label: 'Calls' }} />
      <Card>
        <EmptyState title="Not on record.">
          A call is named by the FreeSWITCH channel UUID. This one names no row in{' '}
          <code>call_log</code> — it may never have existed, or the retention sweep may have
          taken it.
        </EmptyState>
      </Card>
    </>
  );
}
