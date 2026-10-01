/**
 * The **contract file** (ADR 0021 Decision 2): everything a console needs to
 * render, validate and restore the documents it edits — a `runtime_config`
 * document and, since ADR 0031, one `faq_entry` row — in one file that can be
 * copied into another repo as it stands.
 *
 * It imports `zod` and `../domain/speakable.js` — nothing else, ever. That is
 * the whole point: the admin console copies this file and `domain/speakable.ts`
 * into its own tree at the same relative layout and validates a document with
 * the same schema the pipeline runs, so an edit the app would refuse is refused
 * in the form instead of on every later call. `docs/read-contract.md` §7 pins
 * both files' bytes with a `contract-hash` line, and `check-config` rule 14
 * recomputes them, so this file cannot change without the contract saying so.
 *
 * What lives here: the document schema and the **leaf schemas** it is built
 * from (each bound written once — the flat schema in `schema.ts` pipes its
 * string input through the same leaf), the model catalogue and the two value
 * lists a form renders as selects, the shipped texts that are both the defaults
 * and the restore target, and `disclosureAdvice`. What stays in `runtime.ts` is
 * what only this process needs: the path → flat key table and the merge.
 *
 * Pure: schemas and plain functions over plain values, no I/O and no clock.
 */
import { z } from 'zod';
import { speakable } from '../domain/speakable.js';

/**
 * The STT and TTS model ids an editor may choose, per provider — only the
 * providers that have an adapter (ADR 0020 Decision 4). LLM ids stay free text:
 * OpenRouter's catalogue is not ours to enumerate, and an unpriced LLM id
 * already has a defined outcome (`total_cost_vnd` null, never 0).
 *
 * `check-config` rule 13 keeps every id here priced in `domain/pricing.ts`, so
 * a call can never run on a catalogue model the cost column cannot price.
 */
export const MODEL_CATALOGUE = {
  deepgram: ['nova-3'],
  soniox: ['stt-rt-v5'],
  speechmatics: ['enhanced'],
  cartesia: ['sonic-3.6', 'sonic-3.5'],
  elevenlabs: ['eleven_flash_v2_5'],
} as const;

/**
 * What `OPENROUTER_REASONING` and `llm.params.reasoning` may say, and what each
 * value sends:
 *
 *   omit                              no `reasoning` field at all
 *   off                               `reasoning: { enabled: false }`
 *   minimal|low|medium|high|xhigh|max `reasoning: { effort: <value>, exclude: false }`
 *
 * OpenRouter docs, read 2026-09-03: `reasoning` takes either `effort` (one of
 * `max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none`) or `max_tokens`,
 * never both; `exclude: true` (default false) keeps the reasoning internal and
 * out of the response, and is documented as supported by all models;
 * `enabled: true|false` switches reasoning with default parameters.
 *
 * `omit` is the always-safe value: a model that rejects the field cannot be
 * broken by a field that is not sent. `off` is the low-latency value for a
 * model that reasons by default and allows disabling (measured 2026-08-30 on
 * qwen3.5-397b: 25.8 s to the first content token with reasoning on, 0.59 s
 * with `enabled: false`). The effort values are for a model whose OpenRouter
 * listing reads `reasoning.mandatory: true` — it answers 400 to
 * `enabled: false` (observed 2026-09-03 on `openai/gpt-oss-120b`), so it must
 * be asked to reason. `exclude: false` — the vendor default, sent explicitly —
 * asks for the thoughts back: they are recorded per turn and never spoken
 * (W2-L3).
 *
 * OpenRouter's `none` is deliberately absent: `off` is the one name here for
 * "do not reason". The union itself lives in `domain/ports.ts` — which values
 * exist is the shape of an LLM request — and `schema.ts` re-exports this list
 * behind a `satisfies` guard against it.
 */
export const REASONING_VALUES = [
  'omit',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/**
 * Which Deepgram frame the adapter promotes to the turn-end signal (ADR 0022
 * Decision 2). One list for both parsers: the flat key's enum is built from it,
 * so a value a form offers is a value the boot accepts.
 */
export const STT_TURN_TRIGGER_VALUES = ['utterance_end', 'speech_final'] as const;

/**
 * The STT vendors this build has an adapter for, and the `provider`
 * discriminator of the document's `stt` branch (ADR 0022 Decision 4). A console
 * renders one form per entry; `STT_PROVIDER` in `config/schema.ts` takes the
 * same list, so the vendor a form offers is a vendor the boot accepts.
 */
export const STT_PROVIDER_VALUES = ['deepgram', 'soniox', 'speechmatics'] as const;
export type SttProviderValue = (typeof STT_PROVIDER_VALUES)[number];

/**
 * The TTS vendors this build has an adapter for, and the `provider`
 * discriminator of the document's `tts` branch (ADR 0023 Decision 1). The STT
 * list's twin one leg over: a console renders one form per entry, and
 * `TTS_PROVIDER` in `config/schema.ts` takes the same list, so the vendor a
 * form offers is a vendor the boot accepts.
 */
export const TTS_PROVIDER_VALUES = ['cartesia', 'elevenlabs'] as const;
export type TtsProviderValue = (typeof TTS_PROVIDER_VALUES)[number];

/**
 * What the router does on a caller turn (ADR 0032 Decision 6): `off` asks
 * nothing and records nothing; `shadow` asks the router beside the LLM and
 * writes its decision to the trail, never to what the caller hears. `on`
 * arrives with J5. `ROUTER_MODE` in `config/schema.ts` takes the same list, so
 * the mode a form offers is a mode the boot accepts.
 */
export const ROUTER_MODE_VALUES = ['off', 'shadow'] as const;

/**
 * The texts this build ships with (ADR 0021 Decision 4): the default of each
 * of the six text keys, and the target of the console's "restore" — a new row
 * carrying one of these strings. They are no longer "in code on purpose": a
 * tenant's row may replace any of them, effective on the next call, under the
 * mechanical rules of `LEAF.text` below.
 *
 * The greeting is legally load-bearing (Law 134/2025, CONTEXT §Legal) and still
 * pending counsel review (build plan §3.2); `disclosureAdvice` is the soft
 * guardrail on it, never a refusal. The clinic name arrives with `tenant_config`.
 */
export const SHIPPED_TEXT = {
  /**
   * Placeholder system prompt, still code-owned until the prompt becomes a
   * versioned tenant artifact (W5-A, build plan §3.4).
   *
   * The speech-shaping block is the first of ADR 0016's two levers: the reply
   * is read out loud over a phone, so the model is told to write it as speech —
   * numbers, times and prices as Vietnamese words, no emoji, no markdown, no
   * lists, no abbreviations, one or two short sentences. The second lever is
   * `domain/speakable.ts`, which deletes what arrives unpronounceable anyway;
   * an instruction to a model is not an invariant.
   */
  system_prompt:
    'Bạn là trợ lý AI của một phòng khám tại Việt Nam. ' +
    'Câu trả lời của bạn được đọc thành tiếng cho người gọi nghe qua điện thoại, ' +
    'nên hãy viết đúng như lời nói: không dùng emoji, không dùng ký hiệu markdown, ' +
    'không dùng danh sách gạch đầu dòng hay danh sách đánh số, không viết tắt. ' +
    'Không dùng dấu gạch chéo, hãy viết "hoặc" hay "và" thay cho dấu "/". ' +
    'Mọi con số, giờ giấc và giá tiền phải viết bằng chữ tiếng Việt, ' +
    'ví dụ "mười bảy giờ", "hai trăm nghìn đồng". ' +
    'Trả lời bằng tiếng Việt, lịch sự, mỗi lượt chỉ một đến hai câu ngắn. ' +
    'Không đưa ra lời khuyên y khoa.',

  /**
   * Draft disclosure greeting (build plan §3.2, pending counsel).
   *
   * The earlier draft's "Cuộc gọi sẽ được kết nối ngay sau vài giây." is
   * removed deliberately — it implies a human is coming and contradicts the AI
   * disclosure. It must not come back.
   */
  greeting:
    'Xin chào, đây là phòng khám. Em là trợ lý AI. ' +
    // "anh chị", never "anh/chị": VERIFIED on the box 2026-09-05 — Cartesia
    // Sonic treats the slash as a token boundary and spells the word before it
    // out letter by letter ("A N H chị"). The same reason the system prompt
    // forbids the character in the model's own replies, and the reason the five
    // spoken texts refuse one below.
    'Cuộc gọi được ghi âm để xử lý yêu cầu của anh, chị và lưu hồ sơ. ' +
    'Em có thể giúp gì cho mình ạ?',

  // The silence watchdog is this line's only caller (`turn-engine.ts`,
  // `timer_fired` on `no_input`), so it always reaches a caller who has said
  // nothing yet — "vui lòng nói lại" asked them to repeat what they never said.
  canned_reprompt: 'Dạ, em vẫn đang nghe ạ, anh chị cứ nói ạ.',

  canned_degraded: 'Dạ, hệ thống đang bận, anh chị vui lòng chờ giây lát ạ.',

  // One closing line for every limit (ADR 0004 §9): the caller must hear that
  // the call ended on purpose, whichever limit tripped.
  canned_farewell:
    'Dạ, em xin phép kết thúc cuộc gọi tại đây. ' +
    'Anh chị vui lòng gọi lại nếu cần thêm hỗ trợ ạ. Em cảm ơn anh chị.',

  // The holding line (ADR 0030): what the caller hears when the answer is
  // slow, rotated by turn index so a long call does not repeat one phrase.
  // A promise to answer, never an answer — none of them says anything the
  // reply could contradict.
  holding_lines: [
    'Dạ, anh chị chờ em một lát ạ.',
    'Dạ, em xem giúp anh chị ngay ạ.',
    'Dạ, anh chị đợi em một chút nhé.',
  ],
} as const;

/**
 * A spoken line of 600 characters is already half a minute of speech — past
 * that the text is a mistake, not an edit. The prompt is read by a model rather
 * than a voice, so it gets room for a real instruction block.
 */
const SPOKEN_TEXT_MAX_CHARS = 600;
const SYSTEM_PROMPT_MAX_CHARS = 8000;

/**
 * The character bound standing in for Deepgram's 500-token keyterm limit
 * (ADR 0022 Decision 5). ASSUMED to stay under it for Vietnamese: Deepgram
 * publishes the limit in tokens, and a list past it fails the handshake, which
 * leaves the call deaf — so the list is checked with `provider-smoke --keyterm`
 * before a row carries it.
 */
const KEYTERMS_MAX_JOINED_CHARS = 800;

/**
 * Speechmatics drops any `additional_vocab` element longer than six words, and
 * says so only with an in-band `Warning type=validation_warning` before
 * `RecognitionStarted` (docs, verified 2026-09-17) — a refusal at the row or at
 * boot is louder than a log line nobody reads. Counted in whitespace tokens,
 * the same way the adapters count a transcript's words.
 */
const SPEECHMATICS_VOCAB_MAX_WORDS = 6;

function withinVocabWordLimit(term: string): boolean {
  return term.trim().split(/\s+/u).length <= SPEECHMATICS_VOCAB_MAX_WORDS;
}

const VOCAB_WORD_LIMIT_MESSAGE =
  `each term must be at most ${String(SPEECHMATICS_VOCAB_MAX_WORDS)} words — ` +
  'Speechmatics drops a longer element and only says so in an in-band warning';

/**
 * The characters `speakable` would delete from this text, de-duplicated, for
 * the refusal message. Tested one character at a time, so the answer is the
 * set an editor has to look for; whitespace is excluded because the filter
 * collapses runs of it rather than removing it. Empty when what the filter
 * would remove is a markdown heading or bullet — a mark that only exists at the
 * start of a line and so cannot be found character by character.
 */
function unspeakableChars(text: string): string {
  const removed = [...new Set(Array.from(text))].filter(
    (ch) => !/\s/u.test(ch) && speakable(ch) !== ch,
  );
  return removed.map(nameIfInvisible).join(' ');
}

/** A character an editor cannot see (a zero-width space, a non-breaking space) by its code point; any other as itself. */
function nameIfInvisible(ch: string): string {
  return /[\p{Cf}\p{Zs}\u{FEFF}]/u.test(ch) && ch !== ' '
    ? `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
    : ch;
}

/**
 * One of the **spoken texts** — the greeting, the three canned lines, each
 * holding line and, since ADR 0031, a FAQ entry's answer.
 * Beyond being a non-empty text of sane length, two mechanical rules
 * (ADR 0021 Decision 4), both refusals rather than repairs:
 *
 *  - no `/`: Cartesia Sonic spells the word before a slash letter by letter
 *    (VERIFIED on the box 2026-09-05), and `speakable` cannot fix it — a filter
 *    that deleted slashes would turn "24/7" into "247";
 *  - `speakable(text) === text`: the consent record stores the effect's text
 *    unfiltered (`session/effect-runner.ts`, `spokenDisclosure`) while the
 *    voice receives the filtered sentence, and ADR 0016 needs those to be one
 *    string. A text the filter would change is refused, not silently altered —
 *    an editor whose emoji vanished would never learn it had.
 *
 * The system prompt is under neither rule: it is never spoken, and the shipped
 * prompt contains a `/` itself — in the instruction telling the model not to
 * use one.
 */
function spokenText(label: string) {
  return z
    .string()
    .min(1, { message: `${label} must not be empty` })
    .max(SPOKEN_TEXT_MAX_CHARS, {
      message: `${label} must be at most ${String(SPOKEN_TEXT_MAX_CHARS)} characters — it is read out loud`,
    })
    .refine((t) => !t.includes('/'), {
      message: `${label} must not contain the slash "/" — Cartesia Sonic spells the word before it out letter by letter, so write "hoặc" or "và" instead`,
    })
    .superRefine((t, ctx) => {
      const spoken = speakable(t);
      if (spoken === t) return;
      // Whitespace first: the filter collapses runs, trims the ends and drops a
      // space before punctuation, and none of that shows up character by
      // character — so a text that differs only there would otherwise be
      // blamed on a markdown mark it does not contain.
      const whitespaceOnly = t.replace(/\s/gu, '') === spoken.replace(/\s/gu, '');
      const removed = whitespaceOnly ? '' : unspeakableChars(t);
      // Whitespace an editor cannot see — a non-breaking space pasted from a
      // web page — is named by code point, or there is nothing to look for.
      const invisible = [...new Set(t.match(/[^\S \t\r\n]/gu) ?? [])].map(nameIfInvisible);
      ctx.addIssue({
        code: 'custom',
        message:
          `${label} contains characters the speakable filter (ADR 0016) would remove ` +
          (whitespaceOnly
            ? '(whitespace: a leading or trailing space or line break, a run of spaces, or a space before punctuation' +
              (invisible.length > 0 ? `; invisible whitespace ${invisible.join(' ')}` : '') +
              ')'
            : removed === ''
              ? '(a markdown heading or list mark at the start of a line)'
              : `(${removed})`) +
          ' — the voice and the consent record must carry one and the same string',
      });
    });
}

/**
 * Every leaf's own schema, with its bound (ADR 0021 Decision 3). The document
 * below is built from these, and `config/schema.ts` pipes each editable flat
 * key through the same leaf — so a bound is written here once and both parsers
 * run it. Nested exactly like the document, so a leaf's path is its path here.
 *
 * The three model keys are the exception, and the reason is the same for all
 * three: a model id is operator-named (ADR 0006 §4), so `DEEPGRAM_MODEL`,
 * `CARTESIA_TTS_MODEL` and `OPENROUTER_MODEL` stay free text in the flat schema
 * with no bound to share. What a ROW may say about them is narrower and belongs
 * to the document alone — the two catalogued legs take `MODEL_CATALOGUE` per
 * provider (which is why `stt.model` and `tts.model` have no entry here: their
 * schema is per provider, inside the discriminated union), and `llm.model`
 * refuses an empty string below.
 */
export const LEAF = {
  turn: {
    max_call_duration_sec: z.int().positive(),
    max_turns_per_call: z.int().positive(),
    /** 0 = never reprompt. */
    max_reprompts: z.int().nonnegative(),
    /** 0 = never reopen a turn. */
    max_turn_reopens: z.int().nonnegative(),
    /**
     * The three timer leaves below are capped at one hour: each becomes a
     * `setTimeout` delay, and Node fires any delay above 2³¹−1 ms after 1 ms
     * instead — an immediate reprompt, a hang-up before the farewell is
     * spoken, a holding line on every turn.
     */
    no_input_timeout_ms: z.int().positive().max(3_600_000),
    farewell_grace_ms: z.int().positive().max(3_600_000),
    /**
     * How long a committed turn waits for its answer before the holding line (ADR 0030); 0 = at once.
     * Any value above `LLM_TTFB_MS` already means "off" (ADR 0030 §6), so the
     * one-hour cap leaves that meaning reachable while blocking the overflow.
     */
    holding_line_after_ms: z.int().nonnegative().max(3_600_000),
    stt_mute_on_first_audio: z.boolean(),
    barge_in_enabled: z.boolean(),
    barge_in_min_words: z.int().positive(),
    barge_in_audio_window_ms: z.int().positive(),
    vad_speech_threshold: z.int().positive(),
  },
  stt: {
    params: {
      /**
       * The request language of BOTH legs (ADR 0014): the TTS leg reads the
       * same flat key, so `tts.params` has no language leaf. `min(1)` because
       * an empty string would merge to `STT_LANGUAGE=`, which `parseConfig`
       * reads as unset — the call would then run on the boot value, which is
       * neither the row's nor anything ADR 0020 defines.
       */
      language: z.string().min(1),
      endpointing_ms: z.int().positive(),
      /**
       * Deepgram documents 1000–5000 ms and ignores a value under 1000
       * (verified 2026-09-23, ADR 0029 Decision 7): a smaller one would be
       * recorded in the snapshot as a setting the call never ran on.
       */
      utterance_end_ms: z.int().min(1000).max(5000),
      /**
       * Deepgram's own parameter, not a turn-engine setting: it names which of
       * Deepgram's two end-of-speech frames becomes the turn-end signal, and
       * the engine never sees a frame name at all (ADR 0022 Decision 3). It
       * left the `turn` group on 2026-09-16 for that reason.
       */
      turn_trigger: z.enum(STT_TURN_TRIGGER_VALUES),
      /**
       * Deepgram's `keyterm` term biasing (Nova-3), one query parameter per
       * term: the clinic's own names — services, doctors, wards — that a
       * general model mishears. Plain terms only; Deepgram silently ignores a
       * `:weight` suffix and reads it as part of the term.
       *
       * Deepgram's own limit is 500 TOKENS across the whole list per request,
       * and a list over it is rejected at the handshake — so the bound here is
       * a character count that stands in for it. An empty list is refused like
       * an empty string: "no keyterms" is the absent leaf.
       */
      keyterms: z
        .array(z.string().trim().min(1).max(64))
        .min(1)
        .max(50)
        .refine((list) => list.join(' ').length <= KEYTERMS_MAX_JOINED_CHARS, {
          message:
            `the keyterms must be at most ${String(KEYTERMS_MAX_JOINED_CHARS)} characters joined — ` +
            "Deepgram's limit is 500 tokens across the whole list and rejects a request over it",
        }),
      /** Deepgram's `smart_format`: punctuation plus entity formatting. */
      smart_format: z.boolean(),
      /** Deepgram's `punctuate`: punctuation alone. */
      punctuate: z.boolean(),
      /**
       * Soniox's five, from here down (ADR 0024 Decision 3). Silence before
       * Soniox emits the `<end>` token this adapter promotes to the turn-end
       * signal; the vendor's own default is 2000 ms and its range is the bound.
       */
      max_endpoint_delay_ms: z.int().min(500).max(3000),
      /** Soniox's `endpoint_sensitivity` (v5): higher endpoints sooner, default 0. */
      endpoint_sensitivity: z.number().min(-1).max(1),
      /**
       * Soniox's `endpoint_latency_adjustment_level` (v5): higher means lower
       * latency and more endpoints, at slightly lower accuracy. Default 0.
       */
      endpoint_latency_adjustment_level: z.int().min(0).max(3),
      /**
       * Soniox's `context.terms` — the same term biasing `keyterms` is for
       * Deepgram, under the same bounds on purpose: Soniox's own limit is
       * 8 000 tokens across the whole `context` object, far above the list any
       * clinic keeps, and one shape means a console renders one term-list
       * field per vendor from one rule.
       */
      context_terms: z
        .array(z.string().trim().min(1).max(64))
        .min(1)
        .max(50)
        .refine((list) => list.join(' ').length <= KEYTERMS_MAX_JOINED_CHARS, {
          message:
            `the context terms must be at most ${String(KEYTERMS_MAX_JOINED_CHARS)} characters joined — ` +
            "Soniox's limit is 8000 tokens across the whole context object and rejects a request over it",
        }),
      /** Soniox's `context.text` — free text saying what this conversation is about. */
      context_text: z.string().trim().min(1).max(2000),
      /**
       * Speechmatics's four, from here down (ADR 0025 Decision 4). The silence
       * after which the vendor sends the `EndOfUtterance` message this adapter
       * promotes to the turn-end signal, in seconds.
       *
       * The one STT leaf that carries a repo default and refuses the vendor's
       * own: `0` switches `EndOfUtterance` off, which would leave the port with
       * no turn-end signal and no turn would ever end. `min(0.1)` says that as
       * one bound; `0.8` is `DEEPGRAM_ENDPOINTING_MS` in seconds and the top of
       * the 0.5–0.8 s band the vendor's docs recommend for voice AI.
       */
      end_of_utterance_silence_trigger: z.number().min(0.1).max(2),
      /**
       * Speechmatics's `max_delay`: seconds between a spoken word's end and the
       * final that carries it. Optional with no default — the vendor's own is
       * 4 s, and a repo default would be guessing at a latency no call has
       * measured yet. Its range is the bound.
       */
      max_delay: z.number().min(0.7).max(4),
      /**
       * Speechmatics's `additional_vocab` — the same term biasing `keyterms` is
       * for Deepgram and `context_terms` for Soniox, under the same bounds on
       * purpose (one term-list shape per vendor from one rule), plus the
       * vendor's own six-word element limit.
       */
      additional_vocab: z
        .array(
          z
            .string()
            .trim()
            .min(1)
            .max(64)
            .refine(withinVocabWordLimit, { message: VOCAB_WORD_LIMIT_MESSAGE }),
        )
        .min(1)
        .max(50)
        .refine((list) => list.join(' ').length <= KEYTERMS_MAX_JOINED_CHARS, {
          message:
            `the additional vocab must be at most ${String(KEYTERMS_MAX_JOINED_CHARS)} characters joined — ` +
            'Speechmatics charges a documented latency penalty for a long list and delays session start on a cold one',
        }),
      /**
       * Speechmatics's `additional_vocab[].sounds_like` — a term mapped to how
       * it is heard, which is how a foreign drug name is biased in Vietnamese
       * speech. Its own leaf rather than a syntax inside the term list, so the
       * other two vendors' branches never have to parse a rule that means
       * nothing to them (ADR 0025 Decision 4).
       *
       * The wire carries these spellings ON the matching `additional_vocab`
       * entry, so every key must name a term the list has —
       * `speechmaticsCrossFieldRefusals` below, called from both parsers.
       */
      sounds_like: z.record(
        z.string().min(1).max(64),
        z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(64)
              .refine(withinVocabWordLimit, { message: VOCAB_WORD_LIMIT_MESSAGE }),
          )
          .min(1)
          .max(5),
      ),
    },
  },
  llm: {
    /** Free text, unlike the two catalogued legs — see MODEL_CATALOGUE. Not empty, for the reason on `stt.params.language`. */
    model: z.string().min(1),
    /** Empty stays legal: on this key it already means "no fallback" (ADR 0010 rule 5). */
    fallback_model: z.string(),
    params: {
      /** ADR 0010 rule 9: which values a model accepts is a property of the model, so an edit that changes `model` sets this in the same row. */
      reasoning: z.enum(REASONING_VALUES),
      max_tokens: z.int().positive(),
      /** OpenRouter: 0 ≤ temperature ≤ 2 (docs, verified 2026-09-13). */
      temperature: z.number().min(0).max(2),
      /** OpenRouter: 0 < top_p ≤ 1 (docs, verified 2026-09-13). */
      top_p: z.number().gt(0).max(1),
      /**
       * One to four stop sequences. OpenRouter takes a string or an array of
       * strings; the array is the one shape here, so the flat key and the leaf
       * carry the same type. An empty array is refused like an empty string:
       * "no stop sequences" is the absent leaf, not an empty one.
       */
      stop: z.array(z.string().min(1)).min(1).max(4),
    },
  },
  tts: {
    /**
     * Which voice the vendor speaks in (ADR 0029 Decision 3): one id of that
     * vendor's **voice list** in the box `.env`. Bounded here only as a
     * string — Cartesia's ids are UUIDs and ElevenLabs' 20-character tokens,
     * and the list, not a pattern, is the real bound: the flat schema refuses
     * an id the list does not name, at boot and on every merged row. The
     * allowed ids are per box, so a form takes them from the latest
     * `boot_report` row rather than from this file.
     */
    voice: z.string().trim().min(1).max(128),
    params: {
      flush_ms: z.int().positive(),
      min_sentence_chars: z.int().positive(),
      /**
       * Cartesia's four optional request parameters (ADR 0023 Decision 3),
       * bounds as its docs state them (verified 2026-09-16). Each is absent by
       * default, and absent means the field is left off the generation frame —
       * never a value this repo picked on Cartesia's behalf.
       *
       * `generation_config.speed`: how fast the voice reads, 1.0 its default.
       */
      speed: z.number().min(0.6).max(1.5),
      /** `generation_config.volume`: how loud the voice is, 1.0 its default. */
      volume: z.number().min(0.5).max(2),
      /**
       * `pronunciation_dict_id`: a dictionary created out of band that fixes
       * how a drug or doctor name is spoken. The 128-character bound is
       * defensive — Cartesia documents no id length, and it is corrected from
       * an observed id if it is wrong.
       */
      pronunciation_dict_id: z.string().trim().min(1).max(128),
      /**
       * `max_buffer_delay_ms`: how long Cartesia buffers transcript text before
       * it starts generating, 0–5000 with its own default 3000. This pipeline
       * aggregates its own sentences, so a delay that applies is latency the
       * caller waits through — which is what the smoke run measures.
       */
      max_buffer_delay_ms: z.int().min(0).max(5000),
      /**
       * ElevenLabs' five voice settings and its dictionary locator (ADR 0026
       * Decision 5), bounds as its API description states them (verified
       * 2026-09-17). Each is absent by default, and absent means the field is
       * left off the context's first message — never a value this repo picked
       * on ElevenLabs' behalf, so the voice's own saved settings apply.
       *
       * `voice_settings.stability`: how much the delivery varies between
       * generations, 0.5 its default.
       */
      stability: z.number().min(0).max(1),
      /** `voice_settings.similarity_boost`: how closely the clone is followed, 0.75 its default. */
      similarity_boost: z.number().min(0).max(1),
      /**
       * `voice_settings.style`: style exaggeration, 0 its default and the
       * fastest. Whether Flash v2.5 accepts it is ASSUMED (ADR 0026 A8 — the
       * vendor's websocket and HTTP documents disagree); leave it unset until
       * the smoke run in runbook §10.2 settles it.
       */
      style: z.number().min(0).max(1),
      /** `voice_settings.use_speaker_boost`: extra similarity at some latency, true its default. ASSUMED on Flash v2.5 like `style` (A8). */
      speaker_boost: z.boolean(),
      /**
       * The one leaf name the two TTS branches disagree on: both call it
       * `speed`, and each vendor bounds it its own way — Cartesia 0.6–1.5
       * above, ElevenLabs 0.7–1.2 here ("values range from 0.7 to 1.2", 1.0 its
       * default). Two schemas, one document field name per branch, so a row
       * refuses the value the vendor it names would refuse.
       */
      elevenlabs_speed: z.number().min(0.7).max(1.2),
      /**
       * `pronunciation_dictionary_locators[0].version_id` — the other half of
       * the locator whose id is `pronunciation_dict_id` above (which both
       * vendors spell the same way and bound the same way). ElevenLabs' locator
       * requires both, which is what `elevenlabsCrossFieldRefusals` enforces.
       */
      pronunciation_dict_version_id: z.string().trim().min(1).max(128),
    },
  },
  text: {
    system_prompt: z
      .string()
      .refine((t) => t.trim() !== '', { message: 'text.system_prompt must not be empty' })
      .max(SYSTEM_PROMPT_MAX_CHARS, {
        message: `text.system_prompt must be at most ${String(SYSTEM_PROMPT_MAX_CHARS)} characters`,
      }),
    greeting: spokenText('text.greeting'),
    canned_reprompt: spokenText('text.canned_reprompt'),
    canned_degraded: spokenText('text.canned_degraded'),
    canned_farewell: spokenText('text.canned_farewell'),
    /** One to four, rotated by turn index (ADR 0030). */
    holding_lines: z.array(spokenText('text.holding_lines')).min(1).max(4),
  },
  /**
   * The router's mode and the three thresholds the shell judges its decision
   * by (ADR 0032 Decisions 3 and 6): a turn routes to the FAQ entry when
   * `confidence >= faq_min_confidence`, `medical < medical_max` and
   * `extra_request < extra_request_max`. Each is a probability the vendor
   * answers in 0–1, so each bound is 0–1 too.
   */
  router: {
    mode: z.enum(ROUTER_MODE_VALUES),
    faq_min_confidence: z.number().min(0).max(1),
    medical_max: z.number().min(0).max(1),
    extra_request_max: z.number().min(0).max(1),
  },
} as const;

/**
 * A refusal that no single Speechmatics leaf can carry, and the leaf it is
 * reported on. Both parsers — the document's `speechmatics` branch and the flat
 * schema's `superRefine` — call `speechmaticsCrossFieldRefusals` and report what
 * it returns on their own key, so the two rules below are written once (ADR 0025
 * Decision 4, ADR 0011 P3). The messages name the leaves; the flat keys are
 * those names with a `SPEECHMATICS_` prefix, so an operator reads the same
 * sentence either way.
 */
export interface SpeechmaticsCrossFieldRefusal {
  leaf: 'end_of_utterance_silence_trigger' | 'sounds_like';
  message: string;
}

/**
 * The two rules that read more than one Speechmatics leaf:
 *
 *  - the silence trigger must stay below `max_delay` when that is set — the
 *    vendor's docs say to keep it lower, and ours is the defensive half (A8 asks
 *    whether the vendor refuses it too);
 *  - every `sounds_like` key must name a term `additional_vocab` lists, because
 *    the wire carries the spellings on that term's own entry.
 *
 * Called with whatever the caller has: a document row may leave both timing
 * leaves out, in which case there is nothing to compare and the merged flat
 * record is checked by the same rules a moment later.
 */
export function speechmaticsCrossFieldRefusals(params: {
  end_of_utterance_silence_trigger?: number | undefined;
  max_delay?: number | undefined;
  additional_vocab?: readonly string[] | undefined;
  sounds_like?: Readonly<Record<string, readonly string[]>> | undefined;
}): readonly SpeechmaticsCrossFieldRefusal[] {
  const refusals: SpeechmaticsCrossFieldRefusal[] = [];
  const trigger = params.end_of_utterance_silence_trigger;
  const maxDelay = params.max_delay;
  if (trigger !== undefined && maxDelay !== undefined && trigger >= maxDelay) {
    refusals.push({
      leaf: 'end_of_utterance_silence_trigger',
      message:
        `end_of_utterance_silence_trigger (${String(trigger)}) must be below max_delay (${String(maxDelay)}) — ` +
        "Speechmatics' docs require the silence trigger to stay under the delay bound of the final it follows",
    });
  }
  if (params.sounds_like !== undefined) {
    const listed = new Set(params.additional_vocab ?? []);
    for (const term of Object.keys(params.sounds_like)) {
      if (listed.has(term)) continue;
      refusals.push({
        leaf: 'sounds_like',
        message:
          `sounds_like has an entry for "${term}", which additional_vocab does not list — ` +
          "Speechmatics carries the spellings on that term's own vocabulary entry, so a term the list is missing has nowhere to go",
      });
    }
  }
  return refusals;
}

/**
 * A refusal that no single ElevenLabs leaf can carry, and the leaf it is
 * reported on — the Speechmatics shape one leg over (ADR 0026 Decision 5). Both
 * parsers call `elevenlabsCrossFieldRefusals` and report what it returns on
 * their own key, so the rule is written once (ADR 0011 P3).
 */
export interface ElevenLabsCrossFieldRefusal {
  leaf: 'pronunciation_dict_id' | 'pronunciation_dict_version_id';
  message: string;
}

/**
 * The one rule that reads more than one ElevenLabs leaf: a pronunciation
 * dictionary is named by a locator carrying BOTH an id and a version id, so
 * half a locator is refused rather than sent as a locator the vendor rejects —
 * or, worse, dropped silently by the adapter. Reported on the half that is
 * missing, which is the field an editor has to fill.
 */
export function elevenlabsCrossFieldRefusals(params: {
  pronunciation_dict_id?: string | undefined;
  pronunciation_dict_version_id?: string | undefined;
}): readonly ElevenLabsCrossFieldRefusal[] {
  const id = params.pronunciation_dict_id;
  const versionId = params.pronunciation_dict_version_id;
  if ((id === undefined) === (versionId === undefined)) return [];
  const message =
    'a pronunciation dictionary needs both pronunciation_dict_id and pronunciation_dict_version_id — ' +
    "ElevenLabs' locator carries the two together, and half of one names no dictionary";
  return [{ leaf: id === undefined ? 'pronunciation_dict_id' : 'pronunciation_dict_version_id', message }];
}

/**
 * The document stored in `runtime_config.config`. Every group and every leaf is
 * optional and `{}` is valid — an empty document means "boot config", which is
 * also what no row at all means. `strictObject` at every level: an unknown
 * group, an unknown leaf, or a parameter that belongs to another provider is an
 * `unrecognized_keys` issue, never a silently dropped edit.
 *
 * Nested per leg, and discriminated by provider for STT and TTS, so a console
 * can render one form per provider and a parameter belonging to another
 * provider is refused rather than stored and ignored.
 */
export const runtimeConfigSchema = z.strictObject({
  turn: z
    .strictObject({
      max_call_duration_sec: LEAF.turn.max_call_duration_sec.optional(),
      max_turns_per_call: LEAF.turn.max_turns_per_call.optional(),
      max_reprompts: LEAF.turn.max_reprompts.optional(),
      max_turn_reopens: LEAF.turn.max_turn_reopens.optional(),
      no_input_timeout_ms: LEAF.turn.no_input_timeout_ms.optional(),
      farewell_grace_ms: LEAF.turn.farewell_grace_ms.optional(),
      holding_line_after_ms: LEAF.turn.holding_line_after_ms.optional(),
      stt_mute_on_first_audio: LEAF.turn.stt_mute_on_first_audio.optional(),
      barge_in_enabled: LEAF.turn.barge_in_enabled.optional(),
      barge_in_min_words: LEAF.turn.barge_in_min_words.optional(),
      barge_in_audio_window_ms: LEAF.turn.barge_in_audio_window_ms.optional(),
      vad_speech_threshold: LEAF.turn.vad_speech_threshold.optional(),
    })
    .optional(),
  stt: z
    .discriminatedUnion('provider', [
      z.strictObject({
        // `satisfies`: the member's discriminator is one of the vendors the
        // build has an adapter for, checked by `pnpm typecheck`.
        provider: z.literal('deepgram' satisfies SttProviderValue),
        model: z.enum(MODEL_CATALOGUE.deepgram).optional(),
        params: z
          .strictObject({
            language: LEAF.stt.params.language.optional(),
            endpointing_ms: LEAF.stt.params.endpointing_ms.optional(),
            utterance_end_ms: LEAF.stt.params.utterance_end_ms.optional(),
            turn_trigger: LEAF.stt.params.turn_trigger.optional(),
            keyterms: LEAF.stt.params.keyterms.optional(),
            smart_format: LEAF.stt.params.smart_format.optional(),
            punctuate: LEAF.stt.params.punctuate.optional(),
          })
          .optional(),
      }),
      z.strictObject({
        provider: z.literal('soniox' satisfies SttProviderValue),
        model: z.enum(MODEL_CATALOGUE.soniox).optional(),
        params: z
          .strictObject({
            // `language` is the one parameter both branches share — one
            // language key serves both STT vendors and the TTS leg (ADR 0014).
            language: LEAF.stt.params.language.optional(),
            max_endpoint_delay_ms: LEAF.stt.params.max_endpoint_delay_ms.optional(),
            endpoint_sensitivity: LEAF.stt.params.endpoint_sensitivity.optional(),
            endpoint_latency_adjustment_level:
              LEAF.stt.params.endpoint_latency_adjustment_level.optional(),
            context_terms: LEAF.stt.params.context_terms.optional(),
            context_text: LEAF.stt.params.context_text.optional(),
          })
          .optional(),
      }),
      z.strictObject({
        provider: z.literal('speechmatics' satisfies SttProviderValue),
        model: z.enum(MODEL_CATALOGUE.speechmatics).optional(),
        params: z
          .strictObject({
            // `language` again — the one parameter every branch shares.
            language: LEAF.stt.params.language.optional(),
            end_of_utterance_silence_trigger:
              LEAF.stt.params.end_of_utterance_silence_trigger.optional(),
            max_delay: LEAF.stt.params.max_delay.optional(),
            additional_vocab: LEAF.stt.params.additional_vocab.optional(),
            sounds_like: LEAF.stt.params.sounds_like.optional(),
          })
          // The two rules that read more than one leaf, from the one place they
          // are written; reported on the leaf each belongs to, so a console
          // shows the refusal on the field an editor has to change.
          .superRefine((params, ctx) => {
            for (const refusal of speechmaticsCrossFieldRefusals(params)) {
              ctx.addIssue({ code: 'custom', message: refusal.message, path: [refusal.leaf] });
            }
          })
          .optional(),
      }),
    ])
    .optional(),
  llm: z
    .strictObject({
      model: LEAF.llm.model.optional(),
      fallback_model: LEAF.llm.fallback_model.optional(),
      params: z
        .strictObject({
          reasoning: LEAF.llm.params.reasoning.optional(),
          max_tokens: LEAF.llm.params.max_tokens.optional(),
          temperature: LEAF.llm.params.temperature.optional(),
          top_p: LEAF.llm.params.top_p.optional(),
          stop: LEAF.llm.params.stop.optional(),
        })
        .optional(),
    })
    .optional(),
  tts: z
    .discriminatedUnion('provider', [
      z.strictObject({
        // `satisfies`: the member's discriminator is one of the vendors the
        // build has an adapter for, checked by `pnpm typecheck`.
        provider: z.literal('cartesia' satisfies TtsProviderValue),
        model: z.enum(MODEL_CATALOGUE.cartesia).optional(),
        // Which voice, like `model` names which model — beside it, not in
        // `params`, which are the vendor's request knobs (ADR 0029).
        voice: LEAF.tts.voice.optional(),
        params: z
          .strictObject({
            flush_ms: LEAF.tts.params.flush_ms.optional(),
            min_sentence_chars: LEAF.tts.params.min_sentence_chars.optional(),
            speed: LEAF.tts.params.speed.optional(),
            volume: LEAF.tts.params.volume.optional(),
            pronunciation_dict_id: LEAF.tts.params.pronunciation_dict_id.optional(),
            max_buffer_delay_ms: LEAF.tts.params.max_buffer_delay_ms.optional(),
          })
          .optional(),
      }),
      z.strictObject({
        provider: z.literal('elevenlabs' satisfies TtsProviderValue),
        model: z.enum(MODEL_CATALOGUE.elevenlabs).optional(),
        voice: LEAF.tts.voice.optional(),
        params: z
          .strictObject({
            // The two pipeline knobs every TTS branch shares: how much audio is
            // buffered before a frame goes out, and how short a sentence may be
            // — this repo's own numbers, not a vendor's.
            flush_ms: LEAF.tts.params.flush_ms.optional(),
            min_sentence_chars: LEAF.tts.params.min_sentence_chars.optional(),
            stability: LEAF.tts.params.stability.optional(),
            similarity_boost: LEAF.tts.params.similarity_boost.optional(),
            style: LEAF.tts.params.style.optional(),
            speaker_boost: LEAF.tts.params.speaker_boost.optional(),
            // Same field name as the cartesia branch's, this vendor's bound.
            speed: LEAF.tts.params.elevenlabs_speed.optional(),
            pronunciation_dict_id: LEAF.tts.params.pronunciation_dict_id.optional(),
            pronunciation_dict_version_id:
              LEAF.tts.params.pronunciation_dict_version_id.optional(),
          })
          // The rule that reads more than one leaf, from the one place it is
          // written; reported on the half an editor has to fill.
          .superRefine((params, ctx) => {
            for (const refusal of elevenlabsCrossFieldRefusals(params)) {
              ctx.addIssue({ code: 'custom', message: refusal.message, path: [refusal.leaf] });
            }
          })
          .optional(),
      }),
    ])
    .optional(),
  /**
   * The five spoken texts and the system prompt (ADR 0021 Decision 4). A leaf
   * left out is the shipped text, like every other leaf left out is the boot
   * value.
   */
  text: z
    .strictObject({
      system_prompt: LEAF.text.system_prompt.optional(),
      greeting: LEAF.text.greeting.optional(),
      canned_reprompt: LEAF.text.canned_reprompt.optional(),
      canned_degraded: LEAF.text.canned_degraded.optional(),
      canned_farewell: LEAF.text.canned_farewell.optional(),
      holding_lines: LEAF.text.holding_lines.optional(),
    })
    .optional(),
  /**
   * The router (ADR 0032). Which vendor and model it runs on is not a row's
   * to choose — `TYPESAFE_MODEL` is operator-named — so the group holds only
   * the mode and the thresholds.
   */
  router: z
    .strictObject({
      mode: LEAF.router.mode.optional(),
      faq_min_confidence: LEAF.router.faq_min_confidence.optional(),
      medical_max: LEAF.router.medical_max.optional(),
      extra_request_max: LEAF.router.extra_request_max.optional(),
    })
    .optional(),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

/**
 * The most FAQ entries a tenant may have enabled (ADR 0031 Decision 4): the
 * router's vendor takes 255 choices, and one of them is `other`. The console
 * counts the enabled rows before it enables one more; the process reads at most
 * this many and drops the rest in key order.
 */
export const FAQ_MAX_ENTRIES = 254;

/** The router's own answer — "none of the entries" — so never an entry's key. */
export const FAQ_RESERVED_KEY = 'other';

/**
 * One FAQ entry as a call sees it (ADR 0031 Decision 2): what the console
 * validates before it inserts or updates a `faq_entry` row, and what the
 * process runs on every row it reads. `enabled` is a column, not a field here —
 * a call only ever reads enabled rows. The table's CHECKs guard the same bounds
 * and are never stricter; `answer` is a spoken text, so it also holds the two
 * rules no CHECK can.
 */
export const faqEntrySchema = z.strictObject({
  /** Immutable once written: the router, the snapshot and the trail name the entry by it. */
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, {
      message: 'key must start with a lowercase letter and hold only a-z, 0-9 and _, at most 64 characters',
    })
    .refine((k) => k !== FAQ_RESERVED_KEY, {
      message: `key must not be '${FAQ_RESERVED_KEY}' — that is the router's answer when no entry fits`,
    }),
  /** The clinic's example question. Never spoken. */
  question: z.string().trim().min(1, { message: 'question must not be empty' }).max(300),
  answer: spokenText('answer'),
  /** What the router matches on: when this entry is the answer. */
  description: z.string().trim().min(1, { message: 'description must not be empty' }).max(200),
});

export type FaqEntry = z.infer<typeof faqEntrySchema>;

/** The AI disclosure and the recording notice, as the shipped greeting words them. */
const AI_DISCLOSURE_PHRASE = 'trợ lý AI';
const RECORDING_NOTICE_PHRASE = 'ghi âm';

/**
 * Advice — never a refusal — on a greeting that no longer looks like the
 * disclosure Law 134/2025 and CONTEXT §Legal require (ADR 0021 Decision 5): one
 * string for each obligation the text stops naming, none for the shipped
 * greeting. The console shows them before the insert and as a banner while the
 * current row carries such a greeting; the pipeline never evaluates them, and a
 * greeting is refused only for the mechanical rules of `LEAF.text`.
 *
 * A plain function with no zod issue path on purpose: it cannot become a refine
 * by accident. If counsel's answer makes the disclosure a refusal, that is a
 * change to ADR 0021 Decision 5, not a quiet promotion of this predicate.
 */
export function disclosureAdvice(greeting: string): string[] {
  // Compared case-insensitively on NFC: "Trợ lý AI" at a sentence start, or a
  // greeting typed on a keyboard that emits decomposed accents, is the same
  // disclosure.
  const text = greeting.normalize('NFC').toLocaleLowerCase('vi');
  const says = (phrase: string) => text.includes(phrase.toLocaleLowerCase('vi'));
  const advice: string[] = [];
  if (!says(AI_DISCLOSURE_PHRASE)) {
    advice.push(
      `The greeting no longer says "${AI_DISCLOSURE_PHRASE}" — a caller has to be told they are talking to an AI (Law 134/2025).`,
    );
  }
  if (!says(RECORDING_NOTICE_PHRASE)) {
    advice.push(
      `The greeting no longer says "${RECORDING_NOTICE_PHRASE}" — the call is recorded, and the notice is the consent this pilot records (CONSENT_MODE=notice_continuation).`,
    );
  }
  return advice;
}
