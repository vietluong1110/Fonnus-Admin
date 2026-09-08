/**
 * The one door to the environment (CLAUDE.md §Ground rules). Lint forbids
 * `process.env` anywhere else under `src/`.
 *
 * Next.js loads `.env` itself before it imports any route module, so there is no
 * dotenv call here. The read is lazy on purpose: `next build` imports every
 * route module, and a throw at module scope would make the build fail on a
 * machine that has no `.env` — a build needs no database.
 */

/** The artifact bucket's five keys, read as one group (ADR 0004). */
export interface ArtifactStore {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** ADR 0005 — the internal test phase's deployment switch, `on` or `off`. */
export type ConsentGate = 'on' | 'off';

export interface Config {
  /** The `console` role's connection string; never the `fonnus` superuser. */
  databaseUrl: string;
  /** All five S3_* keys or none (ADR 0004); undefined = recording access not configured. */
  artifactStore?: ArtifactStore;
  /** ADR 0005; unset = 'on'. */
  consentGate: ConsentGate;
}

/**
 * A value that is only whitespace counts as unset — the same reading
 * `DATABASE_URL` has always had, and the reading an uncommented but empty line
 * in `.env.example` deserves.
 */
function read(env: Partial<NodeJS.ProcessEnv>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/**
 * The five keys in the order `.env.example` lists them, each with the field it
 * fills. One group, because "configured or not" is the only question a screen
 * asks of the bucket (ADR 0004).
 */
const ARTIFACT_STORE_KEYS = [
  ['S3_ENDPOINT', 'endpoint'],
  ['S3_REGION', 'region'],
  ['S3_BUCKET', 'bucket'],
  ['S3_ACCESS_KEY_ID', 'accessKeyId'],
  ['S3_SECRET_ACCESS_KEY', 'secretAccessKey'],
] as const satisfies readonly (readonly [string, keyof ArtifactStore])[];

/**
 * All five set → the store; none set → undefined, which every recording surface
 * renders as "recording access not configured"; some but not all → a throw
 * naming what is missing. A half-configured group is a typo, and a typo must
 * fail at start rather than degrade into "not configured" (ADR 0004).
 */
function readArtifactStore(env: Partial<NodeJS.ProcessEnv>): ArtifactStore | undefined {
  const found = ARTIFACT_STORE_KEYS.map(([key, field]) => [key, field, read(env, key)] as const);
  const missing = found.filter(([, , value]) => value === undefined).map(([key]) => key);
  if (missing.length === ARTIFACT_STORE_KEYS.length) return undefined;
  if (missing.length > 0) {
    throw new Error(
      `The S3_* group is half-configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'Set all five keys or none (see .env.example).',
    );
  }
  const store = {} as ArtifactStore;
  for (const [, field, value] of found) store[field] = value as string;
  return store;
}

const CONSENT_GATES: readonly ConsentGate[] = ['on', 'off'];

/**
 * Unset is the closed gate; a garbled value is loud. This is the one place
 * where "fail open" and "fail closed" differ in kind, so neither is guessed
 * from a value the ADR does not name (ADR 0005).
 */
export function readConsentGate(env: Partial<NodeJS.ProcessEnv>): ConsentGate {
  const value = read(env, 'CONSENT_GATE');
  if (value === undefined) return 'on';
  if (!(CONSENT_GATES as readonly string[]).includes(value)) {
    throw new Error(
      `CONSENT_GATE is "${value}" — the accepted values are exactly "on" and "off" (ADR 0005).`,
    );
  }
  return value as ConsentGate;
}

/**
 * Pure, so a test can hand it any environment. The parameter is `Partial<…>`
 * rather than `NodeJS.ProcessEnv` because Next.js declares `NODE_ENV` as a
 * required member of that type, which no literal test environment carries;
 * `process.env` itself still satisfies it.
 */
export function readConfig(env: Partial<NodeJS.ProcessEnv>): Config {
  const databaseUrl = read(env, 'DATABASE_URL');
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env (README.md)');
  }
  const artifactStore = readArtifactStore(env);
  const config: Config = { databaseUrl, consentGate: readConsentGate(env) };
  // Left off the object entirely when unconfigured, so `'artifactStore' in
  // config` and a `toEqual({…})` in a test read the same as its absence.
  return artifactStore === undefined ? config : { ...config, artifactStore };
}

let cached: Config | undefined;

/** Reads the environment once per process; every caller shares the result. */
export function getConfig(): Config {
  cached ??= readConfig(process.env);
  return cached;
}

let cachedGate: ConsentGate | undefined;

/**
 * The gate alone, independent of `DATABASE_URL` — the one piece of configuration
 * the root layout needs (ADR 0005: while the gate is off every screen says so,
 * so the line is rendered by the shell rather than by each page).
 *
 * `getConfig()` cannot serve it: it throws without `DATABASE_URL`, and
 * `next build` renders the root layout for the static routes it prerenders
 * (`/_not-found`) on a machine that has no `.env` at all. A build needs no
 * database, and it must not need one to know whether a caveat line renders.
 */
export function getConsentGate(): ConsentGate {
  cachedGate ??= readConsentGate(process.env);
  return cachedGate;
}
