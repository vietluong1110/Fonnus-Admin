/*
 * A tree scan over `src/`, the pattern `src/writes.test.ts` uses: some rules
 * are about what is NOT on the screen, and only a scan can hold them.
 *
 * The rule here: the custom-range panel of the window control is an overlay,
 * and an overlay carries no prose. The two sentences it used to carry — "both
 * days included" and the zone the range is read in — widened the panel's
 * max-content width, which inflated the `auto` grid track of the Overview head
 * and pushed the Calls search form onto a second line. "To" keeps the fact as
 * a tooltip (`src/ui/window-control.tsx`); the zone is `CALL_TIME_ZONE`, the
 * one every screen already pins.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Every source file under `src/`, its own tests excluded. */
function sources(): { rel: string; text: string }[] {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const found: { rel: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
        found.push({ rel: `src/${relative(root, full).split(sep).join('/')}`, text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(root);
  return found;
}

describe('the custom range panel', () => {
  it('carries no caveat prose, on any screen', () => {
    const offenders = sources()
      .filter(({ text }) => /both days included|the range is read in/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
