import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * ADR 0014: every hint on screen is the drawn `Tooltip`, never the browser's
 * `title` attribute — which waits a second, cannot be styled, clips long text
 * and never shows on keyboard focus. `title` stays legal where it is the
 * element's own semantics: `<abbr>` (the expansion) and the media elements
 * (their accessible name).
 *
 * Intrinsic elements are scanned, and the components that pass `title` on to
 * their DOM element (`Link`, `Button`); `title` on any other component
 * (`Card`, `PageHead`, `EmptyState`) is a heading prop, not the attribute.
 */
const ALLOWED_TAGS = new Set(['abbr', 'audio', 'video', 'img', 'iframe']);
const FORWARDING = new Set(['Link', 'Button']);

const srcRoot = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `path:line <tag>` for every `title=` that reaches the DOM, outside the allow-list. */
function titleAttributes(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = `src/${relative(srcRoot, file).split(sep).join('/')}`;
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const intrinsic = (/^[a-z]/.test(tag) && !tag.includes('.')) || FORWARDING.has(tag);
      const hasTitle = node.attributes.properties.some(
        (attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === 'title',
      );
      if (intrinsic && hasTitle && !ALLOWED_TAGS.has(tag)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push(`${rel}:${String(line + 1)} <${tag}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('no title attribute on screen (ADR 0014)', () => {
  it('the shared primitives under src/ui are clean', () => {
    expect(sources(join(srcRoot, 'ui')).flatMap(titleAttributes)).toEqual([]);
  });

  it('the screens under src/app are clean', () => {
    expect(sources(join(srcRoot, 'app')).flatMap(titleAttributes)).toEqual([]);
  });
});
