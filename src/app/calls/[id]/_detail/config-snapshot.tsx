/*
 * The exact configuration the call ran under: the three identity keys, then
 * every other key grouped by prefix for reading (`src/snapshot-groups.ts`).
 *
 * Three rules of contract §3.4 the card carries on screen, because none of them
 * can be read off the values:
 *   - `PROVIDERS` says only whether real vendors answered, not which ones;
 *     `STT_PROVIDER` and `TTS_PROVIDER` name the vendor of each leg and head
 *     their groups, read before any vendor key.
 *   - a vendor's keys are present only on a call that ran that vendor, so an
 *     absent `DEEPGRAM_*` key means that vendor did not run, never "the default
 *     applied". A key the process had no value for is absent, never null.
 *   - a key this console does not know is shown, never dropped (trap 6), and a
 *     value is not always a scalar: `runtime` and `SPEECHMATICS_SOUNDS_LIKE`
 *     are objects and four keys are arrays.
 */

import { parseSnapshot, renderValue } from '@/dashboard';
import { shortSha } from '@/calls';
import { groupSnapshot } from '@/snapshot-groups';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import Field from '@/ui/field';

/** The keys the identity row renders; they are not repeated in the groups. */
const IDENTITY_KEYS = ['FONNUS_BUILD_SHA', 'PROVIDERS', 'FONNUS_ENV'];

/** A key the process had no value for is absent, never null (contract §3.4). */
function identityValue(snapshot: Record<string, unknown>, key: string): string {
  return Object.hasOwn(snapshot, key) ? renderValue(snapshot[key]) : 'not configured';
}

/** `PROVIDERS` is `real` or `fake` and says only whether real vendors answered. */
function providersLine(value: string): string {
  if (value === 'real') return 'real — real vendors answered';
  if (value === 'fake') return 'fake — no vendor was called';
  return value;
}

export default function ConfigSnapshot({ value }: { value: unknown }) {
  // `parseSnapshot` is the column's one trust boundary (`src/dashboard.ts`), so
  // the dashboard and this card agree on what counts as a snapshot at all.
  const snapshot = parseSnapshot(value);
  if (snapshot === null) {
    return (
      <EmptyState title="Not recorded.">
        The call was written before the pipeline&rsquo;s migration 0007, which added config
        provenance.
      </EmptyState>
    );
  }

  const buildSha = identityValue(snapshot, 'FONNUS_BUILD_SHA');
  const rest = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => !IDENTITY_KEYS.includes(key)),
  );
  const groups = groupSnapshot(rest);
  const count = Object.keys(rest).length;

  return (
    <>
      {/* Each identity key stands on its own: a snapshot that carries no
          FONNUS_BUILD_SHA still says which environment ran the call, and the
          missing key reads as "not configured" like any other. */}
      <dl className="m-0 grid grid-cols-2 gap-4 border-b border-border-hairline pb-4 md:grid-cols-3">
        <Field label="FONNUS_BUILD_SHA">
          <span className="font-num" title={buildSha}>
            {shortSha(buildSha)}
          </span>
        </Field>
        <Field label="PROVIDERS">{providersLine(identityValue(snapshot, 'PROVIDERS'))}</Field>
        <Field label="FONNUS_ENV">{identityValue(snapshot, 'FONNUS_ENV')}</Field>
      </dl>

      <details className="text-[length:var(--size-ui)]">
        <summary className="cursor-pointer font-medium text-text-link">
          {count} more {count === 1 ? 'key' : 'keys'}
        </summary>
        <Caveat>
          grouped by prefix — a rendering choice only; a key with an unknown prefix falls to Other
          and none is ever dropped. A vendor&rsquo;s keys are present only on a call that ran that
          vendor, so an absent key means that vendor did not run, never that a default applied.
        </Caveat>
        <div className="mt-3 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <div key={group.name} className="min-w-0">
              <div className="border-b border-border-hairline pb-1 text-[length:var(--size-eyebrow)] font-semibold tracking-[.1em] text-text-accent uppercase">
                {group.name}
              </div>
              <dl className="m-0 mt-1 flex flex-col gap-0.5">
                {group.entries.map((entry) => (
                  <div key={entry.key} className="flex justify-between gap-2.5 py-0.5">
                    <dt className="font-num text-[length:var(--size-eyebrow)] break-all text-text-muted">
                      {entry.key}
                    </dt>
                    <ConfigValue value={entry.value} />
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

/**
 * A snapshot value. A scalar reads as one line; an object or an array —
 * `runtime`, `SPEECHMATICS_SOUNDS_LIKE`, the four term lists (§3.4) — reads as
 * indented JSON, because the whole point of the row is that the operator can
 * see which leaf changed. An empty string is drawn as `""`, never blank, so it
 * cannot be mistaken for a key the process had no value for — that key would be
 * absent from the object entirely.
 */
function ConfigValue({ value }: { value: unknown }) {
  const scalar = typeof value !== 'object' || value === null;
  if (scalar) {
    return (
      <dd className="font-num text-[length:var(--size-eyebrow)] break-all">
        {value === '' ? '""' : renderValue(value)}
      </dd>
    );
  }
  return (
    <dd className="max-w-[60%] font-num text-[length:var(--size-eyebrow)] break-all whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </dd>
  );
}
