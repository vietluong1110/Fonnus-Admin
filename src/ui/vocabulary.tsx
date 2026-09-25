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
import { termFor, type GlossaryNamespace } from './glossary';
import Term from './term';
import Tooltip from './tooltip';

export default function Vocabulary({
  value,
  known,
  tone,
  of,
}: {
  value: string | null;
  known: boolean;
  /** Omitted (or undefined) renders the value as plain text. */
  tone?: BadgeTone | undefined;
  /**
   * The glossary namespace the value belongs to: a value the glossary names
   * renders as its name with the pipeline term beside it (ADR 0013); one it
   * does not know is unknown whatever `known` says, and gets the ⚠ badge.
   */
  of?: GlossaryNamespace | undefined;
}) {
  if (value === null) return <>—</>;
  const term = of === undefined ? null : termFor(of, value);
  if (!known || (of !== undefined && term === null)) {
    return (
      <Tooltip tip={UNKNOWN_VOCABULARY_TITLE}>
        <Badge tone="warning">
          <span aria-hidden="true">⚠ </span>
          {value}
        </Badge>
      </Tooltip>
    );
  }
  if (term !== null) {
    const label = <Term term={term} layout="inline" />;
    return tone === undefined ? label : <Badge tone={tone}>{label}</Badge>;
  }
  return tone === undefined ? <>{value}</> : <Badge tone={tone}>{value}</Badge>;
}
