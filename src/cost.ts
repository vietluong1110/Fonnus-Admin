/*
 * What a turn and a call cost, as the console shows them (ADR 0015).
 *
 * The arithmetic is the pipeline's own: every price comes through the byte
 * copy `src/contract/pricing.ts`, so the cached-share clamp and the
 * "unknown model is null, never 0" rule are not re-implemented here. What
 * this module adds is the console's framing: the rate, the per-turn split,
 * and the words a missing figure is shown with.
 */

import { llmCostUsd, priceRow, PRICES, ttsCostUsd } from './contract/pricing';
import { formatNumber, parseCostVnd } from './calls';

/**
 * The box's `VND_PER_USD`, read 2026-09-25 (ADR 0015 decision 2). The pipeline
 * does not snapshot the rate, so the console cannot read the one a call was
 * priced at; every VND figure computed here says this rate in its tooltip.
 */
export const VND_PER_USD = 26_500;

/** The tooltip of every cost figure computed here — the per-turn split (ADR 0015 decision 6). */
export const PRICE_SOURCE_TIP =
  "computed here from the pipeline's price table (domain/pricing.ts, copied; prices dated in the table) at 26 500 VND/USD; the vendor's invoice may differ";

/**
 * The tooltip of every figure the pipeline stored — `call_log.total_cost_vnd`
 * and what is derived from it (a call's total and cost per minute, a window's
 * sum): the console did not compute it and says who did.
 */
export const STORED_COST_TIP =
  "computed by the pipeline when the call was finalized, from its price table (domain/pricing.ts) at 26 500 VND/USD; the vendor's invoice may differ";

/**
 * ADR 0015 D7's sentence for a stored total beside the models it left out
 * (trap 3: an unpriced leg counts 0), or null when every model is priced.
 */
export function floorSentence(unpriced: readonly string[]): string | null {
  return unpriced.length === 0 ? null : `a floor while these models are unpriced: ${unpriced.join(', ')}`;
}

/** The muted word beside a stored total while `floorSentence` applies to it. */
export function floorMark(unpriced: readonly string[]): 'floor' | null {
  return unpriced.length === 0 ? null : 'floor';
}

/** Why the STT cost cell of a turn reads "—" (ADR 0015 decision 3). */
export const STT_PER_TURN_TIP = 'billed per call minute; no per-turn audio length on record';

/** The `turn` columns a per-turn price reads (contract §3, `turn` table). */
export interface TurnCostInput {
  llm_model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cached: number | null;
  tts_chars: number | null;
}

/**
 * One turn's LLM and TTS cost in VND, unrounded. A leg is null when its
 * accounting is null (`llm_model`, `tokens_in` or `tokens_out`, or
 * `tts_chars`) or when its model has no price row; only the second case names
 * the model in `unpriced`. STT has no per-turn figure at all
 * (`STT_PER_TURN_TIP`).
 *
 * A null `tokens_cached` beside the other three counts as 0 cached tokens, as
 * the pipeline counts it: ../Fonnus/app/src/providers/openrouter/openrouter-llm.ts
 * starts `tokensCached` at 0 and keeps it there when the provider reports no
 * cached count, and ../Fonnus/app/src/persistence/call-sink.ts prices the call
 * from that number. So an unreported cached count is priced at the full input
 * rate, the same way the stored total priced it.
 */
export function turnCost(
  turn: TurnCostInput,
  ttsModel: string | null,
): { llmVnd: number | null; ttsVnd: number | null; unpriced: string[] } {
  const unpriced: string[] = [];
  let llmVnd: number | null = null;
  if (
    turn.llm_model !== null &&
    turn.tokens_in !== null &&
    turn.tokens_out !== null
  ) {
    const usd = llmCostUsd({
      model: turn.llm_model,
      tokensIn: turn.tokens_in,
      tokensOut: turn.tokens_out,
      tokensCached: turn.tokens_cached ?? 0,
    });
    if (usd === null) unpriced.push(turn.llm_model);
    else llmVnd = usd * VND_PER_USD;
  }
  let ttsVnd: number | null = null;
  if (turn.tts_chars !== null && ttsModel !== null) {
    const usd = ttsCostUsd(turn.tts_chars, ttsModel);
    if (usd === null) unpriced.push(ttsModel);
    else ttsVnd = usd * VND_PER_USD;
  }
  return { llmVnd, ttsVnd, unpriced };
}

/**
 * The models among these with no price row, deduplicated and sorted — the
 * pipeline's `unpricedModels` rule, evaluated here over the columns on record.
 */
function unpricedOf(
  stt: readonly (string | null)[],
  tts: readonly (string | null)[],
  llm: readonly (string | null)[],
  router: readonly (string | null)[],
): string[] {
  const unpriced = new Set<string>();
  for (const model of stt) if (model !== null && priceRow(PRICES.stt, model) === undefined) unpriced.add(model);
  for (const model of tts) if (model !== null && priceRow(PRICES.tts, model) === undefined) unpriced.add(model);
  for (const model of llm) if (model !== null && priceRow(PRICES.llm, model) === undefined) unpriced.add(model);
  for (const model of router) if (model !== null && priceRow(PRICES.router, model) === undefined) unpriced.add(model);
  return [...unpriced].sort();
}

/**
 * A call's cost as the call detail shows it. `totalVnd` is the stored
 * `total_cost_vnd`, never recomputed (ADR 0015 decision 4).
 *
 * The LLM models it names come from the turns and from the call's configured
 * `OPENROUTER_MODEL` (`configuredLlm`, from `config_snapshot`): an unconsented
 * call has no turn rows (trap 1), yet its stored total covers its LLM usage,
 * so an unpriced configured model still makes that total a floor.
 *
 * `configuredRouter` is the call's router model (`configuredRouterOf`): trap 3
 * prices each shadow-router decision into the stored total too, and no column
 * holds the router's tokens, so the configured model is the only one on record.
 */
export function callCostView(
  call: {
    total_cost_vnd: string | null;
    started_at: Date;
    ended_at: Date | null;
    stt_model: string | null;
    tts_model: string | null;
  },
  turns: readonly TurnCostInput[],
  configuredLlm: string | null,
  configuredRouter: string | null,
): {
  totalVnd: number | null;
  perMinuteVnd: number | null;
  unpriced: string[];
} {
  const totalVnd = parseCostVnd(call.total_cost_vnd);
  const minutes =
    call.ended_at === null ? null : (call.ended_at.getTime() - call.started_at.getTime()) / 60_000;
  const perMinuteVnd = totalVnd === null || minutes === null || minutes <= 0 ? null : totalVnd / minutes;
  return {
    totalVnd,
    perMinuteVnd,
    unpriced: unpricedOf(
      [call.stt_model],
      [call.tts_model],
      [configuredLlm, ...turns.map((turn) => turn.llm_model)],
      [configuredRouter],
    ),
  };
}

/**
 * The unpriced models a window's calls and turns ran on — the Overview cost
 * tooltip. Each call carries its configured `OPENROUTER_MODEL`
 * (`configured_llm`, from `config_snapshot`), for the same reason as
 * `callCostView`: a call with no turn rows still paid for its LLM. Its router
 * model (`configured_router`) counts the same way.
 */
export function unpricedInWindow(
  calls: readonly {
    stt_model: string | null;
    tts_model: string | null;
    configured_llm: string | null;
    configured_router: string | null;
  }[],
  turns: readonly { llm_model: string | null }[],
): string[] {
  return unpricedOf(
    calls.map((call) => call.stt_model),
    calls.map((call) => call.tts_model),
    [...calls.map((call) => call.configured_llm), ...turns.map((turn) => turn.llm_model)],
    calls.map((call) => call.configured_router),
  );
}

/** Whole đồng, space-grouped; "—" when there is no figure. */
export function formatVnd(vnd: number | null): string {
  return vnd === null ? '—' : `${formatNumber(Math.round(vnd))} ₫`;
}

/**
 * One cost cell: the figure, or why there is none — the unpriced model named
 * verbatim, or "not reported" when the accounting is null (a different fact
 * from 0, contract §3).
 */
export function costCell(vnd: number | null, unpriced: readonly string[]): string {
  if (vnd !== null) return formatVnd(vnd);
  return unpriced.length > 0 ? `unpriced (${unpriced.join(', ')})` : 'not reported';
}
