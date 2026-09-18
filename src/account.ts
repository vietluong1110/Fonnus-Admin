/*
 * The account behind a request, read in exactly one place — the way
 * `src/calls.ts` is the one consent gate (ADR 0007 decision 4).
 *
 * Caddy authenticates the request with `basic_auth` and forwards the name it
 * vouched for as `X-Console-Account`, replacing whatever the client sent, and
 * drops `Authorization` so this process never sees the password
 * (`caddy/Caddyfile`). Nothing on the read side is gated by the header: the
 * compose healthcheck, `pnpm dev` on a laptop and the tunnel all arrive without
 * Caddy and render every screen they render today. Writes are the ones that
 * need it, through `requireAccount()`.
 */
import { headers } from 'next/headers';

/** The header Caddy sets; the literal is written nowhere else under `src/`. */
export const ACCOUNT_HEADER = 'x-console-account';

/**
 * Branded, so a write function's `by: Account` cannot be satisfied by a literal,
 * a placeholder or a form field — only by a value this file minted from a real
 * request. `created_by` is an append-only audit trail and a false name in it
 * cannot be corrected.
 */
export type Account = string & { readonly __brand: 'Account' };

/**
 * Pure, so a test can hand it any headers. The value is a line of `caddy/users`,
 * which `ops/deploy.sh` already holds to "no whitespace", and `created_by` is
 * opaque text to the contract — so the only shape rules are those two.
 */
export function readAccount(headers: { get(name: string): string | null }): Account | undefined {
  const value = headers.get(ACCOUNT_HEADER)?.trim();
  if (value === undefined || value === '' || /\s/.test(value)) return undefined;
  return value as Account;
}

/**
 * Usable in Server Components, Server Actions and Route Handlers. `headers()` is
 * asynchronous in Next.js 16.
 */
export async function currentAccount(): Promise<Account | undefined> {
  return readAccount(await headers());
}

/**
 * Thrown rather than rendered as a placeholder: a write surface shows this as a
 * refusal, never as an account named "unknown".
 */
export class NoAccountError extends Error {
  constructor() {
    super(
      'no account on this request — writes are accepted only through the reverse proxy (ADR 0007)',
    );
    this.name = 'NoAccountError';
  }
}

/** The write path's gate; every write surface calls it before it touches the editor pool. */
export async function requireAccount(): Promise<Account> {
  const account = await currentAccount();
  if (account === undefined) throw new NoAccountError();
  return account;
}

/** The `created_by` form of read contract §7, written once. */
export function createdBy(account: Account): string {
  return `console:${account}`;
}
