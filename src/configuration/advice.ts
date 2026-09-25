/**
 * Advice the Configuration form shows beside a value, worded from the
 * pipeline's runbook rather than invented here.
 */

/**
 * Shown when `llm.params.reasoning` is set to `off`: `../Fonnus/docs/runbook.md`
 * §2.5 row 17 settles that `openai/gpt-oss-120b` answers `{enabled: false}`
 * with HTTP 400 ("Reasoning is mandatory") and accepts `omit`.
 */
export const REASONING_OFF_ADVICE =
  'some models reject reasoning off with HTTP 400 on every turn (openai/gpt-oss-120b does); omit instead';
