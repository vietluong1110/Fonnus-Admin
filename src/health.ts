/**
 * The health probe's answer, as a pure function so it can be tested without
 * Next.js and without a database.
 */

/** The only role this app reads as (../Fonnus ADR 0017, migration 0006). */
export const EXPECTED_ROLE = 'console';

/** The only role this app writes as (read contract §2, ADR 0007). */
export const EXPECTED_EDITOR_ROLE = 'console_editor';

export interface HealthAnswer {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Three outcomes:
 * - connected as the expected role — healthy;
 * - connected as anything else — degraded, and the role is named. The ground
 *   rule "never the `fonnus` superuser" gets an enforcer that actually runs;
 * - no config, no connection, or a failed query — error, with the message.
 *
 * `status` is written last in every body so no detail can overwrite it (the
 * same discipline as ../Fonnus/app/src/http/server.ts).
 *
 * The expected role is a parameter because the probe answers for two
 * credentials (ADR 0007): the reader's, whose answer is the HTTP status, and
 * the editor's, which is reported inside the body and never changes it.
 */
export function healthBody(
  input: { role: string } | { error: string },
  expected: string = EXPECTED_ROLE,
): HealthAnswer {
  if ('error' in input) {
    return { status: 503, body: { error: input.error, status: 'error' } };
  }
  if (input.role !== expected) {
    return { status: 503, body: { role: input.role, status: 'degraded' } };
  }
  return { status: 200, body: { role: input.role, status: 'ok' } };
}
