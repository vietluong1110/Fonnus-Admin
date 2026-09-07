/**
 * The health probe's answer, as a pure function so it can be tested without
 * Next.js and without a database.
 */

/** The only role this app may connect as (../Fonnus ADR 0017, migration 0006). */
export const EXPECTED_ROLE = 'console';

export interface HealthAnswer {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Three outcomes:
 * - connected as `console` — healthy;
 * - connected as anything else — degraded, and the role is named. The ground
 *   rule "never the `fonnus` superuser" gets an enforcer that actually runs;
 * - no config, no connection, or a failed query — error, with the message.
 *
 * `status` is written last in every body so no detail can overwrite it (the
 * same discipline as ../Fonnus/app/src/http/server.ts).
 */
export function healthBody(input: { role: string } | { error: string }): HealthAnswer {
  if ('error' in input) {
    return { status: 503, body: { error: input.error, status: 'error' } };
  }
  if (input.role !== EXPECTED_ROLE) {
    return { status: 503, body: { role: input.role, status: 'degraded' } };
  }
  return { status: 200, body: { role: input.role, status: 'ok' } };
}
