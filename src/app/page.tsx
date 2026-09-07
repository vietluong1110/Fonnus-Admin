export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Fonnus Admin</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        The screens arrive with <code>PLAN.md</code> row A1 — the call list and the call
        detail. Until then,{' '}
        <a className="text-accent underline" href="/api/healthz">
          /api/healthz
        </a>{' '}
        reports the database connection and the Postgres role it was made as.
      </p>
    </main>
  );
}
