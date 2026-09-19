/**
 * The tenant's whole `runtime_config` history, newest first, no `LIMIT`
 * (ADR 0011 §Why): the newest row is "current", a restore is "load into form",
 * and a bounded read would hide the row an operator came here to find.
 *
 * Each row's document is shown **as stored** — never re-serialised through the
 * copied schema. A row written by hand may carry a key the schema refuses
 * (trap 6); it is rendered raw with the refusal beside it, because pretending
 * it parses would hide the one fact that explains why the pipeline fell back to
 * boot config.
 */

import Link from 'next/link';
import { formatWhen } from '@/calls';
import { parseDocument } from '@/configuration/document';
import type { RuntimeConfigRow } from '@/queries/runtime-config';
import Badge from '@/ui/badge';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';

export default function History({
  rows,
  tenant,
}: {
  rows: RuntimeConfigRow[];
  tenant: string;
}) {
  if (rows.length === 0) {
    return (
      <Card title="History">
        <EmptyState title="No runtime config row yet — the pipeline runs on boot config.">
          Every call answers on the values this build shipped with. The first save here writes
          row #1 for this tenant, and the next call answered runs on it.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card title={`History — ${String(rows.length)} rows`}>
      <div className="flex flex-col">
        {rows.map((row, index) => {
          const parsed = parseDocument(row.config);
          return (
            <div
              key={row.id}
              id={`row-${row.id}`}
              className="flex flex-col gap-1.5 border-t border-border-hairline py-3 first:border-t-0 first:pt-0 target:bg-surface-warm"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-num tabular-nums font-medium">#{row.id}</span>
                <span className="text-text-muted">·</span>
                <span className="font-num tabular-nums">{formatWhen(row.created_at)}</span>
                <span className="text-text-muted">·</span>
                <span>{row.created_by}</span>
                <span className="text-text-muted">·</span>
                <span className={row.note === null ? 'text-text-muted' : undefined}>
                  {row.note ?? '—'}
                </span>
                {index === 0 ? <Badge tone="success">current</Badge> : null}
                {parsed.ok ? null : <Badge tone="warning">the copied schema refuses this row</Badge>}
                <Link
                  href={`/configuration?tenant=${encodeURIComponent(tenant)}&from=${encodeURIComponent(row.id)}`}
                  className="text-[length:var(--size-ui)] font-medium text-text-link hover:underline"
                >
                  load into form
                </Link>
              </div>

              {parsed.ok ? null : (
                <div className="flex flex-col gap-1">
                  {parsed.issues.map((issue) => (
                    <Caveat key={`${issue.path}:${issue.message}`}>
                      {issue.path === '' ? 'the document' : issue.path}: {issue.message}
                    </Caveat>
                  ))}
                </div>
              )}

              <details className="text-[length:var(--size-ui)]">
                <summary className="cursor-pointer text-text-link">document</summary>
                <pre className="mt-2 mb-0 overflow-x-auto rounded-md bg-surface-page p-3 font-num text-[length:var(--size-ui)] leading-[1.5] whitespace-pre-wrap">
                  {JSON.stringify(row.config, null, 2)}
                </pre>
              </details>
            </div>
          );
        })}
      </div>

      <Caveat>
        a row is never updated and never deleted: a correction is a new row, and a restore is a
        new row carrying an older document. <code>created_by</code> reads as stored —{' '}
        <code>console:&lt;account&gt;</code> for a row this console wrote, another prefix for a
        row the pipeline&apos;s own tools wrote.
      </Caveat>
    </Card>
  );
}
