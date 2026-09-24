# The redesign — the product draft reconciled with the data

The product owner's draft of the console (Overview, Calls, Call detail) is the build target:
its layout and visual language stand, by the operator's instruction. This file says which of
its blocks the pipeline's data supports as drawn, which names moved under it, which numbers
need SQL this repo does not have yet, and what it does not contain at all. Written 2026-09-18
from a review in `../Fonnus` (its PLAN row W2-E8), against `../Fonnus@8516c81`.

Authority, unchanged: the contract (`../Fonnus/docs/read-contract.md`) → `PIPELINE_ARCHITECTURE.md`
→ the ADRs → `docs/upstream.md` → this file. This file is a build guide, not a source of truth
about the data, and it states no column the contract does not already state.

The mockups themselves are `docs/design/` (three standalone HTML artboards, one folder each,
served locally per their README). That folder is **gitignored**: the artboards are handed over
outside git by the product owner and exist only on the machines that received them — a fresh
checkout asks for them, and this file is the tracked record of what they draw. The author's two
PDFs — a coverage check against the pipeline repo and a vocabulary note — stay with the
operator; the coverage check predates the 2026-09-17 contract and is superseded by §2 below.

## 1. What the draft draws, and the data supports as drawn

Nothing here needs a new fact from the pipeline. Most is already on screen.

- **Overview.** P95 `pipeline_ms` and `caller_perceived_ms` against the ADR 0007 targets; P50,
  P95 and max of the six legs; the per-day trend; the distributions of `end_reason` and of
  `consent_record.outcome`; turn failures by `failed_leg` and `failed_stage`; calls grouped by
  `config_snapshot`; the turns outside the percentile.
- **Calls.** The list, the day band, duration, the per-call turn tick strip, the cost floor, and
  the five recording states — which are exactly the five `recordingAccess` already computes.
- **Call detail.** The call card's fourteen fields, the turn table, the six-leg waterfall, the
  three end-of-turn spans, the two-sided transcript, the config snapshot and consent blocks. The
  A5 pieces the draft assumes — the player, the playhead, the chat bubbles, the call strip —
  already exist and are reused, not rebuilt.

## 2. Corrections — the draft predates the 2026-09-17 contract

Each of these is a name or a unit, not a missing fact, and each is already stated in contract
§3.4. Three of them are the backlog row "Absorb the 2026-09-17 contract", which this work should
carry rather than duplicate.

| In the draft | What it is now |
|---|---|
| `PROVIDERS` shown as `deepgram + openrouter + cartesia` | `PROVIDERS` is `real` or `fake` and says only whether real vendors answered. The vendor of each leg is `STT_PROVIDER` / `TTS_PROVIDER`, and those two are read **before** any `DEEPGRAM_*`, `SONIOX_*`, `SPEECHMATICS_*`, `CARTESIA_*` or `ELEVENLABS_*` key |
| `STT_ENDPOINTING_MS`, `STT_UTTERANCE_END_MS`, `STT_TURN_TRIGGER` | renamed `DEEPGRAM_*`; rows from before that deploy keep the old spelling, so grouping coalesces both (the backlog row already carries this) |
| "3 + 35 keys" in the config snapshot | the list is 74 keys, and a call carries only the keys of the vendors it ran: an absent `DEEPGRAM_ENDPOINTING_MS` on a Soniox call means that vendor did not run, never "the default applied" |
| every snapshot value a scalar | `runtime` and `SPEECHMATICS_SOUNDS_LIKE` are objects and four values are arrays — already handled by the dashboard since 2026-09-18, still assumed by the draft's snapshot table |
| chip "Failed turn 20" on the Calls screen | 20 counts **turns**; as a filter over **calls** it is "calls with at least one failed turn" |
| chip "Hit a cap 12" | the caps are `max_duration`, `max_turns` and `max_reprompts` — all three `end_reason` values |
| header "100 most recent calls" over cards counting 214 | two populations on one screen; give the Calls screen the Overview's window control and let both follow it |
| "Artifact directory /var/fonnus/…" | `call_log.artifact_dir` is relative to the recordings root on the box and cannot be opened from here — text with that caveat, never a link |

## 3. Computable, but with no query here yet

One new query each, no new pipeline data: the Overview's total cost floor for the window; the
calls per bucket across the window; median call duration; turns per consented call; how many recordings
reached the bucket and their share; and per-call failed-turn counts, which both the row tick
strip and the Calls chips stand on.

Keep the cost of these in mind: Postgres holds no views and no aggregates, and the only indexes
are `call_log(started_at)` and `turn(call_id, idx)` (contract §3.3). A range scan of `call_event`
across calls is sequential and must stay off the list screens.

## 4. What the draft does not contain, and must

### 4.1 The call detail needs the interval lane, not only the turn axis

The draft's time axis is built from `turn` rows. That axis structurally cannot show the greeting,
a reprompt, a degraded line or the farewell (no `turn` row), an utterance the recogniser
segmented and returned nothing for (no row), or a partial the bot overtook (no row) — which is
the difference between "the caller was silent" and "the caller spoke and we heard nothing".

The requirement, the unit, what must be visible and the acceptance on call `330052e1` are
`../Fonnus/docs/console-call-view.md`; the derivation rules are contract §8; the reference
rendering is `intervals.txt` in that repo's evidence bundle. This is row A1b, re-aimed: the
interval lane is the detail's primary axis and the existing turn table stays under it as the
per-turn latency view. The trail's completeness verdict (`complete` · `open` · `truncated` ·
`gap` · `absent`) sits above the lane — intervals are never read off an incomplete trail
without it.

### 4.2 The config tab — the draft has no write surface at all

Its sidebar has two items and its footer reads "console · read-only". The pipeline side is
finished: 54 editable document paths, the vendor of each leg among them, and the role
`console_editor` with its insert proven on the box. No artboard: the tab is designed in the
existing visual language (operator's decision, 2026-09-19, `PLAN.md` row A9; a drawing
arriving later re-enters as a sized task); what it must do is fixed by contract §7 and
pipeline ADRs 0020/0021/0028, and the write posture is ADR 0007 here.

1. **The form is generated, never hand-written.** Copy `../Fonnus/app/src/config/runtime-document.ts`
   and `../Fonnus/app/src/domain/speakable.ts` at the same relative layout, with the two
   `contract-hash` sha256 lines of contract §7, on `zod` 4, and build every field, bound, select
   and default from them: `LEAF`, `MODEL_CATALOGUE`, `STT_PROVIDER_VALUES`, `TTS_PROVIDER_VALUES`,
   `REASONING_VALUES`, `SHIPPED_TEXT` (both the defaults and the "restore shipped text" target).
   `llm.model` is free text on purpose. An edit the pipeline would refuse is then refused in the
   form instead of on every later call.
2. **A save is a whole-document replace**, appended as a new `runtime_config` row, never an update
   of the previous one. So the tab shows the row history, and a save is preceded by a diff against
   the current row.
3. **An edit takes effect on the next call answered**, and on no call in progress.
4. **The box's newest `boot_report` row is what the vendor and voice selects offer.** The
   process writes one row per boot (pipeline ADR 0029): the vendors it holds keys for
   (`vendors.stt` / `vendors.tts`, the same value `/healthz` reports) and, per TTS vendor, its
   voice list (`voices.<vendor>[] = { id, label, is_default }`). `stt.provider` and `tts.provider`
   offer the row's vendors; `tts.voice` offers the selected vendor's voices by `label` and writes
   the `id`, with "boot value (`<label of the is_default entry>`)" first. The cards say "as of boot
   at `<booted_at>`, build `<build_sha>`", because the newest row may describe a process that died
   after writing it, with no successor or with one that writes no row — when the newest call
   ran a different build after that boot, the tab says so (rendered from the two facts, never
   inferred). A stored value outside the row's list is an issue that blocks the save: the
   process refuses such a row **whole** (`reason: provider`) or at the next call
   (`reason: invalid`), and that call runs on boot config. No `boot_report` row at all (a box
   before migration 0015, a dev database) is a first-class state: every vendor is offered,
   `tts.voice` is a text box, and the tab says the id cannot be checked against this box.
   Rule of ADR 0012.
5. **Show whether the latest row is actually running.** A call's
   `config_snapshot->'runtime'->>'version'` is the `runtime_config.id` it ran under, and the key
   is absent when it ran on boot config. If recent calls carry no `runtime` block, or an older id
   than the newest row, warn that the latest row is not being applied. The reason (`timeout`,
   `query`, `invalid`, `provider`) is in the pipeline's log line and in
   `fonnus_runtime_config_fallbacks_total` on `/metrics`, never in Postgres — point at those,
   do not infer a reason from the database.
6. **Greeting advice, never a refusal.** `disclosureAdvice(greeting)` returns one line per legal
   obligation a greeting stops naming (Law 134/2025, pipeline ADR 0021 Decision 5): show them
   before the insert and as a banner while the current row carries such a greeting. The pipeline
   never evaluates them and never refuses a greeting for them.
7. **Every "last call" value names its layer.** Beside the value the last answered call ran on,
   the form says "row #`<runtime.version>`" when the leaf's path is present in
   `config_snapshot.runtime.config` and "boot" otherwise: `runtime.config` is the document the
   process read for that call, so a path present there came from the row and a path absent from
   it came from boot config. A snapshot without `runtime` is boot (or a row the process refused —
   rule 5's warning says which); a null snapshot stays "not recorded". The call detail's snapshot
   card says the same of the effective voice id ("chosen by row #N" / "boot value"). Rule of
   ADR 0012 (user decision 2026-09-23).

### 4.3 The annotation form — specified, not drawn

`../Fonnus/docs/console-call-view.md` §Annotations is the whole specification: what is shown
beside the recogniser column, the one-gesture form (interval from the player, one label of the
six, `caller_said` required for `stt_wrong` / `stt_missed`), correction and retraction by
inserting a superseding row, and the refusal SQLSTATEs mapped to their messages. It is a block
inside the call detail in the existing visual language — no new artboard.

It stays blocked until `../Fonnus` `ISSUES.md` L1-260914-1 is fixed: the caller channel of
`call.wav` lags the trail by about a second, so an interval taken from the player lands on the
wrong interval. Build the showing half; gate the writing half on that row.

## 5. Worth adding beyond the draft

- **The thinking span.** `llm_first_reasoning` and `turn.reasoning_text` — already in the backlog
  row; on a reasoning model this is the largest single span of a turn and the draft has no place
  for it yet.
- **Group the Overview by config row.** Grouped by `config_snapshot->'runtime'->>'version'` the
  card turns a console edit into a measurable A/B; grouped by the whole snapshot it splits on
  noise.

## 6. Nothing is dropped for lack of data

Every number on the three artboards is derivable from `call_log`, `turn`, `call_event`,
`consent_record` and the bucket listing. The only element removed outright is the
`deepgram + openrouter + cartesia` rendering of `PROVIDERS`, and it is replaced rather than
dropped by `PROVIDERS` plus the two per-leg vendor keys.

## 7. The one prerequisite that blocks both write paths

This app cannot name the logged-in account: access is Caddy `basic_auth` (ADR 0002) and no
identity header is read, while both writes of contract §7 require `created_by = console:<account>`.
Passing the account through is a prerequisite of §4.2 and §4.3 — a placeholder account would put
a false name in an append-only audit trail.

## 8. Where this lands in the tracker

Rows it feeds: A1b (§4.1, re-aimed at intervals), "Absorb the 2026-09-17 contract" (§2's first
three lines, §5's first line, and the write-posture ADR §4.2 needs). Rows it does not have yet:
the redesign of the three screens (§1–§3), the config tab (§4.2), the annotation form (§4.3),
and the account identity of §7.
