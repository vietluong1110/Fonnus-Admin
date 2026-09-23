import { describe, expect, it } from 'vitest';
import { keysFromRow, ranOnOf } from './call-config';

/** A call that ran under row #42, which set the LLM model and the Soniox endpointing delay. */
const SNAPSHOT: Record<string, unknown> = {
  FONNUS_BUILD_SHA: '5c2cb31aa0000000000000000000000000000000',
  PROVIDERS: 'real',
  STT_PROVIDER: 'soniox',
  SONIOX_MODEL: 'stt-rt-v5',
  SONIOX_MAX_ENDPOINT_DELAY_MS: 1_500,
  OPENROUTER_MODEL: 'openai/gpt-oss-safeguard-20b',
  OPENROUTER_TOP_P: 0.2,
  TTS_PROVIDER: 'cartesia',
  CARTESIA_TTS_MODEL: 'sonic-3.5',
  MAX_TURNS_PER_CALL: 20,
  runtime: {
    version: 42,
    config: {
      llm: { model: 'openai/gpt-oss-safeguard-20b' },
      stt: { provider: 'soniox', params: { max_endpoint_delay_ms: 1_500 } },
    },
  },
};

/** The same call with no `runtime` key: it ran on boot config. */
function boot(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(SNAPSHOT).filter(([key]) => key !== 'runtime'));
}

const COLUMNS = { stt_model: 'stt-rt-v5', tts_model: 'sonic-3.5' };

describe('ranOnOf', () => {
  it('names the row, each leg’s vendor and model, and the build', () => {
    const ran = ranOnOf(SNAPSHOT, COLUMNS, ['openai/gpt-oss-safeguard-20b']);
    expect(ran).toEqual({
      row: '42',
      stt: { vendor: 'soniox', model: 'stt-rt-v5' },
      llm: { model: 'openai/gpt-oss-safeguard-20b', others: [] },
      tts: { vendor: 'cartesia', model: 'sonic-3.5' },
      build: '5c2cb31aa0000000000000000000000000000000',
      fakeProviders: false,
    });
  });

  it('counts the turns that reported another model, and ignores turns with no accounting', () => {
    const ran = ranOnOf(SNAPSHOT, COLUMNS, [
      'openai/gpt-oss-safeguard-20b',
      'openai/gpt-oss-120b',
      null,
      'openai/gpt-oss-120b',
    ]);
    expect(ran.llm.others).toEqual([{ model: 'openai/gpt-oss-120b', turns: 2 }]);
  });

  it('reads a call with no runtime key as boot config', () => {
    expect(ranOnOf(boot(), COLUMNS, []).row).toBeNull();
  });

  it('reads a malformed runtime key as boot config, as layerOf does', () => {
    expect(ranOnOf({ ...SNAPSHOT, runtime: { version: 'x', config: {} } }, COLUMNS, []).row).toBeNull();
  });

  it('flags a call that ran on fake providers', () => {
    expect(ranOnOf({ ...SNAPSHOT, PROVIDERS: 'fake' }, COLUMNS, []).fakeProviders).toBe(true);
  });

  it('says nothing it was not told when there is no snapshot', () => {
    const ran = ranOnOf(null, { stt_model: null, tts_model: null }, ['m']);
    expect(ran.row).toBeNull();
    expect(ran.stt).toEqual({ vendor: null, model: null });
    expect(ran.llm).toEqual({ model: null, others: [{ model: 'm', turns: 1 }] });
    expect(ran.build).toBeNull();
  });
});

describe('keysFromRow', () => {
  it('tags exactly the keys whose path the row set, per-vendor keys included', () => {
    expect([...keysFromRow(SNAPSHOT)].sort()).toEqual([
      'OPENROUTER_MODEL',
      'SONIOX_MAX_ENDPOINT_DELAY_MS',
      'STT_PROVIDER',
    ]);
  });

  it('maps an old spelling of a renamed key through its new one', () => {
    const snapshot = {
      STT_PROVIDER: 'deepgram',
      STT_ENDPOINTING_MS: 300,
      runtime: { version: 7, config: { stt: { provider: 'deepgram', params: { endpointing_ms: 300 } } } },
    };
    expect(keysFromRow(snapshot).has('STT_ENDPOINTING_MS')).toBe(true);
  });

  it('is empty on a call that ran on boot config', () => {
    expect(keysFromRow(boot()).size).toBe(0);
  });

  it('never tags runtime itself or a key the row cannot set', () => {
    const keys = keysFromRow(SNAPSHOT);
    expect(keys.has('runtime')).toBe(false);
    expect(keys.has('FONNUS_BUILD_SHA')).toBe(false);
  });
});
