/*
 * The call's state as trap 2 renders it (`../Fonnus/docs/read-contract.md` §5):
 * the badge and the caveat that says why, drawn together in one place so the
 * call list and the call detail cannot say different things about the same row.
 * The vocabulary is the pipeline's — this component renders a state, it coins
 * no term for one (CLAUDE.md §Ground rules).
 *
 * On a list row the caveat is the badge's tooltip: the same sentence under
 * every unfinalized row is read once and then only crowds the list.
 *
 * `finalized` draws nothing at all: the call has its consent outcome, and that
 * outcome is what the screen shows instead.
 */
import { CALL_STATE_CAVEAT, CALL_STATE_LABEL, CALL_STATE_TONE, type CallState } from '@/calls';
import Badge from '@/ui/badge';
import Caveat from '@/ui/caveat';

export default function CallStateBlock({
  state,
  compact = false,
}: {
  state: CallState;
  /** A list row: the why is the badge's tooltip, not a line repeated on every row. */
  compact?: boolean;
}) {
  const label = CALL_STATE_LABEL[state];
  const caveat = CALL_STATE_CAVEAT[state];
  const tone = CALL_STATE_TONE[state];
  if (label === null || caveat === null || tone === null) return null;

  if (compact) {
    return (
      <Badge tone={tone} title={caveat}>
        {label}
      </Badge>
    );
  }

  return (
    <>
      <Badge tone={tone}>{label}</Badge>
      <Caveat>{caveat}</Caveat>
    </>
  );
}
