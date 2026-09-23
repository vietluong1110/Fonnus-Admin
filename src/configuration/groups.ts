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
