# ADR 0013: Plain-language labels, with the pipeline term on screen beside them

**Status:** accepted · **Date:** 2026-09-25 · **Row:** A19

## Decision

1. **Every label that names a pipeline concept is a pair: a plain-language name first, the
   pipeline's own term second.** The pipeline term is never replaced and never hidden —
   it is the secondary line under the name, or in parentheses after it, in the muted
   monospace of `--size-eyebrow`. `CLAUDE.md`'s ground rule "a screen label renders a
   pipeline term" is read as *renders*, not *is*: the term is rendered on screen every
   time, and the name is how the console renders it. `CONTEXT.md` §Language changes from
   "pipeline vocabulary appears on screen as-is … with a one-line gloss where a term first
   appears" to "pipeline vocabulary appears on screen as a plain-language name with the
   pipeline term beside it, every time".

2. **Three things are never renamed:** model ids (`openai/gpt-oss-120b`, `nova-3`,
   `sonic-3.6`), voice ids, and build SHAs. They are operator-named identifiers with no
   meaning to translate (pipeline ADR 0006 §4), and they render verbatim, as the only line.

3. **One glossary module, `src/ui/glossary.ts`, is the only file in which a friendly name
   is written.** It holds one map per vocabulary — the six legs, the three headline spans,
   `end_reason`, `consent_record.outcome`, `failed_leg`, `failed_stage`, `turn.source`'s
   two fixed values, the interval holder kinds and the three canned lines, the eight
   Overview groupings, and the 55 configuration leaves — each entry `{ name, code,
   description? }`. A screen obtains a name only by calling the glossary
   (`termFor(namespace, code)`), never by writing one. The full table is §Glossary below.

4. **A value the glossary does not know stays raw and marked.** `termFor` answers `null`
   for it; `Vocabulary` keeps rendering the ⚠ badge with the stored value (the additive
   vocabularies of contract §4 are still shown, never dropped). `turn.source` is the open
   vocabulary: `carry_over` and `reopen` have entries, every other value renders as
   "Vendor end-of-speech signal" with the raw value as its code line, because the value
   is a vendor's frame name and the contract says it is printed as-is (the name does not
   repeat the value — the `Term` layout already prints it once).

5. **Configuration leaves carry a description.** Each of the 55 entries has a one-sentence
   description, which becomes the row's tooltip on the Configuration form and the
   snapshot card; the bounds and the "boot value" fact stay in the same tooltip. The
   description is console-authored from the pipeline's own JSDoc and is not a contract
   fact: it explains, it never validates.

6. **Enforcers** (ADR 0011 P3 — an invariant with no enforcer is a fork):
   - `src/ui/glossary.test.ts`, totality both ways: every value of `END_REASONS`,
     `CONSENT_OUTCOMES`, `FAILED_LEGS`, `FAILED_STAGES`, every `LEGS[].name`, every
     `HOLDER_KINDS` value (a runtime constant `src/intervals.ts` gains beside the
     `HolderKind` type, `satisfies` against it), the three canned lines, the eight
     groupings of `OVERVIEW_GROUPINGS`, and every key of `FLAT_KEYS` has a glossary
     entry — and every glossary entry names a value one of those lists holds, so a leaf
     the pipeline renames fails here rather than going unlabelled.
   - `src/ui/glossary-scan.test.ts`, a tree scan over `src/app/**` and `src/ui/**`
     (`glossary.ts` and test files excluded), over what a screen renders — JSX text and
     string literals given to a label-bearing JSX attribute (`label`, `hint`, `tip`,
     `sub`, `caption`, `placeholder`, `aria-label`, `alt`) — and not over logic (a
     comparison such as `kind === 'llm'`, a lookup such as `termFor('leg', 'send')` or
     a classifying prop such as `side="caller"` is a branch, not a label): (a) no rendered text equals a
     glossary `code` — a screen may not write `'endpoint_wait'` or `'max_turns'` as a
     label; it calls the glossary; (b) no rendered text equals a glossary `name` — a
     friendly name written twice is two spellings waiting to diverge. The scan is the
     same shape as the Recharts allow-list of `src/interval-lane.test.ts`. A label built
     in plain code and handed to JSX through a variable escapes the scan; that residual
     is left to review.
   - What the pair does not catch — a screen inventing a *different* friendly name for a
     term the glossary already names — is left to review; it is named here so nobody
     believes the test catches it.

## Why

The internal team's first-use feedback (brief, 2026-09-25) said the same thing on every
screen: `pipeline_ms`, `endpoint_wait`, `bot: reprompt`, `max_turns_per_call` as the
primary label mean nothing to a reader who has not opened the pipeline's source, and the
one-line gloss "where a term first appears" is never where the reader is looking. The
console exists so the team reads a call and forms a hypothesis without opening the code
(`CONTEXT.md` §Why now); a label they cannot read defeats that.

The forces pulling the other way are real and are why the term stays on screen:

- **The vocabulary is the pipeline's (pipeline ADR 0013).** A reader who sees "End-of-speech
  wait" and then greps the pipeline for it finds nothing; the reader who sees
  `endpoint_wait` under it finds `PIPELINE_ARCHITECTURE.md` §6. The pair keeps the
  console's screen and the pipeline's docs, logs and `report-calls` output speaking one
  language. A name that replaced the term would be a console-coined term for a pipeline
  concept, which the ground rule forbids.
- **One place to write a name, or two spellings.** Today `configurations.tsx`,
  `turn-table.tsx` and the Calls list each format vocabulary values on their own; adding a
  friendly layer the same way would give three spellings of "Caller hung up" within a
  month. The glossary is the single home, and the scan makes writing a name elsewhere a
  failing test instead of a review comment.
- **Unknown values must stay loud.** The vocabularies grow additively (contract §4); a
  glossary that silently passed an unknown value through as its raw code would hide the
  pipeline's newest behaviour behind an ordinary-looking label. The ⚠ badge stays, and
  the totality test means "unknown to the glossary" is exactly "outside the contract's
  list the console last copied".
- **Identifiers are not vocabulary.** A model id or a voice id is a fact the operator typed
  into `.env` or a row; the team compares it against vendor dashboards and the box's
  `.env`. Any rendering but verbatim is a lie waiting to be pasted.

## Rejected

- **Friendly name only, term in the tooltip.** Cleanest screen; but the term is what the
  team pastes into a grep, a Slack message or a `report-calls` invocation, and a tooltip
  cannot be copied from. It also breaks the ground rule outright rather than reading it.
- **Term primary, friendly name secondary (the reverse pair).** Keeps the ground rule's
  letter; fails the feedback — the eye lands on the first line, and the first line would
  still be `pipeline_ms`.
- **Names beside the vocabulary constants in `src/calls.ts` / `src/latency.ts`** instead
  of one glossary module. Keeps each name next to its list; but the configuration leaves
  live in a byte-copied contract file that may not be edited, so at least those 55 names
  need a home of their own, and one home for all is simpler to scan than five.
- **Descriptions in the contract copy.** The 55 leaf descriptions could be read from the
  JSDoc of `runtime-document.ts` at build time; the file is a pinned byte copy and its
  comments are the pipeline's engineering notes, not screen text. The console writes its
  own sentence, citing the JSDoc.

## Glossary

The console's own names. `code` is the pipeline's term, rendered beside the name every
time. Model ids, voice ids and build SHAs have no row here on purpose (Decision 2).

### Headline spans (`turn` columns; `PIPELINE_ARCHITECTURE.md` §6)

| code | name | description (tooltip) |
|---|---|---|
| `pipeline_ms` | Pipeline latency | `endpoint_decision → first_audio_out`: the part of the wait the pipeline controls, and the tuning target (P95 < 1 200 ms). |
| `caller_perceived_ms` | Caller-perceived latency | `speech_end → first_audio_out`: how long the caller waited in silence. |
| `llm_first_reasoning → llm_first_token` | Model reasoning | The model's thinking before its first spoken token; sits inside LLM first token. Absent on a model that emits no reasoning. |
| `greeting_first_audio_ms` | Answered → first audio | From the call being answered to the greeting's first audio out; shown on the Call card in Pipeline detail. |

### Legs (`src/latency.ts` `LEGS`)

| code | name | description |
|---|---|---|
| `stt_emit` | Transcript arrival | `speech_end → stt_final`: the provider's transcript latency after the caller stopped talking. Outside the partition; overlaps End-of-speech wait. |
| `endpoint_wait` | End-of-speech wait | `speech_end → endpoint_decision`: the endpointing silence — the gap the reducer cannot shorten. |
| `llm_ttft` | LLM first token | `endpoint_decision → llm_first_token`: turn committed to the model's first token. |
| `tts_ttfb` | TTS first audio (first sentence) | `llm_first_token → tts_first_byte`: first token to the first synthesized byte, first sentence of the reply only. |
| `send` | Audio send | `tts_first_byte → first_audio_out`: synthesized to handed to the audio sink — the pipeline's own buffering. |
| `playback` | Playback | `first_audio_out → playback_start`: sink to FreeSWITCH's report of the first played chunk. Advisory, outside the partition. |

End-of-turn spans keep their mark pair as the label (`llm_first_token → llm_last_token`,
`tts_first_byte → tts_last_byte`, `playback_start → playback_end`): the pipeline names no
leg for them (`app/src/domain/__tests__/latency.test.ts`), so the console coins none; their
code line reads "end-of-turn marks".

### `call_log.end_reason` (contract §3.1)

| code | name |
|---|---|
| `max_duration` | Hit duration cap |
| `max_turns` | Hit turn cap |
| `max_reprompts` | Hit reprompt cap |
| `provider_failure` | Provider failure |
| `caller_hangup` | Caller hung up |
| `shutdown` | Process shut down |
| `media_stream_closed` | Media stream closed |

### `consent_record.outcome` (contract §3.1)

| code | name |
|---|---|
| `granted` | Consent granted |
| `hung_up_before_disclosure` | Hung up before disclosure |
| `hung_up_before_consent` | Hung up before consent |
| (no row) | Not finalized — unchanged, a state of the call (trap 2), not a vocabulary value |

### Turn failure (`turn.failed_leg` · `turn.failed_stage`, contract §3.1)

Rendered as one chip, `<leg name> · <stage name>`, never a chip plus loose text.

| code | name |
|---|---|
| leg `llm` | LLM |
| leg `tts` | TTS |
| stage `ttfb` | no first token/byte in time |
| stage `idle` | stream stalled |
| stage `total` | over the total limit |
| stage null (leg set) | provider error |
| `failed_after_ms` | Failed after — tooltip: measured from the endpoint decision, not the configured limit (trap 7). |

### `turn.source` (open vocabulary, contract §3.1)

| code | name |
|---|---|
| `carry_over` | Text arrived during the reply |
| `reopen` | Reopened before the reply was heard |
| any other value | Vendor end-of-speech signal — the raw value as the code line; never ⚠ |

### Interval holders (`src/intervals.ts` `HolderKind`; `../Fonnus/docs/console-call-view.md`)

| code | name |
|---|---|
| `greeting` | Fonnus · greeting |
| `reply` (turn N) | Fonnus · reply N |
| `waiting` (turn N) | Fonnus · preparing reply N |
| `canned` `reprompt` | Fonnus · reprompt |
| `canned` `degraded` | Fonnus · degraded line |
| `canned` `farewell` | Fonnus · farewell |
| `canned` (line missing) | Fonnus · canned line |
| `caller` | Caller |
| `silence` | Silence |
| `deaf` | Not listening (STT reconnecting) |

"What was heard" column (the recogniser cell): a final in quotes · "partial, overtaken: …"
· "segmented, nothing returned" (with the raw `turn_end.source` in parentheses) ·
"no input — reprompt timer fired".

### Overview groupings (ADR 0009; the eight offered)

| code (URL value) | name |
|---|---|
| `key:OPENROUTER_MODEL` | LLM model |
| `stt_model` | STT model |
| `tts_model` | TTS model |
| `key:CARTESIA_VOICE_ID` ∥ `key:ELEVENLABS_VOICE_ID` (coalesced, see `docs/upstream.md` §Overview) | Voice |
| `key:OPENROUTER_REASONING` | Reasoning |
| `key:STT_PROVIDER` | STT vendor |
| `key:TTS_PROVIDER` | TTS vendor |
| `key:runtime.version` | Runtime config row |

`none`, `llm_model`, `config` and any other `key:<K>` stay parseable from the URL and
render their code as the name (`Value` fallback), unchanged.

### Configuration leaves (the 55 paths of `src/configuration/flat-keys.ts`)

Description sentences are drafted from the JSDoc in `src/contract/config/runtime-document.ts`
(`LEAF`) and the comments of `flat-keys.ts` and the pipeline's `config/schema.ts`. The six
`turn.*` and `tts.params.min_sentence_chars` sentences that have no JSDoc were checked on
2026-09-25 against the code that reads each leaf (see §Evidence).

**Turn**

| path | name | description |
|---|---|---|
| `turn.max_call_duration_sec` | Max call length (s) | The call ends with the farewell line once it has run this many seconds (pipeline ADR 0004 §9); must stay 30 s under the FreeSWITCH backstop `MAX_CALL_SEC`. |
| `turn.max_turns_per_call` | Max turns per call | The call ends with the farewell line after this many turns. |
| `turn.max_reprompts` | Max reprompts | How many times the bot says the reprompt line to a silent caller before ending the call; 0 never reprompts. |
| `turn.max_turn_reopens` | Max turn reopens | How many times one turn may be reopened when the caller speaks again before its reply is heard; 0 never reopens. |
| `turn.no_input_timeout_ms` | No-input timeout (ms) | Silence from the caller after which the reprompt timer fires. |
| `turn.farewell_grace_ms` | Farewell grace (ms) | The longest the call stays open after the farewell line before the pipeline hangs up on its own (bounds a lost playback-drain report). |
| `turn.stt_mute_on_first_audio` | Mute STT at first audio | When the caller's audio stops reaching speech-to-text for a reply: on (the default) at the reply's first audible byte, off at the moment the turn is committed — the old behaviour, kept as a rollback (pipeline ADR 0004 §2). |
| `turn.barge_in_enabled` | Barge-in | Lets the caller cut a reply or a reprompt short by speaking over it, once both barge-in signals agree (pipeline ADR 0004 §5); off in production, and as built it cannot fire, because speech-to-text is muted while the bot is audible. |
| `turn.barge_in_min_words` | Barge-in min words | The fewest words one recogniser result (partial or final) heard during the reply must carry to count as barge-in's word signal; the count does not expire until the next reply, and caller line energy must also agree. |
| `turn.barge_in_audio_window_ms` | Barge-in audio window (ms) | How recent the caller's last loud frame (at or above the speech threshold) must be when the word signal is met for a barge-in to fire; it bounds the energy signal only, not the words. |
| `turn.vad_speech_threshold` | Speech energy threshold | The loudest 16-bit sample a caller audio frame must reach to count as speech: barge-in's energy signal, and where a turn's utterance starts in the recording (turn.speech_start_ms); 500 fires on room noise, 5 000 is the proven value. |

**Speech to text**

| path | name | description |
|---|---|---|
| `stt.provider` | STT vendor | Which speech-to-text vendor the call runs on; the committed value is the default and a row may name any vendor the box holds a key for. |
| `stt.model` | STT model | The vendor's model id (`DEEPGRAM_MODEL` / `SONIOX_MODEL` / `SPEECHMATICS_MODEL`); one of the catalogue, every entry priced. |
| `stt.params.language` | Language | The request language of both the STT and the TTS leg (pipeline ADR 0014). |
| `stt.params.endpointing_ms` | Endpointing silence (ms) | Deepgram: silence after which a `speech_final` is sent. |
| `stt.params.utterance_end_ms` | Utterance end (ms) | Deepgram: silence after which `UtteranceEnd` is sent; 1 000–5 000, a smaller value is ignored by the vendor. |
| `stt.params.turn_trigger` | Turn-end frame | Deepgram: which of its two end-of-speech frames (`utterance_end`, `speech_final`) becomes the turn-end signal. |
| `stt.params.keyterms` | Keyterms | Deepgram (Nova-3): the clinic's own names — services, doctors, wards — a general model mishears; at most 50 terms, 800 characters joined. |
| `stt.params.smart_format` | Smart format | Deepgram: punctuation plus entity formatting. |
| `stt.params.punctuate` | Punctuate | Deepgram: punctuation alone. |
| `stt.params.max_endpoint_delay_ms` | Max endpoint delay (ms) | Soniox: silence before the `<end>` token that ends the turn; 500–3 000, vendor default 2 000. |
| `stt.params.endpoint_sensitivity` | Endpoint sensitivity | Soniox v5: higher ends the turn sooner; −1 to 1, default 0. |
| `stt.params.endpoint_latency_adjustment_level` | Endpoint latency level | Soniox v5: higher means lower latency and more endpoints at slightly lower accuracy; 0–3, default 0. |
| `stt.params.context_terms` | Context terms | Soniox: term biasing, the same list shape as Keyterms and the same bounds. |
| `stt.params.context_text` | Context text | Soniox: free text saying what this conversation is about; at most 2 000 characters. |
| `stt.params.end_of_utterance_silence_trigger` | End-of-utterance silence (s) | Speechmatics: silence after which `EndOfUtterance` ends the turn; 0.1–2 s, must stay below Max delay. |
| `stt.params.max_delay` | Max delay (s) | Speechmatics: seconds between a spoken word's end and the final that carries it; 0.7–4, vendor default 4. |
| `stt.params.additional_vocab` | Additional vocabulary | Speechmatics: term biasing, the same list shape as Keyterms; each term at most six words. |
| `stt.params.sounds_like` | Sounds like | Speechmatics: how a listed term is heard (a foreign drug name in Vietnamese speech); every key must be a term of Additional vocabulary. |

**Language model**

| path | name | description |
|---|---|---|
| `llm.model` | LLM model | The OpenRouter model id, free text; an id with no price row makes every cost figure a floor. |
| `llm.fallback_model` | Fallback model | The model tried when the primary fails; empty means no fallback (pipeline ADR 0010 rule 5). |
| `llm.params.reasoning` | Reasoning effort | What the `reasoning` field sends: `omit` sends nothing (always safe), `off` sends `enabled: false` (some models answer HTTP 400 to it — `openai/gpt-oss-120b` does; use `omit` instead), an effort level asks the model to think that hard. A property of the model, set in the same row as the model. |
| `llm.params.max_tokens` | Max output tokens | The most tokens one reply may generate. |
| `llm.params.temperature` | Temperature | Sampling temperature, 0–2. |
| `llm.params.top_p` | Top-p | Nucleus sampling bound, 0 < top_p ≤ 1. |
| `llm.params.stop` | Stop sequences | One to four strings at which generation stops. |

**Text to speech**

| path | name | description |
|---|---|---|
| `tts.provider` | TTS vendor | Which text-to-speech vendor the call runs on; the committed value is the default. |
| `tts.model` | TTS model | The vendor's model id (`CARTESIA_TTS_MODEL` / `ELEVENLABS_TTS_MODEL`); one of the catalogue, every entry priced. |
| `tts.voice` | Voice | The vendor's voice id, one of the ids the box's `.env` lists for that vendor; an id outside the list is refused at boot and on every merged row, and the call falls back to boot config. |
| `tts.params.flush_ms` | Flush interval (ms) | How much synthesized audio the reply pipeline accumulates before it writes a frame to the call; the pipeline's own knob, every vendor. |
| `tts.params.min_sentence_chars` | Min sentence length (chars) | The shortest sentence the pipeline sends to synthesis on its own: a shorter piece is merged into the next one, except the last piece, which is always sent; the pipeline's own knob, every vendor. |
| `tts.params.speed` | Reading speed | How fast the voice reads, 1.0 the vendor default; Cartesia 0.6–1.5, ElevenLabs 0.7–1.2. |
| `tts.params.volume` | Volume | Cartesia: how loud the voice is, 0.5–2, 1.0 the default. |
| `tts.params.pronunciation_dict_id` | Pronunciation dictionary id | A dictionary created out of band that fixes how a drug or doctor name is spoken; ElevenLabs needs the version id beside it. |
| `tts.params.max_buffer_delay_ms` | Max buffer delay (ms) | Cartesia: how long it buffers text before generating, 0–5 000, its default 3 000; a delay that applies is latency the caller waits through. |
| `tts.params.stability` | Stability | ElevenLabs: how much the delivery varies between generations, 0–1, 0.5 the default. |
| `tts.params.similarity_boost` | Similarity boost | ElevenLabs: how closely the voice clone is followed, 0–1, 0.75 the default. |
| `tts.params.style` | Style exaggeration | ElevenLabs: 0–1, 0 the default and the fastest; whether Flash v2.5 honours it is unverified. |
| `tts.params.speaker_boost` | Speaker boost | ElevenLabs: extra similarity at some latency, true the default; unverified on Flash v2.5. |
| `tts.params.pronunciation_dict_version_id` | Pronunciation dictionary version | ElevenLabs: the other half of the dictionary locator; required together with the id. |

**Texts**

| path | name | description |
|---|---|---|
| `text.system_prompt` | System prompt | The instruction block the model reads on every turn; at most 8 000 characters; never spoken, so the slash and speakable rules do not apply. Shown under the Language model tab (a display placement only; the path stays `text.`). |
| `text.greeting` | Greeting | The disclosure line the caller hears first; legally load-bearing (Law 134/2025), at most 600 characters, no `/`, and it must survive the speakable filter unchanged. |
| `text.canned_reprompt` | Reprompt line | Said when the no-input timer fires; same mechanical rules as the greeting. |
| `text.canned_degraded` | Degraded line | Said when the reply pipeline cannot answer; same rules. |
| `text.canned_farewell` | Farewell line | Said when a limit ends the call; same rules. |

## Revisit when

- The pipeline pins a name table of its own (a `labels` export, or names in the read
  contract): the glossary becomes a byte copy of it and this ADR's Decision 3 is reduced
  to "copy".
- A second language on screen is needed (a clinic user, `CONTEXT.md` §Language): the
  glossary's `name` becomes per-locale, the `code` does not.
- The scan's residual (a rival name written inline) bites twice in review: then the scan
  grows an allow-list of every string literal in `src/app`, which is the heavier tool
  this ADR declined.

## Verified facts

- The vocabularies and their sources: `END_REASONS`, `CONSENT_OUTCOMES`, `FAILED_LEGS`,
  `FAILED_STAGES`, `ANNOTATION_LABELS` in `src/calls.ts` (contract §3.1); `LEGS` in
  `src/latency.ts` (copied from `../Fonnus/app/src/domain/latency.ts`); `HolderKind` in
  `src/intervals.ts:248` (a type only today — Decision 6 adds the runtime list); the
  canned line names `reprompt` / `degraded` / `farewell` in
  `../Fonnus/app/src/domain/turn-engine.ts:155,373,450`; the holder vocabulary in
  `../Fonnus/docs/console-call-view.md:31`.
- `turn.source` is open on purpose (`src/calls.ts`, the comment under `FAILED_STAGES`;
  contract §3.1): vendor frame names are printed as-is.
- The 55 leaf paths are `FLAT_KEYS` in `src/configuration/flat-keys.ts`, whose totality
  against the copied schema `flat-keys.test.ts` already pins.
- The barge-in, mute, speech-threshold and sentence-length sentences follow
  `../Fonnus/docs/adr/0004` §2, §5 and §10 and the code that reads them:
  `app/src/domain/turn-engine.ts` (mute :201, :417, :483; barge-in :516-537, :662-683;
  reopen only in `thinking` :380-413), `app/src/session/audio-energy.ts:8-20` (the
  threshold is a peak 16-bit sample), `app/src/session/effect-runner.ts:477-483` (energy is
  measured before the mute; `speech_start_ms` only on an unmuted line) and
  `app/src/domain/sentence-splitter.ts:37-61`. A `reopen` turn is re-committed while the
  reply is still unheard; the contract's wording "re-committed after a barge-in"
  (read-contract §3.2) disagrees with that code, and a `PLAN.md` §Waiting row asks for it
  to be corrected.
- The other leaf meanings are stated in the JSDoc of `LEAF` in
  `src/contract/config/runtime-document.ts` (byte copy, contract-hash pinned) or in
  `../Fonnus/app/src/config/schema.ts` (`FAREWELL_GRACE_MS` :271-276, `TTS_FLUSH_MS`,
  `MAX_TURN_REOPENS` :267, `VAD_SPEECH_THRESHOLD` :484).
- `reasoning = off` sends `{ enabled: false }` and `openai/gpt-oss-120b` answers HTTP 400
  "Reasoning is mandatory" to it on every turn; `omit` is accepted
  (`runtime-document.ts:43-72`; `../Fonnus/docs/runbook.md` row 17).

## Assumed

- **A1.** Settled 2026-09-25: the six sentences once inferred from key names were checked
  against the pipeline's code (§Evidence); five were rewritten and one confirmed, and the
  `reopen` name and the `max_turn_reopens` sentence were corrected with them.
- **A2.** The name set is the user's to veto (brief §Glossary): every name above is a
  default until the veto pass, and the veto changes `glossary.ts` only.
