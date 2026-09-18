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
| `turn` (one correlated aggregate per call: `json_agg(idx order by idx) filter (where failed_leg is not null)`, served by the primary key `(call_id, idx)`) | `idx`, `failed_leg` | Failed = `failed_leg IS NOT NULL`, the one test (trap 7). The row's tick strip draws `turn_count` ticks and paints the listed `idx` values red; an unconsented call has no `turn` rows (trap 1), so its strip reads "none — not consented", never zero ticks. The chip "Failed turn" is calls whose list is non-empty — a count of calls, not of turns (`docs/redesign.md` §2) |

**Scope, search, chips, page** — the URL contract is ADR 0006. One query
(`callsInScope`) reads every call of the scope: the window (`started_at >= since`, and
`< until` for a custom range — `call_log_started_idx` serves both) or, while a keyword is
present, all history by two ORed predicates: `caller_phone_e164 LIKE '%' || $digits` and
`id::text LIKE $hex || '%'`. Neither search predicate is served by an index (the uuid is
cast to text; the suffix has no leading anchor) — ASSUMED a sequential scan of `call_log`,
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
`isFetchable` and their share of the scope — and the hour-of-day histogram, which buckets
`started_at` by hour in `Asia/Ho_Chi_Minh`. The page is a slice of 100.

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
| `call_log` | everything above plus `did`, `stt_model`, `tts_model`, `recording_started_at`, `disclosure_completed_at`, `stt_audio_ms`, `tts_chars`, `tts_bytes`, `artifact_dir`, `config_snapshot`, `greeting_first_audio_ms` | `caller_phone_e164` null may be age (trap 5) — the head says "Call" without a number, never a blank; `recording_started_at` is the origin of the audio ↔ marks mapping (§Artifacts) and null means no turn of the call can be placed on the recording's axis; `artifact_state` + `artifact_key_prefix` decide, through the one `recordingAccess` of ADR 0004, whether a player renders and whether `/calls/[id]/recording` presigns; `artifact_dir` may be swept (trap 5) — it is a path, not a promise, and since the pipeline's migration 0010 the row says so itself in `artifact_state` (§Artifacts); `config_snapshot` null = written before the pipeline's migration 0007, rendered "not recorded", and a key the reader does not know is shown, never dropped (contract §3.4, trap 6); `greeting_first_audio_ms` is `first_audio_out − answered` of the greeting (contract §3.5) — measured from the channel answer, not `started_at`; null = not measured (hung up before the first byte, or written before migration 0008). `caller_phone_e164` renders masked in the head and in full only inside the collapsed "Pipeline detail" Call card (ADR 0008). The head's model and build are `config_snapshot.OPENROUTER_MODEL` (the configured model — a turn's `llm_model` can differ on a fallback) and `FONNUS_BUILD_SHA`, each omitted when the snapshot lacks it |
| `call_log` | `greeting_marks` (since row A6) | Contract §3.5: `answered` plus the reply-side keys of the greeting (`tts_first_byte`, `tts_last_byte`, `first_audio_out`, `playback_start`, `playback_end`), written at finalize; null on a call written before migration 0008, a call that never finalized, or one terminated before the greeting was dispatched — then the axis has no greeting block, said in the caption. The block runs from `answered` to `playback_end`, else the latest key present, else `answered` itself (a hairline), placed on the recording clock through `recordingOffsetMs` like a turn (§Audio ↔ marks); it has no `pipeline_ms` of its own, so the lower lane draws no bar under it. `greeting_first_audio_ms` stays the head's number — the same two keys, computed by the pipeline |
| `consent_record` | `consent_mode`, `disclosure_completed_at`, `granted_at`, `outcome`, `disclosure_text` | — |
| `turn` (by `call_id`, order `idx`) | `idx`, `caller_text`, `assistant_text`, `interrupted`, `source`, `speech_start_ms`, `speech_end_ms`, `marks`, `caller_perceived_ms`, `pipeline_ms`, `llm_model`, `tokens_in`, `tokens_out`, `tokens_cached`, `tts_chars`, `tts_bytes`, `failed_leg`, `failed_stage`, `failed_after_ms` | **`caller_text` only when `outcome = 'granted'`** (trap 4) — through `showCallerData(outcome, gate)`, the one gate, which the test-phase switch of ADR 0005 can open; the same function withholds the recording; null text may be age (trap 5); `speech_start_ms` / `speech_end_ms` are offsets into `call.wav` already (§Artifacts, the mapping), so a bubble's voice length is `speech_end_ms − speech_start_ms` and a null pair is a bubble with text but no place on the strip; null accounting = "not reported", a different fact from 0; `tokens_cached` is a share of `tokens_in`, not on top of it; `failed_leg IS NOT NULL` is the test for "failed" (`interrupted` alone does not separate a barge-in from a mid-reply failure), a null `failed_stage` under a non-null leg is a provider error, and `failed_after_ms` is the elapsed time from `endpoint_decision`, never the configured bound — the bound is `config_snapshot.LLM_TTFB_MS` and its siblings (trap 7). "The call" block draws one bar per turn from `pipeline_ms`, on the same axis as the turn blocks: a turn without `first_audio_out` has a null `pipeline_ms` and is drawn as a dashed outline labelled "—" (a reply that never became audible, never a zero); a negative value is the fault of contract §3.2 and is drawn the same way, labelled "not measured" |

The config snapshot on the detail is grouped by key prefix for reading (Speech to text ·
Language model · Text to speech · Turn taking · Call limits · Consent & recording · Texts
· Runtime config row · Other) — a rendering choice only; a key with an unknown prefix
falls to Other and no key is ever dropped (a test pins that every key of a snapshot lands
in one group). Each vendor group is headed by `STT_PROVIDER` / `TTS_PROVIDER`, read
before any vendor key; a vendor's keys are present only on a call that ran that vendor,
so an absent `DEEPGRAM_*` key means "that vendor did not run", never "the default
applied" (contract §3.4). `PROVIDERS` is `real` / `fake` and says only whether real
vendors answered.

### The waterfall

`turn.marks` is a JSON object of absolute wall-clock instants (ms since epoch), one key
per stage the turn reached; every key optional (contract §3.2). Eleven keys since
migration 0014: `speech_end`, `endpoint_decision`, `stt_final`, `llm_first_reasoning`,
`llm_first_token`, `llm_last_token`, `tts_first_byte`, `tts_last_byte`, `playback_start`,
`first_audio_out`, `playback_end`; `src/latency.ts` keeps exactly these and drops any
other key. The six legs and their end
points, copied from `../Fonnus/app/src/domain/latency.ts` and
`PIPELINE_ARCHITECTURE.md` §6:

| Leg | from → to | Render note |
|---|---|---|
| `stt_emit` | `speech_end → stt_final` | outside the partition; overlaps `endpoint_wait` |
| `endpoint_wait` | `speech_end → endpoint_decision` | the largest leg in the first baseline; governed by the endpointing settings |
| `llm_ttft` | `endpoint_decision → llm_first_token` | |
| `tts_ttfb` | `llm_first_token → tts_first_byte` | **first sentence only** |
| `send` | `tts_first_byte → first_audio_out` | |
| `playback` | `first_audio_out → playback_start` | outside the partition; advisory |

`endpoint_wait + llm_ttft + tts_ttfb + send` tiles `caller_perceived_ms` exactly; the last
three tile `pipeline_ms`. A span whose end precedes its start is a fault, rendered "not
measured" — never a negative bar, never folded into a percentile. The waterfall's axis
starts at `speech_end`; the pipeline leaves that key out when the audio clock has no
origin (`effect-runner.ts`: an invented `speech_end` is worse than a missing one), and
then a leg can have a span but no place on the axis — it is named under the chart as
"measured but not placed", never drawn from 0 as if it ran alongside the legs before it. Targets (ADR 0007):
`pipeline_ms` P95 < 1 200; `caller_perceived_ms` alarm at P95 ≥ 3 600 (aspirational).

Under the six legs the waterfall draws the three **end-of-turn marks** of W2-L3 F2 as
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
mark (first-write-wins) and part of no leg — it sits inside `llm_ttft`, which the six-leg
row already shows whole, so the pair is a second reading of that leg, not a seventh leg,
and the pipeline names none for it. Absent on a model that emits no reasoning, and then
absent from the chart. On an LLM failover the mark is the primary's and `llm_first_token`
the fallback's (contract §3.2), a fact the two marks alone cannot show — the caveat under
the row says the span can contain a failover; the record that proves one is in
`call_event` (row A4).

### The call timeline (row A1b — not built yet; its data landed with `../Fonnus` W2-L3 F5–F6, 2026-09-07)

F5 writes every record the pipeline's recorder puts in `events.jsonl` into the Postgres
table `call_event` (pipeline ADR 0018, migration 0009; contract §3 "`call_event`") — shape
`call_id, seq, ts, kind, type, gen, turn_idx, phase, data jsonb`, read ordered by
`(call_id, seq)`. Nothing here reads it until A1b first consumes it; the traps of the
contract's §5 (8–11) are folded into this section then. F6 added the sub-stage instants
named below, including `tts/generation_sent` (the instant behind `CONTEXT.md` trap 8). The record set
is `PIPELINE_ARCHITECTURE.md` §7's; the ones the timeline draws, and how the pipeline's own
reader pairs them (`../Fonnus/tools/lib/call-report.ts` — copy the rules, do not import):

| Records (`kind` / `type`) | Draws | Pairing rule (from `call-report.ts`) |
|---|---|---|
| STT partial and final transcripts (`sensitive`, `data.text`) | each partial as a tick with its text, the final as the STT mark | text only when `outcome = 'granted'` (trap 4) — the pipeline's sink already dropped the payload otherwise, so an empty `data` is a consent fact, not a bug |
| `turn_end` | the end of the caller's turn | — |
| the LLM request record (F6: the real "request sent"; before F6 the `effect` / `start_reply` proxy), `llm` / `settled` | request → first token (`turn.marks.llm_first_token`) → last token | one per `gen` |
| `tts` / `sentence`, `tts` / `first_byte` (F4), `tts` / `settled`, the frame-sent record (F6) | one bar per sentence: sent → frame sent → first byte → settled | nth `sentence` of a `gen` pairs with the nth `settled` of the same `gen` in `seq` order (`ttsSentences`); an unpaired sentence is one cut by a barge-in or a failed leg — render "not settled", never zero bytes; `turn_idx` null = greeting or canned line |
| `barge_in` / `detected` and its followers (`kill_playback_done`, `llm_cancelled`, `reply_closed`) | the interruption and the three latencies behind it | `bargeIns`: each follower is the first matching record after `detected` for the same `gen` (`kill_playback_done` has no gen) |
| `reply_failed` (`data.stage`, `data.ms`) | a marker at the failing stage | one per `gen` |
| `playback_completed` (carries `gen` after F2) | playback end | first one per `gen` |
| `answered` (F6) | the origin of the greeting axis | `call_log.started_at` is the media-socket open, not the pick-up — the greeting axis starts at `answered`, not at `started_at` |

The seven `turn.marks` stay the summary the waterfall is drawn from; the table is the
detail under it. `ts` is wall-clock ms since epoch, the same clock as `turn.marks`, so a
record and a mark sit on one axis. Records are ordered by `seq`, not by `ts`. The consent
and TTL rules of `turn.caller_text` apply to any text payload in `data` — F5 gives the
table the same sweep.

`turns/NNN/llm.stream.jsonl` in the bucket carries every token with its own `ts`; after
W2-L3 F7 it also carries `{ts, reasoning}` lines and `turn.reasoning_text` holds the
reasoning as text, under the same consent and TTL rules as `assistant_text`. Render it
collapsed under the reply; it is what the model was doing before its first content token.

## Overview

`/` (PLAN rows A2 and A6; `/dashboard` redirects here), a server-rendered screen over the
window of ADR 0006 — `since` in the pipeline's `report-calls --since` forms (`7d`, `36h`,
`15m`, or an ISO instant; default `7d`; a preset is open-ended so the leg numbers equal
`report-calls --since <same>`), plus `until` for a custom range — and a grouping (`none`,
`llm_model`, `stt_model`, `tts_model`, `config`, `key:<snapshot key>`, or
`key:runtime.version`; default `key:OPENROUTER_MODEL`, ADR 0009). Two hand-written
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
| `turn` JOIN `call_log` on `call_id`, `call_log.started_at >= since` (and `< until`), ordered by `started_at, idx` (`dashboardWindow`, second statement) | `turn.call_id`, `idx`, `marks`, `caller_perceived_ms`, `pipeline_ms`, `llm_model`, `interrupted`, `source`, `failed_leg`, `failed_stage`, `failed_after_ms` | Only consented calls have rows (trap 1); a reversed span is excluded from its leg's sample, a failed or interrupted turn is included — the rule of `../Fonnus/tools/lib/cross-call-report.ts`; per-leg `count` is turns with both marks, not the turn count. `marks` is nullable: the turn count means what the pipeline's `turnCount` means (rows with a non-null `marks`, the filter `turnMetricRows` applies in SQL) so the A2 acceptance against `report-calls` holds, but a null-marks row is not filtered out — it is listed under "Turns outside the percentile" and counted in the caveat as "U more without marks, excluded from every number" |

Computation is in TypeScript (`src/dashboard.ts`), never in SQL, so the copied pipeline
rule is the one that runs and the one the tests pin: per-leg spans from `legSpans` over the
six legs, nearest-rank P50 / P95 / max copied from `../Fonnus/tools/lib/call-report.ts`
(`sorted[min(n−1, ceil(q·n)−1)]`, null on empty), and the two headline percentiles of
`caller_perceived_ms` and `pipeline_ms` — which the pipeline's baseline JSON does not carry —
against the ADR 0007 targets. Day buckets take the **call's** `started_at` (a turn has no
timestamp of its own) in `Asia/Ho_Chi_Minh`, the zone every screen pins; a day with no turn
between the first and the last bucket is a null point, so the per-day P95 bars leave a
gap there instead of drawing a zero.

Grouping by `config` keys on the whole `config_snapshot` object ("this exact
configuration", labelled by its `FONNUS_BUILD_SHA`) and shows only the keys whose values
differ across the groups, side by side — never the whole object twice: the top-level flat
keys plus the one derived column `runtime.version`, never the `runtime.config` leaves
(ADR 0009). `key:<K>` groups on one setting (`config_snapshot->>K`, evaluated in
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
`caller_perceived_ms`, said under the bar. "Turns outside the percentile" lists the
window's turns whose marks lack `first_audio_out` (the reply never became audible) with
`source`, `interrupted`, `failed_leg`, `failed_stage` (null under a set leg = "provider
error", §3.1) and `failed_after_ms` (elapsed since `endpoint_decision`, not the bound —
trap 7); the first six by default, all of them under `outside=all`, each row linking to
`/calls/<id>?turn=<idx>`.

Caveats that travel with the numbers, on the screen: "consented calls only — N of M calls,
T turns" beside the headline stats; "turns with both marks, not turns" on the count column;
"first sentence of the reply only" on the `tts_ttfb` row.

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

## Waiting on `../Fonnus`

The table in `PLAN.md` §Waiting on `../Fonnus` is the live list; it is kept there, not
here, so status has one home.
