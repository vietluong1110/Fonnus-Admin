'use server';

/**
 * The Configuration screen's one server action (ADR 0011 decision 5): a thin
 * dispatcher on a hidden `intent` field over the pure functions of
 * `src/configuration/document.ts`, and the only file on this screen that
 * touches `FormData`.
 *
 * A save is two steps of one submission, not two forms — `review` builds what
 * the operator reads, `save` writes it — so both feed the single
 * `useActionState` of `configuration-form.tsx`.
 *
 * Both `review` and `save` read the tenant's newest `boot_report` row afresh and
 * hold the document to it (ADR 0012 D3): a provider or voice this box does not
 * offer is an issue, and an issue blocks the save exactly as the schema's do. A
 * reboot between the two steps is caught by the save, and a hand-made `save`
 * POST is held to the same rule as the form.
 *
 * The trust boundary is the second parse. The proposed document travels back to
 * the browser in a hidden field between the two steps, so what arrives at
 * `save` is client-held text: it is parsed against the copied schema again here
 * before it reaches the insert, and a document that fails never gets there.
 *
 * The diff's starting point is never client-held: both steps read the tenant's
 * newest row themselves. The review hands its id to the form (`base`), and the
 * save inserts only while that row is still the newest (`insertRuntimeConfig`),
 * so a save made from a review another operator's save has overtaken is
 * refused and shown against the new row instead of silently undoing it.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NoAccountError, requireAccount, type Account } from '@/account';
import { offeredIssues, type BootReport } from '@/boot-report';
import {
  adviceFor,
  diffDocuments,
  documentFromForm,
  leafPaths,
  NOTE_MAX_CHARS,
  parseDocument,
  type DiffEntry,
  type DocumentIssue,
} from '@/configuration/document';
import { groupOf, type Group } from '@/configuration/groups';
import { latestBootReport } from '@/queries/boot-report';
import { newestRuntimeConfig } from '@/queries/runtime-config';
import { insertRuntimeConfig } from '@/writes/runtime-config';

/**
 * The whole state of the screen's form, in both of its steps. `values` travels
 * through every step, because "Edit" must give the operator back the form
 * exactly as they left it — including a leaf whose value the schema refused. A
 * blank value is a leaf left out (`isSetText`). `group` is the tab the form was
 * on, so "Edit" and the page after a save open on it again.
 */
export type FormState =
  | {
      step: 'edit';
      tenant: string;
      group: Group;
      values: Record<string, string>;
      failure: string | null;
    }
  | {
      step: 'review';
      tenant: string;
      group: Group;
      values: Record<string, string>;
      /**
       * The proposed document as the save would insert it: the parsed copy when
       * it parses (trimmed, as the schema leaves it), the one the form built —
       * with its issues — when it does not (ADR 0012 D7b).
       */
      document: Record<string, unknown>;
      /**
       * The id of the tenant's newest row the diff was taken against, null when
       * the tenant has none; the save writes only while it is still the newest.
       */
      base: string | null;
      issues: DocumentIssue[];
      diff: DiffEntry[];
      advice: string[];
      note: string;
      failure: string | null;
    };

const INTENTS = ['review', 'edit', 'save'] as const;
type Intent = (typeof INTENTS)[number];

const NO_ACCOUNT = 'no account came through the reverse proxy; nothing was written';
const STALE_DOCUMENT =
  'the proposed document no longer passes the copied schema; nothing was written — review the form again';
const NOT_OFFERED =
  'the proposed document names a vendor or voice this box does not offer as of its latest boot report; nothing was written — review the form again';
const MALFORMED =
  'the form did not arrive as this screen sends it; nothing was written — reload the page and try again';

const NOTE_TOO_LONG = `the note is longer than ${String(NOTE_MAX_CHARS)} characters; nothing was written — shorten it and save again`;

/** Every string-valued entry; a file entry cannot occur on this form. */
function stringEntries(formData: FormData): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') entries.push([key, value]);
  }
  return entries;
}

/**
 * The form as submitted, restricted to the leaves the schema names. Anything
 * else on the form (`intent`, `tenant`, `group`, `base`, `note`, `document`) is
 * the action's own plumbing, never part of the document.
 */
function submitted(entries: readonly [string, string][]): Record<string, string> {
  const known = new Set(leafPaths());
  const values: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (known.has(key)) values[key] = value;
  }
  return values;
}

/**
 * A JSON object carried in a hidden field, or null when the field is absent or
 * is anything but a JSON object. The distinction matters where the value
 * reaches the insert: a request with no `document` at all must not be read as
 * the empty document, which is a legal row meaning "back to boot config" —
 * that row would be one the operator never reviewed.
 */
function readObject(formData: FormData, name: string): Record<string, unknown> | null {
  const raw = formData.get(name);
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readText(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === 'string' ? raw : '';
}

/** A stored document as a diff reads it: anything but a JSON object is the empty one. */
function asDocument(config: unknown): Record<string, unknown> {
  return typeof config === 'object' && config !== null && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

/**
 * What the review step shows: the document, its verdict, the diff against the
 * newest row of the tenant (`newest`, read afresh by the caller — ADR 0012
 * D7a), and the advice. The issues are the schema's, then what the boot report refuses
 * (`offeredIssues`, D3) — both block the save. Issues and advice are
 * separate on purpose — an issue blocks the save, advice never does (ADR 0011
 * decision 5, rule 6 of `docs/redesign.md` §4.2).
 */
function reviewState(input: {
  tenant: string;
  group: Group;
  values: Record<string, string>;
  newest: { id: string; config: unknown } | null;
  document: Record<string, unknown>;
  note: string;
  failure: string | null;
  report: BootReport | null;
}): FormState {
  const from = asDocument(input.newest?.config);
  const parsed = parseDocument(input.document);
  // What the review renders, diffs and carries back in the hidden `document` is
  // what `save` would insert, so the row is byte for byte the one reviewed and
  // the save's second parse is idempotent (ADR 0012 D7b).
  const document = parsed.ok ? parsed.document : input.document;
  return {
    step: 'review',
    tenant: input.tenant,
    group: input.group,
    values: input.values,
    document,
    base: input.newest?.id ?? null,
    issues: [...(parsed.ok ? [] : parsed.issues), ...offeredIssues(document, input.report)],
    diff: diffDocuments(from, document),
    advice: parsed.ok ? adviceFor(from, parsed.document) : [],
    note: input.note,
    failure: input.failure,
  };
}

export async function submitConfiguration(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const entries = stringEntries(formData);
  const values = submitted(entries);
  const tenant = readText(formData, 'tenant');
  const intent = readText(formData, 'intent');
  // Which tab the form was on: navigation only, so anything unknown is the first.
  const group = groupOf(readText(formData, 'group'));

  // Neither can come from an operator's typing: both are hidden fields this
  // screen writes. A missing one is a mangled request, answered with the form
  // and a sentence rather than with a thrown error page.
  if (tenant === '' || !INTENTS.includes(intent as Intent)) {
    return { step: 'edit', tenant, group, values, failure: MALFORMED };
  }

  const note = readText(formData, 'note');

  if (intent === 'edit') {
    return { step: 'edit', tenant, group, values, failure: null };
  }

  if (intent === 'review') {
    const [report, newest] = await Promise.all([latestBootReport(tenant), newestRuntimeConfig(tenant)]);
    return reviewState({
      report,
      tenant,
      group,
      values,
      newest,
      document: documentFromForm(entries),
      note,
      failure: null,
    });
  }

  // `save`. The document the operator reviewed comes back in a hidden field;
  // if it is absent or is not a JSON object, this is not a submission this
  // screen sent, and there is nothing that was reviewed to write. `'{}'` is a
  // legal document ("back to boot config") and goes on. `base` is the row the
  // review was taken against; `''` is "the tenant had no row", absent is a
  // request this screen did not send.
  const document = readObject(formData, 'document');
  const rawBase = formData.get('base');
  if (document === null || typeof rawBase !== 'string') {
    return { step: 'edit', tenant, group, values, failure: MALFORMED };
  }
  const base = rawBase === '' ? null : rawBase;

  // The account first: without it nothing is written, whatever the document
  // says. The rows below are still read when it is absent, only to show the
  // review again beside the refusal.
  let account: Account | null;
  try {
    account = await requireAccount();
  } catch (err) {
    // Only the absent account is a refusal to render; anything else thrown here
    // is a genuine failure and belongs on `error.tsx`.
    if (!(err instanceof NoAccountError)) throw err;
    account = null;
  }

  // Read afresh, never carried from the review: the box may have rebooted
  // between the two steps (ADR 0012 D3), and another row may have landed.
  const [report, newest] = await Promise.all([latestBootReport(tenant), newestRuntimeConfig(tenant)]);
  const refuse = (failure: string): FormState =>
    reviewState({ tenant, group, values, newest, document, note, failure, report });

  if (account === null) return refuse(NO_ACCOUNT);
  if (note.length > NOTE_MAX_CHARS) return refuse(NOTE_TOO_LONG);

  const parsed = parseDocument(document);
  if (!parsed.ok) return refuse(STALE_DOCUMENT);
  if (offeredIssues(parsed.document, report).length > 0) return refuse(NOT_OFFERED);

  const result = await insertRuntimeConfig({
    tenantId: tenant,
    // The parsed document, not the hidden text: what the schema accepted is
    // what the row carries.
    config: parsed.document,
    note: note === '' ? null : note,
    base,
    by: account,
  });
  if (!result.ok) {
    // Re-read, so a refusal because another row landed shows the diff against
    // that row and carries its id as the next save's base.
    return reviewState({
      tenant,
      group,
      values,
      newest: await newestRuntimeConfig(tenant),
      document,
      note,
      failure: result.reason,
      report,
    });
  }

  revalidatePath('/configuration');
  // Outside every `try`: `redirect` works by throwing, and a catch would turn
  // a successful save into a failure message (Next.js 16 redirecting guide).
  // `saved` is what lets the page confirm the new row, on the tab it left.
  const search = new URLSearchParams({ tenant, group, saved: result.id });
  redirect(`/configuration?${search.toString()}`);
}
