/**
 * The smoke check: is the database reachable, and are we the `console` role?
 * `select current_user` is both the "is the connection alive" probe and the role
 * report in one statement; it touches no table, so it needs nothing from the
 * read contract.
 */
import { getPool } from '@/db';
import { healthBody } from '@/health';

// Never cached or prerendered: the answer is about this process, right now.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const { rows } = await getPool().query<{ role: string }>('select current_user as role');
    const role = rows[0]?.role;
    const { status, body } =
      role === undefined
        ? healthBody({ error: 'select current_user returned no row' })
        : healthBody({ role });
    return Response.json(body, { status });
  } catch (err) {
    // Missing config, refused connection, timeout — all one answer to the caller.
    const { status, body } = healthBody({
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(body, { status });
  }
}
