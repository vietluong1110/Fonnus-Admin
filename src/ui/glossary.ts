/*
 * The one file in which a friendly name is written (ADR 0013 decision 3).
 *
 * Every label that names a pipeline concept is a pair: `name`, the console's
 * plain-language name, and `code`, the pipeline's own term, rendered beside it
 * every time (decision 1). A screen obtains a name only through `termFor` and
 * the helpers below; `glossary-scan.test.ts` fails on a name or a code written
 * anywhere else under `src/app` or `src/ui`, and `glossary.test.ts` holds the
 * maps equal to the vocabularies they name, both ways.
 *
 * The names and descriptions are ADR 0013 §Glossary verbatim; a veto of a name
 * (ADR 0013 A2) is an edit here only. Model ids, voice ids and build SHAs have
 * no entry on purpose (decision 2): they render verbatim.
 *
 * Pure: no React, so a client component can import it.
 */

import type { Grouping } from '../dashboard';
import type { HolderKind } from '../intervals';

export interface Term {
  name: string;
  code: string;
  description?: string;
}

export type GlossaryNamespace =
  | 'span'
  | 'leg'
  | 'endReason'
  | 'consentOutcome'
  | 'failedLeg'
  | 'failedStage'
  | 'turnSource'
  | 'holder'
  | 'canned'
  | 'grouping'
  | 'configLeaf';

type Entries = Readonly<Record<string, Omit<Term, 'code'>>>;

/** Each map keyed by the pipeline's code; `code` is filled in from the key. */
const ENTRIES: Readonly<Record<GlossaryNamespace, Entries>> = {
  // Headline spans (`turn` columns; PIPELINE_ARCHITECTURE.md §6), plus the
  // elapsed time of a failed reply (ADR 0013 §Turn failure).
  span: {
    pipeline_ms: {
      name: 'Pipeline latency',
      description:
        'endpoint_decision → first_audio_out: the part of the wait the pipeline controls, and the tuning target (P95 < 1 200 ms).',
    },
    caller_perceived_ms: {
      name: 'Caller-perceived latency',
      description: 'speech_end → first_audio_out: how long the caller waited in silence.',
    },
    'llm_first_reasoning → llm_first_token': {
      name: 'Model reasoning',
      description:
        "The model's thinking before its first spoken token; sits inside LLM first token. Absent on a model that emits no reasoning.",
    },
    failed_after_ms: {
      name: 'Failed after',
      description: 'measured from the endpoint decision, not the configured limit (trap 7).',
    },
    // `call_log.greeting_first_audio_ms` (contract §3.1): the greeting's wait,
    // on the call rather than on a turn.
    greeting_first_audio_ms: {
      name: 'Answered → first audio',
      description:
        "From the moment the channel was answered to the greeting's first audio frame — measured from the answer, not from started_at",
    },
    // The end-of-turn spans (`src/latency.ts` END_OF_TURN_PAIRS, contract
    // §3.2). The pipeline names no span for them and the console coins none
    // (ADR 0013), so each name is its mark pair; the code shown beside it is
    // the contract's name for the group (`CODE_OVERRIDE`).
    'llm_first_token → llm_last_token': {
      name: 'llm_first_token → llm_last_token',
      description: "The language model's stream, from its first token to the normal end of the stream.",
    },
    'tts_first_byte → tts_last_byte': {
      name: 'tts_first_byte → tts_last_byte',
      description: 'Synthesis, from the first byte to the last byte of the last sentence.',
    },
    'playback_start → playback_end': {
      name: 'playback_start → playback_end',
      description:
        "FreeSWITCH's playback of the reply, from the first played chunk to its last report of an empty queue.",
    },
  },

  // Legs (`src/latency.ts` `LEGS`).
  leg: {
    stt_emit: {
      name: 'Transcript arrival',
      description:
        "speech_end → stt_final: the provider's transcript latency after the caller stopped talking. Outside the partition; overlaps End-of-speech wait.",
    },
    endpoint_wait: {
      name: 'End-of-speech wait',
      description:
        'speech_end → endpoint_decision: the endpointing silence — the gap the reducer cannot shorten.',
    },
    llm_ttft: {
      name: 'LLM first token',
      description: "endpoint_decision → llm_first_token: turn committed to the model's first token.",
    },
    tts_ttfb: {
      name: 'TTS first audio (first sentence)',
      description:
        'llm_first_token → tts_first_byte: first token to the first synthesized byte, first sentence of the reply only.',
    },
    send: {
      name: 'Audio send',
      description:
        "tts_first_byte → first_audio_out: synthesized to handed to the audio sink — the pipeline's own buffering.",
    },
    playback: {
      name: 'Playback',
      description:
        "first_audio_out → playback_start: sink to FreeSWITCH's report of the first played chunk. Advisory, outside the partition.",
    },
  },

  // `call_log.end_reason` (contract §3.1).
  endReason: {
    max_duration: { name: 'Hit duration cap' },
    max_turns: { name: 'Hit turn cap' },
    max_reprompts: { name: 'Hit reprompt cap' },
    provider_failure: { name: 'Provider failure' },
    caller_hangup: { name: 'Caller hung up' },
    shutdown: { name: 'Process shut down' },
    media_stream_closed: { name: 'Media stream closed' },
  },

  // `consent_record.outcome` (contract §3.1). No row is a state of the call
  // (trap 2), not a vocabulary value, so it has no entry.
  consentOutcome: {
    granted: { name: 'Consent granted' },
    hung_up_before_disclosure: { name: 'Hung up before disclosure' },
    hung_up_before_consent: { name: 'Hung up before consent' },
  },

  // `turn.failed_leg` · `turn.failed_stage` (contract §3.1), shown as one chip
  // through `failureChip`.
  failedLeg: {
    llm: { name: 'LLM' },
    tts: { name: 'TTS' },
  },
  failedStage: {
    ttfb: { name: 'no first token/byte in time' },
    idle: { name: 'stream stalled' },
    total: { name: 'over the total limit' },
  },

  // `turn.source`, the open vocabulary: every other value goes through
  // `turnSourceTerm` (ADR 0013 decision 4).
  turnSource: {
    carry_over: { name: 'Text arrived during the reply' },
    reopen: { name: 'Reopened before the reply was heard' },
  },

  // Interval holders (`src/intervals.ts` `HolderKind`). `reply` and `waiting`
  // take the turn number and `canned` the line through `holderTerm`.
  holder: {
    greeting: { name: 'Fonnus · greeting' },
    reply: { name: 'Fonnus · reply' },
    waiting: { name: 'Fonnus · preparing reply' },
    canned: { name: 'Fonnus · canned line' },
    caller: { name: 'Caller' },
    silence: { name: 'Silence' },
    deaf: { name: 'Not listening (STT reconnecting)' },
  },

  // The three canned lines (`../Fonnus/app/src/domain/effects.ts` `CannedLine`).
  canned: {
    reprompt: { name: 'Fonnus · reprompt' },
    degraded: { name: 'Fonnus · degraded line' },
    farewell: { name: 'Fonnus · farewell' },
  },

  // The eight Overview groupings, keyed by their URL value (ADR 0009). The
  // voice grouping's code is the two snapshot keys it coalesces
  // (docs/upstream.md §Overview), set in `GROUPING_CODE`.
  grouping: {
    'key:OPENROUTER_MODEL': { name: 'LLM model' },
    stt_model: { name: 'STT model' },
    tts_model: { name: 'TTS model' },
    voice: { name: 'Voice' },
    'key:OPENROUTER_REASONING': { name: 'Reasoning' },
    'key:STT_PROVIDER': { name: 'STT vendor' },
    'key:TTS_PROVIDER': { name: 'TTS vendor' },
    'key:runtime.version': { name: 'Runtime config row' },
  },

  // The 55 configuration leaves (`src/configuration/flat-keys.ts`); where
  // each sentence comes from is ADR 0013 §Evidence.
  configLeaf: {
    'turn.max_call_duration_sec': {
      name: 'Max call length (s)',
      description:
        'The call ends with the farewell line once it has run this many seconds (pipeline ADR 0004 §9); must stay 30 s under the FreeSWITCH backstop MAX_CALL_SEC.',
    },
    'turn.max_turns_per_call': {
      name: 'Max turns per call',
      description: 'The call ends with the farewell line after this many turns.',
    },
    'turn.max_reprompts': {
      name: 'Max reprompts',
      description:
        'How many times the bot says the reprompt line to a silent caller before ending the call; 0 never reprompts.',
    },
    'turn.max_turn_reopens': {
      name: 'Max turn reopens',
      description:
        'How many times one turn may be reopened when the caller speaks again before its reply is heard; 0 never reopens.',
    },
    'turn.no_input_timeout_ms': {
      name: 'No-input timeout (ms)',
      description: 'Silence from the caller after which the reprompt timer fires.',
    },
    'turn.farewell_grace_ms': {
      name: 'Farewell grace (ms)',
      description:
        'The longest the call stays open after the farewell line before the pipeline hangs up on its own (bounds a lost playback-drain report).',
    },
    'turn.stt_mute_on_first_audio': {
      name: 'Mute STT at first audio',
      description:
        "When the caller's audio stops reaching speech-to-text for a reply: on (the default) at the reply's first audible byte, off at the moment the turn is committed — the old behaviour, kept as a rollback (pipeline ADR 0004 §2).",
    },
    'turn.barge_in_enabled': {
      name: 'Barge-in',
      description: "Lets the caller cut a reply or a reprompt short by speaking over it, once both barge-in signals agree (pipeline ADR 0004 §5); off in production, and as built it cannot fire, because speech-to-text is muted while the bot is audible.",
    },
    'turn.barge_in_min_words': {
      name: 'Barge-in min words',
      description: "The fewest words one recogniser result (partial or final) heard during the reply must carry to count as barge-in's word signal; the count does not expire until the next reply, and caller line energy must also agree.",
    },
    'turn.barge_in_audio_window_ms': {
      name: 'Barge-in audio window (ms)',
      description: "How recent the caller's last loud frame (at or above the speech threshold) must be when the word signal is met for a barge-in to fire; it bounds the energy signal only, not the words.",
    },
    'turn.vad_speech_threshold': {
      name: 'Speech energy threshold',
      description:
        "The loudest 16-bit sample a caller audio frame must reach to count as speech: barge-in's energy signal, and where a turn's utterance starts in the recording (turn.speech_start_ms); 500 fires on room noise, 5 000 is the proven value.",
    },
    'stt.provider': {
      name: 'STT vendor',
      description:
        'Which speech-to-text vendor the call runs on; the committed value is the default and a row may name any vendor the box holds a key for.',
    },
    'stt.model': {
      name: 'STT model',
      description:
        "The vendor's model id (DEEPGRAM_MODEL / SONIOX_MODEL / SPEECHMATICS_MODEL); one of the catalogue, every entry priced.",
    },
    'stt.params.language': {
      name: 'Language',
      description: 'The request language of both the STT and the TTS leg (pipeline ADR 0014).',
    },
    'stt.params.endpointing_ms': {
      name: 'Endpointing silence (ms)',
      description: 'Deepgram: silence after which a speech_final is sent.',
    },
    'stt.params.utterance_end_ms': {
      name: 'Utterance end (ms)',
      description:
        'Deepgram: silence after which UtteranceEnd is sent; 1 000–5 000, a smaller value is ignored by the vendor.',
    },
    'stt.params.turn_trigger': {
      name: 'Turn-end frame',
      description:
        'Deepgram: which of its two end-of-speech frames (utterance_end, speech_final) becomes the turn-end signal.',
    },
    'stt.params.keyterms': {
      name: 'Keyterms',
      description:
        "Deepgram (Nova-3): the clinic's own names — services, doctors, wards — a general model mishears; at most 50 terms, 800 characters joined.",
    },
    'stt.params.smart_format': {
      name: 'Smart format',
      description: 'Deepgram: punctuation plus entity formatting.',
    },
    'stt.params.punctuate': {
      name: 'Punctuate',
      description: 'Deepgram: punctuation alone.',
    },
    'stt.params.max_endpoint_delay_ms': {
      name: 'Max endpoint delay (ms)',
      description:
        'Soniox: silence before the <end> token that ends the turn; 500–3 000, vendor default 2 000.',
    },
    'stt.params.endpoint_sensitivity': {
      name: 'Endpoint sensitivity',
      description: 'Soniox v5: higher ends the turn sooner; −1 to 1, default 0.',
    },
    'stt.params.endpoint_latency_adjustment_level': {
      name: 'Endpoint latency level',
      description:
        'Soniox v5: higher means lower latency and more endpoints at slightly lower accuracy; 0–3, default 0.',
    },
    'stt.params.context_terms': {
      name: 'Context terms',
      description: 'Soniox: term biasing, the same list shape as Keyterms and the same bounds.',
    },
    'stt.params.context_text': {
      name: 'Context text',
      description:
        'Soniox: free text saying what this conversation is about; at most 2 000 characters.',
    },
    'stt.params.end_of_utterance_silence_trigger': {
      name: 'End-of-utterance silence (s)',
      description:
        'Speechmatics: silence after which EndOfUtterance ends the turn; 0.1–2 s, must stay below Max delay.',
    },
    'stt.params.max_delay': {
      name: 'Max delay (s)',
      description:
        "Speechmatics: seconds between a spoken word's end and the final that carries it; 0.7–4, vendor default 4.",
    },
    'stt.params.additional_vocab': {
      name: 'Additional vocabulary',
      description:
        'Speechmatics: term biasing, the same list shape as Keyterms; each term at most six words.',
    },
    'stt.params.sounds_like': {
      name: 'Sounds like',
      description:
        'Speechmatics: how a listed term is heard (a foreign drug name in Vietnamese speech); every key must be a term of Additional vocabulary.',
    },
    'llm.model': {
      name: 'LLM model',
      description:
        'The OpenRouter model id, free text; an id with no price row makes every cost figure a floor.',
    },
    'llm.fallback_model': {
      name: 'Fallback model',
      description:
        'The model tried when the primary fails; empty means no fallback (pipeline ADR 0010 rule 5).',
    },
    'llm.params.reasoning': {
      name: 'Reasoning effort',
      description:
        'What the reasoning field sends: omit sends nothing (always safe), off sends enabled: false (some models answer HTTP 400 to it — openai/gpt-oss-120b does; use omit instead), an effort level asks the model to think that hard. A property of the model, set in the same row as the model.',
    },
    'llm.params.max_tokens': {
      name: 'Max output tokens',
      description: 'The most tokens one reply may generate.',
    },
    'llm.params.temperature': {
      name: 'Temperature',
      description: 'Sampling temperature, 0–2.',
    },
    'llm.params.top_p': {
      name: 'Top-p',
      description: 'Nucleus sampling bound, 0 < top_p ≤ 1.',
    },
    'llm.params.stop': {
      name: 'Stop sequences',
      description: 'One to four strings at which generation stops.',
    },
    'tts.provider': {
      name: 'TTS vendor',
      description:
        'Which text-to-speech vendor the call runs on; the committed value is the default.',
    },
    'tts.model': {
      name: 'TTS model',
      description:
        "The vendor's model id (CARTESIA_TTS_MODEL / ELEVENLABS_TTS_MODEL); one of the catalogue, every entry priced.",
    },
    'tts.voice': {
      name: 'Voice',
      description:
        "The vendor's voice id, one of the ids the box's .env lists for that vendor; an id outside the list is refused at boot and on every merged row, and the call falls back to boot config.",
    },
    'tts.params.flush_ms': {
      name: 'Flush interval (ms)',
      description:
        "How much synthesized audio the reply pipeline accumulates before it writes a frame to the call; the pipeline's own knob, every vendor.",
    },
    'tts.params.min_sentence_chars': {
      name: 'Min sentence length (chars)',
      description:
        "The shortest sentence the pipeline sends to synthesis on its own: a shorter piece is merged into the next one, except the last piece, which is always sent; the pipeline's own knob, every vendor.",
    },
    'tts.params.speed': {
      name: 'Reading speed',
      description:
        'How fast the voice reads, 1.0 the vendor default; Cartesia 0.6–1.5, ElevenLabs 0.7–1.2.',
    },
    'tts.params.volume': {
      name: 'Volume',
      description: 'Cartesia: how loud the voice is, 0.5–2, 1.0 the default.',
    },
    'tts.params.pronunciation_dict_id': {
      name: 'Pronunciation dictionary id',
      description:
        'A dictionary created out of band that fixes how a drug or doctor name is spoken; ElevenLabs needs the version id beside it.',
    },
    'tts.params.max_buffer_delay_ms': {
      name: 'Max buffer delay (ms)',
      description:
        'Cartesia: how long it buffers text before generating, 0–5 000, its default 3 000; a delay that applies is latency the caller waits through.',
    },
    'tts.params.stability': {
      name: 'Stability',
      description:
        'ElevenLabs: how much the delivery varies between generations, 0–1, 0.5 the default.',
    },
    'tts.params.similarity_boost': {
      name: 'Similarity boost',
      description: 'ElevenLabs: how closely the voice clone is followed, 0–1, 0.75 the default.',
    },
    'tts.params.style': {
      name: 'Style exaggeration',
      description:
        'ElevenLabs: 0–1, 0 the default and the fastest; whether Flash v2.5 honours it is unverified.',
    },
    'tts.params.speaker_boost': {
      name: 'Speaker boost',
      description:
        'ElevenLabs: extra similarity at some latency, true the default; unverified on Flash v2.5.',
    },
    'tts.params.pronunciation_dict_version_id': {
      name: 'Pronunciation dictionary version',
      description:
        'ElevenLabs: the other half of the dictionary locator; required together with the id.',
    },
    'text.system_prompt': {
      name: 'System prompt',
      description:
        'The instruction block the model reads on every turn; at most 8 000 characters; never spoken, so the slash and speakable rules do not apply. Shown under the Language model tab (a display placement only; the path stays text.).',
    },
    'text.greeting': {
      name: 'Greeting',
      description:
        'The disclosure line the caller hears first; legally load-bearing (Law 134/2025), at most 600 characters, no /, and it must survive the speakable filter unchanged.',
    },
    'text.canned_reprompt': {
      name: 'Reprompt line',
      description: 'Said when the no-input timer fires; same mechanical rules as the greeting.',
    },
    'text.canned_degraded': {
      name: 'Degraded line',
      description: 'Said when the reply pipeline cannot answer; same rules.',
    },
    'text.canned_farewell': {
      name: 'Farewell line',
      description: 'Said when a limit ends the call; same rules.',
    },
  },
};

/**
 * Where an entry's `code` is not its key: the voice grouping is one URL value
 * over two snapshot keys, and the code shown is the pipeline's, never the URL's.
 */
const CODE_OVERRIDE: Partial<Record<GlossaryNamespace, Readonly<Record<string, string>>>> = {
  grouping: { voice: 'key:CARTESIA_VOICE_ID ∥ key:ELEVENLABS_VOICE_ID' },
  span: {
    'llm_first_token → llm_last_token': 'end-of-turn marks',
    'tts_first_byte → tts_last_byte': 'end-of-turn marks',
    'playback_start → playback_end': 'end-of-turn marks',
  },
};

export const GLOSSARY: Readonly<Record<GlossaryNamespace, Readonly<Record<string, Term>>>> =
  Object.fromEntries(
    Object.entries(ENTRIES).map(([ns, entries]) => [
      ns,
      Object.fromEntries(
        Object.entries(entries).map(([key, entry]) => [
          key,
          { ...entry, code: CODE_OVERRIDE[ns as GlossaryNamespace]?.[key] ?? key },
        ]),
      ),
    ]),
  ) as Record<GlossaryNamespace, Record<string, Term>>;

/**
 * The glossary's entry for a code, or null — null is "unknown to the
 * glossary", and the caller renders the value raw with the ⚠ badge
 * (ADR 0013 decision 4). Own keys only: a stored value can be any string.
 */
export function termFor(ns: GlossaryNamespace, code: string | null): Term | null {
  if (code === null) return null;
  const entries = GLOSSARY[ns];
  return Object.hasOwn(entries, code) ? (entries[code] ?? null) : null;
}

/**
 * `turn.source`: its two fixed values from the glossary; any other value is a
 * vendor's frame name, shown as the code beside a fixed name and never marked
 * ⚠ (contract §3.1, ADR 0013 decision 4). Null is no source on record.
 */
export function turnSourceTerm(source: string | null): Term | null {
  if (source === null) return null;
  return termFor('turnSource', source) ?? { name: 'Vendor end-of-speech signal', code: source };
}

/** The trailing number of a holder label, `bot: reply 3` → 3. */
function labelNumber(label: string): number | null {
  const match = /\s(\d+)$/.exec(label);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/**
 * Who held the line in one interval: `Fonnus · reply 3`, `Fonnus · farewell`.
 * `code` is the pipeline's original string (`bot: reply 3`). The reply number
 * is the turn's, else the one the label carries (the pipeline falls back to
 * the generation, `src/intervals.ts`); a canned line with no `line` field
 * reads "canned line".
 */
export function holderTerm(h: { kind: HolderKind; label: string; turnIdx: number | null }): Term {
  const base = GLOSSARY.holder[h.kind]?.name ?? h.label;
  if (h.kind === 'reply' || h.kind === 'waiting') {
    const n = h.turnIdx ?? labelNumber(h.label);
    return { name: n === null ? base : `${base} ${String(n)}`, code: h.label };
  }
  if (h.kind === 'canned') {
    const line = h.label.startsWith('bot: ') ? h.label.slice('bot: '.length) : null;
    return { name: termFor('canned', line)?.name ?? base, code: h.label };
  }
  return { name: base, code: h.label };
}

/** A failed leg whose stage is null: the provider answered with an error (trap 7). */
const PROVIDER_ERROR = 'provider error';

/**
 * A turn's failure as one chip, `<leg name> · <stage name>` (ADR 0013 §Turn
 * failure): null when nothing failed, "provider error" for a null stage. A leg
 * or stage outside the contract's list renders as stored.
 */
export function failureChip(leg: string | null, stage: string | null): Term | null {
  if (leg === null) return null;
  const legName = termFor('failedLeg', leg)?.name ?? leg;
  const stageName = stage === null ? PROVIDER_ERROR : (termFor('failedStage', stage)?.name ?? stage);
  return { name: `${legName} · ${stageName}`, code: stage === null ? leg : `${leg} · ${stage}` };
}

/** The groupings the Overview control offers, in ADR 0013's order. */
export const OVERVIEW_GROUPINGS: readonly { value: Grouping; term: Term }[] = (
  [
    'key:OPENROUTER_MODEL',
    'stt_model',
    'tts_model',
    'voice',
    'key:OPENROUTER_REASONING',
    'key:STT_PROVIDER',
    'key:TTS_PROVIDER',
    'key:runtime.version',
  ] as const satisfies readonly Grouping[]
).map((value) => {
  const term = GLOSSARY.grouping[value];
  if (term === undefined) throw new Error(`no glossary entry for grouping ${value}`);
  return { value, term };
});
