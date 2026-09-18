/**
 * The one module that knows the artifact bucket (ADR 0004). Wave 1 of row A5
 * adds `recordingAccess` and `presignCallWav` here; this is the part every
 * recording surface shares: whether a call's files are in the bucket at all.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { showCallerData } from './calls';
import { getConfig, type Config } from './config';

/**
 * The archived predicate, copied from the pipeline's own `fetchableCallsSince`
 * (`../Fonnus/app/src/persistence/call-queries.ts:180-203`), never re-derived:
 *   artifact_state = 'archived' OR (artifact_state = 'expired' AND artifact_key_prefix IS NOT NULL)
 * `spooled`, `failed`, NULL (a row before migration 0010) and any value outside
 * the contract's vocabulary (§6) are "not in the bucket". This is the only place
 * under `src/` that compares `artifact_state` to a literal.
 */
export function isFetchable(state: string | null, prefix: string | null): boolean {
  return state === 'archived' || (state === 'expired' && prefix !== null);
}

/**
 * Contract §6 — `call_log.artifact_state`. The vocabulary lives here, beside
 * `isFetchable`, because this file is the one place that may name an
 * `artifact_state` value; the technical section renders the column through
 * `Vocabulary` so a value the contract does not name is flagged rather than
 * read as normal (contract §4). NULL is a row written before the pipeline's
 * migration 0010 and is not a vocabulary value at all.
 */
export const ARTIFACT_STATES = ['spooled', 'archived', 'expired', 'failed'] as const;

export function isKnownArtifactState(value: string): boolean {
  return (ARTIFACT_STATES as readonly string[]).includes(value);
}

/** Contract §6: the call's recording sits at `${artifact_key_prefix}/call.wav`. */
export function callWavKey(prefix: string): string {
  return `${prefix}/call.wav`;
}

/**
 * The five states every recording surface renders — the list's signal, the
 * detail page's player, the `/calls/[id]/recording` route (ADR 0004). One
 * predicate for three screens, so none of them can drift from the others.
 */
export type RecordingAccess = 'not_configured' | 'not_archived' | 'gone' | 'withheld' | 'playable';

/**
 * The five states in words — the title of the call detail's recording block
 * and the `Rec` cell's tooltip on the call list read from this one map, so the
 * two screens cannot say different things about the same call. The reason
 * behind a state (which `artifact_state`, which consent outcome) is each
 * screen's own sentence, because only the detail has room for it.
 */
export const RECORDING_REASON = {
  not_configured: 'Recording access not configured',
  not_archived: 'Not archived yet',
  gone: 'Recording gone (retention)',
  withheld: 'Recording withheld',
  playable: 'In the bucket',
} as const satisfies Record<RecordingAccess, string>;

/**
 * Read in this order: no bucket configured at all → not in the bucket → the
 * consent gate → playable. `not_configured` comes first because without the
 * `S3_*` group there is nothing to say about a particular call; the gate comes
 * last because "withheld" is a statement about a recording that does exist.
 *
 * `gone` is the one case where the files are nowhere: `expired` says the box's
 * disk copy was swept, and a null `artifact_key_prefix` says the bucket copy
 * went with it (docs/upstream.md §Artifacts, contract §6 trap 12) — and, the
 * same reading, an `archived` row that carries no prefix at all. Every other
 * not-fetchable value — `spooled`, `failed`, NULL, or a state outside the
 * contract's vocabulary — is `not_archived`: not in the bucket *yet*, which the
 * screen says rather than showing a broken player.
 */
export function recordingAccess(
  call: {
    artifact_state: string | null;
    artifact_key_prefix: string | null;
    outcome: string | null;
  },
  config: Pick<Config, 'artifactStore' | 'consentGate'>,
): RecordingAccess {
  if (config.artifactStore === undefined) return 'not_configured';
  if (!isFetchable(call.artifact_state, call.artifact_key_prefix)) {
    return call.artifact_state === 'expired' ? 'gone' : 'not_archived';
  }
  // `archived` is fetchable whatever the prefix says (the pipeline's own
  // predicate), but with no prefix there is no key to sign: data that should
  // not exist, read as gone rather than as a player that cannot load.
  if (call.artifact_key_prefix === null) return 'gone';
  // Trap 4, through the one enforcement point (ADR 0005): `call.wav` carries
  // the caller's channel, so it is withheld whole — this app never touches the
  // bytes and could not mute one channel if it wanted to.
  if (!showCallerData(call.outcome, config.consentGate)) return 'withheld';
  return 'playable';
}

/**
 * ADR 0004: the presigned GET lives 900 s, counted from the redirect rather
 * than from the page render. It is the SDK's own default, named here because
 * the number is a decision — a page left open keeps playing because every media
 * request goes through the route and gets a fresh URL.
 */
export const PRESIGN_EXPIRES_S = 900;

// `next dev` re-imports modules on every edit, and the client holds an agent
// with sockets; the cache outlives the module for the same reason the pool's
// does (`src/db.ts`).
const CLIENT_KEY = Symbol.for('fonnus-admin.s3-client');
const globalClients = globalThis as { [CLIENT_KEY]?: S3Client };

/**
 * Built on first use, not at import: `next build` imports route modules, and a
 * build must not need the `S3_*` keys (see `src/config.ts`).
 *
 * The settings are explicit and match the pipeline's own client
 * (`../Fonnus/app/src/recording/object-store.ts`): virtual-hosted keys, one
 * attempt, bounded connect and request. Presigning signs locally and makes no
 * network call, so today the bounds guard nothing — they are set so the first
 * request this module ever does make inherits deliberate bounds instead of the
 * SDK's silent three-attempt default (ADR 0004).
 */
function getClient(): S3Client {
  const existing = globalClients[CLIENT_KEY];
  if (existing !== undefined) return existing;
  const store = getConfig().artifactStore;
  if (store === undefined) {
    throw new Error(
      'recording access is not configured: the S3_* group is unset (see .env.example, ADR 0004)',
    );
  }
  const client = new S3Client({
    endpoint: store.endpoint,
    region: store.region,
    credentials: { accessKeyId: store.accessKeyId, secretAccessKey: store.secretAccessKey },
    forcePathStyle: false,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 10_000 },
  });
  globalClients[CLIENT_KEY] = client;
  return client;
}

/**
 * A URL the browser can GET the call's recording with, straight from the
 * bucket. Signing is local — no request leaves this process — so the only
 * failure is an unconfigured bucket, which `getClient` names.
 *
 * The caller has already run `recordingAccess`: this function does not repeat
 * the consent gate, and no caller may reach it on any state but `playable`.
 */
export async function presignCallWav(prefix: string): Promise<string> {
  const client = getClient();
  // Non-null: `getClient` threw above if the group were unset.
  const bucket = getConfig().artifactStore?.bucket;
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: callWavKey(prefix) }),
    { expiresIn: PRESIGN_EXPIRES_S },
  );
}
