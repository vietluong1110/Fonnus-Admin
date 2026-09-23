/**
 * What one call ran on, read from its `config_snapshot` and its own columns —
 * the facts the operator tunes, put at the top of the call detail: the
 * `runtime_config` row (or boot config), and the STT, LLM and TTS models.
 *
 * Two sources on purpose. The vendor of each leg is the snapshot's
 * `STT_PROVIDER` / `TTS_PROVIDER` (contract §3.4); the STT and TTS models are
 * `call_log.stt_model` / `tts_model`, what the call itself reported. The LLM is
 * the snapshot's `OPENROUTER_MODEL`, the configured model, because a turn's
 * `llm_model` is per turn and can differ from it.
 */

import { renderValue, canonicalKey } from '@/dashboard';
import { layerOf, runtimeRow } from '@/configuration/document';
import { FLAT_KEYS } from '@/configuration/flat-keys';

export interface RanOn {
  /** `runtime.version`, the id of the row the call ran under; null = boot config. */
  row: string | null;
  stt: { vendor: string | null; model: string | null };
  llm: {
    model: string | null;
    /** Models turns reported other than `model`, with how many turns each. */
    others: { model: string; turns: number }[];
  };
  tts: { vendor: string | null; model: string | null };
  /** `FONNUS_BUILD_SHA`, null when the snapshot lacks it. */
  build: string | null;
  /** `PROVIDERS = fake`: no vendor answered the call. */
  fakeProviders: boolean;
}

/** A snapshot key's value as text, or null when the key is absent (§3.4: absent, never null). */
function text(snapshot: Record<string, unknown> | null, key: string): string | null {
  if (snapshot === null || !Object.hasOwn(snapshot, key)) return null;
  return renderValue(snapshot[key]);
}

export function ranOnOf(
  snapshot: Record<string, unknown> | null,
  call: { stt_model: string | null; tts_model: string | null },
  turnModels: readonly (string | null)[],
): RanOn {
  const llm = text(snapshot, 'OPENROUTER_MODEL');
  // `turn.llm_model` is the model "as the provider reported it" (contract §3, `turn`),
  // so a turn that differs may be a failover (`fallback: true` on its
  // `llm/request_sent`) or a provider that names the model its own way. The
  // screen states the difference and does not call it a failover. ASSUMED that
  // OpenRouter echoes the requested slug, so an ordinary call shows nothing
  // here; settled by comparing `turn.llm_model` with `OPENROUTER_MODEL` on the
  // box's calls.
  const counts = new Map<string, number>();
  for (const model of turnModels) {
    if (model === null || model === llm) continue;
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return {
    row: snapshot === null ? null : (runtimeRow(snapshot)?.version ?? null),
    stt: { vendor: text(snapshot, 'STT_PROVIDER'), model: call.stt_model },
    llm: {
      model: llm,
      others: [...counts].map(([model, turns]) => ({ model, turns })),
    },
    tts: { vendor: text(snapshot, 'TTS_PROVIDER'), model: call.tts_model },
    build: text(snapshot, 'FONNUS_BUILD_SHA'),
    fakeProviders: text(snapshot, 'PROVIDERS') === 'fake',
  };
}

/** Every flat snapshot key the runtime document can set, to the path that sets it. */
const PATH_OF_KEY: ReadonlyMap<string, string> = new Map(
  Object.entries(FLAT_KEYS).flatMap(([path, key]) =>
    typeof key === 'string'
      ? [[key, path] as const]
      : Object.values(key).map((each) => [each, path] as const),
  ),
);

/**
 * The snapshot keys whose value came from the call's `runtime_config` row
 * rather than boot config: a key the row can set (`FLAT_KEYS`) whose path is
 * present in `runtime.config` — `layerOf`'s rule, applied key by key. A key of
 * another vendor never appears in the snapshot, so the per-vendor paths need no
 * provider check here. Empty on a call that ran on boot config.
 */
export function keysFromRow(snapshot: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  if (runtimeRow(snapshot) === null) return keys;
  for (const key of Object.keys(snapshot)) {
    // An old spelling of a renamed Deepgram key maps through its new one.
    const path = PATH_OF_KEY.get(canonicalKey(key));
    if (path !== undefined && layerOf(snapshot, path).kind === 'row') keys.add(key);
  }
  return keys;
}
