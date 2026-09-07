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

Role `console`, database `fonnus`, schema `public`, read-only. Two paths, both on the box
(contract §2): `postgres:5432` from a container on `fonnus_default`, `127.0.0.1:5432` from
host networking; from a laptop, an SSH tunnel to the latter (`README.md`).

The probe `/api/healthz` is the one exception to everything below: it issues
`select current_user` and reads no table, so it depends on no column of the contract — it
answers only whether the connection stands and which role it was made as.

## Call list

| Reads | Column(s) | Trap |
|---|---|---|
| `call_log` | `id`, `started_at`, `ended_at`, `end_reason`, `turn_count`, `total_cost_vnd`, `did`, `stt_model`, `tts_model` | `turn_count` = rows written (trap 1); `total_cost_vnd` is a floor (trap 3); `numeric` arrives as a string — parse, and treat an unparseable one as missing, not 0 |
| `consent_record` (LEFT JOIN on `call_id`) | `outcome` | A missing row = not finalized (trap 2): in progress when `ended_at IS NULL`, else died or the finish transaction failed |

Order: `started_at DESC`; index `call_log_started_idx` serves it. Vocabularies:
`end_reason` and `outcome` are fixed sets (contract §3.1) — render unknown values as-is
with a warning, never drop the row. Every `timestamptz` is an absolute instant; the screens
render it in `Asia/Ho_Chi_Minh` pinned in code (`src/calls.ts`), never in the process's
own zone, so the box and a laptop show the same clock.

## Call detail

| Reads | Column(s) | Trap |
|---|---|---|
| `call_log` | everything above plus `caller_phone_e164`, `recording_started_at`, `disclosure_completed_at`, `stt_audio_ms`, `tts_chars`, `tts_bytes`, `artifact_dir`, `config_snapshot`, `greeting_first_audio_ms` | `caller_phone_e164` null may be age (trap 5); `artifact_dir` may be swept (trap 5) — it is a path, not a promise; `config_snapshot` null = written before the pipeline's migration 0007, rendered "not recorded", and a key the reader does not know is shown, never dropped (contract §3.4, trap 6); `greeting_first_audio_ms` is `first_audio_out − answered` of the greeting (contract §3.5) — measured from the channel answer, not `started_at`; null = not measured (hung up before the first byte, or written before migration 0008). `greeting_marks` itself is not read until row A1b draws the greeting axis |
| `consent_record` | `consent_mode`, `disclosure_completed_at`, `granted_at`, `outcome`, `disclosure_text` | — |
| `turn` (by `call_id`, order `idx`) | `idx`, `caller_text`, `assistant_text`, `interrupted`, `source`, `speech_start_ms`, `speech_end_ms`, `marks`, `caller_perceived_ms`, `pipeline_ms`, `llm_model`, `tokens_in`, `tokens_out`, `tokens_cached`, `tts_chars`, `tts_bytes`, `failed_leg`, `failed_stage`, `failed_after_ms` | **`caller_text` only when `outcome = 'granted'`** (trap 4); null text may be age (trap 5); null accounting = "not reported", a different fact from 0; `tokens_cached` is a share of `tokens_in`, not on top of it; `failed_leg IS NOT NULL` is the test for "failed" (`interrupted` alone does not separate a barge-in from a mid-reply failure), a null `failed_stage` under a non-null leg is a provider error, and `failed_after_ms` is the elapsed time from `endpoint_decision`, never the configured bound — the bound is `config_snapshot.LLM_TTFB_MS` and its siblings (trap 7) |

### The waterfall

`turn.marks` is a JSON object of absolute wall-clock instants (ms since epoch), one key
per stage the turn reached; every key optional (contract §3.2). Ten keys since migration
0008: `speech_end`, `endpoint_decision`, `stt_final`, `llm_first_token`, `llm_last_token`,
`tts_first_byte`, `tts_last_byte`, `playback_start`, `first_audio_out`, `playback_end`;
`src/latency.ts` keeps exactly these and drops any other key. The six legs and their end
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

## Dashboard

`/dashboard` (PLAN row A2), a server-rendered screen over a window `since` (the pipeline's
`report-calls --since` forms: `7d`, `36h`, `15m`, or an ISO instant; default `7d`) and a
grouping (`none`, `llm_model`, `stt_model`, `tts_model`, `config`, or `key:<snapshot key>`).
Two hand-written queries in `src/queries/dashboard.ts`, both bounded by the window only —
**no `LIMIT` on turn rows**, the trap the pipeline's own `turnMetricRows`
(`../Fonnus/app/src/persistence/call-queries.ts`) falls into by capping turns after the
join. A window longer than 366 days is refused on screen, because the pool gives a
statement 10 seconds (`src/db.ts`) and the screen reads every turn in the window.

| Reads | Column(s) | Trap |
|---|---|---|
| `call_log` LEFT JOIN `consent_record` on `call_id`, `started_at >= since`, ordered by `started_at` (`callsSince`) | `call_log.id`, `started_at`, `stt_model`, `tts_model`, `config_snapshot`; `consent_record.outcome` | Every call in the window, consented or not — the denominator of "N of M calls" (trap 1); a null snapshot is a call written before F1, grouped as "unknown", never dropped (§3.4) |
| `turn` JOIN `call_log` on `call_id`, `call_log.started_at >= since`, ordered by `started_at, idx` (`turnsSince`) | `turn.call_id`, `idx`, `marks`, `caller_perceived_ms`, `pipeline_ms`, `llm_model`, `interrupted`, `source`, `failed_leg`, `failed_stage`, `failed_after_ms` | Only consented calls have rows (trap 1); a reversed span is excluded from its leg's sample, a failed or interrupted turn is included — the rule of `../Fonnus/tools/lib/cross-call-report.ts`; per-leg `count` is turns with both marks, not the turn count. `marks` is nullable: the turn count means what the pipeline's `turnCount` means (rows with a non-null `marks`, the filter `turnMetricRows` applies in SQL) so the A2 acceptance against `report-calls` holds, but a null-marks row is not filtered out — it is listed under "Turns outside the percentile" and counted in the caveat as "U more without marks, excluded from every number" |

Computation is in TypeScript (`src/dashboard.ts`), never in SQL, so the copied pipeline
rule is the one that runs and the one the tests pin: per-leg spans from `legSpans` over the
six legs, nearest-rank P50 / P95 / max copied from `../Fonnus/tools/lib/call-report.ts`
(`sorted[min(n−1, ceil(q·n)−1)]`, null on empty), and the two headline percentiles of
`caller_perceived_ms` and `pipeline_ms` — which the pipeline's baseline JSON does not carry —
against the ADR 0007 targets. Day buckets take the **call's** `started_at` (a turn has no
timestamp of its own) in `Asia/Ho_Chi_Minh`, the zone every screen pins; a day with no turn
between the first and the last bucket is a null point, so the trend line breaks there
instead of drawing through it.

Grouping by `config` keys on the whole `config_snapshot` object ("this exact
configuration", labelled by its `FONNUS_BUILD_SHA`) and shows only the keys whose values
differ across the groups, side by side — never the whole object twice; `key:<K>` groups on
one setting (`config_snapshot->>K`, evaluated in TypeScript). Two calls on the same build
with one changed key are the comparison the hypothesis loop is made of (`CONTEXT.md` §Why
now). Group rows are built from turn rows, so a group's call count is "calls with turns on
record" — said in the column header. "Turns outside the percentile" lists the window's turns
whose marks lack `first_audio_out` (the reply never became audible) with `source`,
`interrupted`, `failed_leg`, `failed_stage` (null under a set leg = "provider error", §3.1)
and `failed_after_ms` (elapsed since `endpoint_decision`, not the bound — trap 7).

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

## Artifacts (not readable yet)

`call.wav`, `events.jsonl`, `call.json`, `turns/NNN/{llm.request.json, llm.stream.jsonl,
tts.input.txt, tts.output.wav}` live in the pipeline's artifact directory
`calls/YYYY-MM-DD/<uuid>/` (UTC start date). They become readable through the Vietnix S3
bucket with `../Fonnus` PLAN row W2-L1, under the same keys and with the object-key half of the
contract. The spike (`../Fonnus/docs/research/2026-09-07-vietnix-s3-spike.md`, 2026-09-07)
settled how this app reaches them: endpoint `https://s3.vn-hcm-1.vietnix.cloud`, region
`vn-hcm-1`; presigned GET works and honours `Range`, so the audio player links straight at
the bucket with a short-lived presigned URL and never proxies bytes through this app — the
VPS-to-Vietnix path measured only ~0.9 MB/s, while the viewer's own connection is far faster.
The bucket holds internal test calls only during this phase; the consent rule applies to them
unchanged. Whether the stored `Content-Type` (`audio/vnd.wave` today from the CLI; the
uploader will set it explicitly) plays inline in a browser is unverified — one page load in
A4 settles it, and the answer goes back to the pipeline's W2-L1 row. The `events.jsonl` record set (every line has a wall-clock `ts` and a
recording offset `a_ms`) is described in `PIPELINE_ARCHITECTURE.md` §7; the per-sentence
TTS timing pairs `tts/sentence` with `tts/settled` per generation and, after W2-L3 F4,
`tts/first_byte`. Once F5 lands the same records are in Postgres (§The call timeline);
the bucket then serves the audio and the verbatim files, not the timing.

## Waiting on `../Fonnus`

The table in `PLAN.md` §Waiting on `../Fonnus` is the live list; it is kept there, not
here, so status has one home.
