import { describe, expect, it } from 'vitest';
import { SNAPSHOT_GROUPS, groupSnapshot } from './snapshot-groups';

/**
 * One key of every prefix a snapshot can carry
 * (`../Fonnus/app/src/config/schema.ts`, `CONFIG_SNAPSHOT_KEYS`), the nested
 * `runtime` key, the three identity keys, a pre-2026-09-17 `STT_*` spelling,
 * and one key no version of this console knows.
 */
const SNAPSHOT: Record<string, unknown> = {
  FONNUS_ENV: 'prod',
  PROVIDERS: 'real',
  FONNUS_BUILD_SHA: 'a1c93f2',
  STT_PROVIDER: 'deepgram',
  STT_LANGUAGE: 'vi',
  STT_UTTERANCE_END_MS: 1_500,
  SAMPLE_RATE: 16_000,
  DEEPGRAM_MODEL: 'nova-3',
  SONIOX_MODEL: 'stt-rt-preview',
  SPEECHMATICS_SOUNDS_LIKE: { Augmentin: ['ao-men-tin'] },
  OPENROUTER_MODEL: 'openai/gpt-oss-120b',
  OPENROUTER_STOP: ['\n\n'],
  LLM_TTFB_MS: 15_000,
  TTS_PROVIDER: 'cartesia',
  TTS_FLUSH_MS: 250,
  CARTESIA_TTS_MODEL: 'sonic-3.5',
  ELEVENLABS_STABILITY: 0.4,
  BARGE_IN_ENABLED: false,
  VAD_SPEECH_THRESHOLD: 5_000,
  MAX_TURN_REOPENS: 2,
  NO_INPUT_TIMEOUT_MS: 10_000,
  MAX_CALL_DURATION_SEC: 600,
  MAX_TURNS_PER_CALL: 20,
  MAX_REPROMPTS: 2,
  MAX_CONSECUTIVE_FAILURES: 3,
  FAREWELL_GRACE_MS: 10_000,
  CONSENT_MODE: 'notice_continuation',
  RECORD_CALLS: 'full',
  SYSTEM_PROMPT: '…',
  GREETING_TEXT: '…',
  CANNED_FAREWELL: '…',
  runtime: { version: 7, config: { stt: { provider: 'deepgram' } } },
  FUTURE_TUNABLE_MS: 42,
};

function groupNameOf(key: string): string | undefined {
  return groupSnapshot(SNAPSHOT).find((group) =>
    group.entries.some((entry) => entry.key === key),
  )?.name;
}

describe('groupSnapshot — docs/upstream.md §Call detail, a rendering choice only', () => {
  it('puts every key in exactly one group and drops none (trap 6)', () => {
    const keys = groupSnapshot(SNAPSHOT).flatMap((group) => group.entries.map((e) => e.key));
    expect(keys.length).toBe(Object.keys(SNAPSHOT).length);
    expect([...keys].sort()).toEqual(Object.keys(SNAPSHOT).sort());
  });

  it('sends a key it does not know to Other rather than hiding it', () => {
    expect(groupNameOf('FUTURE_TUNABLE_MS')).toBe('Other');
  });

  it('gives the runtime config row its own group', () => {
    expect(groupNameOf('runtime')).toBe('Runtime config row');
  });

  it('files each vendor key under its leg, including the pre-rename STT_ spelling', () => {
    expect(groupNameOf('DEEPGRAM_MODEL')).toBe('Speech to text');
    expect(groupNameOf('SONIOX_MODEL')).toBe('Speech to text');
    expect(groupNameOf('SPEECHMATICS_SOUNDS_LIKE')).toBe('Speech to text');
    // Renamed to `DEEPGRAM_UTTERANCE_END_MS` on 2026-09-17; older rows keep it.
    expect(groupNameOf('STT_UTTERANCE_END_MS')).toBe('Speech to text');
    expect(groupNameOf('CARTESIA_TTS_MODEL')).toBe('Text to speech');
    expect(groupNameOf('ELEVENLABS_STABILITY')).toBe('Text to speech');
    expect(groupNameOf('OPENROUTER_MODEL')).toBe('Language model');
    expect(groupNameOf('LLM_TTFB_MS')).toBe('Language model');
  });

  it('heads each vendor group with the provider key, read before any vendor key', () => {
    const groups = groupSnapshot(SNAPSHOT);
    expect(groups.find((g) => g.name === 'Speech to text')?.entries[0]?.key).toBe('STT_PROVIDER');
    expect(groups.find((g) => g.name === 'Text to speech')?.entries[0]?.key).toBe('TTS_PROVIDER');
  });

  it('keeps the groups in their declared order and leaves empty ones out', () => {
    const order = groupSnapshot(SNAPSHOT).map((group) => group.name);
    expect(order).toEqual(SNAPSHOT_GROUPS.filter((name) => order.includes(name)));
    expect(groupSnapshot({ TTS_FLUSH_MS: 250 })).toEqual([
      { name: 'Text to speech', entries: [{ key: 'TTS_FLUSH_MS', value: 250 }] },
    ]);
  });

  it('files the turn-taking, limit, consent and text keys where the card reads them', () => {
    expect(groupNameOf('BARGE_IN_ENABLED')).toBe('Turn taking');
    expect(groupNameOf('MAX_TURN_REOPENS')).toBe('Turn taking');
    expect(groupNameOf('MAX_TURNS_PER_CALL')).toBe('Call limits');
    expect(groupNameOf('CONSENT_MODE')).toBe('Consent & recording');
    expect(groupNameOf('SYSTEM_PROMPT')).toBe('Texts');
    expect(groupNameOf('CANNED_FAREWELL')).toBe('Texts');
  });

  it('has nothing to group on an empty object', () => {
    expect(groupSnapshot({})).toEqual([]);
  });
});
