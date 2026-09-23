/**
 * The two choices the Configuration page makes from its URL before it renders
 * anything (ADR 0006: the URL is the whole input, ADR 0011 decision 8) — which
 * tenant the screen is about, and which document the form opens on.
 *
 * Pure and structurally typed, so the cases that decide a screen (an unknown
 * `?tenant=`, an unknown `?from=`, no row at all) are pinned by a test instead
 * of by opening the page against a database.
 */

import { parseDocument } from './document';

/** Only the fields the choices read; the query rows carry more. */
interface HasId {
  id: string;
}

interface ConfigRow extends HasId {
  config: unknown;
}

/**
 * The tenant the screen edits: the one `?tenant=` names when it is a row of
 * `tenant_config`, otherwise the first row. A value naming no row falls back
 * rather than emptying the screen — a tenant that does not exist is a stale
 * link, not a state worth a page of its own.
 */
export function chooseTenant(tenants: readonly HasId[], requested: string | undefined): string | null {
  if (requested !== undefined && tenants.some((tenant) => tenant.id === requested)) {
    return requested;
  }
  return tenants[0]?.id ?? null;
}

/**
 * The document the form opens on and the row it came from: the `?from=` row's
 * document when that id is in the tenant's history ("load into form"), else the
 * newest row's, else the empty document — which is boot config, and the state
 * of a tenant with no row yet.
 *
 * The `from` row is only ever a row of THIS tenant's history, so a `?from=` of
 * another tenant's row falls back to the newest here.
 *
 * `row` is the row the screen says the form was loaded from, and it is null for
 * the newest one however the form got there: "loaded from row #7, not from the
 * newest row" must not appear when #7 IS the newest row.
 */
export function startDocument(
  rows: readonly ConfigRow[],
  from: string | undefined,
): { document: unknown; row: ConfigRow | null } {
  const newest = rows[0];
  const requested = from === undefined ? undefined : rows.find((row) => row.id === from);
  if (requested !== undefined && requested !== newest) {
    return { document: requested.config, row: requested };
  }
  if (newest !== undefined) return { document: newest.config, row: null };
  return { document: {}, row: null };
}

/**
 * What a review diffs against: the newest row's document as the pipeline parses
 * it — the one the next call runs on — never the row the form was loaded from,
 * so restoring a history row shows what it would change (ADR 0012 D7a). Boot
 * config, `{}`, when there is no row or the newest row is one the copied schema
 * refuses: the pipeline refuses it too and runs on boot config (trap 6).
 */
export function diffBase(rows: readonly ConfigRow[]): Record<string, unknown> {
  const newest = rows[0];
  if (newest === undefined) return {};
  const parsed = parseDocument(newest.config);
  return parsed.ok ? parsed.document : {};
}
