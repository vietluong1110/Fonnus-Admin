'use client';

/*
 * The one turn being read, as a stack of capsule tracks on one shared scale
 * (ADR 0014 decision 7): the turn under the playhead, else the turn last
 * clicked, else the first on record (`currentTurnIdx`, `src/playback.ts`).
 * The rows and their scale are built on the server (`selectedTurnView`,
 * `_detail/turn-view.ts`); this island chooses the turn and draws the
 * playhead through the scale.
 */

import { formatCount, formatNumber } from '@/calls';
import { PRICE_SOURCE_TIP, STT_PER_TURN_TIP } from '@/cost';
import { currentTurnIdx, turnAt, type TurnSpan } from '@/playback';
import Badge from '@/ui/badge';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import type { Term as GlossaryTerm } from '@/ui/glossary';
import HBar, { TrackRow } from '@/ui/hbar';
import Stat from '@/ui/stat';
import Term from '@/ui/term';
import {
  playheadOnScale,
  TTS_PER_TURN_TIP,
  type SelectedTurnView,
  type TurnCostCells,
} from './_detail/turn-view';
import { usePlayback } from './playback-provider';

/**
 * From 1180px the card is the right-hand column of its band (the page's grid),
 * so a tooltip in it ends at its trigger's right edge rather than starting or
 * centring past the window's; below that the card is full width and each
 * trigger's own alignment fits.
 */
const TIPS_END_WIDE =
  'min-[1180px]:[&_.tip-body]:right-0 min-[1180px]:[&_.tip-body]:left-auto min-[1180px]:[&_.tip-body]:[transform:none]';

/** One turn, prepared on the server: no marks object crosses the boundary. */
export interface SelectedTurnData {
  idx: number;
  /** Null when the turn has no readable mark — no scale to draw on. */
  view: SelectedTurnView | null;
  /** The `marks` column itself is null or `{}` — a pipeline write to look at. */
  noMarksStored: boolean;
  interrupted: boolean;
  /** `failureChip(...)`, or null when `failed_leg` is null (trap 7). */
  failure: GlossaryTerm | null;
  /** `failureLine(...)` — the chip's tooltip, elapsed from `endpoint_decision`. */
  failureLine: string | null;
  costs: TurnCostCells;
  tokensIn: number | null;
  tokensOut: number | null;
  /** A share of `tokens_in`, never on top of it (`docs/upstream.md`). */
  tokensCached: number | null;
}

export default function SelectedTurn({
  turns,
  spans,
}: {
  turns: SelectedTurnData[];
  spans: TurnSpan[];
}) {
  const { playheadMs, selectedIdx } = usePlayback();
  const span = playheadMs > 0 ? turnAt(spans, playheadMs) : null;
  const currentIdx = currentTurnIdx(spans, playheadMs, selectedIdx, turns[0]?.idx ?? null);
  const current = turns.find((turn) => turn.idx === currentIdx) ?? turns[0];

  if (current === undefined) {
    return <EmptyState title="No turns on record.">This call has no turn to show.</EmptyState>;
  }

  const view = current.view;
  const playhead = view === null ? undefined : playheadOnScale(view, playheadMs);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mb-0 font-display text-[17px] leading-[1.3] font-semibold text-text-heading">
          Turn {formatNumber(current.idx)}{' '}
          <span className="text-[length:var(--size-eyebrow)] font-normal text-text-muted">
            of {formatNumber(turns.length)}
          </span>
        </h3>
        {current.interrupted ? <Badge tone="terracotta">interrupted</Badge> : null}
        {current.failure === null ? null : (
          <Badge tone="error" dot>
            <Term
              term={current.failure}
              layout="inline"
              {...(current.failureLine === null ? {} : { hint: current.failureLine })}
            />
          </Badge>
        )}
      </div>
      {spans.length === 0 ? (
        <Caveat>
          no turn can be placed on the recording (no <code>recording_started_at</code>, or no
          speech offsets) — the turn shown is the one selected in the transcript
        </Caveat>
      ) : span === null ? (
        <Caveat>
          the playhead is before the first placed turn — the{' '}
          {selectedIdx === null ? 'first turn on record' : 'selected turn'} is shown
        </Caveat>
      ) : null}

      {view === null ? (
        current.noMarksStored ? (
          <EmptyState title="No marks recorded." />
        ) : (
          <EmptyState title="Marks recorded but none readable.">
            No key of contract §3.2 carries a number.
          </EmptyState>
        )
      ) : (
        <div className={`flex flex-col gap-2.5 ${TIPS_END_WIDE}`}>
          {view.rows.map((row, index) => (
            <div
              key={row.key}
              className={
                // The two headline spans are read first; the legs under them.
                index === 2 ? 'border-t border-border-hairline pt-2.5' : undefined
              }
            >
              {/* The label on its own line: the card is narrow, and the
                  tracks keep all of its width but the value's. */}
              <TrackRow term={row.term} value={row.value} layout="above">
                <HBar
                  thick
                  from={row.span?.from ?? 0}
                  to={row.span?.to ?? 0}
                  scaleMax={view.scaleMax}
                  tone={row.tone}
                  outlined={row.outlined}
                  {...(row.span === null ? { segments: [] } : {})}
                  {...(row.target === undefined ? {} : { target: row.target })}
                  {...(playhead === undefined ? {} : { playhead })}
                />
              </TrackRow>
            </div>
          ))}
        </div>
      )}

      {/* What the transcript leaves out. The spoken text is not repeated here:
          it is the transcript's, and a second copy would be a second place the
          consent gate has to be right. */}
      {/* As many to a line as the card's width holds: the card is the narrow
          half of its band, so a fixed five would squeeze every label to one word. */}
      <div
        className={`grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-4 border-t border-border-hairline pt-3.5 ${TIPS_END_WIDE}`}
      >
        <Stat size="sm" label="STT cost" value={current.costs.stt} hint={STT_PER_TURN_TIP} />
        <Stat size="sm" label="LLM cost" value={current.costs.llm} hint={PRICE_SOURCE_TIP} caveat="list price" />
        <Stat size="sm" label="TTS cost" value={current.costs.tts} hint={TTS_PER_TURN_TIP} caveat="list price" />
        <Stat
          size="sm"
          label="LLM tokens in"
          value={formatCount(current.tokensIn)}
          hint={`of which cached: ${formatCount(current.tokensCached)}`}
        />
        <Stat size="sm" label="LLM tokens out" value={formatCount(current.tokensOut)} />
      </div>
    </div>
  );
}
