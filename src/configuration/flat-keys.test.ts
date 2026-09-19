import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FLAT_KEYS } from './flat-keys';
import { fieldsOf, leafPaths } from './document';

/*
 * ADR 0011 decision 3: `flat-keys.ts` is a copy of the pipeline's
 * `RUNTIME_KEY_MAP`, and the pipeline does not pin it under a contract-hash
 * line yet. What stands in for that pin is totality against the copied schema:
 * a leaf the pipeline adds, or one the console's walk stops finding, fails
 * here rather than going unlabelled on a screen.
 */
describe('the flat-key table against the schema it labels', () => {
  it('names every leaf the schema has, and no path the schema does not', () => {
    expect(Object.keys(FLAT_KEYS).sort()).toEqual(leafPaths().sort());
  });

  it('gives a per-vendor object exactly to the paths more than one branch carries', () => {
    const vendorsOf = new Map<string, Set<string>>();
    for (const field of fieldsOf()) {
      if (field.vendor === null) continue;
      const seen = vendorsOf.get(field.path) ?? new Set<string>();
      seen.add(field.vendor);
      vendorsOf.set(field.path, seen);
    }
    for (const [path, entry] of Object.entries(FLAT_KEYS)) {
      if (typeof entry === 'string') continue;
      // A per-vendor entry names a key for every vendor whose branch carries
      // the path — a vendor missing one would silently read "—" on screen.
      expect(Object.keys(entry).sort()).toEqual([...(vendorsOf.get(path) ?? [])].sort());
    }
  });

  it('is the four per-vendor paths and nothing else', () => {
    const perVendor = Object.entries(FLAT_KEYS)
      .filter(([, entry]) => typeof entry !== 'string')
      .map(([path]) => path);
    expect(perVendor).toEqual([
      'stt.model',
      'tts.model',
      'tts.params.speed',
      'tts.params.pronunciation_dict_id',
    ]);
  });
});

/*
 * The drift gate ADR 0011 decision 3 could not have as a hash line: the
 * pipeline does not pin `RUNTIME_KEY_MAP` under a `contract-hash:` line, so
 * this block reads `../Fonnus/app/src/config/runtime.ts` as TEXT (never as an
 * import — the sibling repo is not a dependency of this one) and compares the
 * map entry for entry with the copy. A renamed or added flat key then fails
 * here rather than turning a "last answered call ran on" hint into "—" on
 * screen. Skipped whole when `../Fonnus` is not checked out beside this repo,
 * the same sibling check `src/contract/contract-hash.test.ts` makes.
 */
const runtimePath = fileURLToPath(new URL('../../../Fonnus/app/src/config/runtime.ts', import.meta.url));
const runtimeAvailable = existsSync(runtimePath);

/** `RUNTIME_KEY_MAP`, read out of the pipeline's source without running it. */
function pipelineKeyMap(): Record<string, string | Record<string, string>> {
  const source = readFileSync(runtimePath, 'utf8');
  const start = source.indexOf('export const RUNTIME_KEY_MAP = {');
  const end = source.indexOf('} as const satisfies', start);
  if (start < 0 || end < 0) throw new Error('RUNTIME_KEY_MAP is no longer spelled as this test reads it');
  // Line comments carry prose with apostrophes; they go before anything is
  // matched so no sentence can look like an entry.
  const block = source.slice(start, end).replaceAll(/\/\/.*$/gm, '');
  const map: Record<string, string | Record<string, string>> = {};
  // `'path': 'KEY'` and `'path': { vendor: 'KEY', … }`, the entry spread over
  // more than one line in both shapes.
  for (const [, path, key, vendors] of block.matchAll(
    /'([\w.]+)':\s*(?:'([A-Z0-9_]+)'|\{([^}]*)\})/g,
  )) {
    if (path === undefined) continue;
    if (key !== undefined) {
      map[path] = key;
      continue;
    }
    const perVendor: Record<string, string> = {};
    for (const [, vendor, vendorKey] of (vendors ?? '').matchAll(/(\w+):\s*'([A-Z0-9_]+)'/g)) {
      if (vendor !== undefined && vendorKey !== undefined) perVendor[vendor] = vendorKey;
    }
    map[path] = perVendor;
  }
  return map;
}

describe.skipIf(!runtimeAvailable)(
  'against the pipeline’s RUNTIME_KEY_MAP (skipped whole when ../Fonnus is not checked out beside this repo)',
  () => {
    it('copies every entry of the map, in the same order, with the same keys', () => {
      const pipeline = pipelineKeyMap();
      expect(Object.keys(pipeline)).toEqual(Object.keys(FLAT_KEYS));
      expect(pipeline).toEqual(FLAT_KEYS);
    });
  },
);
