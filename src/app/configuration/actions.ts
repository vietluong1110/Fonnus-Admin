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
 * The trust boundary is the second parse. The proposed document travels back to
 * the browser in a hidden field between the two steps, so what arrives at
 * `save` is client-held text: it is parsed against the copied schema again here
 * before it reaches the insert, and a document that fails never gets there.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NoAccountError, requireAccount, type Account } from '@/account';
import {
  adviceFor,
  diffDocuments,
  documentFromForm,
  leafPaths,
  parseDocument,
  type DiffEntry,
  type DocumentIssue,
} from '@/configuration/document';
import { insertRuntimeConfig } from '@/writes/runtime-config';

/**
 * The whole state of the screen's form, in both of its steps. `values` and
 * `set` travel through every step, because "Edit" must give the operator back
 * the form exactly as they left it — including a leaf whose value the schema
 * refused.
 */
export type FormState =
  | {
      step: 'edit';
      tenant: string;
      values: Record<string, string>;
      set: string[];
      failure: string | null;
    }
  | {
      step: 'review';
      tenant: string;
      values: Record<string, string>;
      set: string[];
      /** The proposed document, as the form built it — never the parsed copy. */
      document: Record<string, unknown>;
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
const MALFORMED =
  'the form did not arrive as this screen sends it; nothing was written — reload the page and try again';

/** Every string-valued entry; a file entry cannot occur on this form. */
function stringEntries(formData: FormData): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') entries.push([key, value]);
  }
  return entries;
}

/**
 * The form as submitted, restricted to the leaves the schema names: the control
 * values and the paths whose `set:` box was ticked. Anything else on the form
 * (`intent`, `tenant`, `from`, `note`, `document`) is the action's own
 * plumbing, never part of the document.
 */
function submitted(entries: readonly [string, string][]): {
  values: Record<string, string>;
  set: string[];
} {
  const known = new Set(leafPaths());
  const values: Record<string, string> = {};
  const set: string[] = [];
  for (const [key, value] of entries) {
    if (key.startsWith('set:')) {
      const path = key.slice('set:'.length);
      if (known.has(path)) set.push(path);
    } else if (known.has(key)) {
      values[key] = value;
    }
  }
  return { values, set };
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

/**
 * What the review step shows: the document, its verdict, the diff against the
 * document the form started from, and the advice. Issues and advice are
 * separate on purpose — an issue blocks the save, advice never does (ADR 0011
 * decision 5, rule 6 of `docs/redesign.md` §4.2).
 */
function reviewState(input: {
  tenant: string;
  values: Record<string, string>;
  set: string[];
  from: Record<string, unknown>;
  document: Record<string, unknown>;
  note: string;
  failure: string | null;
}): FormState {
  const parsed = parseDocument(input.document);
  return {
    step: 'review',
    tenant: input.tenant,
    values: input.values,
    set: input.set,
    document: input.document,
    issues: parsed.ok ? [] : parsed.issues,
    diff: diffDocuments(input.from, input.document),
    advice: parsed.ok ? adviceFor(input.from, parsed.document) : [],
    note: input.note,
    failure: input.failure,
  };
}

export async function submitConfiguration(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const entries = stringEntries(formData);
  const { values, set } = submitted(entries);
  const tenant = readText(formData, 'tenant');
  const intent = readText(formData, 'intent');

  // Neither can come from an operator's typing: both are hidden fields this
  // screen writes. A missing one is a mangled request, answered with the form
  // and a sentence rather than with a thrown error page.
  if (tenant === '' || !INTENTS.includes(intent as Intent)) {
    return { step: 'edit', tenant, values, set, failure: MALFORMED };
  }

  // The diff's starting point only: it is compared against, never written, so
  // a mangled `from` falls back to the empty document rather than refusing the
  // whole submission.
  const from = readObject(formData, 'from') ?? {};
  const note = readText(formData, 'note');

  if (intent === 'edit') {
    return { step: 'edit', tenant, values, set, failure: null };
  }

  if (intent === 'review') {
    return reviewState({
      tenant,
      values,
      set,
      from,
      document: documentFromForm(entries),
      note,
      failure: null,
    });
  }

  // `save`. The document the operator reviewed comes back in a hidden field;
  // if it is absent or is not a JSON object, this is not a submission this
  // screen sent, and there is nothing that was reviewed to write. `'{}'` is a
  // legal document ("back to boot config") and goes on.
  const document = readObject(formData, 'document');
  if (document === null) {
    return { step: 'edit', tenant, values, set, failure: MALFORMED };
  }

  // The account next: without it nothing is written and nothing else about the
  // request matters.
  let account: Account;
  try {
    account = await requireAccount();
  } catch (err) {
    // Only the absent account is a refusal to render; anything else thrown here
    // is a genuine failure and belongs on `error.tsx`.
    if (!(err instanceof NoAccountError)) throw err;
    return reviewState({
      tenant,
      values,
      set,
      from,
      document,
      note,
      failure: NO_ACCOUNT,
    });
  }

  const parsed = parseDocument(document);
  if (!parsed.ok) {
    return reviewState({ tenant, values, set, from, document, note, failure: STALE_DOCUMENT });
  }

  const result = await insertRuntimeConfig({
    tenantId: tenant,
    // The parsed document, not the hidden text: what the schema accepted is
    // what the row carries.
    config: parsed.document,
    note: note === '' ? null : note,
    by: account,
  });
  if (!result.ok) {
    return reviewState({ tenant, values, set, from, document, note, failure: result.reason });
  }

  revalidatePath('/configuration');
  // Outside every `try`: `redirect` works by throwing, and a catch would turn
  // a successful save into a failure message (Next.js 16 redirecting guide).
  redirect(`/configuration?tenant=${encodeURIComponent(tenant)}#row-${result.id}`);
}
