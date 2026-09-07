/**
 * The one door to the environment (CLAUDE.md §Ground rules). Lint forbids
 * `process.env` anywhere else under `src/`.
 *
 * Next.js loads `.env` itself before it imports any route module, so there is no
 * dotenv call here. The read is lazy on purpose: `next build` imports every
 * route module, and a throw at module scope would make the build fail on a
 * machine that has no `.env` — a build needs no database.
 */

export interface Config {
  /** The `console` role's connection string; never the `fonnus` superuser. */
  databaseUrl: string;
}

/**
 * Pure, so a test can hand it any environment. The parameter is `Partial<…>`
 * rather than `NodeJS.ProcessEnv` because Next.js declares `NODE_ENV` as a
 * required member of that type, which no literal test environment carries;
 * `process.env` itself still satisfies it.
 */
export function readConfig(env: Partial<NodeJS.ProcessEnv>): Config {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env (README.md)');
  }
  return { databaseUrl };
}

let cached: Config | undefined;

/** Reads the environment once per process; every caller shares the result. */
export function getConfig(): Config {
  cached ??= readConfig(process.env);
  return cached;
}
