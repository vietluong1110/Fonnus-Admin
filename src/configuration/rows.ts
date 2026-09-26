/**
 * What the Configuration form puts on each row, as pure functions the form
 * renders and the tests pin (PLAN.md row A19, piece B3): which rows a tab
 * holds, the words beside the reasoning select, and the `tts.voice`
 * suggestions. Nothing here changes the document, `FLAT_KEYS` or the path a
 * leaf is saved under — only where and how a row is shown.
 */

import type { Offered } from '@/boot-report';
import { REASONING_VALUES } from '@/contract/config/runtime-document';
import { REASONING_OFF_ADVICE } from './advice';
import { mergeBranches, type BranchMerge, type Field } from './document';
import { displayGroupOf, type Group } from './groups';

/**
 * The rows one tab renders, each path once: the fields `live` keeps whose
 * display group (`displayGroupOf`, ADR 0013) is the tab — so the system prompt,
 * stored under `text`, is a row of the LLM tab and of no other. A path several
 * vendor branches share is one row carrying the union of those branches
 * (`mergeBranches`).
 */
export function rowsOn(
  fields: readonly Field[],
  tab: Group,
  live: (field: Field) => boolean,
): BranchMerge[] {
  const byPath = new Map<string, Field[]>();
  for (const field of fields) {
    if (displayGroupOf(field.path) !== tab || !live(field)) continue;
    const branches = byPath.get(field.path);
    if (branches === undefined) byPath.set(field.path, [field]);
    else branches.push(field);
  }
  return [...byPath.values()].map(mergeBranches);
}

/**
 * A tab's label: the pipeline's own top-level key, capitalised the way the
 * team writes it — the three legs are acronyms, the other three are words.
 */
export function tabLabel(group: Group): string {
  return group === 'turn' || group === 'text' || group === 'router'
    ? `${group.charAt(0).toUpperCase()}${group.slice(1)}`
    : group.toUpperCase();
}

/**
 * What a `llm.params.reasoning` value sends, from the schema copy's comment on
 * `REASONING_VALUES` (`src/contract/config/runtime-document.ts`, copied from
 * `../Fonnus/app/src/config/runtime-document.ts`): `omit` sends no field,
 * `off` sends `{ enabled: false }`, every other value an effort level. Null for
 * a value the copy does not have.
 */
export function reasoningGloss(value: string): string | null {
  if (!(REASONING_VALUES as readonly string[]).includes(value)) return null;
  if (value === 'omit') return 'sends no reasoning field';
  if (value === 'off') return 'sends enabled:false';
  return `sends effort:${value}`;
}

/** An enum option as its select shows it: the value, and for reasoning what it sends. */
export function optionLabel(path: string, value: string): string {
  const gloss = path === 'llm.params.reasoning' ? reasoningGloss(value) : null;
  return gloss === null ? value : `${value} — ${gloss}`;
}

/**
 * The advice beside the reasoning select when `off` is chosen (brief gap G4):
 * advice only — the schema accepts `off`, and the save is never blocked on it.
 */
export function reasoningAdvice(path: string, value: string): string | null {
  return path === 'llm.params.reasoning' && value.trim() === 'off' ? REASONING_OFF_ADVICE : null;
}

/** One `<datalist>` entry: the id is what the row writes, the label what the operator reads. */
export interface Suggestion {
  value: string;
  label: string;
}

/**
 * The `tts.voice` suggestions (ADR 0014 decision 6): every voice the boot
 * report lists for `vendors`, in `.env` order. With more than one vendor at
 * once — the no-script form, where the merged control serves them all — each
 * label names its vendor. Empty with no report, or none listed.
 */
export function voiceSuggestions(offered: Offered | null, vendors: readonly string[]): Suggestion[] {
  const listed = vendors.flatMap((vendor) =>
    (offered?.voices[vendor] ?? []).map((voice) => ({ vendor, voice })),
  );
  const many = new Set(listed.map(({ vendor }) => vendor)).size > 1;
  return listed.map(({ vendor, voice }) => ({
    value: voice.id,
    label: many ? `${voice.label} (${vendor})` : voice.label,
  }));
}

/**
 * The line under the `tts.voice` box: the label of a listed id; the reason an
 * id is not listed, when there is a list to be outside of; why the id cannot be
 * checked, when there is none (`uncheckable`, `voiceUncheckable`'s words). Null
 * when there is nothing to add.
 */
export function voiceCaption(
  value: string,
  suggestions: readonly Suggestion[],
  unlisted: string,
  uncheckable: string | null,
): { tone: 'label' | 'caveat'; text: string } | null {
  if (suggestions.length === 0) return uncheckable === null ? null : { tone: 'caveat', text: uncheckable };
  // The schema copy trims the leaf, so the id the row would carry is trimmed.
  const id = value.trim();
  if (id === '') return null;
  const hit = suggestions.find((entry) => entry.value === id);
  return hit === undefined ? { tone: 'caveat', text: unlisted } : { tone: 'label', text: hit.label };
}
