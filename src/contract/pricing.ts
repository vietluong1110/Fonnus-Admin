/**
 * What a call cost, in one place (ADR 0011 — one rule, one home).
 *
 * Prices are constants, not config: they are facts about vendor price lists,
 * they change on the vendor's schedule and not on the box's, and a wrong figure
 * must be visible in a diff rather than in a `.env` nobody reads. The one value
 * that genuinely belongs to the deployment — the VND/USD rate — is
 * `VND_PER_USD` in the config schema and is passed in.
 *
 * Every unit price below is dated and settles the same way: the vendor's own
 * pricing page and the usage dashboard after a real call. What is still ASSUMED
 * is marked at the figure itself.
 *
 * Two rules everything here obeys:
 *  - An unknown model prices as `null`, never as 0. A silent zero turns "we do
 *    not know what this cost" into "this was free", which is the one answer a
 *    cost report must never give.
 *  - Raw usage is what gets persisted; these functions are re-runnable over it,
 *    so a corrected price re-prices history instead of rewriting it.
 *
 * Pure (ADR 0003): constants and arithmetic, no I/O, no clock.
 */

/** OpenRouter charges per million tokens, split three ways. */
export interface LlmPrice {
  usdPerMtokIn: number;
  usdPerMtokOut: number;
  /** Cache reads, charged instead of `usdPerMtokIn` for the cached share. */
  usdPerMtokCached: number;
}

/** The router charges per million tokens, in and out (ADR 0032 Decision 5). */
export interface RouterPrice {
  usdPerMtokIn: number;
  usdPerMtokOut: number;
}

export interface Prices {
  /** Streaming STT, USD per minute of audio sent, by model id (any vendor). */
  stt: Readonly<Record<string, number>>;
  /** Streaming TTS, USD per 1 000 characters of input text, by model id (any vendor). */
  tts: Readonly<Record<string, number>>;
  /** By the model id the provider reported, exactly as it comes back. */
  llm: Readonly<Record<string, LlmPrice>>;
  /** By the model id the router's vendor echoed, exactly as it comes back. */
  router: Readonly<Record<string, RouterPrice>>;
}

/**
 * Re-read 2026-08-30 from the vendors' pricing pages and OpenRouter's live
 * model API. Each figure is a list price, chosen toward the ceiling where the
 * vendor offers a cheaper transient rate; what the pilot account is actually
 * billed settles against each vendor's dashboard after the first real calls
 * (runbook §2.5 row 15).
 */
export const PRICES: Prices = {
  stt: {
    // Deepgram Nova-3 streaming, pay-as-you-go, MONOLINGUAL row, regular price.
    // The adapter sends `language=vi`; only `language=multi` (code-switching)
    // bills at the multilingual rate (Deepgram staff, github discussion #1430).
    // A limited-time promo currently bills 0.0048/min, so this is the ceiling
    // until the promo ends. That `vi` lands on the monolingual row is a staff
    // statement, not pricing-page text — ASSUMED until the usage dashboard shows it.
    'nova-3': 0.0077,
    // Soniox real-time, soniox.com/pricing read 2026-09-17 (page dated June
    // 2026): $0.12 per hour = $0.002 per minute. The page states the price as
    // token-based (~30 000 audio tokens per hour) without disclosing the
    // billing granularity — ASSUMED (ADR 0024 A6) that this row bills the audio
    // duration the pipeline counts (`stt_audio_ms`) rather than a token count
    // that diverges from it; the vendor console's usage figure for one known
    // call settles it.
    'stt-rt-v5': 0.002,
    // Speechmatics Enhanced real-time: $0.43 per hour = $0.43/60 per minute.
    // ASSUMED (ADR 0025 A6, user decision 2026-09-17): the vendor's pricing page
    // does not print a real-time rate card, so the figure comes from third-party
    // 2026 rate tables — older ones cite $1.35 per hour. It is also ASSUMED that
    // the row bills the audio duration the pipeline counts (`stt_audio_ms`); the
    // vendor portal's usage figure for the first Speechmatics call settles both.
    'enhanced': 0.43 / 60,
    // The offline fakes make no request to anybody — see the LLM row below.
    'fake/echo-1': 0,
  },
  tts: {
    // Cartesia Sonic bills ~1 credit per character on every Sonic model (docs
    // pricing, "At a glance"), so both ids the operator may name carry the same
    // figure — a switch between them never shows up as an unpriced model
    // (ADR 0014). ASSUMED A4: 0.05 USD / 1 000 chars is the Pro plan's
    // included rate ($5 / 100K credits at ~1 credit per character); the overage
    // rate is unpublished, and whether a Vietnamese NFC character counts as one
    // credit is unverified. Settles against
    // `GET /usage/credits?group_by=model` for the day of a recorded call,
    // compared with `sum(call_log.tts_chars)` (runbook §2.5 row 22).
    'sonic-3.6': 0.05,
    'sonic-3.5': 0.05,
    // ElevenLabs Flash v2.5, elevenlabs.io/pricing/api read 2026-09-17: the
    // Flash and Turbo models bill $0.05 per 1 000 characters. ASSUMED
    // (ADR 0026 A6) that a Vietnamese NFC character counts as one character on
    // that basis — the same open question Cartesia's rows carry. Settles
    // against the vendor's usage page for the day of a recorded call, compared
    // with `sum(call_log.tts_chars)` (runbook §10.2).
    eleven_flash_v2_5: 0.05,
    // The offline fakes make no request to anybody — see the LLM row below.
    'fake/echo-1': 0,
  },
  llm: {
    // Models are operator-named in `.env` (ADR 0006 §4), so this table is not
    // derived from any default: a model reached without a row here prices as
    // `null` and is named in `unpricedModels`. `scripts/check-config.ts` keeps
    // whatever `.env.example` shows an operator in step with these rows.
    // OpenRouter's model-level price is its cheapest endpoint; the request may
    // be routed to a dearer provider (up to 0.75/4.50 for this model), which
    // `GET /api/v1/generation?id=` `total_cost` would show. The top provider
    // offers no cache-read discount, so cached tokens are charged at the input
    // rate.
    'qwen/qwen3.5-397b-a17b': { usdPerMtokIn: 0.39, usdPerMtokOut: 2.34, usdPerMtokCached: 0.39 },
    // Not an assumption: the offline fakes make no request to anybody, so a
    // call driven by them really did cost nothing. Priced here so `PROVIDERS=fake`
    // produces a total rather than an unpriced hole.
    'fake/echo-1': { usdPerMtokIn: 0, usdPerMtokOut: 0, usdPerMtokCached: 0 },
  },
  router: {
    // TypeSafe Jev, read 2026-09-25 from the vendor's cookbook ("as of
    // 2026-08"): USD 0.042 per million input tokens, output free
    // (docs/research/2026-09-25-router-eval.md). About 1.5 VND per request at
    // J1's ~1 430 input tokens. ASSUMED until a TypeSafe bill for a known
    // number of requests is set against `sum(tokensIn)` of the same calls.
    'jev-1.13.0': { usdPerMtokIn: 0.042, usdPerMtokOut: 0 },
    // The offline fake router makes no request to anybody — see the LLM row above.
    'fake/echo-1': { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  },
};

/** What one call consumed, as the raw counters the tables hold. */
export interface CallUsage {
  /** Audio forwarded to STT, ms — `AudioClock.bytesForwarded` converted. */
  sttAudioMs: number;
  /** Characters handed to TTS, summed over completed sentences. */
  ttsChars: number;
  /** One entry per turn that reported accounting; cut generations report none. */
  llm: LlmUsage[];
  /** One entry per turn the router was billed on; empty when it never ran (ADR 0032). */
  router: RouterUsage[];
  /** The STT model the call ran on — the `<VENDOR>_MODEL` of `STT_PROVIDER`, at boot. */
  sttModel: string;
  /** The TTS model the call ran on — the `<VENDOR>_TTS_MODEL` of `TTS_PROVIDER`, at boot. */
  ttsModel: string;
}

export interface LlmUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  /**
   * The provider never reported this turn's usage (`LlmResult.usageMissing`):
   * the zero counts beside it are "unknown", and the turn prices as `null`.
   */
  usageMissing?: true;
}

export interface RouterUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface CallCost {
  /** Total in VND, rounded to 4 decimals — what `call_log.total_cost_vnd` holds. */
  vnd: number;
  usd: number;
  /** The priced amount, or 0 when the model is in `unpricedModels`. */
  sttUsd: number;
  /** The priced amount, or 0 when the model is in `unpricedModels`. */
  ttsUsd: number;
  /** The priced share only; the models below contributed nothing to it. */
  llmUsd: number;
  /** The router's priced share, on the same rule as `llmUsd`. */
  routerUsd: number;
  /**
   * True when at least one leg contributed a price. False means `vnd` is 0
   * because nothing could be priced, not because the call was free — the sink
   * writes `total_cost_vnd` null on it so no reader averages a fake zero.
   */
  priced: boolean;
  /**
   * Models no price is known for, deduplicated — including a model whose turn
   * carried no usage report, which is priced no better than a model with no
   * row. A non-empty list means `vnd` is a floor, not a total — every reader
   * prints it (ADR 0011: fail toward the side that is visible).
   */
  unpricedModels: string[];
}

/**
 * The one lookup every price table goes through. Tables are plain objects, so
 * a model id that happens to be an `Object.prototype` key (`constructor`,
 * `toString`…) would otherwise read a function as its price and produce NaN
 * instead of "no row" — own-property only.
 */
export function priceRow<T>(table: Readonly<Record<string, T>>, model: string): T | undefined {
  return Object.hasOwn(table, model) ? table[model] : undefined;
}

/** `null` when the model has no row — the caller reports it, never prices it 0. */
export function sttCostUsd(audioMs: number, model: string, prices: Prices = PRICES): number | null {
  const perMinute = priceRow(prices.stt, model);
  if (perMinute === undefined) return null;
  return (audioMs / 60_000) * perMinute;
}

/**
 * `chars` is `text.length` — JS UTF-16 code units. Vietnamese in NFC is one
 * unit per character, so this matches a human character count; that the vendor
 * bills the same count is ASSUMED and settles against its dashboard. `null`
 * when the model has no row, exactly as the other two legs.
 */
export function ttsCostUsd(chars: number, model: string, prices: Prices = PRICES): number | null {
  const perKChar = priceRow(prices.tts, model);
  if (perKChar === undefined) return null;
  return (chars / 1_000) * perKChar;
}

/**
 * `null` when the model is not in the table, or when the provider never
 * reported the turn's usage — either way the caller must report it, not treat
 * it as free. `tokensCached` is the cached SHARE of `tokensIn` (how
 * OpenRouter reports it), so it is charged at the cache-read rate instead of,
 * never on top of, the input rate.
 */
export function llmCostUsd(u: LlmUsage, prices: Prices = PRICES): number | null {
  if (u.usageMissing === true) return null;
  const price = priceRow(prices.llm, u.model);
  if (price === undefined) return null;
  const cached = Math.min(Math.max(u.tokensCached, 0), u.tokensIn);
  const fresh = u.tokensIn - cached;
  return (
    (fresh / 1_000_000) * price.usdPerMtokIn +
    (cached / 1_000_000) * price.usdPerMtokCached +
    (u.tokensOut / 1_000_000) * price.usdPerMtokOut
  );
}

/** `null` when the model is not in the table, exactly as the LLM leg. */
export function routerCostUsd(u: RouterUsage, prices: Prices = PRICES): number | null {
  const price = priceRow(prices.router, u.model);
  if (price === undefined) return null;
  return (u.tokensIn / 1_000_000) * price.usdPerMtokIn + (u.tokensOut / 1_000_000) * price.usdPerMtokOut;
}

export function callCostVnd(usage: CallUsage, prices: Prices, vndPerUsd: number): CallCost {
  const unpriced = new Set<string>();
  // Same rule on every leg: an unknown model contributes nothing to the
  // total and is named instead, so the number reads as a floor.
  const stt = sttCostUsd(usage.sttAudioMs, usage.sttModel, prices);
  if (stt === null) unpriced.add(usage.sttModel);
  const tts = ttsCostUsd(usage.ttsChars, usage.ttsModel, prices);
  if (tts === null) unpriced.add(usage.ttsModel);
  const sttUsd = stt ?? 0;
  const ttsUsd = tts ?? 0;
  let llmUsd = 0;
  // A leg counts as priced when it had a row, whatever the amount: a zero-rate
  // model (the offline fakes) really did cost nothing, an unknown one is a hole.
  let priced = stt !== null || tts !== null;
  for (const turn of usage.llm) {
    const cost = llmCostUsd(turn, prices);
    if (cost === null) unpriced.add(turn.model);
    else {
      llmUsd += cost;
      priced = true;
    }
  }
  let routerUsd = 0;
  for (const turn of usage.router) {
    const cost = routerCostUsd(turn, prices);
    if (cost === null) unpriced.add(turn.model);
    else {
      routerUsd += cost;
      priced = true;
    }
  }
  const usd = sttUsd + ttsUsd + llmUsd + routerUsd;
  return {
    vnd: round4(usd * vndPerUsd),
    usd,
    sttUsd,
    ttsUsd,
    llmUsd,
    routerUsd,
    priced,
    unpricedModels: [...unpriced].sort(),
  };
}

/** `call_log.total_cost_vnd` is numeric(14,4); rounding here keeps the two equal. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
