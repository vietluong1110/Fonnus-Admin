'use client';

/*
 * Every turn of the call as one table — one row each, not one card each. A row
 * selects the turn above (the waterfall and the transcript follow the same
 * selection the axis drives) and seeks the recording to where that turn starts.
 *
 * The caller's preview has already passed `showCallerData` on the server
 * (trap 4, ADR 0005): a withheld row receives no caller text at all, only the
 * outcome to say in its place. The timings are never withheld — a latency is
 * not caller speech.
 */

import { formatCount, formatMs, formatNumber } from '@/calls';
import { TARGETS } from '@/latency';
import { currentTurnIdx, type TurnSpan } from '@/playback';
import Badge from '@/ui/badge';
import Caveat from '@/ui/caveat';
import Vocabulary from '@/ui/vocabulary';
import { usePlayback } from '../playback-provider';

/** One row, prepared on the server: no query result crosses the boundary. */
export interface TurnTableRow {
  idx: number;
  source: string | null;
  interrupted: boolean;
  /** `failureLine(...)`, or null when `failed_leg` is null (trap 7). */
  failure: string | null;
  /** The first words of the turn, caller then assistant; null = nothing to show. */
  preview: string | null;
  /** True when the consent gate withholds the caller's side of the preview. */
  callerWithheld: boolean;
  /** What to say in place of withheld text: the outcome, or the call's state. */
  withheldReason: string;
  withheldReasonKnown: boolean;
  /** True when the reason is the call's state, not a consent outcome (trap 2). */
  withheldByState: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  ttsChars: number | null;
  ttsBytes: number | null;
  perceivedMs: number | null;
  pipelineMs: number | null;
}

/** The artboard's column track, one grid shared by the header and every row. */
const COLUMNS =
  'grid grid-cols-[48px_104px_112px_minmax(0,1fr)_100px_120px_84px_84px] items-center gap-3.5';

export default function TurnTable({
  rows,
  spans,
}: {
  rows: TurnTableRow[];
  spans: TurnSpan[];
}) {
  const { playheadMs, selectedIdx, seek, select } = usePlayback();
  const currentIdx = currentTurnIdx(spans, playheadMs, selectedIdx, rows[0]?.idx ?? null);
  const failures = rows.filter((row) => row.failure !== null);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div
            className={`${COLUMNS} border-b border-border-strong pb-2 text-[length:var(--size-eyebrow)] text-text-muted`}
          >
            <span className="text-right">Turn</span>
            <span>
              <code>source</code>
            </span>
            <span>State</span>
            <span>Said</span>
            <span className="text-right">Tokens in · out</span>
            <span className="text-right">TTS chars · bytes</span>
            <span className="text-right">
              <code>perceived</code>
            </span>
            <span className="text-right">
              <code>pipeline</code>
            </span>
          </div>

          {rows.map((row) => (
            <button
              key={row.idx}
              type="button"
              onClick={() => {
                // Seek first: a seek clears the selection
                // (`playback-provider.tsx`), and this row's turn must be the one
                // left standing. A turn with no place on the recording still
                // selects — that is the only selection such a call has.
                const span = spans.find((each) => each.idx === row.idx);
                if (span !== undefined) seek(span.startMs);
                select(row.idx);
              }}
              aria-current={row.idx === currentIdx ? 'true' : undefined}
              className={`${COLUMNS} w-full border-b border-border-hairline py-2 text-left text-[length:var(--size-ui)] hover:bg-[var(--action-ghost-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${
                row.idx === currentIdx ? 'bg-[var(--action-ghost-hover)]' : ''
              }`}
            >
              <span className="text-right font-num tabular-nums">{formatNumber(row.idx)}</span>
              <span className="truncate text-[length:var(--size-eyebrow)] text-text-muted">
                {row.source ?? '—'}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {row.interrupted ? <Badge tone="terracotta">interrupted</Badge> : null}
                {row.failure === null ? null : (
                  <Badge tone="error" title={row.failure}>
                    failed
                  </Badge>
                )}
                {/* An ordinary turn is neither, and says so rather than
                    leaving the column blank. */}
                {!row.interrupted && row.failure === null ? (
                  <span className="text-text-muted">—</span>
                ) : null}
              </span>
              <span className="truncate text-text-muted">
                {row.callerWithheld ? (
                  row.withheldByState ? (
                    // Trap 2: no consent row is a state of the call, never a refusal.
                    <>caller text withheld — the call is {row.withheldReason}</>
                  ) : (
                    <>
                      caller text withheld — consent:{' '}
                      <Vocabulary value={row.withheldReason} known={row.withheldReasonKnown} />
                    </>
                  )
                ) : (
                  (row.preview ?? 'not on record')
                )}
              </span>
              <span className="text-right font-num tabular-nums">
                {formatCount(row.tokensIn)} · {formatCount(row.tokensOut)}
              </span>
              <span className="text-right font-num tabular-nums">
                {formatCount(row.ttsChars)} · {formatCount(row.ttsBytes)}
              </span>
              <span className="text-right font-num tabular-nums">{formatMs(row.perceivedMs)}</span>
              <span
                className={`text-right font-num tabular-nums${
                  row.pipelineMs !== null && row.pipelineMs > TARGETS.pipelineP95Ms
                    ? ' font-semibold text-error'
                    : ''
                }`}
              >
                {formatMs(row.pipelineMs)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {failures.length === 0 ? null : (
        <div className="flex flex-col gap-1 border-t border-border-hairline pt-2">
          {failures.map((row) => (
            <Caveat key={row.idx}>
              Turn {formatNumber(row.idx)}: {row.failure}
            </Caveat>
          ))}
          <Caveat>
            elapsed since <code>endpoint_decision</code>, never the bound that tripped — the bound
            is <code>config_snapshot.LLM_TTFB_MS</code> and its siblings
          </Caveat>
        </div>
      )}
      <Caveat>a row selects the turn above and seeks the recording to where it starts</Caveat>
    </div>
  );
}
