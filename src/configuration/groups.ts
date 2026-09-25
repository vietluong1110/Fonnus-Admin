/**
 * The runtime document's top-level keys, in the pipeline's own names and order
 * (ADR 0013) — the five groups the Configuration form is split into, one tab
 * each, because an operator tuning one leg has no reason to scroll past the
 * other four.
 */
export const GROUPS = ['turn', 'stt', 'llm', 'tts', 'text'] as const;
export type Group = (typeof GROUPS)[number];

/** A `?group=` value or a form's `group` field as a group; anything else is the first. */
export function groupOf(raw: string | undefined): Group {
  return GROUPS.find((group) => group === raw) ?? GROUPS[0];
}

/**
 * Where a leaf is SHOWN when that differs from its top-level key (ADR 0013):
 * the system prompt is stored under `text` but is what the LLM is told, so an
 * operator tuning the model finds it on the LLM tab. Placement only — the
 * document, `FLAT_KEYS` and the path saved stay the pipeline's.
 */
export const DISPLAY_GROUP: Readonly<Record<string, Group>> = { 'text.system_prompt': 'llm' };

/**
 * The tab a leaf's row sits on: its display override, else its top-level key.
 * Own keys only: a path named after a prototype property is no override.
 */
export function displayGroupOf(path: string): Group {
  const override = Object.hasOwn(DISPLAY_GROUP, path) ? DISPLAY_GROUP[path] : undefined;
  return override ?? groupOf(path.split('.')[0]);
}
