import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * ADR 0011 decision 2: `src/contract/config/runtime-document.ts` and
 * `src/contract/domain/speakable.ts` are byte copies of
 * `../Fonnus/app/src/config/runtime-document.ts` and
 * `../Fonnus/app/src/domain/speakable.ts`, at the same relative layout so the
 * one relative import between them is unchanged. **Re-copying the two files
 * from the pipeline is the only edit they may ever get** — no header line, no
 * re-export, no formatting pass: the pipeline's `docs/read-contract.md` §7 pins
 * their bytes with a `contract-hash:` line each, and an edit made here would
 * make this console validate documents the pipeline does not.
 *
 * Three checks, of which only the middle one needs the sibling checkout:
 * (a) the copies' bytes against the hashes pinned below;
 * (b) those pinned hashes against the contract's own lines, so a contract that
 *     moved on shows up as a failing test here rather than on a screen;
 * (c) the copies' import specifiers, which are what the Turbopack alias of
 *     `next.config.ts` and the `zod` dependency stand on.
 */

/** The two lines of `../Fonnus/docs/read-contract.md` §7, verbatim. */
const CONTRACT_HASH_LINES = [
  'contract-hash: app/src/config/runtime-document.ts sha256:714eadafa30b853c83bab25b165643538b91818c8f281458ad896c428ec50cc9',
  'contract-hash: app/src/domain/speakable.ts sha256:934e0fe58d520ce689613fcf992319bae0848923b2a3d1c316f707ac2d2bac08',
] as const;

/**
 * `contract-hash: <path> sha256:<hex>` — copied from the pipeline's own rule 14
 * (`../Fonnus/scripts/check-config.ts:235`), so the two read the contract's
 * lines the same way.
 */
const CONTRACT_HASH_LINE = /^contract-hash:[ \t]+(\S+)[ \t]+sha256:([0-9a-f]{64})[ \t]*$/;

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Where each pinned line's pipeline path lives in this tree. */
const COPY_OF: Readonly<Record<string, string>> = {
  'app/src/config/runtime-document.ts': './config/runtime-document.ts',
  'app/src/domain/speakable.ts': './domain/speakable.ts',
};

interface Pinned {
  sourcePath: string;
  hash: string;
  localPath: string;
}

const PINNED: Pinned[] = CONTRACT_HASH_LINES.map((line) => {
  const match = CONTRACT_HASH_LINE.exec(line);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`not a contract-hash line: ${line}`);
  }
  const localPath = COPY_OF[match[1]];
  if (localPath === undefined) throw new Error(`no copy is declared for ${match[1]}`);
  return { sourcePath: match[1], hash: match[2], localPath };
});

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const contractPath = here('../../../Fonnus/docs/read-contract.md');
const contractAvailable = existsSync(contractPath);

describe('the copied contract files', () => {
  it.each(PINNED)('$sourcePath is byte-identical to its pinned hash', ({ hash, localPath }) => {
    expect(sha256(readFileSync(here(localPath)))).toBe(hash);
  });

  describe.skipIf(!contractAvailable)(
    'against ../Fonnus/docs/read-contract.md §7 (skipped whole when ../Fonnus is not checked out beside this repo)',
    () => {
      it('pins the same two lines the contract does', () => {
        const lines = readFileSync(contractPath, 'utf8')
          .split('\n')
          .filter((line) => CONTRACT_HASH_LINE.test(line.trimEnd()))
          .map((line) => line.trimEnd());
        expect(lines).toEqual([...CONTRACT_HASH_LINES]);
      });
    },
  );

  /**
   * Comments are stripped first, the way the pipeline's rule 14 does
   * (`../Fonnus/scripts/check-config.ts`, `withoutComments`): both files
   * document heavily, and a sentence naming a module is prose, not an import.
   * The `[^:]` guard keeps a `https://` link from reading as a line comment.
   */
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** Every specifier an `import`/`export … from` or a dynamic `import()` names. */
  const IMPORT_SPECIFIER = /(?:\bfrom|^\s*import|\bimport\s*\()\s*['"]([^'"]+)['"]/gm;

  const specifiersOf = (localPath: string): string[] => [
    ...new Set(
      [...withoutComments(readFileSync(here(localPath), 'utf8')).matchAll(IMPORT_SPECIFIER)].map(
        ([, specifier]) => specifier ?? '',
      ),
    ),
  ];

  it('the document copy imports only zod and the speakable copy beside it', () => {
    // `'../domain/speakable.js'` is also the key of the Turbopack alias in
    // `next.config.ts`: pinned here so the two cannot drift apart silently.
    for (const specifier of specifiersOf('./config/runtime-document.ts')) {
      expect(['zod', '../domain/speakable.js']).toContain(specifier);
    }
  });

  it('the speakable copy imports nothing', () => {
    expect(specifiersOf('./domain/speakable.ts')).toEqual([]);
  });
});
