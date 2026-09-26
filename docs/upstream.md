# Upstream — what this repo reads from `../Fonnus`, screen by screen

The pipeline repo owns the data; this file maps each screen here to the tables and
columns it reads under `../Fonnus/docs/read-contract.md` (the contract) and names the
trap each one must handle. Update rule: when the contract changes, this file changes in
the same commit that first consumes the new column — never earlier (nothing ships ahead
of its first consumer) and never later (a reader that silently depends on an unannounced
column is the drift ADR 0013 forbids).

Authority order when documents disagree: the contract → `PIPELINE_ARCHITECTURE.md` →
the ADRs → this file. This file is a map, not a source.

## Connection

Role `console`, database `fonnus`, schema `public`, read-only, for every screen. Two
paths, both on the box (contract §2): `postgres:5432` from a container on
`fonnus_default`, `127.0.0.1:5432` from host networking; from a laptop, an SSH tunnel to
the latter (`README.md`). A second pool, role `console_editor` (`EDITOR_DATABASE_URL`,
optional), exists only for the two inserts of contract §7 and is opened only under
`src/writes/` (ADR 0007); `created_by` is `console:<account>` from the `X-Console-Account`
header the reverse proxy sets.

The probe `/api/healthz` is the one exception to everything below: it issues
`select current_user` and reads no table, so it depends on no column of the contract — it
answers only whether the connection stands and which role it was made as — for both
pools, the editor's under an `editor` object that never changes the HTTP status.

## Call list

| Reads | Column(s) | Trap |
|---|---|---|
| `call_log` | `id`, `started_at`, `ended_at`, `end_reason`, `turn_count`, `total_cost_vnd`, `caller_phone_e164`, `artifact_state`, `artifact_key_prefix` | `turn_count` = rows written (trap 1); `total_cost_vnd` is a floor (trap 3); `numeric` arrives as a string — parse, and treat an unparseable one as missing, not 0; `caller_phone_e164` null is age or a call that never reached the row — "not on record", never blank (trap 5); `artifact_state` + `artifact_key_prefix` feed only the archived predicate of §Artifacts (trap 12) — the list shows a signal that a recording can be fetched, and presigns nothing. `did`, `stt_model`, `tts_model` left the list row (identical on every row) and are read by the detail only |
| `consent_record` (LEFT JOIN on `call_id`) | `outcome` | A missing row = not finalized (trap 2): in progress when `ended_at IS NULL`, else died or the finish transaction failed. The row's "how it ended" cell renders `outcome` and `end_reason` together: quiet text when ordinary (`granted` + `caller_hangup`), the existing `Vocabulary`/`Badge` tones for every other value and for not-finalized |
| `turn` (one correlated aggregate per call: `json_agg` of `idx`, `failed_leg`, `failed_stage` ordered by `idx`, over the rows where `failed_leg is not null`, served by the primary key `(call_id, idx)`) | `idx`, `failed_leg`, `failed_stage` | Failed = `failed_leg IS NOT NULL`, the one test (trap 7). The row's tick strip draws `turn_count` ticks and paints the listed `idx` values red, each red tick's tooltip naming the failure as one chip (`failed_leg · failed_stage`, a null stage = provider error, ADR 0013); an unconsented call has no `turn` rows (trap 1), so its strip reads "none — not consented", never zero ticks. The chip "Failed turn" is calls whose list is non-empty — a count of calls, not of turns (`docs/redesign.md` §2) |

**Scope, search, chips, page** — the URL contract is ADR 0006. One query
(`callsInScope`) reads every call of the scope: the window (`started_at >= since`, and
`< until` for a custom range — `call_log_started_idx` serves both) or, while a keyword is
present, all history by ORed predicates: `caller_phone_e164 LIKE $pattern` for each pattern
`phonePatterns` builds from the keyword (a suffix, a `+84…` prefix for a domestic or `+`
number, or head and tail of the masked form) and `id::text LIKE $hex || '%'`. Neither kind
is reliably served by an index (the uuid is cast to text; a suffix has no leading anchor) —
ASSUMED a sequential scan of `call_log`,
acceptable at the pilot's row count and settled by `EXPLAIN` on the box. A number that has
aged out of the column (trap 5) cannot be found by search; the empty result says so.
Everything else is computed in TypeScript over the scope's rows, so the copied rule is
the one that runs: the chip predicates (`failed_turn` = non-empty failed list;
`not_finalized` = no consent row; `unconsented` = `hung_up_before_disclosure` or
`hung_up_before_consent`; `hit_cap` = `end_reason` in `max_duration` / `max_turns` /
`max_reprompts`; `has_recording` = `isFetchable`, §Artifacts), the four cards — calls;
median duration = nearest-rank P50 of `ended_at − started_at` over calls with an
`ended_at`, the `percentiles` copied from `../Fonnus/tools/lib/call-report.ts` (a call
still open has no duration and is left out, said on the card); turns per consented call
= mean `turn_count` over calls with `isConsentGranted(outcome)` (trap 1: rows written,
so a granted call with zero rows counts as zero); recordings in the bucket = calls with
`isFetchable` and their share of the scope — and the calls per bucket, which counts
`started_at` into the window's own buckets (`bucketUnit`, in `Asia/Ho_Chi_Minh`, the
Overview's rule); a search has no window, so its buckets run from its oldest call to now. The page is a slice of 100.

The caller's number renders masked, `+84 90 ••• 4417`, through `maskPhone` (ADR 0008);
the duration track in each row is relative to the longest call of its day band, a
rendering choice with no data behind it.

Order: `started_at DESC`; index `call_log_started_idx` serves it. Vocabularies:
`end_reason` and `outcome` are fixed sets (contract §3.1) — render unknown values as-is
with a warning, never drop the row. Every `timestamptz` is an absolute instant; the screens
render it in `Asia/Ho_Chi_Minh` pinned in code (`src/calls.ts`), never in the process's
own zone, so the box and a laptop show the same clock.

## Call detail

| Reads | Column(s) | Trap |
|---|---|---|
| `call_log` | everything above plus `did`, `stt_model`, `tts_model`, `recording_started_at`, `stt_audio_ms`, `tts_chars`, `tts_bytes`, `config_snapshot`, `greeting_first_audio_ms` | `caller_phone_e164` null may be age (trap 5) — the head says "Call" without a number, never a blank; `recording_started_at` is the origin of the audio ↔ marks mapping (§Artifacts) and null means no turn of the call can be placed on the recording's axis; `artifact_state` + `artifact_key_prefix` decide, through the one `recordingAccess` of ADR 0004, whether a player renders and whether `/calls/[id]/recording` presigns; `config_snapshot` null = written before the pipeline's migration 0007, rendered "not recorded", and a key the reader does not know is shown, never dropped (contract §3.4, trap 6); `greeting_first_audio_ms` is `first_audio_out − answered` of the greeting (contract §3.5) — measured from the channel answer, not `started_at`; null = not measured (hung up before the first byte, or written before migration 0008). `caller_phone_e164` renders masked in the head and in full only inside the collapsed "Pipeline detail" Call card (ADR 0008). The "Ran on" strip under the head (`ranOnOf`, `src/call-config.ts`) reads `runtime.version` (row #N, else boot config), `STT_PROVIDER` / `TTS_PROVIDER` for each leg's vendor, `stt_model` / `tts_model` for its model, `OPENROUTER_MODEL` for the configured LLM — with a count of turns whose `turn.llm_model` differs, stated as a difference and never called a failover (ASSUMED zero on an ordinary call, PLAN backlog) — `FONNUS_BUILD_SHA`, `PROVIDERS = fake` as a warning, and since row A20 `config_snapshot->'faq'->>'count'` as "N FAQ entries" — the key is absent when the call ran with no enabled entry, which reads "no FAQ entries" (never zero; contract §3.4), and a `count` that is not a non-negative integer reads "FAQ entries: not reported"; an absent key elsewhere reads "not reported" / "not configured", never a guess |
| `call_log` | `tenant_id` (since row A15) | Only to scope the `boot_report` read below to the call's tenant, the same filter the Configuration tab applies (ADR 0029 D6) |
| `call_log` | `config_snapshot->>'CARTESIA_VOICE_ID'` / `->>'ELEVENLABS_VOICE_ID'`, `config_snapshot->'runtime'->'config'` (since row A15) | The **effective voice id** (contract §3.4, ADR 0029): present on the call's `TTS_PROVIDER` vendor only, read after `TTS_PROVIDER`, and on a snapshot that names no known vendor whichever of the two keys is present — one function for this card and the Overview's `voice` grouping; the row's `tts.voice` when one ran, else the boot default — the snapshot never says which by itself, so the card reads `runtime.config.tts.voice`: present = "chosen by row #`<runtime.version>`", absent = "boot value" (rule 7 of `docs/redesign.md` §4.2, `layerOf`). The voice **lists** are never in the snapshot; the label comes from `boot_report` below. Rendered as its label in the "Text to speech" group of the snapshot card, "unlisted voice" when no report knows it; the id only in the tooltip |
| `boot_report` (by `tenant_id`, `booted_at <= started_at`, `order by id desc limit 1`) | `id`, `booted_at`, `build_sha`, `voices` | One read per detail page on the `console` pool: the label of the voice id by ADR 0012 D6 (the newest report booted before the call, or the previous boot's for a call that started between its process's port bind and row insert; a `build_sha` that differs from the call's `FONNUS_BUILD_SHA` adds a caveat, never withholds the label). No row = "unlisted voice", and nothing is said about the box. Parsed as in §Configuration |
| `call_log` | `greeting_marks` (since row A6) | Contract §3.5: `answered` plus the reply-side keys of the greeting (`tts_first_byte`, `tts_last_byte`, `first_audio_out`, `playback_start`, `playback_end`), written at finalize; null on a call written before migration 0008, a call that never finalized, or one terminated before the greeting was dispatched — then the axis has no greeting block, said in the caption. The block runs from `answered` to `playback_end`, else the latest key present, else `answered` itself (a hairline), placed on the recording clock through `recordingOffsetMs` like a turn (§Audio ↔ marks); it has no `pipeline_ms` of its own, so the lower lane draws no bar under it. `greeting_first_audio_ms` stays the head's number — the same two keys, computed by the pipeline |
| `consent_record` | `consent_mode`, `disclosure_completed_at`, `granted_at`, `outcome`, `disclosure_text` | — |
| `turn` (by `call_id`, order `idx`) | `idx`, `caller_text`, `assistant_text`, `interrupted`, `source`, `speech_start_ms`, `speech_end_ms`, `marks`, `caller_perceived_ms`, `pipeline_ms`, `llm_model`, `tokens_in`, `tokens_out`, `tokens_cached`, `tts_chars`, `tts_bytes`, `failed_leg`, `failed_stage`, `failed_after_ms` | `caller_perceived_ms` is `speech_end → earliest(holding_line_out, first_audio_out)` since pipeline ADR 0030 (contract §3): on a turn that spoke a holding line the caller's silent wait ended at the line, not at the answer, and `pipeline_ms` is unchanged (`endpoint_decision → first_audio_out`); `tts_chars` includes the holding line's characters (§3.1), said in the TTS cost tooltip. **`caller_text` only when `outcome = 'granted'`** (trap 4) — through `showCallerData(outcome, gate)`, the one gate, which the test-phase switch of ADR 0005 can open; the same function withholds the recording; null text may be age (trap 5); `speech_start_ms` / `speech_end_ms` are offsets into `call.wav` already (§Artifacts, the mapping), so a bubble's voice length is `speech_end_ms − speech_start_ms` and a null pair is a bubble with text but no place on the strip; null accounting = "not reported", a different fact from 0; `tokens_cached` is a share of `tokens_in`, not on top of it; `failed_leg IS NOT NULL` is the test for "failed" (`interrupted` alone does not separate a barge-in from a mid-reply failure), a null `failed_stage` under a non-null leg is a provider error, and `failed_after_ms` is the elapsed time from `endpoint_decision`, never the configured bound — the bound is `config_snapshot.LLM_TTFB_MS` and its siblings (trap 7). "The call" block draws one bar per turn from `pipeline_ms`, on the same axis as the turn blocks: a turn without `first_audio_out` has a null `pipeline_ms` and is drawn as a dashed outline labelled "—" (a reply that never became audible, never a zero); a negative value is the fault of contract §3.2 and is drawn the same way, labelled "not measured" |
| `turn` (the same read) with `call_log.tts_model`, `total_cost_vnd`, `started_at`, `ended_at` | `llm_model`, `tokens_in`, `tokens_out`, `tokens_cached`, `tts_chars` | **Per-turn cost (ADR 0015)**, computed here from `src/contract/pricing.ts` — a byte copy of `../Fonnus/app/src/domain/pricing.ts` `PRICES` and its functions, pinned by `src/contract/pricing.test.ts` (the contract pins no hash for it — an ask in `PLAN.md` §Waiting on) — at the documented constant `VND_PER_USD = 26 500` (`src/cost.ts`; the pipeline reads it from the box `.env`, never snapshots it): LLM = `llmCostUsd({model: llm_model, tokens_in, tokens_out, tokens_cached})`, the cached share charged instead of, never on top of, the input rate (`tokens_cached ≤ tokens_in`, clamped as the pipeline does); TTS = `ttsCostUsd(tts_chars, call_log.tts_model)`; **STT has no per-turn figure** (`stt_audio_ms` is per call, billed per minute) and the cell reads "—" with that reason. A null counter is "not reported", never 0; a model with no price row is `unpriced (<model>)`, the id verbatim — `openai/gpt-oss-120b`, the running model, has none. Every cost header says "list price" once, with the price source and rate in its tooltip. The per-turn sum is **not** `total_cost_vnd` and is never shown as the call's total: the stored figure also covers STT, the greeting and the canned lines (`call_log.tts_chars`), and the LLM usage of an unconsented call that has no `turn` rows (trap 1) — the turn-table footer says so. The unpriced-model list of a call = `stt_model`, `tts_model`, `config_snapshot.OPENROUTER_MODEL` and every distinct `turn.llm_model` without a price row — the configured model is always in it, because an unconsented call has no `turn` rows while its `total_cost_vnd` still includes the LLM usage |

**The stat strip** under the player (row A19): Call duration (`ended_at − started_at`) ·
Number of turns (`turn_count`, trap 1 in the tooltip) · Total cost (`total_cost_vnd`, "list
price", the unpriced models named) · Cost per minute (total over the duration; "—" while the
call runs) · Average turn latency = the **arithmetic mean of `pipeline_ms` over the turns whose
value is non-null and non-negative** (the ADR 0007 target is on `pipeline_ms`; a reversed span
is excluded as it is from every percentile), with the count it is over in the tooltip.
`greeting_first_audio_ms` ("Answered → first audio") leaves the strip for the Call card under
Pipeline detail; the "Cost floor" figure is replaced by the total above.

The config snapshot on the detail is grouped by key prefix for reading (Speech to text ·
Language model · Text to speech · Turn taking · Call limits · Consent & recording · Texts
· Other, the nested `runtime` key folded under them, and since row A20 **FAQ entries** for the
nested `faq` key) — a rendering choice only; a key with an unknown prefix
falls to Other and no key is ever dropped (a test pins that every key of a snapshot lands
in one group). `HOLDING_LINES` (a JSON array) sits under Texts and renders one line per
entry, never as JSON; `HOLDING_LINE_AFTER_MS` under Turn taking. The **FAQ entries** group
reads `config_snapshot.faq = { count, entries: [{ key, question, answer, description }] }`
(contract §3.4, pipeline ADR 0031): the head says "N entries (as the call read them)", then
one collapsed entry per element in the snapshot's order (key order), opening to its three
texts, a missing field shown as "—" and never dropped; the key is absent when the call ran
with no enabled entry and then the group says "No FAQ entries — none enabled, or the read
failed", never zero. The texts are the snapshot's only: nothing on the call detail reads
`faq_entry`, because the row may have been edited since the call. Each vendor group is headed by `STT_PROVIDER` / `TTS_PROVIDER`, read
before any vendor key; a vendor's keys are present only on a call that ran that vendor,
so an absent `DEEPGRAM_*` key means "that vendor did not run", never "the default
applied" (contract §3.4). `PROVIDERS` is `real` / `fake` and says only whether real
vendors answered. Each flat key whose value came from the call's `runtime_config` row is
tagged "row" (`keysFromRow`: a key `FLAT_KEYS` maps to a path present in
`runtime.config`, `layerOf`'s rule key by key); the nested `runtime` key itself is folded
under the groups as raw JSON, shown and never dropped.

### The selected turn (capsule tracks since row A19; the waterfall before it)

`turn.marks` is a JSON object of absolute wall-clock instants (ms since epoch), one key
per stage the turn reached; every key optional (contract §3.2). Twelve keys since
pipeline ADR 0030: `speech_end`, `endpoint_decision`, `stt_final`, `llm_first_reasoning`,
`llm_first_token`, `llm_last_token`, `tts_first_byte`, `tts_last_byte`, `playback_start`,
`first_audio_out`, `holding_line_out`, `playback_end`; `src/latency.ts` keeps exactly these
and drops any other key. `holding_line_out` is the first byte of the holding line the bot
spoke while the answer was still being generated — present only on a turn where the line
played; `first_audio_out` stays the answer's first byte, and a turn may carry the former
and not the latter when the answer never became audible. The seven legs and their end
points, copied from `../Fonnus/app/src/domain/latency.ts` and
`PIPELINE_ARCHITECTURE.md` §6 (the contract's closing paragraph of §3.2 says the list may
gain entries, so the copy is held to the pipeline's by test, not by count):

| Leg | from → to | Render note |
|---|---|---|
| `stt_emit` | `speech_end → stt_final` | outside the partition; overlaps `endpoint_wait` |
| `endpoint_wait` | `speech_end → endpoint_decision` | the largest leg in the first baseline; governed by the endpointing settings |
| `llm_ttft` | `endpoint_decision → llm_first_token` | |
| `tts_ttfb` | `llm_first_token → tts_first_byte` | **first sentence only** |
| `send` | `tts_first_byte → first_audio_out` | |
| `playback` | `first_audio_out → playback_start` | outside the partition; advisory |
| `holding_line` | `endpoint_decision → holding_line_out` | outside the partition; the row is drawn only on a turn that carries the mark (pm decision, row A20) |

`endpoint_wait + llm_ttft + tts_ttfb + send` tiles `caller_perceived_ms` exactly on a turn
without a holding line; on a turn with one, `endpoint_wait + holding_line` tiles it, and the
headline caller-perceived bar ends at the line (`callerPerceivedEnd`, the copy of the
pipeline's `callerPerceivedMs` rule). The last three of the four tile `pipeline_ms` on
every turn. A span whose end precedes its start is a fault, rendered "not
measured" — never a negative bar, never folded into a percentile. The rows are drawn as
capsule tracks (`HBar` thick, ADR 0014) on **one shared scale**: origin = the earliest mark
the turn carries (`speech_end` when present), end = `playback_end` or the latest mark present;
the playhead is placed on it through `recording_started_at` (`recordingOffsetMs`, §Audio ↔
marks) and drawn only while it is inside the turn's span. The pipeline leaves `speech_end`
out when the audio clock has no origin (`effect-runner.ts`: an invented `speech_end` is worse
than a missing one), and then a leg can have a span but no place on the axis — it is named
under the rows as "measured but not placed", never drawn from 0 as if it ran alongside the
legs before it. The two headline spans lead the rows with their target marks (ADR 0007), the
legs follow (six, or seven on a holding-line turn), then Model reasoning and the three end-of-turn spans; the footer prints the
turn's STT · LLM · TTS cost and `tokens_in` / `tokens_out` from the per-turn cost row above. Targets (ADR 0007):
`pipeline_ms` P95 < 1 200; `caller_perceived_ms` alarm at P95 ≥ 3 600 (aspirational).

Under the legs the card draws the three **end-of-turn marks** of W2-L3 F2 as
spans by mark pair — `llm_first_token → llm_last_token`, `tts_first_byte → tts_last_byte`,
`playback_start → playback_end` — outside the partition. The pipeline names no leg for
them (`app/src/domain/__tests__/latency.test.ts` pins that tail spans are not legs), so
this console coins none: the label is the pair. Absent keys are absent bars; the reversed
and not-placed rules above apply unchanged. Two facts the turn card states only when they
apply (contract §3.2): on an `interrupted` turn `playback_end` is the last lull before the
barge-in, not the end of the reply; on `source = 'reopen'` the head marks are the first
generation's and the end-of-turn marks the last's.

Beside them, since row A6, the one **head pair** of W2-L3 F7: `llm_first_reasoning →
llm_first_token`, the thinking span of a reasoning model. `llm_first_reasoning` is a head
mark (first-write-wins) and part of no leg — it sits inside `llm_ttft`, which the leg
row already shows whole, so the pair is a second reading of that leg, not a leg of its own,
and the pipeline names none for it. Absent on a model that emits no reasoning, and then
absent from the card. On an LLM failover the mark is the primary's and `llm_first_token`
the fallback's (contract §3.2), a fact the two marks alone cannot show — the caveat under
the row says the span can contain a failover; the record that proves one is in
`call_event` (row A4).

### The call timeline (row A1b — the interval lane and the interval card; ADR 0010)

The upper lane of the axis and the interval card under "The call" are one list of
**intervals** — contiguous stretches of the recording clock, each held by the bot, the
caller, silence, or a deaf recogniser — derived from the call's `call_event` trail by
contract §8, in `src/intervals.ts`, as a copy of the pipeline's own reader
`../Fonnus/tools/call-evidence.ts` (cited by line below; copied, never imported — pipeline
ADR 0013). `docs/console-call-view.md` in the pipeline repo is the requirement the card
answers; `intervals.txt` in an evidence bundle is the reference rendering of the same rules,
so a call's card and its `intervals.txt` must agree.

| Reads | Column(s) | Trap |
|---|---|---|
| `call_event` where `call_id = $1`, ordered by `seq`, no `LIMIT` (`getCallEvents`, one statement on the `console` pool, after `getCall` and beside `getTurns`; `count(*)` and `max(seq)` are taken from the array) | `seq`, `ts`, `kind`, `type`, `gen`, `turn_idx`, `phase`, `sensitive`, `data` | Read and place by `seq`, never by `ts`: `ts` can tie and step back a few ms between records the pipeline wrote in order (trap 9). No row at all is `RECORD_CALLS` off, a call that died before its first record, a row set the sweep removed, or a call older than migration 0009 — never "nothing happened" (trap 8). A `sensitive` row with null `data` is refused consent or the transcript TTL, told apart by `consent_record.outcome` (trap 10). `chunk_played.data.seq` is the playback module's own counter, not `call_event.seq` (trap 11) — not read here. An unknown `{kind, type}` is a record the pipeline added since (§3.1): ignored by the derivation, counted for completeness. |
| `call_log` (already read by `getCall`) | `recording_started_at`, `ended_at`, `config_snapshot->>'RECORD_CALLS'` | The clock origin: offset = `ts − recording_started_at`, exact in ms, right to about 100 ms and late-only (§8 rule 1; ADR 0012); a null origin places nothing: the card says the trail cannot be placed on the recording clock and the lane falls back to turn blocks. `ended_at` null is a running call — verdict `open`, not `truncated`. The snapshot key is named in the `absent` verdict only; §3.4 rules for the snapshot apply. |
| `consent_record` (already read by `getCall`) | `outcome` | Gates every recogniser text on the card through `showCallerData` once (ADR 0005, trap 4); tells withheld from expired on a null `data` (trap 10). |
| `turn` (already read by `getTurns`) | `idx`, `assistant_text` | The reply interval's bot text, joined by `turn_idx`; `effect/start_reply.data` is `sensitive` and is not read for text. Absent for a canned line and the greeting (§8 rule 2 — they own no turn). `assistant_text` never contains the holding line (§3.1); the line's text comes from the trail, below. |
| `call_annotation` where `call_id = $1`, ordered by `id`, no `LIMIT` (`getCallAnnotations`, one statement on the `console` pool, beside `getTurns` and `getCallEvents`; since row A7) | `id`, `call_id`, `from_ms`, `to_ms`, `label`, `caller_said`, `note`, `supersedes`, `text_expired_at`, `created_by`, `created_at` | Every row of the call is read and **current** is derived in TypeScript by the contract §3 rule (a labelled row no other row supersedes — `currentAnnotations`, copied from `call-evidence.ts:911-913`), so one fetch serves both the cells and the history. `from_ms` / `to_ms` are already on the recording clock (§8 rule 1) — no conversion; a current row is shown on **every** interval it overlaps (`from_ms < interval.toMs AND to_ms > interval.fromMs`, the ms form of §8's rule — `call-evidence.ts:971`), because the caller's stretch is cut at each `turn_end`. `caller_said` and `note` are caller-derived (trap 4): gated through `showCallerData` like the recogniser texts; `label`, the interval, `created_by`, `created_at` and `supersedes` are never withheld. A null text is one of three things (trap 13): `[withheld]` when the gate is closed; `[expired]` when `text_expired_at` is set (the sweep, counted from the **call's** `started_at`); `—` when both are null (never written) — the cell prints the bare `[expired]` the card's caveat explains, the history prints `[expired <instant>]` as `annotations.txt` does. A row carrying both texts shows both in its cell (`"caller_said" — note: …`), where the reference prints the words alone and leaves the note to `annotations.txt` — the console's history is a collapsed block, so the cell cannot lean on it. `label` is the fixed vocabulary of §3.1 (six values; null only on a retraction) — an unknown value renders with the `Vocabulary` warning, never dropped. A call without granted consent or without `recording_started_at` has no rows by the pipeline's insert gate (§7), not because nothing was wrong on it — the card's caveat says so. `id` and `supersedes` are `bigint` and arrive from `pg` as strings (ASSUMED standard driver behaviour; settled by the first live row). `annotations.txt` in an evidence bundle is the reference for the history view (standing words `current` · `superseded by #N` · `retracted by #N` · `retraction of #N`, `annotationStanding` `:921-930`). No index serves `order by id` beyond the `(call_id, id)` UNIQUE (§3.3) — tens of rows per call at most. |

**`data` keys read**, per `{kind, type}` — the contract names the payload "verbatim, as
`PIPELINE_ARCHITECTURE.md` §7 describes it" and §3.1 fixes the vocabularies; the key names
below are verified against the recorder (`../Fonnus/app/src/recording/artifact-recorder.ts`
:905-975) and **ASSUMED against the contract until §3 names them** (PLAN §Waiting on
`../Fonnus`). A key of the wrong shape is treated as absent, never thrown on.

| Record | Key | Used for |
|---|---|---|
| `recorder/finalized` | `failed` (boolean), `mirror.dropped` (number), `mirror.fromSeq` (number) | the verdict — named by §3.1 and trap 8 (not assumed) |
| `effect/speak_text` | `text` (string, not sensitive) | the greeting's text on the card — ASSUMED (`artifact-recorder.ts:963`) |
| `effect/speak_canned` | `line` (`reprompt` / `degraded` / `farewell`) | the holder label `bot: <line>` — named by §8 rule 2 (not assumed) |
| `tts/sentence` | `holding_line` (boolean), `text` (string, not sensitive) | the holding line's text on its interval, from the record of the same `gen` flagged `holding_line = true` — the flag is named by §3.1, the `text` key and the flag's placement in `data` are ASSUMED (`artifact-recorder.ts:467`); a record of the wrong shape reads as no text |
| `event/holding_line_audible`, `event/holding_line_failed`, `effect/speak_holding_line`, `event/first_sentence_queued` | none | the first is the instant the `holding` interval starts (§8 rule 3); the other three are counted for completeness and read for nothing |
| `event/stt_partial`, `event/stt_final` | `text` (string, sensitive) | the recogniser cell — ASSUMED (`artifact-recorder.ts:918`); null `data` under a granted outcome is trap 10 (`[expired]`), and a payload that is present without the key reads `[no text in payload]` — the assumption failing would show as that marker, never as the TTL |
| `event/turn_end` | `source` (string) | printed verbatim in the "segmented, returned nothing (<source>)" signature — named by §8 rule 4 (not assumed); never switched on |
| `event/timer_fired` | `id` (`no_input`) | the no-input watchdog — named by §8 rule 5 (not assumed) |
| `event/caller_energy` | none | the instant alone; `suppressed` is not read |

**The verdict** (`trailVerdict`, copied from `call-evidence.ts:389-476`; contract trap 8),
rendered above the card before any interval, in the pipeline's five words: `absent` when
the call has no row (the text names `config_snapshot->>'RECORD_CALLS'` and the four causes;
the lane falls back to the turn blocks of §Audio ↔ marks under a caveat); `open` when there
is no `recorder/finalized` and `ended_at` is null; `truncated` when there is none and the
call ended; `gap` when `recorder/finalized` carries `failed = true` (hole from the record
before it, `max(seq) − 1`; `:486-489`), or `mirror.dropped > 0` (hole from `mirror.fromSeq`;
`:497-505`), or `count(*) ≠ max(seq)` — both holes listed when both apply, and every interval
after the earliest hole is marked unsupported (§8 rule 7); `complete` otherwise. The
verdict is a state of the trail, never an error: a running call is `open` by design.

**The intervals** (`callIntervals`, copied from `call-evidence.ts:610-665`), each `[from,
to)` in ms on the recording clock, contiguous from the first record to `recorder/finalized`
(or the last record when the trail is not finalized), with the first record's offset kept
even when negative (`:622-624` — the recorder can open after the first record; ADR 0010
Decision 4). The rules, each cited:

- **Bot intervals** (§8 rule 3; `botSpans` `:723-792`): one per intent record —
  `effect/speak_text` → `bot: greeting`; `effect/speak_canned` → `bot: <data.line>`
  (`cannedHolder` `:760-763`, `bot: canned line` when the key is missing);
  `effect/start_reply` → `bot: waiting on reply N` from the intent to the first
  `event/first_audible` of the same `gen`, then `bot: reply N` to the end, with
  `N = turn_idx ?? gen` and no N at all when both are null. Since pipeline ADR 0030 (row
  A20, `:735-748`, `:765-771`, `:780-785`): when the first `event/holding_line_audible` of
  the `gen` precedes the answer's `first_audible`, the wait ends at the line and
  `bot: holding line N` runs from there to the answer's `first_audible` — or, when the
  answer never became audible, to the later of `synthesis_complete` and the last
  `playback_completed` of the `gen` before any `first_audible` (a drain before the answer
  belongs to the line; only drains after it belong to the reply); `event/holding_line_failed`
  ends nothing; barge-in and `reply_failed` cut as before. The card's row for such a line
  carries "the answer never became audible" when the reply never produced `first_audible`
  (`console-call-view.md` item 1 — a line that played and an answer that never came must
  read as exactly that). The window is the intent to the
  next intent (any `gen`) or the clock end. The end is the first that applies of: the first
  `barge_in/detected` strictly after the intent inside the window (it carries no `gen`);
  the **last** `event/playback_completed` of the `gen` in the window (`playback_completed`
  of another `gen` is a dead generation's drain and holds nothing); with no `first_audible`,
  `event/reply_failed` of the `gen`; with no `first_audible` and only for `start_reply`,
  `event/synthesis_complete` of the `gen`; else the window end. An empty span (`to ≤ from`)
  is dropped. **Known reference bug carried as written** (`../Fonnus/ISSUES.md`
  L10-260917-1): the `synthesis_complete` cut applies to `start_reply` only, so a canned
  line whose synthesis returned no bytes holds the line until the next intent and the
  caller's energy and `turn_end` under it are swallowed; the card says so in a caveat, the
  fix is the pipeline's (PLAN backlog).
- **Caller or silence** (§8 rule 5; `callerSpans` `:771-785`, `holderOf` `:787-790`): every
  gap between bot intervals, and the stretch after the last one, cut at each `event/turn_end`
  strictly inside it and at the deaf point; a segment holding any `event/caller_energy`,
  `event/stt_partial`, `event/stt_final` or `event/turn_end` (`HEARD` `:558-563`) is
  `caller`, one holding none is `silence`. A trail with no bot interval is one span over
  the whole clock. Records fall into a span by `recordsOf` `:798-805`: a `turn_end` at the
  span's start belongs to the span before it (it cut there), except on the first span.
- **Deaf** (§8 rule 6): from `stt/reconnect_exhausted` (clamped at 0) to the end of the
  clock, every non-bot segment is `deaf`, not `silence` — the contract's label is `deaf`
  (`console-call-view.md` holder vocabulary); the reference prints `deaf (stt exhausted)`
  (`:788`), which this console renders as the explanation beside the label, not as the
  label.
- **The sound-instant note** (§8 rule 4; `callerLineCell` `:836-846`, `mutedStretches`
  `:683-698`): the "caller line" column of the reference is not a column here since row A19
  (brief decision 4). Its facts survive as a note inside "What was heard", printed only when
  they change the reading: the `caller_energy` instants — `sound at 31.40, 31.70`, collapsed
  to `sound ×N (first…last)` above six (`ENERGY_SHOWN` `:569`) — when the interval holds
  sound and nothing recognised (no `stt_final`, no overtaken partial), and with ` (unheard —
  feed muted)` when any instant lies in a muted stretch. Muted stretches are read from the
  trail only: from the first record to the first `effect/unmute_stt`, and from each
  `effect/mute_stt` to the next `effect/unmute_stt`, an unclosed one running to the end —
  never re-derived from `STT_MUTE_ON_FIRST_AUDIO` or from the bot's intervals. An interval
  whose sound was recognised prints the recognised text alone; `intervals.txt` still prints
  every instant, so the two agree on facts, not on layout.
- **What was heard** (the recogniser cell, §8 rule 4; `recogniserCell` `:854-870`, `overtakenPartials`
  `:813-826`, `signalRuns` `:878-888`): every `stt_final` in the interval as quoted text;
  a `stt_partial` with no `stt_final` after it before the next intent or the trail's end
  as `partial overtaken: "…"`; when the interval has neither, each run of `turn_end`
  records as `segmented, returned nothing (<data.source>)`, with ` ×N` for a run of N
  (`turn_end` without a source prints `segmented, returned nothing`); `timer_fired` with
  `id = 'no_input'` as `no-input watchdog fired`; items joined with ` · `, `—` when none.
  Text (`sttText` `:897-901`) is `[withheld]` on a `sensitive` record when consent is not
  granted, `[withheld]` when it is granted and `data` has no text (the copy's rule); this
  console tells the second case apart as `[expired]` by trap 10 when the outcome is
  `granted` (a console-own rendering, see the "withheld vs expired" fork of the A1b
  design). The signatures themselves are never withheld: they carry no words.
- **Bot text on the card**: the greeting from `effect/speak_text.data.text` (ASSUMED key,
  above); a reply from `turn.assistant_text` via `turn_idx`, shown on every call exactly as
  the Transcript card shows it — trap 4 gates `caller_text` only, and the bot's own words
  are not the caller's; a holding line from the `tts/sentence` record of its `gen` flagged
  `holding_line` (ASSUMED key, above; the record is not sensitive — the text is clinic
  configuration), a departure from the reference, which prints no text for the line
  (recorded in the `src/intervals.ts` header); a canned line shows its holder label only.

The card's columns since row A19 are From · To · Who (the holder through the glossary,
ADR 0013; tone by kind) · What was heard (plus the bot's own text in italics on a Fonnus
row). The **annotation column is gone**: the current rows and the history are one block
under the table (the `<details>` of row A7, now carrying the current rows first), so the
`call_annotation` read above is unchanged and an interval's annotations are found by the
same overlap rule, listed under the table with the interval they cover.

The interval offsets are what the player seeks to (`seek(from)`), and a `reply` or
`waiting` interval with a `turn_idx` selects that turn (`select(turn_idx)`) — the same
`?turn=` contract as the turn blocks (ADR 0006). The lower `pipeline_ms` lane, the
Transcript card and the selected turn's card keep reading `turn` as before.

Every record the trail carries beyond the ones above — the per-sentence `tts/*` pairs,
`llm/request_sent` and the token stream, the `barge_in/detected` followers, `reply_failed`
stages, `playback/chunk_played`, and `turns/NNN/llm.stream.jsonl` with `turn.reasoning_text`
in the bucket — is row A4's, the per-record detail; the pairing rules the old A1b table
carried (`ttsSentences`, `bargeIns` in `../Fonnus/tools/lib/call-report.ts`) are copied
there when A4 is designed, not here.

## Overview

`/` (PLAN rows A2 and A6; `/dashboard` redirects here), a server-rendered screen over the
window of ADR 0006 — `since` in the pipeline's `report-calls --since` forms (`7d`, `36h`,
`15m`, or an ISO instant; default `7d`; a preset is open-ended so the leg numbers equal
`report-calls --since <same>`), plus `until` for a custom range — and a grouping (`none`,
`llm_model`, `stt_model`, `tts_model`, `config`, `voice`, `key:<snapshot key>`, or
`key:runtime.version`; default `key:OPENROUTER_MODEL`, ADR 0009). Since row A19 the
control offers **eight** of these (ADR 0013 names them): `key:OPENROUTER_MODEL` (LLM model,
default) · `stt_model` · `tts_model` · `voice` · `key:OPENROUTER_REASONING` (Reasoning) ·
`key:STT_PROVIDER` (STT vendor) · `key:TTS_PROVIDER` (TTS vendor) · `key:runtime.version`
(Runtime config row); every other value stays parseable from the URL (`none`, `llm_model`,
`config`, any `key:<K>`), renders "Value" as the column header and shows itself as an extra,
selected option of the control so the control never lies. `voice` groups on the
**effective voice id**: `config_snapshot->>'CARTESIA_VOICE_ID'` when `TTS_PROVIDER` is
`cartesia`, `->>'ELEVENLABS_VOICE_ID'` when `elevenlabs`, else whichever of the two is
present (a snapshot names the key of its own vendor only, §3.4) — evaluated in TypeScript,
"unknown" when neither is present; the id is verbatim, the label from `boot_report` is
never the group key (a label can change between boots, an id cannot). The control is a
client component that on change calls `router.replace(url, { scroll: false })` — no Show
button, no reload; the URL still carries `group` (ADR 0006). Two hand-written
queries in `src/queries/dashboard.ts`, both bounded by the window only —
**no `LIMIT` on turn rows**, the trap the pipeline's own `turnMetricRows`
(`../Fonnus/app/src/persistence/call-queries.ts`) falls into by capping turns after the
join. The two run on one connection inside one `REPEATABLE READ READ ONLY` transaction, so
they read the same snapshot and a call that starts between them cannot leave turn rows
without a call row. A window longer than 366 days is refused on screen, because the pool
gives a statement 10 seconds (`src/db.ts`) and the screen reads every turn in the window.

| Reads | Column(s) | Trap |
|---|---|---|
| `call_log` LEFT JOIN `consent_record` on `call_id`, `started_at >= since` (and `< until` on a custom range), ordered by `started_at` (`dashboardWindow`, first statement) | `call_log.id`, `started_at`, `ended_at`, `end_reason`, `total_cost_vnd`, `stt_model`, `tts_model`, `config_snapshot`; `consent_record.outcome` | Every call in the window, consented or not — the denominator of "N of M calls" (trap 1); a null snapshot is a call written before F1, grouped as "unknown", never dropped (§3.4). Since row A6 the same rows feed: calls per day, split consented / not by `isConsentGranted(outcome)`; the window's cost floor = the sum of parsed `total_cost_vnd` (`numeric` → string → number, unparseable = missing, not 0), a **floor** while any model is unpriced (trap 3) — said beside the number; "How calls ended" = the distribution of `end_reason` with **not finalized** (no consent row, trap 2) counted as a state of the call beside the values, and the distribution of `outcome` with "no consent row yet" beside the three values — a missing row is never a refusal |
| `turn` JOIN `call_log` on `call_id`, `call_log.started_at >= since` (and `< until`), ordered by `started_at, idx` (`dashboardWindow`, second statement) | `turn.call_id`, `idx`, `marks`, `caller_perceived_ms`, `pipeline_ms`, `llm_model`, `interrupted`, `source`, `failed_leg`, `failed_stage`, `failed_after_ms` | Only consented calls have rows (trap 1); a reversed span is excluded from its leg's sample, a failed or interrupted turn is included — the rule of `../Fonnus/tools/lib/cross-call-report.ts`; per-leg `count` is turns with both marks, not the turn count. `marks` is nullable: the turn count means what the pipeline's `turnCount` means (rows with a non-null `marks`, the filter `turnMetricRows` applies in SQL) so the A2 acceptance against `report-calls` holds, but a null-marks row is not filtered out — it is listed under "Turns that never became audible" and counted in the caveat as "U more without marks, excluded from every number" |

Computation is in TypeScript (`src/dashboard.ts`), never in SQL, so the copied pipeline
rule is the one that runs and the one the tests pin: per-leg spans from `legSpans` over the
seven legs of `LEGS` (`holding_line` has a row like the others; its sample is turns carrying
both marks, so the "max of N" caveat usually applies), nearest-rank P50 / P95 / max copied from `../Fonnus/tools/lib/call-report.ts`
(`sorted[min(n−1, ceil(q·n)−1)]`, null on empty), and the two headline percentiles of
`caller_perceived_ms` and `pipeline_ms` — which the pipeline's baseline JSON does not carry —
against the ADR 0007 targets. Buckets take the **call's** `started_at` (a turn has no
timestamp of its own) in `Asia/Ho_Chi_Minh`, the zone every screen pins, and the bucket
unit follows the window (`bucketUnit` in `src/window.ts`): one hour for `24h` and any other
window of at most two days (`36h`, `90m`, a one-day range), one calendar day for `7d`, `30d`
and any other window of at most 45 days, one Monday-start week beyond that. The buckets cover the whole window, `since` to `until` (or now), so a quiet edge of
the window shows as zeros rather than being cut off; a bucket with no turn is a null point,
so the P95 bars leave a gap there instead of drawing a zero, while "Calls per day" draws a
real zero (nobody rang is a measurement). A rolling preset starts inside a bucket, so the
first and last columns may be partial; they are drawn hatched and the chart's legend keys
the hatch whenever one is on screen. The card
titles say the unit.

Grouping by `config` keys on the whole `config_snapshot` object ("this exact
configuration", labelled by its `FONNUS_BUILD_SHA`) and shows only the keys whose values
differ across the groups, side by side — never the whole object twice: the top-level flat
keys plus the one derived column `runtime.version`, never the `runtime.config` leaves
(ADR 0009), and never the nested `faq` key (row A20): the entries are an object of some
kilobytes that changes with every edit of a FAQ entry, so it is neither part of the
grouping identity nor a differing column — a grouping on `faq.count` is a later ask if
needed. `key:<K>` groups on one setting (`config_snapshot->>K`, evaluated in
TypeScript); `key:runtime.version` on `config_snapshot->'runtime'->>'version'`, the
`runtime_config.id` the call ran under (absent = boot config, grouped "unknown"); the
three `DEEPGRAM_*` keys read their pre-2026-09-17 `STT_*` spelling as a fallback (contract
§3.4's COALESCE), so a deploy that straddles the rename is one group per value, not two.
Two calls on the same build with one changed key are the comparison the hypothesis loop
is made of (`CONTEXT.md` §Why now). Group rows are built from turn rows, so a group's
call count is "calls with turns on record" — said in the column header; the two gauges of
each group share the headline's scale. "Turn failures" counts the window's turns by
`failed_leg · failed_stage` over the turns with marks, a null stage under a set leg
rendered "provider error" (§3.1). "Where the reply's time goes" is the P50 of each of the
four partition legs laid end to end — P50s of legs do not sum to the P50 of
`caller_perceived_ms`, said under the bar; `holding_line` is not laid in (its P50 is over a
different turn set), and when the window has turns carrying `holding_line_out` a caveat
names their count and says the bar is the answer's four legs. "Turns that never became
audible" lists the window's turns whose marks lack `first_audio_out` (the answer never
became audible — a turn whose holding line played is still listed, marked "holding line
played", and does count in the caller-perceived percentile) with
`source`, `interrupted`, `failed_leg`, `failed_stage` (null under a set leg = "provider
error", §3.1) and `failed_after_ms` (elapsed since `endpoint_decision`, not the bound —
trap 7); the first six by default, all of them under `outside=all`, each row linking to
`/calls/<id>?turn=<idx>`.

Caveats that travel with the numbers, on the screen: "consented calls only — N of M calls,
T turns" beside the headline stats; in "Where the reply's time goes", "over T turns with both
marks" in the card head, and on each leg row whose sample is under 20 turns a visible "max of N"
beside its P95 (nearest-rank P95 of fewer than 20 values is the maximum), the per-leg count in
the row's value tooltip; "first sentence of the reply only" in the `tts_ttfb` row's name; the
window's Cost figure carries a visible "floor" while any model in the window is unpriced (each
call's `stt_model`, `tts_model` and `config_snapshot.OPENROUTER_MODEL`, every
`turn.llm_model`, and `config_snapshot.TYPESAFE_MODEL` while the call's `ROUTER_MODE` is not
`off` — trap 3 puts the router's decisions inside `total_cost_vnd` and prices a model with
no row at 0; the console reads no router records, so a shadow call that asked the router
nothing is still counted, which errs toward showing "floor"), its
tooltip "a floor while these models are unpriced: <list>" or "every model in the window is
priced" (ADR 0015 D7).

## Baselines

`../Fonnus/docs/baselines/<date>-<label>.json` is the output of `report-calls --baseline`:
`generatedAt, label, source ('postgres' | 'fs'), root, skippedDirs, callIds[], since, callCount,
turnCount, legs{<leg>:{count,p50,p95,max}}, calls[{id,startedAt,durationMs,turns,costVnd,
vndPerMinute}], pricedCallCount, totalCostVnd, totalMinutes, vndPerMinute, targetVndPerMinute,
withinTarget, unpricedModels[], ttsRender{...}`. The label defaults to the pipeline's short
git SHA. Mind `source`: the first baseline (`2026-09-05-w2v2`) was computed from the artifact
directory (`fs`), which also covers unconsented calls; a dashboard reading Postgres sees
consented calls only, so the two agree on leg percentiles only over the same call set —
compare by `callIds`, not by window. A backlog row imports these files to overlay committed
numbers on the dashboard.

## Artifacts (row A5 reads `call.wav`; the per-turn files wait for row A4)

The bucket landed with `../Fonnus` PLAN row W2-L1 on 2026-09-07 (its ADR 0019, migration
0010, read contract §6 and trap 12). Row A5 (the call review) is the first consumer: the
detail page plays `call.wav` through a presigned GET (ADR 0004). `turns/NNN/*` stays unread
until row A4. These are the facts both rows are built on.

**Where a call's files are.** One bucket, `recordinginternal`, endpoint
`https://s3.vn-hcm-1.vietnix.cloud`, region `vn-hcm-1`. A call's objects sit under
`call_log.artifact_key_prefix`, which is `calls/YYYY-MM-DD/<uuid>` on the call's UTC start
day; each regular file of the artifact directory is one object whose key is the prefix plus
its relative path: `call.wav`, `events.jsonl`, `call.json`, and per turn
`turns/NNN/{llm.request.json, llm.stream.jsonl, tts.input.txt, tts.output.wav}` with `NNN`
zero-padded. Two dotfiles, `.caller.raw` and `.bot.raw`, exist only when the stereo
interleave failed — then *they* are the audio, so a listing that hides dotfiles hides the
only evidence left of that call.

**Whether the files are there at all — `call_log.artifact_state`.** The column is the
gate, and the screen reads it before offering anything (contract §6, trap 12):
`archived` = every object is present, verified by ETag; `expired` with a non-null
`artifact_key_prefix` = swept from the box's disk but still in the bucket, so fetch it;
`expired` with a null prefix = gone everywhere; `spooled`, `failed`, or NULL = not in the
bucket (yet) — render "not archived yet", never a 404; NULL together with a non-null
`artifact_dir` is a row written before migration 0010, "unknown, probably spooled". A
`call.json` object under the prefix means the set is complete, because the uploader puts it
last. The predicate the pipeline itself uses, copied rather than re-derived
(`app/src/persistence/call-queries.ts:180-203`, `fetchableCallsSince`) into
`src/artifacts.ts` as `isFetchable` and pinned by its test:
`artifact_state = 'archived' OR (artifact_state = 'expired' AND artifact_key_prefix IS NOT NULL)`.
It is the gate for every recording surface — the list's `Rec` column and its "Has
recording" chip, the "Recording in the bucket" card and its share, the detail's player,
the `/calls/[id]/recording` route — and nothing else in `src/` compares `artifact_state`
to a literal. A value outside the contract's vocabulary is not fetchable and is shown with the
`Vocabulary` warning. `artifact_dir` remains the disk copy only — a path on the box that
nobody outside it can open; it is not a bucket key.

**When they arrive.** The uploader runs only while no call is active, so a call that just
ended reaches the bucket seconds to minutes later. This is why the screen reads
`artifact_state` and never assumes the audio exists because the call does.

**Playing them.** Presigned GET works and honours `Range` (206), so the player links
straight at the bucket through a short-lived presigned URL — built with
`@aws-sdk/s3-request-presigner` over the same client — and this app never proxies bytes: the
VPS-to-Vietnix path measured only ~0.9 MB/s while the viewer's own connection is far faster.
The `<audio>` element's `src` is this app's `/calls/[id]/recording`, which redirects to a
URL presigned for 900 s at that moment (ADR 0004), so a page left open keeps playing and
seeking. The uploader stores `call.wav` as `audio/wav`
(`../Fonnus/app/src/recording/object-store.ts`), which settles the Content-Type question;
what is still unverified is whether a browser plays that inline, and the first page load of
A5 answers it — the observation is owed back to `../Fonnus/docs/runbook.md` §2.5 row 30.
CORS on the bucket was deliberately not configured: a plain `<audio src>` needs none, a
`fetch()` would — which is also why no waveform is drawn from the bytes: the browser cannot
read them, only play them. The presign expiry ceiling Vietnix accepts is also unverified
(ASSUMED ≥ 900 s; the first `302` that plays settles it).

### Audio ↔ marks — placing a turn on the recording

No new data is needed to line the transcript and the waterfall up with the audio; the
recording clock is the wall clock (pipeline ADR 0012). The rules, copied from
`../Fonnus/app/src/recording/wav-writer.ts` and `artifact-recorder.ts` into `src/playback.ts`
and pinned by its tests:

- **Origin.** Sample 0 of `call.wav` is `call_log.recording_started_at` exactly, on both
  channels (`RawTrack.sampleAt(wallMs) = round((wallMs − startedAt) / 1000 × sampleRate)`;
  L = caller, R = bot; a channel that has no track is silence, which is what an unconsented
  call's L is). The sample rate is in the file's own header (`config_snapshot.SAMPLE_RATE`
  for the record); the browser reads it, this code never needs it.
- **A mark's place in the audio** is `mark − recording_started_at`, clamped at 0 and
  rounded — the pipeline's own `recordingMsAt` (`artifact-recorder.ts:515-540`,
  `max(0, round(wallMs − recordingStartedAt))`). `turn.speech_start_ms` and `speech_end_ms`
  are already that number (written by `recordingMsAt` in `app/src/session/effect-runner.ts:839-840`); they
  are not re-derived from marks.
- **Error bound.** The writer pads a gap of more than `GAP_TOLERANCE_MS = 100` with silence
  and never rewinds a track (a frame that arrives early is appended, not overlapped), so a
  mark's place is right to within ~100 ms and can only drift *late* relative to the
  audio, never early. The playhead line on the waterfall is read at that precision.
- **A turn's block on the call strip** — since row A6 the upper lane of "The call" block, with the `pipeline_ms` bars under it on the same axis — runs from `speech_start_ms` to the place of
  `marks.playback_end`; when `playback_end` is absent (a failed leg, a turn cut before the
  reply played) the block ends at the latest mark present by value, and when no mark is
  present at all, at `speech_end_ms`. When no turn of the call can be placed (null
  `recording_started_at`, or every `speech_start_ms` null) the transcript still selects a
  turn by click and the waterfall follows the selection; the strip says why nothing is
  drawn. A turn with a null `speech_start_ms` has no block
  (there is nothing to start it from, whatever its marks say): it is listed as "not
  placed" under the strip and its bubble has no voice element, never a block at 0.
- **The turn under the playhead** is the placed turn with the latest start at or before
  the playhead; before the first placed turn there is none. Between a reply's end and the
  next utterance the previous turn stays current (its waterfall is still the one being
  heard out). Overlapping blocks (a barge-in starts the next turn before `playback_end`
  of the last) resolve the same way — the later start wins the moment it begins.
- **The playhead on the waterfall** is `playhead − (speech_end − recording_started_at)`,
  because the waterfall's axis starts at `speech_end` (§The waterfall); no `speech_end`
  mark or a null `recording_started_at` → no line, the chart's "not placed" rule unchanged.
  A value outside the chart's domain is simply not drawn.
- **Null `recording_started_at`** places nothing: no block, no line, the transcript still
  reads. The contract sets it on every call that has `call_event` rows; a call without it
  is one that never had a recorder clock.
- **Bubble length and where a bubble seeks to.** Caller: `speech_end_ms − speech_start_ms`,
  seeking to `speech_start_ms`. Assistant: the bot's channel starts in `call.wav` where
  `first_audio_out` says (the recorder writes the bot's frames from the hand-over to the
  sink, before FreeSWITCH's advisory `playback_start`), so the bubble seeks to the place of
  `first_audio_out` and its length is `playback_end − first_audio_out`; `playback_start`
  is the fallback when `first_audio_out` is absent. On an `interrupted` turn that is the
  length heard before the barge-in, said by the pill on the bubble, not by the number.
- **What a play glyph plays.** A glyph is drawn only when the recording is playable (not
  withheld by the consent gate, and present in the bucket); otherwise the bubble still
  selects and seeks. The range is the same: `speech_start_ms → speech_end_ms` for the
  caller, the place of `first_audio_out` (else `playback_start`) to `playback_end` for the
  reply. On an `interrupted` reply it stops at `playback_end`, the last lull before the cut,
  so the audio after that lull is not played. The next turn's `speech_start_ms` does not
  mark the cut: the pipeline stamps it only on an unmuted line, and the line is muted while
  a reply plays (`../Fonnus/app/src/session/effect-runner.ts:483`), so it falls after the
  cut, and after the degraded line when the reply failed mid-way (trap 7). The cut instant
  is the `barge_in/channel_r_cut` record, whose payload the contract does not name
  (`PLAN.md` §Waiting).

Observations this player owes back to `../Fonnus/docs/runbook.md` §2.5: row 10 (the bot's
first sentence is heard where `first_audio_out − recording_started_at` says) and row 30
(browser inline playback of a presigned `audio/wav`).

**The SDK.** `@aws-sdk/client-s3` v3 works against this endpoint with default settings; the
pipeline pins `3.1127.0` and sets `forcePathStyle: false` with `maxAttempts: 1` and a 90 s
socket timeout. Match `forcePathStyle: false` and choose `maxAttempts` deliberately here too
rather than taking the SDK's silent retry default.

**Consent, unchanged.** Every caller-derived byte — the left channel of `call.wav`, caller
text, everything under `turns/`, the `sensitive` records in `events.jsonl` — is offered only
when `consent_record.outcome = 'granted'`; an unconsented call has no `turns/` objects at
all. The bucket says nothing about consent; the row does.

**What the files carry.** The `events.jsonl` record set (every line has a wall-clock `ts` and
a recording offset `a_ms`) is described in `PIPELINE_ARCHITECTURE.md` §7; the per-sentence TTS
timing pairs `tts/sentence` with `tts/settled` per generation and, after W2-L3 F4,
`tts/first_byte`. With F5 landed the same records are in Postgres (§The call timeline), so the
bucket serves the audio and the verbatim files, not the timing.

## Configuration (row A9 — the runtime config form; ADR 0011)

The one screen that writes. It reads a tenant's `runtime_config` rows and the calls that
ran after the newest one, and inserts one new row per save through `src/writes/runtime-config.ts`
on the `console_editor` pool (ADR 0007). Everything it validates comes from two files copied
byte for byte from the pipeline — `src/contract/config/runtime-document.ts` and
`src/contract/domain/speakable.ts`, from `../Fonnus/app/src/config/runtime-document.ts` and
`../Fonnus/app/src/domain/speakable.ts` — whose bytes the contract's two `contract-hash:`
lines (§7) pin and `src/contract/contract-hash.test.ts` checks. **Re-copying is the only
edit** these files ever get; a console-side change fails that test. The copy is at the
pipeline's `cba8ea1` (row A20): 57 leaves, among them `turn.holding_line_after_ms`
(`HOLDING_LINE_AFTER_MS`, the wait before a holding line is spoken; 0 = at once, above the
LLM first-token bound = never) and `text.holding_lines` (`HOLDING_LINES`, one to four spoken
texts the call rotates through by turn), both from pipeline ADR 0030. `text.holding_lines`
is the form's one list leaf with a bounded length: the schema holds 1 to 4 entries and the
spoken-text rules per entry, the hint says so, "restore shipped text" fills the three
shipped variants one per line, and the review diff and the "last call" cell print a list one
entry per line, never as JSON (an entry containing a newline, or an empty list, still prints
as JSON). The copy also carries `faqEntrySchema`, `FaqEntry`, `FAQ_MAX_ENTRIES` and
`FAQ_RESERVED_KEY` (pipeline ADR 0031), unused until the Info config page (PLAN row A21).

| Table | Columns read | Trap / rule |
|---|---|---|
| `tenant_config` | `id`, `clinic_name` | The tenant the form edits; `pilot` today. One row → named in the head, no picker; more → a select (`?tenant=`). `clinic_name` may be null — the id is the label then |
| `runtime_config` (by `tenant_id`, `order by id desc`, no `LIMIT`) | `id`, `tenant_id`, `config`, `created_at`, `created_by`, `note` | The newest row is "current" and pre-fills the form; every row is history, newest first. `config` is a complete document, never a patch: an absent leaf means the boot value applies (§3.4 absent ≠ false), and `{}` is a legal row meaning "back to boot config". A stored document the copied schema refuses (trap 6 — a row written by hand, or a copy that has gone stale) is shown raw with the refusal, never dropped and never pretended to parse; the form then starts from boot config and says why. `id` is `bigint` and arrives as a string. `created_by` renders as stored (`console:<account>` for rows this console wrote; the pipeline's own tools write other prefixes) |
| `call_log` (by `tenant_id`, `started_at > <newest row>.created_at`, one aggregate) | `started_at`, `config_snapshot->'runtime'->>'version'` | "Latest row not applied": the count of calls since the newest row whose version is distinct from that row's id — absent (boot config, or a row the pipeline refused: `runtime` is omitted on a refused row, pipeline ADR 0020 D7) or older. Counts only; the reason lives in the pipeline's log line (`reason: timeout \| query \| invalid \| provider`) and in `fonnus_runtime_config_fallbacks_total` on `/metrics`, never in this database and never inferred here. `started_at` is stamped after the row read at call open (`../Fonnus/app/src/session/session-manager.ts:162` then `persistence/call-sink.ts:119`), so a call started before `created_at` never saw the row and is outside the window; one that was being answered as the row landed can be counted although it ran on the previous row legitimately — the copy says so |
| `call_log` (by `tenant_id`, `order by started_at desc limit 1`) | `started_at`, `config_snapshot` | The "last call" value beside each field: the snapshot's flat key for the leaf (`src/configuration/flat-keys.ts`, a copy of `RUNTIME_KEY_MAP` at `../Fonnus/app/src/config/runtime.ts:170`, `tts.voice` → `CARTESIA_VOICE_ID` / `ELEVENLABS_VOICE_ID` since ADR 0029), resolved per vendor from the snapshot's own `STT_PROVIDER` / `TTS_PROVIDER` first — a vendor's keys are present only on that vendor's call, so a missing key reads "—", never a default (§3.4); the name's tooltip prints the key that resolution chose, or says the snapshot names no vendor. The three Deepgram keys renamed on 2026-09-17 are read under both spellings (`KEY_ALIASES`, ADR 0009). Null snapshot = "not recorded". Beside each value its **layer** (rule 7 of `docs/redesign.md` §4.2): "row #`<runtime.version>`" when the leaf's path is present in `config_snapshot.runtime.config` — the parsed document the process read for that call (`../Fonnus/app/src/config/call-config.ts:149`) — else "boot"; `runtime` absent = boot config or a refused row (the not-applied warning says which). `started_at` feeds two things: the liveness check of the `boot_report` row below, and which `boot_report` row labels the last call's voice id |
| `boot_report` (by `tenant_id`, `order by id desc limit 1` — ADR 0029 D6's form; the contract's tenant-less line is the same row while the pilot has one tenant) | `id`, `tenant_id`, `booted_at`, `build_sha`, `fonnus_env`, `providers`, `vendors`, `voices` | The source of the vendor selects (`vendors.stt` / `vendors.tts`, intersected with the schema copy's value lists) and of the `tts.voice` **suggestions**: since row A19 the voice is a text input in every state (ADR 0014 D6, revising ADR 0012 D4), with a `<datalist>` of `voices.<vendor>[]` (`label` shown, `id` the value) and the `is_default` entry's label in the hint as the boot value — rule 4 of `docs/redesign.md` §4.2, ADR 0012 for the rest. **Trap (contract §2):** the newest row may describe a process that died after writing it, whether nothing replaced it or what replaced it writes no row (an image older than migration 0015, which a rollback can bring back); rendered as a warning only when the newest call's `started_at > booted_at` **and** its `config_snapshot->>'FONNUS_BUILD_SHA'` is present and differs from `build_sha`, said nowhere before a call after the boot. **Shape is prose, not DDL:** migration 0015 CHECKs only that `vendors` and `voices` are objects — the console parses them with its own zod schema (`src/boot-report.ts`), drops a malformed entry with a caveat naming it, never fails the page. A `providers = 'fake'` row (dev box) may hold `[]` under a vendor — then the datalist is empty and the hint says the id cannot be checked — or a list with no `is_default`, whose hint says "boot value" without a label. **No row** (a box before migration 0015, the dev database — and a read answered SQLSTATE `42P01` or `42501`, which both reads turn into null with one stderr line; every other error propagates) is a first-class state: every vendor offered, an empty datalist, the former "check `/healthz`" caveat. A stored provider or voice outside the row's lists blocks the save at review (`offeredIssues`, run again on save against a fresh read), and the refusal says why: the pipeline refuses the merged row and the call runs on boot config without saying so. `id` is `bigint` → text; `booted_at` is a `Date` |
| `boot_report` (by `tenant_id`, `booted_at <= <last call>.started_at`, `order by id desc limit 1`; skipped when the newest row already satisfies it) | as above | The label of the last call's voice id (`ranOn` of `tts.voice`): console-own rule of ADR 0012 D6 — the newest report booted before the call, never withheld (a call that started between its process's port bind and that process's row insert gets the previous boot's report, the known edge of D6); when its `build_sha` differs from the call's `FONNUS_BUILD_SHA` the label carries a caveat naming both; an id no report knows reads "unlisted voice"; the id is only in the tooltip |

**The write** (contract §7, verbatim): `insert into runtime_config (tenant_id, config,
created_by, note) values ($1, $2::jsonb, $3, $4) returning id, created_at;` — `$3` is
`console:<account>`, `$4` the optional note (at most 500 characters, `NOTE_MAX_CHARS`). The
insert runs in one transaction on one `console_editor` connection, after
`pg_advisory_xact_lock(hashtext('runtime_config:<tenant>'))` and a read of the tenant's
newest `runtime_config.id`: when that id is not the one the review diffed against (`base`,
read by the review itself, never taken from the form's own choice), nothing is written and
the review is shown again against the new row. The lock serialises two console saves; a row
inserted by hand SQL at the same moment is not held by it. Refusals the console maps to a sentence by
SQLSTATE: `42501` (the role cannot insert — the credential is not `console_editor` or its
grant was revoked), `23514` (the document is not a JSON object), `23503` (the tenant does not
exist). Any other refusal from the server reads "the save failed; nothing was written"; an
error that is not the server's answer (the pool's client-side timeout, a dropped connection)
reads "the save did not complete — reload and check the history before saving again", since
the row may have been committed anyway. The reason goes to stderr only in both cases. What the console cannot check before the insert and the tab says so: the FreeSWITCH
backstop (`turn.max_call_duration_sec + 30 ≤ MAX_CALL_SEC`, 330 in production — runbook
§10) and any rule that reads `.env`. Which vendors hold keys on the box, and which voices
each TTS vendor lists, is checked against the tenant's newest `boot_report` row (the same
facts `/healthz` reports, ADR 0029) — and only against it: without a row every vendor is
offered and the pipeline refuses per call (pipeline ADR 0028 D7), which the tab says. The disclosure phrases of `text.greeting`
(`disclosureAdvice`) are advice, never a refusal (pipeline ADR 0021 D5). So is the
reasoning line (row A19, brief G4): when `llm.params.reasoning` is `off` the field shows
"some models reject reasoning off with HTTP 400 on every turn (openai/gpt-oss-120b does);
omit instead" — `off` sends `{enabled: false}`, which a model listed `reasoning.mandatory`
answers 400 to (`../Fonnus/docs/runbook.md` row 17); the schema accepts the value and the
console does not block it. `text.system_prompt` is **displayed under the LLM tab** — a
placement map beside `GROUPS` in `src/configuration/groups.ts`; its path, flat key
(`SYSTEM_PROMPT`) and the contract hash are untouched, and the document is written with the
leaf under `text` as the schema requires.

**What it must not do.** Read a column of `runtime_config` or `tenant_config` the contract
does not name; `UPDATE` or `DELETE` anything (a correction is a new row, a restore is a new
row carrying an old document); infer why a row was not applied; edit the copied files;
import the pipeline's schema across repos (the copy is the boundary, pipeline ADR 0013).

## Waiting on `../Fonnus`

The table in `PLAN.md` §Waiting on `../Fonnus` is the live list; it is kept there, not
here, so status has one home.
