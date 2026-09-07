import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * ADR 0003: the token files are byte copies of ../Fonnus-Web-UI's, plus one
 * header line. Editing one here instead of re-copying it is the failure mode
 * that ends with two design systems, so it is pinned rather than trusted.
 *
 * The sibling checkout is not guaranteed to exist (CI, a fresh clone of this
 * repo alone), so the comparison skips itself by name rather than failing.
 */

const TOKENS = ['colors', 'typography', 'spacing', 'shape', 'motion', 'base'] as const;

/** The commit the copies were taken at; it is named in every header line. */
const SOURCE_COMMIT = '302e3e8';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const localPath = (name: string): string => here(`./tokens/${name}.css`);
const sourceRepo = here('../../../Fonnus-Web-UI');

/**
 * The file as it was at the pinned commit — not the sibling's working tree,
 * which may sit on another branch or carry uncommitted edits. Null when the
 * checkout or the commit is not there.
 */
const sourceAt = (name: string): string | null => {
  const r = spawnSync(
    'git',
    ['-C', sourceRepo, 'show', `${SOURCE_COMMIT}:src/styles/tokens/${name}.css`],
    { encoding: 'utf8' },
  );
  return r.status === 0 ? r.stdout : null;
};

const sourceAvailable = existsSync(sourceRepo) && sourceAt('colors') !== null;

describe('the copied design tokens', () => {
  it.each(TOKENS)('%s.css names its source in one header line', (name) => {
    const [header] = readFileSync(localPath(name), 'utf8').split('\n');
    expect(header).toBe(
      `/* Copied verbatim from ../Fonnus-Web-UI/src/styles/tokens/${name}.css @ ${SOURCE_COMMIT} (ADR 0003). Do not edit here — re-copy. */`,
    );
  });

  describe.skipIf(!sourceAvailable)(
    `against its source at ${SOURCE_COMMIT} (skipped whole when ../Fonnus-Web-UI is not checked out beside this repo or lacks that commit)`,
    () => {
      it.each(TOKENS)('%s.css is byte-identical below the header', (name) => {
        const copied = readFileSync(localPath(name), 'utf8');
        expect(copied.slice(copied.indexOf('\n') + 1)).toBe(sourceAt(name));
      });
    },
  );

  it('does not copy fonts.css — the faces load through next/font (ADR 0003 point 2)', () => {
    expect(existsSync(localPath('fonts'))).toBe(false);
  });
});
