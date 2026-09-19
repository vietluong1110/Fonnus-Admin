/**
 * The document path → flat key table, copied entry for entry from
 * `RUNTIME_KEY_MAP` at `../Fonnus/app/src/config/runtime.ts:164` with its own
 * comments (ADR 0011 decision 3). It is what the pipeline writes each leaf of a
 * `runtime_config` row into before it parses the merged flat record, so it is
 * also the key a call's `config_snapshot` carries that leaf under — which is how
 * the form shows what the last answered call actually ran on.
 *
 * A copy rather than a byte-pinned file because the pipeline does not pin this
 * map under a `contract-hash:` line (`PLAN.md` §Waiting on `../Fonnus`). What
 * holds it honest instead is `flat-keys.test.ts`: the key set equals the leaf
 * paths derived from the copied schema, both ways, so a leaf the pipeline adds
 * fails here rather than going silently unlabelled on screen. The flat key
 * NAMES are ASSUMED stable until that pin exists — a rename fails
 * `flat-keys.test.ts` only when `../Fonnus` is checked out beside this repo
 * (the test reads `RUNTIME_KEY_MAP` from it as text); without the sibling it
 * only makes a "ran on" hint read "—".
 *
 * A path more than one provider branch carries maps to one flat key per vendor,
 * exactly as the source spells it; `ranOn` in `document.ts` resolves which.
 */
export const FLAT_KEYS: Readonly<Record<string, string | Readonly<Record<string, string>>>> = {
  'turn.max_call_duration_sec': 'MAX_CALL_DURATION_SEC',
  'turn.max_turns_per_call': 'MAX_TURNS_PER_CALL',
  'turn.max_reprompts': 'MAX_REPROMPTS',
  'turn.max_turn_reopens': 'MAX_TURN_REOPENS',
  'turn.no_input_timeout_ms': 'NO_INPUT_TIMEOUT_MS',
  'turn.farewell_grace_ms': 'FAREWELL_GRACE_MS',
  'turn.stt_mute_on_first_audio': 'STT_MUTE_ON_FIRST_AUDIO',
  'turn.barge_in_enabled': 'BARGE_IN_ENABLED',
  'turn.barge_in_min_words': 'BARGE_IN_MIN_WORDS',
  'turn.barge_in_audio_window_ms': 'BARGE_IN_AUDIO_WINDOW_MS',
  'turn.vad_speech_threshold': 'VAD_SPEECH_THRESHOLD',
  // The vendor of the leg: the committed value is the default, and a row may
  // name any available vendor (ADR 0028 Decision 1).
  'stt.provider': 'STT_PROVIDER',
  // The one path two branches share, with a flat key each: the merge picks by
  // the document's own `stt.provider` (ADR 0024 Decision 4). Two paths would
  // put the vendor twice in one row.
  'stt.model': {
    deepgram: 'DEEPGRAM_MODEL',
    soniox: 'SONIOX_MODEL',
    speechmatics: 'SPEECHMATICS_MODEL',
  },
  // One language for both STT vendors and the TTS leg (ADR 0014).
  'stt.params.language': 'STT_LANGUAGE',
  // Deepgram's own parameters carry the vendor's prefix: they are one API's
  // numbers, meaningless on another vendor's call, and the snapshot is filtered
  // by vendor (ADR 0022 Decision 5, ADR 0024 Decision 5). The leaf names are
  // unchanged — a leaf is never renamed while a row may carry it.
  'stt.params.endpointing_ms': 'DEEPGRAM_ENDPOINTING_MS',
  'stt.params.utterance_end_ms': 'DEEPGRAM_UTTERANCE_END_MS',
  'stt.params.turn_trigger': 'DEEPGRAM_TURN_TRIGGER',
  'stt.params.keyterms': 'DEEPGRAM_KEYTERMS',
  'stt.params.smart_format': 'DEEPGRAM_SMART_FORMAT',
  'stt.params.punctuate': 'DEEPGRAM_PUNCTUATE',
  // Soniox's five, the same way (ADR 0024 Decision 3).
  'stt.params.max_endpoint_delay_ms': 'SONIOX_MAX_ENDPOINT_DELAY_MS',
  'stt.params.endpoint_sensitivity': 'SONIOX_ENDPOINT_SENSITIVITY',
  'stt.params.endpoint_latency_adjustment_level': 'SONIOX_ENDPOINT_LATENCY_ADJUSTMENT_LEVEL',
  'stt.params.context_terms': 'SONIOX_CONTEXT_TERMS',
  'stt.params.context_text': 'SONIOX_CONTEXT_TEXT',
  // Speechmatics's four, the same way (ADR 0025 Decision 4).
  'stt.params.end_of_utterance_silence_trigger':
    'SPEECHMATICS_END_OF_UTTERANCE_SILENCE_TRIGGER',
  'stt.params.max_delay': 'SPEECHMATICS_MAX_DELAY',
  'stt.params.additional_vocab': 'SPEECHMATICS_ADDITIONAL_VOCAB',
  'stt.params.sounds_like': 'SPEECHMATICS_SOUNDS_LIKE',
  'llm.model': 'OPENROUTER_MODEL',
  'llm.fallback_model': 'OPENROUTER_FALLBACK_MODEL',
  'llm.params.reasoning': 'OPENROUTER_REASONING',
  'llm.params.max_tokens': 'OPENROUTER_MAX_TOKENS',
  'llm.params.temperature': 'OPENROUTER_TEMPERATURE',
  'llm.params.top_p': 'OPENROUTER_TOP_P',
  'llm.params.stop': 'OPENROUTER_STOP',
  // The TTS leg's vendor and its own per-vendor model path, resolved by the
  // document's `tts.provider` exactly as `stt.model` is by `stt.provider`
  // (ADR 0026 Decision 6, ADR 0028 Decision 1).
  'tts.provider': 'TTS_PROVIDER',
  'tts.model': {
    cartesia: 'CARTESIA_TTS_MODEL',
    elevenlabs: 'ELEVENLABS_TTS_MODEL',
  },
  'tts.params.flush_ms': 'TTS_FLUSH_MS',
  'tts.params.min_sentence_chars': 'TTS_MIN_SENTENCE_CHARS',
  // Every vendor's optional request parameters keep the vendor's prefix: they
  // are one API's request fields, never reused for another vendor's prosody
  // controls (ADR 0023 Decision 3). `TTS_FLUSH_MS` and `TTS_MIN_SENTENCE_CHARS`
  // above stay neutral because they are this pipeline's own knobs.
  //
  // Two of the leaves are spelled the same in both branches and mean the same
  // thing to a reader — the reading speed and the pronunciation dictionary's id
  // — so they are one path each with a flat key per vendor, and a row never
  // says which vendor twice.
  'tts.params.speed': {
    cartesia: 'CARTESIA_SPEED',
    elevenlabs: 'ELEVENLABS_SPEED',
  },
  'tts.params.pronunciation_dict_id': {
    cartesia: 'CARTESIA_PRONUNCIATION_DICT_ID',
    elevenlabs: 'ELEVENLABS_PRONUNCIATION_DICT_ID',
  },
  'tts.params.volume': 'CARTESIA_VOLUME',
  'tts.params.max_buffer_delay_ms': 'CARTESIA_MAX_BUFFER_DELAY_MS',
  // ElevenLabs' five of its own (ADR 0026 Decision 5).
  'tts.params.stability': 'ELEVENLABS_STABILITY',
  'tts.params.similarity_boost': 'ELEVENLABS_SIMILARITY_BOOST',
  'tts.params.style': 'ELEVENLABS_STYLE',
  'tts.params.speaker_boost': 'ELEVENLABS_SPEAKER_BOOST',
  'tts.params.pronunciation_dict_version_id': 'ELEVENLABS_PRONUNCIATION_DICT_VERSION_ID',
  'text.system_prompt': 'SYSTEM_PROMPT',
  'text.greeting': 'GREETING_TEXT',
  'text.canned_reprompt': 'CANNED_REPROMPT',
  'text.canned_degraded': 'CANNED_DEGRADED',
  'text.canned_farewell': 'CANNED_FAREWELL',
};
