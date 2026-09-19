import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The write posture of ADR 0007, enforced by a scan of the tree rather than by
 * discipline: this console inserts the two rows of read contract §7 and nothing
 * else, from `src/writes/` and nowhere else, through the editor pool and never
 * the reader's. Postgres refuses the rest anyway (SQLSTATE 42501) — this is the
 * promise on our side, so a refusal is never the first sign of a mistake.
 *
 * Every scan here passes with `src/writes/` absent, which is the state this row
 * ships in: it is wired now and holds from the first write module on.
 */

/**
 * Comments stripped, the way `../Fonnus/scripts/check-config.ts` does it before
 * it reads a file's imports: what the scans below look for are statements, and
 * prose that happens to spell one is not a statement. The copied contract file
 * of ADR 0011 is what forced this — it explains that the speakable filter would
 * "delete from this text", and its bytes are pinned and cannot be reworded. The
 * `[^:]` guard keeps a `https://` link from reading as a line comment.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every non-test source file under `src/`, as `src/…` paths with their code. */
function sources(): { path: string; text: string }[] {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const found: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        found.push({
          path: `src/${relative(root, full).split(sep).join('/')}`,
          text: withoutComments(readFileSync(full, 'utf8')),
        });
      }
    }
  };
  walk(root);
  return found;
}

const matching = (pattern: RegExp): string[] =>
  sources()
    .filter(({ text }) => pattern.test(text))
    .map(({ path }) => path)
    .sort();

describe('the SQL verbs this console may write (ADR 0007 decision 1)', () => {
  it('inserts only from src/writes/', () => {
    expect(matching(/\binsert\s+into\b/i).filter((path) => !path.startsWith('src/writes/'))).toEqual(
      [],
    );
  });

  it('updates and deletes nowhere — a correction is a superseding row', () => {
    // `\S+` rather than `\w+` for the table: a schema-qualified or quoted name
    // (`update public.runtime_config set`, `update "runtime_config" set`) is the
    // same statement and must not slip past the scan.
    expect(matching(/\bupdate\s+\S+\s+set\b/i)).toEqual([]);
    expect(matching(/\bdelete\s+from\b/i)).toEqual([]);
  });

  it('would catch a violation: the scan reads the whole tree', () => {
    // Without this the three assertions above would also pass on a walk that
    // read nothing. `select` is in every query module, so its count is the
    // number of files the scans actually opened.
    expect(matching(/\bselect\b/i).length).toBeGreaterThan(2);
  });
});

describe('the editor pool belongs to the write modules (ADR 0007 decision 3)', () => {
  // The reader's credential never carries the write, and a write never goes out
  // over the reader's connection (../Fonnus/docs/runbook.md §9).
  const ALLOWED = ['src/db.ts', 'src/app/api/healthz/route.ts'];

  it('names getEditorPool only where it is created, probed, or used to write', () => {
    expect(
      matching(/\bgetEditorPool\b/).filter(
        (path) => !ALLOWED.includes(path) && !path.startsWith('src/writes/'),
      ),
    ).toEqual([]);
  });

  it('creates and probes it in exactly those two places, and writes from one module today', () => {
    // The write modules are the third place the name may appear, and they are
    // listed one by one: a new file under `src/writes/` is a new row this
    // console writes, which is a decision, never a side effect of a refactor.
    expect(matching(/\bgetEditorPool\b/)).toEqual(
      [...ALLOWED, 'src/writes/runtime-config.ts'].sort(),
    );
  });

  it('never reads through the read pool from a write module', () => {
    expect(matching(/\bgetPool\b/).filter((path) => path.startsWith('src/writes/'))).toEqual([]);
  });
});
