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

/** sha256 of the copy, pipeline commit 313ed5d (2026-10-12). */
const PINNED_SHA256 = 'a6683db5c362023b133730ae0c14d93c6d8f2d51e982d49bcfdbd58d1639b049';

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
