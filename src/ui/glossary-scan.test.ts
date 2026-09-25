import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { GLOSSARY } from './glossary';

/*
 * ADR 0013 decision 6, as amended: a friendly name is written in `glossary.ts`
 * only, and a screen obtains both halves of a label from it. So no text a
 * screen PUTS ON SCREEN under `src/app` or `src/ui` may equal (a) a glossary
 * `code` — a screen writing `endpoint_wait` as a label — or (b) a glossary
 * `name` — a second spelling waiting to diverge.
 *
 * Text on screen, for this purpose, is JSX text, a string literal written as a
 * JSX child (`{'Caller'}`), and a string literal given to one of the
 * label-bearing attributes below. A literal reaches the screen through a
 * conditional, a parenthesis or a `??`/`||`/`&&` just as well, so those
 * branches are followed. Not text: comparisons, lookups (`termFor('leg',
 * 'send')`) and classifying props (`side="caller"`), which name a value the
 * code acts on rather than a label anyone reads. What the scan cannot catch —
 * a rival name for a term the glossary already names — is left to review.
 */
const LABEL_ATTRIBUTES = new Set([
  'label',
  'hint',
  'tip',
  'sub',
  'caption',
  'placeholder',
  'aria-label',
  'alt',
]);

const srcRoot = fileURLToPath(new URL('..', import.meta.url));

const CODES = new Set(Object.values(GLOSSARY).flatMap((entries) => Object.values(entries).map((t) => t.code)));
const NAMES = new Set(Object.values(GLOSSARY).flatMap((entries) => Object.values(entries).map((t) => t.name)));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) && entry.name !== 'glossary.ts') {
      out.push(full);
    }
  }
  return out;
}

/** The string literals an expression can evaluate to, through the branches that pass a value on. */
function reachingLiterals(expr: ts.Expression): ts.StringLiteralLike[] {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr];
  if (ts.isParenthesizedExpression(expr)) return reachingLiterals(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    return [...reachingLiterals(expr.whenTrue), ...reachingLiterals(expr.whenFalse)];
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      return [...reachingLiterals(expr.left), ...reachingLiterals(expr.right)];
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return reachingLiterals(expr.right);
  }
  return [];
}

/** `path:line "text"` for every piece of on-screen text equal to a glossary code or name. */
function glossaryText(rel: string, text: string): string[] {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const report = (node: ts.Node, value: string): void => {
    if (!CODES.has(value) && !NAMES.has(value)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${rel}:${String(line + 1)} ${JSON.stringify(value)}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      report(node, node.text.trim());
    } else if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      for (const literal of reachingLiterals(node.expression)) report(literal, literal.text);
    } else if (ts.isJsxAttribute(node) && LABEL_ATTRIBUTES.has(node.name.getText(source))) {
      const init = node.initializer;
      if (init !== undefined && ts.isStringLiteral(init)) report(init, init.text);
      else if (init !== undefined && ts.isJsxExpression(init) && init.expression !== undefined) {
        for (const literal of reachingLiterals(init.expression)) report(literal, literal.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function scanFile(file: string): string[] {
  return glossaryText(`src/${relative(srcRoot, file).split(sep).join('/')}`, readFileSync(file, 'utf8'));
}

describe('names and codes come from the glossary (ADR 0013 decision 6)', () => {
  it('finds on-screen text equal to a glossary code or name, and nothing else', () => {
    // The scanner itself, on a probe holding every case the rule separates.
    const probe = [
      "const a = side === 'caller';",
      "const b = termFor('leg', 'send');",
      'const c = <Bubble side="caller" />;',
      'const d = <Th hint="x">Caller</Th>;',
      'const e = <Stat label="pipeline_ms" />;',
      "const f = <span>{ok ? 'caller_hangup' : null}</span>;",
      "const g = <Field placeholder={value ?? 'llm'} />;",
    ].join('\n');
    expect(glossaryText('probe.tsx', probe)).toEqual([
      'probe.tsx:4 "Caller"',
      'probe.tsx:5 "pipeline_ms"',
      'probe.tsx:6 "caller_hangup"',
      'probe.tsx:7 "llm"',
    ]);
  });

  it('no screen or primitive writes one itself', () => {
    const offenders = [...sources(join(srcRoot, 'app')), ...sources(join(srcRoot, 'ui'))].flatMap(scanFile);
    expect(offenders).toEqual([]);
  });
});
