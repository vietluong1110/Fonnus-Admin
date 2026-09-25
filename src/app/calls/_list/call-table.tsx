/*
 * The call list itself: day bands, and one row per call, after the artboard
 * (`docs/design/Calls-html` — the `.row` grid re-expressed as a real table so
 * the columns keep their header semantics, ADR 0003 point 4).
 *
 * The rules it renders, each from `docs/upstream.md` §Call list:
 *   - the caller's number is masked (ADR 0008), and null is "not on record"
 *     because it may be the retention sweep's work (trap 5);
 *   - the duration track is relative to the LONGEST call of its day band — a
 *     rendering choice with no data behind it, so it never leaves the band;
 *   - "how it ended" says the ordinary ending quietly and draws only the
 *     exception (trap 2 for a call with no consent row);
 *   - `Rec` is the pipeline's own archived predicate (`isFetchable`), and the
 *     five states of `recordingAccess` are the reasons it can be absent.
 */

import Link from 'next/link';
import { Fragment } from 'react';
import { RECORDING_REASON, isFetchable, recordingAccess } from '@/artifacts';
import {
  CALL_STATE_LABEL,
  callState,
  consentOutcomeTone,
  endReasonTone,
  formatDuration,
  formatNumber,
  isConsentGranted,
  isKnownConsentOutcome,
  isKnownEndReason,
  isOrdinaryEnding,
  maskPhone,
  parseCostVnd,
} from '@/calls';
import { callCount, callDurationMs, formatDayBand, formatTimeOfDay, type DayBand } from '@/calls-stats';
import type { Config } from '@/config';
import { STORED_COST_TIP } from '@/cost';
import type { CallScopeRow } from '@/queries/calls';
import CallStateBlock from '@/ui/call-state';
import HBar from '@/ui/hbar';
import { termFor } from '@/ui/glossary';
import Icon from '@/ui/icon';
import LinkRow from '@/ui/link-row';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Tooltip from '@/ui/tooltip';
import Vocabulary from '@/ui/vocabulary';
import TickStrip from './tick-strip';

/** The eight columns below; a band heading spans them all. */
const COLUMNS = 8;

/**
 * Where a row's tooltips open (ADR 0014 decision 2). The table's scroll
 * wrapper clips on both axes, and above the first two rows there is only the
 * header and a band heading — too little for a tooltip that wraps, such as a
 * tick strip naming several failures — so those rows open downward, but only
 * over at least two rows: in a table of one or two rows there is no room
 * below either, and a one-line tooltip still fits above.
 */
function tipSideOf(position: number, rows: number): TipSide {
  return position < 2 && rows - position - 1 >= 2 ? 'bottom' : 'top';
}

export type TipSide = 'top' | 'bottom';

/**
 * The tooltip behind the `Rec` cell: the state's shared wording
 * (`RECORDING_REASON`, the same words the detail's recording block titles
 * itself with) plus the one clause the list has room for. A withheld recording
 * on a call with no consent row is trap 2 — the call is not finalized, so no
 * outcome is on record yet — and is never called a refusal. A consent outcome
 * is said by its glossary name with the stored value beside it (ADR 0013).
 */
function recReason(call: CallScopeRow, config: Config): string {
  const access = recordingAccess(call, config);
  const head = RECORDING_REASON[access];
  switch (access) {
    case 'not_archived':
      return `${head} — the uploader runs between calls`;
    case 'withheld': {
      if (call.outcome === null) {
        const state = CALL_STATE_LABEL[callState(call.ended_at, call.outcome)] ?? '';
        return `${head} — no consent outcome on record yet (the call is ${state})`;
      }
      const term = termFor('consentOutcome', call.outcome);
      return `${head} — consent: ${term === null ? call.outcome : `${term.name} (${term.code})`}`;
    }
    case 'playable':
      return `${head} — open the call to play it`;
    default:
      return head;
  }
}

/**
 * How the call ended, in one cell: the consent outcome and the end reason
 * together. The ordinary ending is said quietly and every exception wears the
 * tone it already had elsewhere. Only the exceptional half is drawn — a
 * consented call that hit `max_duration` shows the end reason alone, because a
 * granted consent was never the news.
 */
function Ending({ call }: { call: CallScopeRow }) {
  const { outcome, end_reason: endReason } = call;

  if (isOrdinaryEnding(outcome, endReason)) {
    // Quiet: the glossary's name with the pipeline's word beside it, no badge
    // (ADR 0013); the column header's tooltip says why it is the ordinary one.
    return (
      <span className="text-text-muted">
        <Vocabulary value={endReason} known of="endReason" />
      </span>
    );
  }

  const state = callState(call.ended_at, outcome);

  return (
    <div className="flex flex-col items-start gap-1">
      {outcome === null ? (
        // Trap 2: no consent row is a state of the call, never "no consent".
        <CallStateBlock state={state} compact />
      ) : isConsentGranted(outcome) ? null : (
        <Vocabulary
          value={outcome}
          known={isKnownConsentOutcome(outcome)}
          tone={consentOutcomeTone(outcome)}
          of="consentOutcome"
        />
      )}
      {endReason === null || endReason === 'caller_hangup' ? null : (
        <Vocabulary
          value={endReason}
          known={isKnownEndReason(endReason)}
          tone={endReasonTone(endReason)}
          of="endReason"
        />
      )}
      {endReason === null && state === 'finalized' ? (
        <span className="text-text-muted">end reason not on record</span>
      ) : null}
    </div>
  );
}

/** The track and the clock; a call still running has neither, and says so. */
function Duration({ call, scaleMax }: { call: CallScopeRow; scaleMax: number }) {
  const ms = callDurationMs(call);
  const text = formatDuration(call.started_at, call.ended_at);

  if (ms === null) {
    // `formatDuration` says the call is still running, or that the span is
    // reversed (contract §3.2) — neither is a length, so neither gets a bar.
    return <span className="text-info">{text}</span>;
  }

  return (
    <span className="flex items-center gap-2.5">
      <span className="min-w-[60px] flex-1">
        <HBar from={0} to={ms} scaleMax={scaleMax} />
      </span>
      <span className="w-[38px] shrink-0 text-right font-num tabular-nums">{text}</span>
    </span>
  );
}

/**
 * The bucket signal, and the reason when there is none (never a broken link).
 * The reason is the cell's drawn tooltip, ending at the cell's right edge (a
 * right-aligned column), and its screen-reader text.
 */
function Rec({ call, config, tipSide }: { call: CallScopeRow; config: Config; tipSide: TipSide }) {
  const reason = recReason(call, config);

  if (!isFetchable(call.artifact_state, call.artifact_key_prefix)) {
    return (
      <Tooltip tip={reason} align="end" side={tipSide}>
        <span className="text-text-muted">
          —<span className="sr-only"> {reason}</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip tip={reason} align="end" side={tipSide}>
      <span className="text-text-accent">
        <Icon name="play" size={15} />
        <span className="sr-only">{reason}</span>
      </span>
    </Tooltip>
  );
}

export default function CallTable({
  bands,
  config,
  now,
}: {
  bands: DayBand<CallScopeRow>[];
  config: Config;
  now: Date;
}) {
  // Each band's first row, counted over the whole table.
  const firstRowOf = bands.map((_, index) =>
    bands.slice(0, index).reduce((rows, band) => rows + band.rows.length, 0),
  );
  const rowCount = bands.reduce((rows, band) => rows + band.rows.length, 0);
  return (
    <TableScroll>
      <Table>
        <thead>
          {/* One line of plain labels; what a column counts is its header's
              tooltip, read once, never a second line under every header. */}
          <tr>
            <Th>When</Th>
            {/* Trap 5: a null number may be the retention sweep's work. */}
            <Th hint="masked to the last four digits; “not on record” is a number the retention sweep cleared, or one never written">
              Caller number
            </Th>
            <Th hint="the track is relative to the longest call of its day">Duration</Th>
            {/* Trap 1: rows written, not turns spoken. */}
            <Th hint="one tick per turn written, red when it failed; an unconsented call has none">
              Turns
            </Th>
            <Th hint="a quiet caller_hangup is the ordinary ending — consent granted, then the caller hung up; every other ending is marked">
              How it ended
            </Th>
            {/* ADR 0004: a signal only — the player lives on the detail page. */}
            <Th align="end" hint="the recording is in the bucket; open the call to play it">
              Rec
            </Th>
            {/* Trap 3: the column keeps no trace of the unpriced legs. The
                figure is the stored total_cost_vnd, so it says who computed it. */}
            <Th align="end" hint={`a floor — a model with no price counts 0; ${STORED_COST_TIP}`}>
              Cost
            </Th>
            <Th>
              <span className="sr-only">Open</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {bands.map((band, bandIndex) => (
            <Fragment key={band.day}>
              <tr>
                <td colSpan={COLUMNS} className="pt-4 pb-2 first:pl-0 last:pr-0">
                  <span className="flex items-center gap-3">
                    <span className="font-display text-[13.5px] leading-[1.4] font-semibold text-text-heading">
                      {formatDayBand(band.day, now)}
                    </span>
                    <span className="font-num text-[length:var(--size-eyebrow)] text-text-muted tabular-nums">
                      {callCount(band.rows.length)}
                    </span>
                    <span className="h-px flex-1 bg-border-hairline" />
                  </span>
                </td>
              </tr>
              {band.rows.map((call, index) => {
                const tipSide = tipSideOf((firstRowOf[bandIndex] ?? 0) + index, rowCount);
                const cost = parseCostVnd(call.total_cost_vnd);
                const masked = maskPhone(call.caller_phone_e164);
                return (
                  // The whole row is the click target; the first cell carries
                  // the real anchor the keyboard and a middle click use.
                  <LinkRow key={call.id} href={`/calls/${call.id}`}>
                    <Td>
                      {/* The link is the tooltip's trigger itself: one tab stop. */}
                      <Tooltip tip={call.id} asChild>
                        <Link
                          href={`/calls/${call.id}`}
                          className="font-num text-text-link hover:underline"
                        >
                          {formatTimeOfDay(call.started_at)}
                        </Link>
                      </Tooltip>
                    </Td>
                    <Td>
                      {masked === null ? (
                        <span className="text-text-muted">not on record</span>
                      ) : (
                        <span className="font-num">{masked}</span>
                      )}
                    </Td>
                    <Td>
                      <Duration call={call} scaleMax={band.longestDurationMs} />
                    </Td>
                    <Td>
                      <TickStrip call={call} tipSide={tipSide} />
                    </Td>
                    <Td>
                      <Ending call={call} />
                    </Td>
                    <Td align="end">
                      <Rec call={call} config={config} tipSide={tipSide} />
                    </Td>
                    <Td num>
                      {cost === null ? (
                        <Tooltip tip="no leg of this call could be priced" align="end" side={tipSide}>
                          <span className="text-text-muted">—</span>
                        </Tooltip>
                      ) : (
                        `≥ ${formatNumber(cost)} ₫`
                      )}
                    </Td>
                    <Td>
                      <span aria-hidden className="text-text-muted">
                        ›
                      </span>
                    </Td>
                  </LinkRow>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </TableScroll>
  );
}
