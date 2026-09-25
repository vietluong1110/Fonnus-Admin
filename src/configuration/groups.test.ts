import { describe, expect, it } from 'vitest';
import { FLAT_KEYS } from './flat-keys';
import { DISPLAY_GROUP, GROUPS, displayGroupOf } from './groups';

describe('displayGroupOf — the tab a leaf is shown on', () => {
  it('shows the system prompt on the LLM tab, though it is stored under text', () => {
    expect(displayGroupOf('text.system_prompt')).toBe('llm');
  });

  it('places every other leaf under its own top-level key', () => {
    for (const path of Object.keys(FLAT_KEYS)) {
      if (path in DISPLAY_GROUP) continue;
      expect(displayGroupOf(path)).toBe(path.split('.')[0]);
    }
  });

  it('reads no override from a prototype property', () => {
    expect(displayGroupOf('constructor')).toBe(GROUPS[0]);
    expect(displayGroupOf('toString')).toBe(GROUPS[0]);
  });

  it('overrides only leaves the document has, onto groups that exist', () => {
    for (const [path, group] of Object.entries(DISPLAY_GROUP)) {
      expect(Object.keys(FLAT_KEYS)).toContain(path);
      expect(GROUPS).toContain(group);
    }
  });
});
