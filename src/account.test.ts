import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_HEADER,
  type Account,
  NoAccountError,
  createdBy,
  currentAccount,
  readAccount,
  requireAccount,
} from './account';

// `next/headers` reads a request scope this suite has none of, and vitest runs
// these in plain node (vitest.config.mts: "nothing here opens a socket or
// imports Next.js"). `vi.mock` is hoisted above the import above, so the mock is
// what `./account` binds to, and `currentAccount` becomes exercisable at all.
const { mockHeaders } = vi.hoisted(() => ({ mockHeaders: vi.fn() }));
vi.mock('next/headers', () => ({ headers: mockHeaders }));

/** The `Headers` shape `readAccount` takes, from a plain record. */
const sent = (value?: string) => ({
  get: (name: string) => (name === ACCOUNT_HEADER && value !== undefined ? value : null),
});

describe('readAccount — the one reader of the account header (ADR 0007)', () => {
  it('is the header value, trimmed', () => {
    expect(readAccount(sent('lesky'))).toBe('lesky');
    expect(readAccount(sent(' lesky '))).toBe('lesky');
  });

  it('is undefined for every value that is not one account name', () => {
    // Absent: `pnpm dev`, the tunnel, the compose healthcheck. Empty or
    // whitespace: a Caddyfile that set the header without a value. Whitespace
    // inside: not a line of `caddy/users`, which deploy.sh holds to one token.
    expect(readAccount(sent())).toBeUndefined();
    expect(readAccount(sent(''))).toBeUndefined();
    expect(readAccount(sent('  '))).toBeUndefined();
    expect(readAccount(sent('a b'))).toBeUndefined();
  });

  it('reads that header and no other', () => {
    expect(readAccount({ get: () => null })).toBeUndefined();
    expect(ACCOUNT_HEADER).toBe('x-console-account');
  });
});

describe('currentAccount and requireAccount', () => {
  afterEach(() => {
    mockHeaders.mockReset();
  });

  it('reads the request headers through next/headers', async () => {
    mockHeaders.mockResolvedValue(sent('lesky'));
    await expect(currentAccount()).resolves.toBe('lesky');
    await expect(requireAccount()).resolves.toBe('lesky');
  });

  it('refuses a write when no account came with the request', async () => {
    mockHeaders.mockResolvedValue(sent());
    await expect(currentAccount()).resolves.toBeUndefined();
    // A refusal, never a placeholder name: `created_by` is append-only and a
    // false name in it cannot be corrected.
    await expect(requireAccount()).rejects.toBeInstanceOf(NoAccountError);
    await expect(requireAccount()).rejects.toThrow(/reverse proxy/);
  });
});

describe('createdBy — the contract §7 form', () => {
  it('prefixes the account with the console marker', () => {
    expect(createdBy('lesky' as Account)).toBe('console:lesky');
  });
});

/** Walks `src/`, skipping test files, and reports the paths whose source matches. */
function filesMatching(pattern: RegExp): string[] {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        if (pattern.test(readFileSync(full, 'utf8'))) {
          found.push(`src/${relative(root, full).split(sep).join('/')}`);
        }
      }
    }
  };
  walk(root);
  return found;
}

describe('the account has one reader and one spelling (ADR 0007)', () => {
  // The same scan the consent gate gets in src/calls.test.ts. Two readers of the
  // header drift; two spellings of `created_by` write two audit trails; and a
  // cast outside this file mints an account the compiler was meant to guarantee.
  it('spells the header name only in src/account.ts', () => {
    expect(filesMatching(/x-console-account/i)).toEqual(['src/account.ts']);
  });

  it('spells the created_by prefix only in src/account.ts', () => {
    // Any string literal starting with the prefix, not just the template this
    // file happens to use today.
    expect(filesMatching(/[`'"]console:/)).toEqual(['src/account.ts']);
  });

  it('casts to Account only in src/account.ts', () => {
    // Both spellings of the cast: `x as Account` and TypeScript's older
    // `<Account>x`, which is still legal in a `.ts` file.
    expect(filesMatching(/\bas Account\b|<Account>/)).toEqual(['src/account.ts']);
  });

  it('walks past src/account.ts, so an empty result means clean and not unread', () => {
    // A scan that reached one file would pass all three above for the wrong
    // reason. Every module under src/ exports something, so this is the count of
    // files the three scans actually read.
    expect(filesMatching(/\bexport\b/).length).toBeGreaterThan(5);
  });
});

describe('the account footer in the shell (ADR 0007 decision 6)', () => {
  const layout = () =>
    readFileSync(fileURLToPath(new URL('./app/layout.tsx', import.meta.url)), 'utf8');

  // The footer cannot be rendered in this suite — it is a server component and
  // nothing here imports Next.js — so its source is pinned instead: the line,
  // both of its endings, and the rule that it is muted and never accented.
  it('draws both endings of the line, with the reason for the missing one', () => {
    const footer = /<footer[\s\S]*?<\/footer>/.exec(layout())?.[0] ?? '';
    expect(footer).toContain('console · ');
    expect(footer).toContain("account ?? 'no account'");
    expect(footer).toContain('did not come through the reverse proxy');
  });

  it('dropped "read-only" when the first write module landed (ADR 0007 decision 6)', () => {
    // The word is wrong the moment a screen can insert, and "edits" would be
    // wrong too — decision 1 allows two inserts, not editing.
    const footer = /<footer[\s\S]*?<\/footer>/.exec(layout())?.[0] ?? '';
    expect(footer).not.toContain('read-only');
  });

  it('is muted, never accent-coloured — a state is not an action', () => {
    const footer = /<footer[\s\S]*?<\/footer>/.exec(layout())?.[0] ?? '';
    expect(footer).toContain('text-text-muted');
    expect(footer).not.toContain('accent');
  });

  it('is read in the shell and on the one screen that decides whether it may write', () => {
    // The shell reads it for the footer; the Configuration page reads it to
    // decide whether the form is editable at all. Every other surface that
    // needs the account goes through `requireAccount` on the write path.
    expect(filesMatching(/\bcurrentAccount\b/).sort()).toEqual([
      'src/account.ts',
      'src/app/configuration/page.tsx',
      'src/app/layout.tsx',
    ]);
  });
});
