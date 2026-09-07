import Link from 'next/link';

/** A malformed id (no query was run) or an id no `call_log` row carries. */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-xl font-semibold">No such call</h1>
      <p className="mt-2 text-sm text-muted">
        A call is named by the FreeSWITCH channel UUID. This one is not on record.
      </p>
      <Link href="/calls" className="mt-4 inline-block text-accent underline">
        Back to the call list
      </Link>
    </main>
  );
}
