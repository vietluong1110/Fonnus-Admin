/*
 * A value from one of the read contract's fixed vocabularies (§3.1), rendered
 * once for every screen. Moved here from the two call screens, unchanged.
 * The rule it enforces: an unfamiliar value is shown as it was stored, marked
 * as outside the contract with a visible ⚠ — a known value can share the warning
 * tone (consent `hung_up_*` does), so the tone alone cannot carry the mark — the vocabularies grow additively (contract §4), so
 * hiding one would hide the pipeline's newest behaviour.
 */

import { UNKNOWN_VOCABULARY_TITLE } from '@/calls';
import Badge, { type BadgeTone } from './badge';

export default function Vocabulary({
  value,
  known,
  tone,
}: {
  value: string | null;
  known: boolean;
  /** Omitted (or undefined) renders the value as plain text, as `turn.source` does. */
  tone?: BadgeTone | undefined;
}) {
  if (value === null) return <>—</>;
  if (!known) {
    return (
      <Badge tone="warning" title={UNKNOWN_VOCABULARY_TITLE}>
        <span aria-hidden="true">⚠ </span>
        {value}
      </Badge>
    );
  }
  return tone === undefined ? <>{value}</> : <Badge tone={tone}>{value}</Badge>;
}
