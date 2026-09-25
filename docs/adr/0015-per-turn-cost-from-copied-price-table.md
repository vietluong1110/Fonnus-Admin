# ADR 0015: Per-turn cost computed in the console from a copy of the pipeline's price table

**Status:** accepted · **Date:** 2026-09-25 · **Row:** A19

## Decision

1. **`src/contract/pricing.ts` is a byte copy of `../Fonnus/app/src/domain/pricing.ts`**
   (244 lines, imports nothing; sha256
   `b8abdb8e18fc86b0a07f6d729ce7b212ed699712665e250b67fa5f678616d386` at pipeline commit
   `cbaa791`, 2026-09-17). It brings `PRICES`, `priceRow`, `sttCostUsd`, `ttsCostUsd`,
   `llmCostUsd`, `callCostVnd` and `round4` unchanged. Re-copying is the only edit.
   `src/contract/pricing.test.ts` pins the bytes to the hash above and, when `../Fonnus`
   is checked out beside this repo, compares the copy to the source byte for byte and
   fails on drift — the `contract-hash.test.ts` shape without the contract line, because
   the contract does not pin this file (§Waiting on `../Fonnus`, the ask to pin it).

2. **The VND rate is a documented constant, `VND_PER_USD = 26_500`, in `src/cost.ts`.**
   The pipeline reads it from `.env` (`VND_PER_USD`, default 26 500,
   `../Fonnus/app/src/config/schema.ts` ~:691; `config/prod.env:27` sets 26 500) and does
   not write it into `config_snapshot`, so the console cannot read the rate a call was
   priced at. The constant names the box value and the date it was read; every VND figure
   the console computes carries "at 26 500 VND/USD" in its tooltip.

3. **Per-turn cost, `src/cost.ts`:**

   ```ts
   turnCost(turn: { llm_model, tokens_in, tokens_out, tokens_cached, tts_chars }, ttsModel: string | null)
     → { llmVnd: number | null; ttsVnd: number | null; unpriced: string[] }
   ```

   - LLM: `llmCostUsd({ model: llm_model, tokensIn, tokensOut, tokensCached })` × rate,
     over the copied function, so the cached-share clamp and the three-way split are the
     pipeline's own arithmetic. Null accounting (any of the four columns null) → `llmVnd`
     null, "not reported"; a model with no price row → null and the model in `unpriced`.
   - TTS: `ttsCostUsd(tts_chars, call_log.tts_model)` × rate; null `tts_chars` → null
     ("no sentence completed"); unpriced model → named.
   - STT: **no per-turn figure.** The pipeline counts caller audio per call
     (`call_log.stt_audio_ms`) and bills it per minute; a turn's share does not exist on
     record. The STT cost cell reads "—" with the tooltip "billed per call minute; no
     per-turn audio length on record" (G1 asks the pipeline for it).
   - The console never fills a leg with 0 for an unknown model: null and a name, the
     pipeline's own rule (`pricing.ts` header).

4. **Call-level view, `src/cost.ts`:**

   ```ts
   callCostView(call: { total_cost_vnd, started_at, ended_at, stt_model, tts_model }, turns: TurnCostInput[], configuredLlm: string | null)
     → { totalVnd: number | null; perMinuteVnd: number | null; unpriced: string[] }
   ```

   `totalVnd` is `call_log.total_cost_vnd` parsed (`numeric` → string → number; unparseable
   = null, never 0), the stored figure the pipeline priced at finalize — the console does
   not recompute the total. `perMinuteVnd` is `totalVnd / (ended_at − started_at)` in
   minutes, null while the call runs. `unpriced` is derived here: `stt_model`,
   `tts_model` and the configured `config_snapshot.OPENROUTER_MODEL` without a price row,
   plus every distinct `turn.llm_model` without one, sorted — the console can now name the
   unpriced model instead of showing the fixed "floor" caveat. The configured model is
   always included because an unconsented call has no `turn` rows while its
   `total_cost_vnd` still includes the LLM usage. No per-turn sum is computed: the turn
   table shows each turn's cells, and Decision 5's sentence says how they relate to the
   total.

5. **How the two figures relate, said on screen.** The per-turn sum is not
   `total_cost_vnd`, and the screen says so where the two meet (the turn-table footer):
   "Per-turn figures are list price over the turns on record; the call total above is the
   pipeline's figure at finalize and also covers speech-to-text and the greeting and
   canned lines." Three facts make them differ, all verified: (a) STT is priced per call
   and has no per-turn share; (b) `call_log.tts_chars` includes the greeting and the
   canned lines, `turn.tts_chars` is the turn's own sentences; (c) on an unconsented call
   no `turn` rows exist (trap 1) while `total_cost_vnd` still includes the LLM usage the
   sink accumulated from the same `t.llm` objects. On a consented call with a priced
   model, the LLM share of the per-turn sum equals the pipeline's LLM share exactly (same
   input, same function).

6. **Every cost number travels with its source.** The column header of every cost column
   says "list price" once, with the tooltip "computed here from the pipeline's price
   table (`domain/pricing.ts`, copied; prices dated in the table) at 26 500 VND/USD; the
   vendor's invoice may differ". An unpriced model reads `unpriced (<model>)` in the cell
   where its figure would be, the model verbatim (ADR 0013 Decision 2), and the same
   list in the Overview's cost tooltip for the window. A null accounting reads "not
   reported", a different fact from 0 (contract §3).

7. **The Overview's "Cost floor" figure becomes "Cost (list price)"**: the window's sum of
   `total_cost_vnd` as today, its tooltip listing the unpriced models seen in the window
   (from `stt_model`, `tts_model` and the turn rows' `llm_model`) — "a floor while these
   models are unpriced: <list>", or "every model in the window is priced" when the list
   is empty. This closes the `unpricedModels` half of the `/healthz` backlog row.

## Why

The team asked what a turn costs; the pipeline stores raw counters per turn
(`tokens_in`, `tokens_out`, `tokens_cached`, `tts_chars`) and one priced total per call.
The user decided (2026-09-25) that the console prices the turn itself from the pipeline's
table, labelled as list price, while a `PLAN.md` row asks the pipeline to record
vendor-reported cost per turn (G1). The forces:

- **Same arithmetic or a second truth.** The pipeline's `pricing.ts` is pure and imports
  nothing, so a byte copy is possible and cheap; any console-written arithmetic would be
  a second implementation of the cached-share clamp and the per-leg null rule, and the two
  would drift on the day the pipeline changes a price. Copying the whole file keeps
  `callCostVnd` available for a test that reprices a consented call and compares the
  figure to the stored `total_cost_vnd`.
- **"Floor" was the only word the console had.** With the table in hand, the console can
  say which model is unpriced and what the reader should do about it (add a price row —
  G1), which is what trap 3 wants a reader to know.
- **The rate is not on record.** `VND_PER_USD` is box config and never snapshotted; a
  constant with a date is honest and is the same value production runs on today. A
  configurable rate in the console's `.env` would be a second place the box's value has
  to be kept, for a number that has not changed in the pilot.
- **STT cannot be shared out per turn honestly.** Dividing `stt_audio_ms` by turn count
  would print a number that measures nothing; "—" with the reason is the console's
  standing rule for a missing fact (`CONTEXT.md` §Constraints).

## Rejected

- **Read `total_cost_vnd` only, no per-turn figure.** No copy, no rate assumption; but the
  team's question is per turn, and the raw counters are on record precisely so a later
  price list can re-price them (`pricing.ts` header: "re-runnable over it").
- **Import `../Fonnus/app/src/domain/pricing.ts` across repos.** Zero drift; forbidden by
  pipeline ADR 0013 and `CLAUDE.md` (copy, never import).
- **A console-side price table with only the rows the console needs.** Smaller; but it is
  the drift it avoids that matters, and a byte copy is the only thing a hash can pin.
- **Add `openai/gpt-oss-120b` to the console's copy so the running model prices.** Would
  make the copy not a copy and the console's figure disagree with the pipeline's stored
  total on the same call; the price row belongs upstream (G1).
- **Recompute the call total from the turns and show that.** It would silently drop STT,
  the greeting and the canned lines, and every unconsented call, and read lower than the
  stored total on the same screen.
- **Proportional STT per turn** (`stt_audio_ms` × turn's share of speech time). Plausible
  arithmetic, no fact behind it; the tooltip would have to explain an estimate on every
  row.

## Revisit when

- The pipeline records vendor-reported cost per turn (G1): the copied table becomes the
  fallback for rows older than the column, and "list price" moves to that fallback only.
- `VND_PER_USD` lands in `config_snapshot`: the constant goes and the rate is read per
  call.
- The read contract pins `domain/pricing.ts` with a `contract-hash:` line: the console's
  own pin is replaced by the contract's, as `contract-hash.test.ts` does for the schema.
- A price row changes upstream: re-copy, update the pinned hash, and the tests pass again
  — that is the whole procedure, and it should stay that small.

## Verified facts

- `PRICES` (`../Fonnus/app/src/domain/pricing.ts:48-113`): STT per minute `nova-3` 0.0077,
  `stt-rt-v5` 0.002, `enhanced` 0.43/60, `fake/echo-1` 0; TTS per 1 000 chars `sonic-3.6`
  0.05, `sonic-3.5` 0.05, `eleven_flash_v2_5` 0.05, `fake/echo-1` 0; LLM per Mtok only
  `qwen/qwen3.5-397b-a17b` (0.39 / 2.34 / 0.39 cached) and `fake/echo-1`. **No row for
  `openai/gpt-oss-120b`**, the model the box runs (brief) — every LLM cell on a call it
  ran reads `unpriced (openai/gpt-oss-120b)` until G1 lands.
- `llmCostUsd` clamps `tokensCached` to `[0, tokensIn]` and charges fresh + cached + out
  (`pricing.ts:195-205`); `tokens_cached` is the cached *share* of `tokens_in`, not on top
  of it (contract §3 `turn` table, `:123`).
- `turn.llm_model` / `tokens_*` come from `t.llm` (`persistence/rows.ts` `turnRow`), and
  `call-sink.ts:166-171` pushes the same `t.llm` into `llmUsage`, which `callCostVnd`
  prices at finalize (`:208-217`) whether or not the call was consented; `turn` rows are
  written only when consented (`:204`, trap 1). Tokens are summed over every generation of
  a turn, the model is the last generation's that reported accounting
  (`effect-runner.ts:975-991`, contract `:121-122`).
- `call_log.tts_chars` includes the greeting and canned lines (contract `:85`);
  `turn.tts_chars` is per turn, null when no sentence completed (`:124`).
- `call_log.stt_audio_ms` is per call and counted whatever the consent outcome (`:84`);
  no per-turn audio length is on record (contract §3 `turn` table has no such column).
- `total_cost_vnd` is `numeric(14,4)`, written as `toFixed(4)` at finalize; an unpriced
  leg contributes 0 and only a call where no leg priced stores null (trap 3, `:544-550`).
- `VND_PER_USD`: `z.coerce.number().positive().default(26500)` in
  `../Fonnus/app/src/config/schema.ts`; `config/prod.env:27` `VND_PER_USD=26500`; not a
  key of `config_snapshot` (contract §3.4 lists none).
- `pricing.ts` has no `import` line (grep), so a byte copy resolves as it stands.

## Assumed

- **A1.** The box's `.env` runs `VND_PER_USD` at 26 500 (prod.env says so; the box's
  `.env` is not readable from here). Settled by `grep VND_PER_USD .env` on the box. If
  it differs, the constant is corrected and dated; the ADR stands.
- **A2.** Repricing a consented call's turns through the copied `llmCostUsd` reproduces
  the LLM share of its stored `total_cost_vnd` to within rounding. The code path is the
  same, but the claim is settled only by one real row: `pricing.test.ts` includes a test
  over a hand-computed turn, and the builder's browser pass compares a consented call on
  `qwen/qwen3.5-397b-a17b` (if one exists in the dev database) against its stored total
  minus the STT and TTS shares.
- **A3.** The prices in the copied table are the pipeline's current list prices, not the
  vendor's invoice; the table itself marks several rows ASSUMED (Deepgram's monolingual
  row, Soniox billing granularity, Cartesia's credit rate). The console repeats the
  pipeline's caveat, "list price", and adds none of its own.
