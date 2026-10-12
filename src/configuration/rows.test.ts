import { describe, expect, it } from 'vitest';
import { offeredOf, parseBootReport } from '@/boot-report';
import { REASONING_VALUES } from '@/contract/config/runtime-document';
import { REASONING_OFF_ADVICE } from './advice';
import { diffDocuments, fieldsOf } from './document';
import { GROUPS } from './groups';
import {
  dialogueSocketAbsentWords,
  optionLabel,
  reasoningAdvice,
  reasoningGloss,
  refusedOnDialogueSocket,
  rowsOn,
  tabLabel,
  voiceCaption,
  voiceSuggestions,
} from './rows';

/*
 * What the Configuration form puts on each row (PLAN.md row A19, piece B3):
 * the placement walk, the reasoning words and the voice suggestions.
 */

const everyField = (): boolean => true;

describe('rowsOn — which rows a tab holds', () => {
  it('places the system prompt on the LLM tab and on no other', () => {
    const tabs = GROUPS.filter((tab) =>
      rowsOn(fieldsOf(), tab, everyField).some(({ field }) => field.path === 'text.system_prompt'),
    );
    expect(tabs).toEqual(['llm']);
  });

  it('shows every path exactly once across the six tabs', () => {
    const shown = GROUPS.flatMap((tab) => rowsOn(fieldsOf(), tab, everyField).map(({ field }) => field.path));
    const paths = [...new Set(fieldsOf().map((field) => field.path))];
    expect([...shown].sort()).toEqual([...paths].sort());
  });

  it('keeps the path saved: the prompt row still names text.system_prompt', () => {
    const row = rowsOn(fieldsOf(), 'llm', everyField).find(({ field }) => field.path === 'text.system_prompt');
    expect(row?.field.group).toBe('text');
  });

  it('leaves out a field `live` drops — another vendor\'s branch', () => {
    const rows = rowsOn(fieldsOf(), 'stt', (field) => field.vendor === null || field.vendor === 'deepgram');
    expect(rows.every(({ field }) => field.vendor === null || field.vendor === 'deepgram')).toBe(true);
    expect(rows.map(({ field }) => field.path)).toContain('stt.params.endpointing_ms');
    expect(rows.map(({ field }) => field.path)).not.toContain('stt.params.max_endpoint_delay_ms');
  });
});

describe('refusedOnDialogueSocket — the ElevenLabs rows a dialogue model drops (pipeline ADR 0033 Decision 5)', () => {
  const field = (path: string, vendor: string) => {
    const found = fieldsOf().find((f) => f.path === path && f.vendor === vendor);
    if (found === undefined) throw new Error(`no field ${path} of ${vendor}`);
    return found;
  };

  it('keeps speed on Flash, which runs on the multi-context websocket', () => {
    expect(refusedOnDialogueSocket(field('tts.params.speed', 'elevenlabs'), 'eleven_flash_v2_5')).toBe(false);
  });

  it('drops speed on eleven_v4_turbo and eleven_v4', () => {
    expect(refusedOnDialogueSocket(field('tts.params.speed', 'elevenlabs'), 'eleven_v4_turbo')).toBe(true);
    expect(refusedOnDialogueSocket(field('tts.params.speed', 'elevenlabs'), 'eleven_v4')).toBe(true);
  });

  it('keeps stability and the pronunciation dictionary on a dialogue model', () => {
    for (const path of [
      'tts.params.stability',
      'tts.params.pronunciation_dict_id',
      'tts.params.pronunciation_dict_version_id',
    ]) {
      expect(refusedOnDialogueSocket(field(path, 'elevenlabs'), 'eleven_v4_turbo')).toBe(false);
    }
  });

  it('drops exactly the four leaves the pipeline lists, and only from the ElevenLabs branch', () => {
    const dropped = fieldsOf()
      .filter((f) => refusedOnDialogueSocket(f, 'eleven_v4_turbo'))
      .map((f) => f.path);
    expect(dropped).toEqual([
      'tts.params.similarity_boost',
      'tts.params.style',
      'tts.params.speaker_boost',
      'tts.params.speed',
    ]);
    expect(refusedOnDialogueSocket(field('tts.params.speed', 'cartesia'), 'eleven_v4_turbo')).toBe(false);
  });

  it('hides nothing while tts.model is blank — the boot value the form cannot read', () => {
    expect(refusedOnDialogueSocket(field('tts.params.speed', 'elevenlabs'), '')).toBe(false);
  });
});

describe('dialogueSocketAbsentWords — the review diff after a dialogue model drops a leaf', () => {
  const flash = { tts: { provider: 'elevenlabs', model: 'eleven_flash_v2_5', params: { speed: 1.1 } } };
  const turbo = { tts: { provider: 'elevenlabs', model: 'eleven_v4_turbo', params: {} } };

  it('names the model, not the boot value, for a leaf the dialogue socket has no setting for', () => {
    const entry = diffDocuments(flash, turbo).find((e) => e.path === 'tts.params.speed');
    expect(entry).toMatchObject({ change: 'removed', to: undefined });
    expect(dialogueSocketAbsentWords('tts.params.speed', turbo, fieldsOf())).toBe(
      'not a setting of eleven_v4_turbo',
    );
  });

  it('says nothing for stability, which the dialogue socket carries', () => {
    expect(dialogueSocketAbsentWords('tts.params.stability', turbo, fieldsOf())).toBeNull();
  });

  it('says nothing on Flash, another vendor, or a document naming no model', () => {
    expect(dialogueSocketAbsentWords('tts.params.speed', flash, fieldsOf())).toBeNull();
    expect(
      dialogueSocketAbsentWords('tts.params.speed', { tts: { provider: 'cartesia', model: 'eleven_v4' } }, fieldsOf()),
    ).toBeNull();
    expect(dialogueSocketAbsentWords('tts.params.speed', { tts: { provider: 'elevenlabs' } }, fieldsOf())).toBeNull();
  });
});

describe('tabLabel', () => {
  it('reads Turn · STT · LLM · TTS · Text · Router', () => {
    expect(GROUPS.map(tabLabel).join(' · ')).toBe('Turn · STT · LLM · TTS · Text · Router');
  });
});

describe('the reasoning select (gap G4)', () => {
  it('glosses every value of the pipeline\'s REASONING_VALUES and nothing else', () => {
    for (const value of REASONING_VALUES) expect(reasoningGloss(value)).not.toBeNull();
    expect(reasoningGloss('none')).toBeNull();
  });

  it('says what each value sends, as the schema copy documents it', () => {
    expect(optionLabel('llm.params.reasoning', 'off')).toBe('off — sends enabled:false');
    expect(optionLabel('llm.params.reasoning', 'omit')).toBe('omit — sends no reasoning field');
    expect(optionLabel('llm.params.reasoning', 'high')).toBe('high — sends effort:high');
  });

  it('leaves every other enum as its value', () => {
    expect(optionLabel('stt.params.turn_trigger', 'speech_final')).toBe('speech_final');
  });

  it('advises only when off is chosen, and only on the reasoning leaf', () => {
    expect(reasoningAdvice('llm.params.reasoning', 'off')).toBe(REASONING_OFF_ADVICE);
    expect(reasoningAdvice('llm.params.reasoning', 'omit')).toBeNull();
    expect(reasoningAdvice('llm.params.reasoning', '')).toBeNull();
    expect(reasoningAdvice('llm.model', 'off')).toBeNull();
  });
});

const REPORT = offeredOf(
  parseBootReport({
    id: '9',
    tenant_id: 'pilot',
    booted_at: new Date('2026-09-23T01:00:00Z'),
    build_sha: 'abc1234',
    fonnus_env: 'prod',
    providers: 'real',
    vendors: { stt: ['deepgram'], tts: ['cartesia', 'elevenlabs'] },
    voices: {
      cartesia: [
        { id: 'linh', label: 'Linh', is_default: true },
        { id: 'minh', label: 'Minh', is_default: false },
      ],
      elevenlabs: [{ id: 'ngoc', label: 'Ngọc', is_default: true }],
    },
  }),
);

describe('voiceSuggestions — the tts.voice datalist (ADR 0014 decision 6)', () => {
  it('offers the chosen vendor\'s voices, id as the value and label shown, in .env order', () => {
    expect(voiceSuggestions(REPORT, ['cartesia'])).toEqual([
      { value: 'linh', label: 'Linh' },
      { value: 'minh', label: 'Minh' },
    ]);
  });

  it('names the vendor when the merged no-script row serves several', () => {
    expect(voiceSuggestions(REPORT, ['cartesia', 'elevenlabs']).map((entry) => entry.label)).toEqual([
      'Linh (cartesia)',
      'Minh (cartesia)',
      'Ngọc (elevenlabs)',
    ]);
  });

  it('offers nothing without a report, or for a vendor it lists no voice for', () => {
    expect(voiceSuggestions(null, ['cartesia'])).toEqual([]);
    expect(voiceSuggestions(REPORT, ['sonic'])).toEqual([]);
  });
});

describe('voiceCaption — the line under the voice box', () => {
  const suggestions = voiceSuggestions(REPORT, ['cartesia']);
  const unlisted = 'not in this box\'s cartesia voice list';

  it('reads a listed id by its label, trimmed as the schema trims it', () => {
    expect(voiceCaption(' minh ', suggestions, unlisted, null)).toEqual({ tone: 'label', text: 'Minh' });
  });

  it('keeps a stored id outside the list, and says so', () => {
    expect(voiceCaption('ngoc', suggestions, unlisted, null)).toEqual({ tone: 'caveat', text: unlisted });
  });

  it('says nothing for a blank box — the boot value', () => {
    expect(voiceCaption('', suggestions, unlisted, null)).toBeNull();
  });

  it('says the id cannot be checked when there is no list', () => {
    expect(voiceCaption('anything', [], unlisted, 'the id cannot be checked against this box')).toEqual({
      tone: 'caveat',
      text: 'the id cannot be checked against this box',
    });
  });
});
