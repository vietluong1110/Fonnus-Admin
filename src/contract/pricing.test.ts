import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * ADR 0015 decision 1: `src/contract/pricing.ts` is a byte copy of
 * `../Fonnus/app/src/domain/pricing.ts`. **Re-copying the file is the only edit
 * it may ever get**, then the pinned hash below moves with it. The contract
 * does not pin this file (docs/upstream.md, §Waiting on ../Fonnus), so the pin
 * lives here: the `contract-hash.test.ts` shape without the contract line.
 */

/** sha256 of the copy, pipeline commit 0f43dad (2026-09-26). */
const PINNED_SHA256 = '0e487c839940548b2c87f0f4ed229a079440a58b504316850ba2cec015d53d18';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const copyPath = here('./pricing.ts');
const sourcePath = here('../../../Fonnus/app/src/domain/pricing.ts');
const sourceAvailable = existsSync(sourcePath);

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

describe('the copied price table', () => {
  it('is byte-identical to its pinned hash', () => {
    expect(sha256(readFileSync(copyPath))).toBe(PINNED_SHA256);
  });

  it('imports nothing, so the copy resolves as it stands', () => {
    expect(readFileSync(copyPath, 'utf8')).not.toMatch(/^\s*import\s/m);
  });

  describe.skipIf(!sourceAvailable)(
    'against ../Fonnus/app/src/domain/pricing.ts (skipped when ../Fonnus is not checked out beside this repo)',
    () => {
      it('matches the pipeline source byte for byte', () => {
        expect(readFileSync(copyPath).equals(readFileSync(sourcePath))).toBe(true);
      });
    },
  );
});
