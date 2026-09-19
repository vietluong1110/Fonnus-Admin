/*
 * The Configuration screen (PLAN.md row A9, ADR 0011) — the one screen that
 * writes, and the only one whose form is generated from a copy of the
 * pipeline's own document schema rather than written by hand.
 *
 * It answers three questions at a glance: what the pipeline runs on now (the
 * newest row, and beside every leaf what the last answered call actually ran
 * on), whether that row is actually being applied (counted, never inferred),
 * and what to change for the next call (the form, then the review, then one new
 * row).
 *
 * The URL is the whole input (ADR 0006): `?tenant=` picks the tenant, `?from=`
 * opens the form on a history row. Nothing here is client state.
 */

import {
  SHIPPED_TEXT,
  disclosureAdvice,
} from '@/contract/config/runtime-document';
import { formatWhen } from '@/calls';
import { currentAccount } from '@/account';
import { editingConfigured } from '@/db';
import { renderValue } from '@/dashboard';
import { fieldsOf, formFromDocument, parseDocument, ranOn } from '@/configuration/document';
import { chooseTenant, startDocument } from '@/configuration/start';
import {
  callsSinceRow,
  lastCallSnapshot,
  runtimeConfigRows,
  tenants,
} from '@/queries/runtime-config';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import PageHead from '@/ui/page-head';
import ConfigurationForm from './configuration-form';
import History from './history';

// The screen is about the database right now, and it writes: nothing here may
// be prerendered or cached.
export const dynamic = 'force-dynamic';

const BASE = '/configuration';

type Params = Record<string, string | string[] | undefined>;

/** A query string key can arrive repeated; the first value is the answer. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A jsonb document as a plain object, or `{}` for anything else. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export default async function ConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const tenantRows = await tenants();
  const tenant = chooseTenant(tenantRows, first(params['tenant']));

  if (tenant === null) {
    return (
      <>
        <PageHead title="Configuration" />
        <Card>
          <EmptyState title="No tenant_config row — the pipeline has not created a tenant yet.">
            A `runtime_config` row belongs to a tenant, so there is nothing to configure until
            the pipeline writes one. Nothing is wrong with this console.
          </EmptyState>
        </Card>
      </>
    );
  }

  const [rows, snapshot, account] = await Promise.all([
    runtimeConfigRows(tenant),
    lastCallSnapshot(tenant),
    currentAccount(),
  ]);
  const editorConfigured = editingConfigured();

  const newest = rows[0] ?? null;
  const applied =
    newest === null ? null : await callsSinceRow(tenant, newest.created_at, newest.id);

  // The document the form opens on: `?from=` names a history row, else the
  // newest row, else boot config.
  const start = startDocument(rows, first(params['from']));
  const parsedStart = parseDocument(start.document);
  // A stored document the copy refuses is never pretended to parse (trap 6):
  // the form starts from boot config and the warning below names both causes.
  const effective = parsedStart.ok ? asRecord(start.document) : {};
  const { values, set } = formFromDocument(effective);

  const fields = fieldsOf();
  // What the last answered call actually ran on, per leaf, resolved here so the
  // client component never reaches for a pool or a query (contract §3.4).
  const ranOnByPath: Record<string, string | null> = {};
  for (const field of fields) {
    if (field.path in ranOnByPath) continue;
    const value = ranOn(snapshot, field);
    ranOnByPath[field.path] = value === undefined ? null : renderValue(value);
  }

  // Rule 6 of `docs/redesign.md` §4.2 is about the greeting the pipeline speaks
  // right now, which is the NEWEST row's — not the document the form happens to
  // have loaded from `?from=`. No row at all: boot config's greeting is the
  // shipped one, which needs no advice. A newest row the copied schema refuses
  // (trap 6) is refused by the pipeline too, so it runs boot config and speaks
  // the shipped greeting — no banner; the trap-6 card above already names the
  // refusal.
  const currentGreeting =
    newest === null || !parseDocument(newest.config).ok
      ? undefined
      : asRecord(asRecord(newest.config)['text'])['greeting'];
  const disclosure = typeof currentGreeting === 'string' ? disclosureAdvice(currentGreeting) : [];

  const editable = editorConfigured && account !== undefined;
  const tenantRow = tenantRows.find((row) => row.id === tenant);
  const tenantLabel =
    tenantRow?.clinic_name === null || tenantRow?.clinic_name === undefined
      ? tenant
      : `${tenantRow.clinic_name} (${tenant})`;

  return (
    <>
      <PageHead title="Configuration">
        <Caveat as="span">{tenantLabel}</Caveat>
      </PageHead>

      {tenantRows.length > 1 ? (
        <form method="get" action={BASE} className="flex flex-wrap items-center gap-2">
          <label htmlFor="tenant-picker" className="text-[length:var(--size-ui)] font-medium">
            tenant
          </label>
          {/* A GET form, so the tenant is in the URL like every other input
              (ADR 0006) and a screen is a pasteable address. */}
          <select
            id="tenant-picker"
            name="tenant"
            defaultValue={tenant}
            className="rounded-sm border border-border-hairline bg-surface-card px-3 py-2 text-[length:var(--size-ui)]"
          >
            {tenantRows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.clinic_name === null ? row.id : `${row.clinic_name} (${row.id})`}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-sm border border-transparent bg-action-primary px-4 py-2 text-[length:var(--size-ui)] font-medium text-text-on-accent"
          >
            Show
          </button>
        </form>
      ) : null}

      <div className="flex flex-col gap-1">
        {/* One status line for the row the pipeline runs on: who wrote it, when,
            and what for. `created_by` is shown exactly as stored — the writer
            this console stamps on its own rows (`src/account.ts`), and whatever
            the pipeline or a hand at the database wrote on the others. */}
        <Caveat>
          {newest === null
            ? 'boot config — no row yet'
            : `row #${newest.id} · ${formatWhen(newest.created_at)} · ${newest.created_by} · ${
                newest.note === null ? 'no note' : `“${newest.note}”`
              }`}
        </Caveat>
        {start.row === null ? null : (
          <Caveat>
            the form below starts from row #{start.row.id}, not from the newest row — a save is
            still a new row
          </Caveat>
        )}
        {/* Rule 4 of `docs/redesign.md` §4.2, fixed on this screen: the console
            cannot see which vendors this box holds credentials for. */}
        <Caveat>
          every vendor is offered here; the box refuses the ones it holds no keys for, and the
          whole row with them — the pipeline&apos;s <code>/healthz</code> on the box says which
          under <code>vendors</code>, and this container cannot reach it
        </Caveat>
      </div>

      {applied !== null && applied.not_applied > 0 && newest !== null ? (
        <Card tone="warm" title="The latest row is not being applied">
          <Caveat>
            {applied.not_applied} of the {applied.total} calls since row #{newest.id} ran on boot
            config or an older row. The reason is in the pipeline&apos;s log line (
            <code>reason: timeout | query | invalid | provider</code>) and in{' '}
            <code>fonnus_runtime_config_fallbacks_total</code> on <code>/metrics</code> — not in
            this database. A call that was being answered at that moment ran on the row before,
            legitimately, and is counted here all the same.
          </Caveat>
        </Card>
      ) : null}

      {parsedStart.ok ? null : (
        <Card tone="warm" title="The stored document does not pass the copied schema">
          <Caveat>
            Either the row was written by hand with something the schema refuses — in which case
            the pipeline refused it too and those calls ran on boot config — or this console&apos;s
            copy of the schema has gone stale against the pipeline&apos;s
            (<code>src/contract/contract-hash.test.ts</code> settles which). The form below starts
            from boot config rather than from a document nothing can read.
          </Caveat>
          <div className="flex flex-col gap-1">
            {parsedStart.issues.map((issue) => (
              <Caveat key={`${issue.path}:${issue.message}`}>
                {issue.path === '' ? 'the document' : issue.path}: {issue.message}
              </Caveat>
            ))}
          </div>
          <pre className="m-0 overflow-x-auto rounded-md bg-surface-page p-3 font-num text-[length:var(--size-ui)] leading-[1.5] whitespace-pre-wrap">
            {JSON.stringify(start.document, null, 2)}
          </pre>
        </Card>
      )}

      {editorConfigured ? null : (
        <Card tone="warm" title="Editing is not configured">
          <Caveat>
            editing is not configured: <code>EDITOR_DATABASE_URL</code> is unset, so this process
            holds no credential that may insert. The form below is shown read-only.
          </Caveat>
        </Card>
      )}

      {account === undefined ? (
        <Card tone="warm" title="No account on this request">
          <Caveat>
            no account came through the reverse proxy; nothing can be written. Every row this
            console writes is signed with the account Caddy authenticated, and there is no
            placeholder name (ADR 0007). The form below is shown read-only.
          </Caveat>
        </Card>
      ) : null}

      <ConfigurationForm
        tenant={tenant}
        initial={{ step: 'edit', tenant, values, set, failure: null }}
        fields={fields}
        ranOn={ranOnByPath}
        snapshotRecorded={snapshot !== null}
        editable={editable}
        from={effective}
        shippedText={SHIPPED_TEXT}
        disclosure={disclosure}
        disclosureRow={newest?.id ?? null}
      />

      <History rows={rows} tenant={tenant} />
    </>
  );
}
