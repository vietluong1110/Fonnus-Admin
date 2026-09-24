/**
 * The one door to the environment (CLAUDE.md §Ground rules). Lint forbids
 * `process.env` anywhere else under `src/`.
 *
 * Next.js loads `.env` itself before it imports any route module, so there is no
 * dotenv call here. The read is lazy on purpose: `next build` imports every
 * route module, and a throw at module scope would make the build fail on a
 * machine that has no `.env` — a build needs no database.
 *
 * Lazy is not "at the first request", though: `src/instrumentation.ts` calls
 * `getConfig()` from Next.js's `register()` hook, which runs once before the
 * server takes its first request and is skipped during `next build`. So a
 * garbled `.env` — a half-configured `S3_*` group, a `CONSENT_GATE` that is
 * neither `on` nor `off` — fails the server start with the message below,
 * instead of surfacing inside a page render as "the database could not be read".
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
  /** ADR 0007 — the `console_editor` role; undefined = editing not configured. */
  editorDatabaseUrl?: string;
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
 * fail at start rather than degrade into "not configured" (ADR 0004) — the
 * start is `src/instrumentation.ts`.
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

/** The role the second connection string must name (`../Fonnus/docs/read-contract.md` §2). */
const EDITOR_ROLE = 'console_editor';

/**
 * Optional, and strict when set (ADR 0007): unset, every screen reads as before
 * and every write surface says "editing not configured"; set, the value must
 * parse as a URL whose username is the editor role. A wrong credential would
 * otherwise first surface as a Postgres `42501` on the first save, weeks later
 * — the same reasoning as the half-configured S3_* group above.
 */
function readEditorDatabaseUrl(env: Partial<NodeJS.ProcessEnv>): string | undefined {
  const value = read(env, 'EDITOR_DATABASE_URL');
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'EDITOR_DATABASE_URL is not a URL — it is the `console_editor` role\'s connection ' +
        'string, in the same form as DATABASE_URL (see .env.example).',
    );
  }
  // The role pg will actually log in as: pg-connection-string lets a `?user=`
  // query parameter win over the URL's username, so reading the username alone
  // would pass `console_editor:x@…?user=fonnus`.
  const role = url.searchParams.get('user') || decodeURIComponent(url.username);
  if (role !== EDITOR_ROLE) {
    throw new Error(
      `EDITOR_DATABASE_URL must connect as role ${EDITOR_ROLE} — it names "${role}" (read contract §2)`,
    );
  }
  return value;
}

const CONSENT_GATES: readonly ConsentGate[] = ['on', 'off'];

/**
 * Unset is the closed gate; a garbled value is loud, at server start rather
 * than at a page render (`src/instrumentation.ts`). This is the one place where
 * "fail open" and "fail closed" differ in kind, so neither is guessed from a
 * value the ADR does not name (ADR 0005).
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
  const editorDatabaseUrl = readEditorDatabaseUrl(env);
  let config: Config = { databaseUrl, consentGate: readConsentGate(env) };
  // Each optional group is left off the object entirely when unconfigured, so
  // `'artifactStore' in config` and a `toEqual({…})` in a test read the same as
  // its absence.
  if (artifactStore !== undefined) config = { ...config, artifactStore };
  if (editorDatabaseUrl !== undefined) config = { ...config, editorDatabaseUrl };
  return config;
}

let cached: Config | undefined;

/**
 * Reads the environment once per process; every caller shares the result — the
 * root layout's consent gate included, now that no route is prerendered and
 * every render of the shell happens on a box that has its `.env`
 * (`src/app/not-found.tsx`).
 */
export function getConfig(): Config {
  cached ??= readConfig(process.env);
  return cached;
}
