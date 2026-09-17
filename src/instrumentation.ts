/**
 * Next.js's server-start hook. It reads the configuration and does nothing
 * else, so a `.env` the console cannot run under — no `DATABASE_URL`, a
 * half-configured `S3_*` group (ADR 0004), a `CONSENT_GATE` that is neither
 * `on` nor `off` (ADR 0005) — stops the server from starting instead of
 * surfacing at the first page render, where each section's `error.tsx` would
 * report it as "the database could not be read".
 *
 * Next.js runs `register()` once per server instance, in `next dev` and
 * `next start` alike, before the first request is served, and prefixes a throw
 * here with "An error occurred while loading instrumentation hook"
 * (`next/dist/server/lib/router-utils/instrumentation-globals.external.js`). It
 * is skipped entirely during `next build` (the same file returns early on
 * `NEXT_PHASE === 'phase-production-build'`), so the Docker build, which has no
 * `.env` at all, is unaffected — a build needs no database (`src/config.ts`).
 */
import { getConfig } from './config';

export function register(): void {
  getConfig();
}
