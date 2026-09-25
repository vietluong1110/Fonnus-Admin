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
 * opens the form on a history row, `?group=` the tab, and `?saved=` is the row
 * a save just wrote, confirmed in the head. The history is an overlay opened
 * from the head, so the form is the whole page.
 */

import {
  SHIPPED_TEXT,
  disclosureAdvice,
} from '@/contract/config/runtime-document';
import { formatWhen } from '@/calls';
import { currentAccount } from '@/account';
import { editingConfigured } from '@/db';
import { renderValue } from '@/dashboard';
import {
  fieldsOf,
  flatKeyOf,
  formFromDocument,
  layerOf,
  parseDocument,
  ranOn,
} from '@/configuration/document';
import { groupOf } from '@/configuration/groups';
import { chooseTenant, diffBase, startDocument } from '@/configuration/start';
import { labelVoice, needsReportBefore, offeredOf, staleReport } from '@/boot-report';
import { bootReportBefore, latestBootReport } from '@/queries/boot-report';
import {
  callsSinceRow,
  lastCallSnapshot,
  runtimeConfigRows,
  tenants,
} from '@/queries/runtime-config';
import Badge from '@/ui/badge';
import Button from '@/ui/button';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import Listbox from '@/ui/listbox';
import Overlay from '@/ui/overlay';
import PageHead from '@/ui/page-head';
import ConfigurationForm, { type LastCall } from './configuration-form';
import History from './history';

// The screen is about the database right now, and it writes: nothing here may
// be prerendered or cached.
export const dynamic = 'force-dynamic';

const BASE = '/configuration';
const HISTORY_ID = 'configuration-history';

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

  const [rows, lastCall, account, report] = await Promise.all([
    runtimeConfigRows(tenant),
    lastCallSnapshot(tenant),
    currentAccount(),
    // The tenant's newest boot report, read once: the vendor and voice selects,
    // their "as of boot" lines and the liveness card all come from it; null is
    // the no-report state (ADR 0012 D1).
    latestBootReport(tenant),
  ]);
  const snapshot = lastCall?.snapshot ?? null;
  const editorConfigured = editingConfigured();
  const stale = report === null ? null : staleReport(report, lastCall);
  const offered = offeredOf(report);

  const newest = rows[0] ?? null;
  const applied =
    newest === null ? null : await callsSinceRow(tenant, newest.created_at, newest.id);

  // The document the form opens on: `?from=` names a history row, else the
  // newest row, else boot config.
  const start = startDocument(rows, first(params['from']));
  const parsedStart = parseDocument(start.document);
  // A stored document the copy refuses is never pretended to parse (trap 6):
  // the form starts from boot config and the warning below names both causes.
  // When it parses, the form opens on the PARSED document — the one the
  // process runs (trimmed, ADR 0012 D7) and the one the review and the report
  // checks compare — so a hand-written row's ` linh ` reads as `linh` here too.
  const effective = parsedStart.ok ? asRecord(parsedStart.document) : {};
  const values = formFromDocument(effective);
  // What "pending" is measured against: the newest row, the one the next call
  // runs on — so a row loaded from history is pending wherever it differs.
  const base = diffBase(rows);
  // The row the form was loaded from — `?from=` or the newest — which the head
  // names; the review diffs against the newest row whatever this is (ADR 0012 D7).
  const fromRow = start.row?.id ?? newest?.id ?? null;

  const fields = fieldsOf();
  // What the last answered call actually ran on, per leaf, resolved here so the
  // client component never reaches for a pool or a query (contract §3.4): the
  // value, the snapshot key it was read under (one resolution, ADR 0012 D9), and
  // the layer it came from (D8) — null before any call, which is "not recorded".
  const ranOnByPath: Record<string, LastCall> = {};
  for (const field of fields) {
    if (field.path in ranOnByPath) continue;
    const value = ranOn(snapshot, field);
    ranOnByPath[field.path] = {
      value: value === undefined ? null : renderValue(value),
      key: flatKeyOf(snapshot, field) ?? null,
      layer: snapshot === null ? null : layerOf(snapshot, field.path),
    };
  }

  // The last call's voice id, labelled by the newest boot report booted at or
  // before that call (ADR 0012 D6): the latest report when it already is that
  // row, else one more point read. The id stays the value; the label and, on a
  // build mismatch, its caveat ride beside it.
  const voiceCell = ranOnByPath['tts.voice'];
  const voiceField = fields.find((field) => field.path === 'tts.voice');
  const voiceId = voiceField === undefined ? undefined : ranOn(snapshot, voiceField);
  if (lastCall !== null && snapshot !== null && voiceCell !== undefined && typeof voiceId === 'string') {
    const labelling = needsReportBefore(report, lastCall.started_at)
      ? await bootReportBefore(tenant, lastCall.started_at)
      : report;
    ranOnByPath['tts.voice'] = { ...voiceCell, ...labelVoice(labelling, snapshot, voiceId) };
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
  const readOnly = [
    ...(editorConfigured
      ? []
      : ['EDITOR_DATABASE_URL is unset, so this process holds no credential that may insert.']),
    ...(account === undefined
      ? ['The reverse proxy passed no account, and a row cannot be written unsigned.']
      : []),
  ];
  const tenantRow = tenantRows.find((row) => row.id === tenant);
  const tenantLabel =
    tenantRow?.clinic_name === null || tenantRow?.clinic_name === undefined
      ? tenant
      : `${tenantRow.clinic_name} (${tenant})`;

  const saved = first(params['saved']);
  // No call answered since the newest row was saved: the value column shows
  // that row, the last-call column the row (or boot config) the call before it
  // ran — two different documents with nothing pending, which the head says.
  const lastCallRow = Object.values(ranOnByPath).find((cell) => cell.layer?.kind === 'row')?.layer;
  const notYetRun =
    newest !== null && applied?.total === 0 && snapshot !== null
      ? lastCallRow?.kind === 'row'
        ? `row #${lastCallRow.version}`
        : 'boot config'
      : null;

  return (
    <>
      <PageHead title="Configuration">
        <Caveat as="span">{tenantLabel}</Caveat>
        <Button variant="secondary" popoverTarget={HISTORY_ID} className="ml-auto">
          History
          {rows.length === 0 ? null : (
            <span className="ml-2 font-num tabular-nums text-text-muted">{rows.length}</span>
          )}
        </Button>
      </PageHead>
      <Overlay id={HISTORY_ID} side="right" title={`History — ${String(rows.length)} rows`}>
        <History rows={rows} tenant={tenant} />
      </Overlay>

      {tenantRows.length > 1 ? (
        <form method="get" action={BASE} className="flex flex-wrap items-center gap-2">
          <label htmlFor="tenant-picker" className="text-[length:var(--size-ui)] font-medium">
            tenant
          </label>
          {/* A GET form, so the tenant is in the URL like every other input
              (ADR 0006) and a screen is a pasteable address. */}
          <div className="min-w-[240px]">
            {/* The drawn listbox over a native select (ADR 0014 decisions 3–4):
                with scripts off the select is what renders and submits. */}
            <Listbox
              id="tenant-picker"
              name="tenant"
              defaultValue={tenant}
              options={tenantRows.map((row) => ({
                value: row.id,
                label: row.clinic_name === null ? row.id : `${row.clinic_name} (${row.id})`,
              }))}
            />
          </div>
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
        <p className="mb-0 text-[length:var(--size-ui)]">
          {newest === null ? (
            'No row yet: every call runs on boot config.'
          ) : (
            <>
              {saved === newest.id ? (
                // The redirect after a save lands here: the new row is current.
                <>
                  <Badge tone="success">saved</Badge>{' '}
                </>
              ) : null}
              Current row <span className="font-num tabular-nums font-medium">#{newest.id}</span>
              <span className="text-text-muted">
                {' '}
                · {formatWhen(newest.created_at)} · {newest.created_by}
                {newest.note === null ? null : <> · “{newest.note}”</>}
              </span>
            </>
          )}
        </p>
        {offered === null ? (
          // Rule 4 of `docs/redesign.md` §4.2 without a boot report (ADR 0012
          // D1): nothing to narrow the vendors by, so the former fixed caveat.
          <Caveat>
            every vendor is offered; the box refuses a row naming one it holds no keys for — its{' '}
            <code>/healthz</code> lists them under <code>vendors</code>
          </Caveat>
        ) : null}
        {notYetRun === null || newest === null ? null : (
          <Caveat>
            no call has been answered since row #{newest.id} was saved, so “last call” still shows{' '}
            {notYetRun} until the next one; a pending mark is only an unsaved edit in this form
          </Caveat>
        )}
        {fromRow === null || fromRow === newest?.id ? null : (
          <Caveat>
            the form below is loaded from row #{fromRow}; saving still writes a new row
          </Caveat>
        )}
      </div>

      {applied !== null && applied.not_applied > 0 && newest !== null ? (
        <Card tone="warm" title="The latest row is not being applied">
          {/* The reason is never in this database (ADR 0011 decision 7), so the
              card points at where it is rather than guessing one. */}
          <Caveat>
            {applied.not_applied} of the {applied.total} calls since row #{newest.id} ran on boot
            config or an older row. The reason is in the pipeline&apos;s log line (
            <code>reason: timeout | query | invalid | provider</code>) and in{' '}
            <code>fonnus_runtime_config_fallbacks_total</code> on <code>/metrics</code>. A call
            already being answered when the row landed ran on the row before, and counts here too.
          </Caveat>
        </Card>
      ) : null}

      {stale === null ? null : (
        // The liveness trap of contract §2, shown only when both halves of the
        // contract's own check hold (ADR 0012 D5).
        <Card tone="warm" title="The boot report may not describe the running process">
          <Caveat>{stale}</Caveat>
        </Card>
      )}

      {parsedStart.ok ? null : (
        <Card tone="warm" title="The stored document does not pass the copied schema">
          <Caveat>
            The form starts from boot config instead. Either the row was written by hand with
            something the schema refuses, and the pipeline refused it too, or this console&apos;s
            copy of the schema is stale (<code>src/contract/contract-hash.test.ts</code> settles
            which).
          </Caveat>
          <div className="flex flex-col gap-1">
            {parsedStart.issues.map((issue) => (
              <Caveat key={`${issue.path}:${issue.message}`}>
                {issue.path === '' ? 'the document' : issue.path}: {issue.message}
              </Caveat>
            ))}
          </div>
          <details className="text-[length:var(--size-ui)]">
            <summary className="cursor-pointer text-text-link">the stored document</summary>
            <pre className="mt-2 mb-0 overflow-x-auto rounded-md bg-surface-page p-3 font-num text-[length:var(--size-ui)] leading-[1.5] whitespace-pre-wrap">
              {JSON.stringify(start.document, null, 2)}
            </pre>
          </details>
        </Card>
      )}

      {readOnly.length === 0 ? null : (
        // ADR 0007: every row is signed with the account Caddy authenticated,
        // by a credential that may insert — with either missing, nothing is.
        <Card tone="warm" title="Read-only">
          {readOnly.map((reason) => (
            <Caveat key={reason}>{reason}</Caveat>
          ))}
        </Card>
      )}

      <ConfigurationForm
        // A soft navigation to this page — the redirect after a save, a history
        // row's "load into form" — keeps a client component's state; the key
        // makes a new row or a new `?from=` a fresh form, not the old review.
        key={`${tenant}:${newest?.id ?? ''}:${fromRow ?? ''}`}
        tenant={tenant}
        initial={{ step: 'edit', tenant, group: groupOf(first(params['group'])), values, failure: null }}
        base={formFromDocument(base)}
        fields={fields}
        ranOn={ranOnByPath}
        snapshotRecorded={snapshot !== null}
        offered={offered}
        editable={editable}
        from={base}
        fromRow={fromRow}
        shippedText={SHIPPED_TEXT}
        disclosure={disclosure}
        disclosureRow={newest?.id ?? null}
      />
    </>
  );
}
