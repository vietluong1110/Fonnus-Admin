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
import type { CallScopeRow } from '@/queries/calls';
import CallStateBlock from '@/ui/call-state';
import Caveat from '@/ui/caveat';
import HBar from '@/ui/hbar';
import Icon from '@/ui/icon';
import LinkRow from '@/ui/link-row';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Vocabulary from '@/ui/vocabulary';
import TickStrip from './tick-strip';

/** The eight columns below; a band heading spans them all. */
const COLUMNS = 8;

/**
 * The tooltip behind the `Rec` cell: the state's shared wording
 * (`RECORDING_REASON`, the same words the detail's recording block titles
 * itself with) plus the one clause the list has room for. A withheld recording
 * on a call with no consent row is trap 2 — the call is not finalized, so no
 * outcome is on record yet — and is never called a refusal.
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
      return `${head} — consent: ${call.outcome}`;
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
    // The pipeline's own word, not a translation of it (CONTEXT.md §Language);
    // the gloss sits once in the column header.
    return <span className="font-num text-text-muted">caller_hangup</span>;
  }

  const state = callState(call.ended_at, outcome);

  return (
    <div className="flex flex-col items-start gap-1">
      {outcome === null ? (
        // Trap 2: no consent row is a state of the call, never "no consent".
        <CallStateBlock state={state} />
      ) : isConsentGranted(outcome) ? null : (
        <Vocabulary
          value={outcome}
          known={isKnownConsentOutcome(outcome)}
          tone={consentOutcomeTone(outcome)}
        />
      )}
      {endReason === null || endReason === 'caller_hangup' ? null : (
        <Vocabulary
          value={endReason}
          known={isKnownEndReason(endReason)}
          tone={endReasonTone(endReason)}
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

/** The bucket signal, and the reason when there is none (never a broken link). */
function Rec({ call, config }: { call: CallScopeRow; config: Config }) {
  const reason = recReason(call, config);

  if (!isFetchable(call.artifact_state, call.artifact_key_prefix)) {
    return (
      <span className="text-text-muted" title={reason}>
        —<span className="sr-only"> {reason}</span>
      </span>
    );
  }

  return (
    <span className="text-text-accent" title={reason}>
      <Icon name="play" size={15} />
      <span className="sr-only">{reason}</span>
    </span>
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
  return (
    <TableScroll>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>
              Caller
              {/* Trap 5: a null number may be the retention sweep's work. */}
              <Caveat>masked; not on record = expired, or never written</Caveat>
            </Th>
            <Th>
              Duration
              <Caveat>track relative to the longest call of its day</Caveat>
            </Th>
            <Th>
              Turns
              {/* Trap 1: rows written, not turns spoken. */}
              <Caveat>turns written; an unconsented call has none</Caveat>
            </Th>
            <Th>
              How it ended
              {/* The gloss for the quiet default, said once (§Language). */}
              <Caveat>quiet = granted, then caller_hangup — the caller hung up</Caveat>
            </Th>
            <Th align="end">
              Rec
              {/* ADR 0004: a signal only — the player lives on the detail page. */}
              <Caveat>in the bucket</Caveat>
            </Th>
            <Th align="end">
              Cost
              {/* Trap 3: the column keeps no trace of the unpriced legs. */}
              <Caveat>floor — unpriced models count 0</Caveat>
            </Th>
            <Th>
              <span className="sr-only">Open</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {bands.map((band) => (
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
              {band.rows.map((call) => {
                const cost = parseCostVnd(call.total_cost_vnd);
                const masked = maskPhone(call.caller_phone_e164);
                return (
                  // The whole row is the click target; the first cell carries
                  // the real anchor the keyboard and a middle click use.
                  <LinkRow key={call.id} href={`/calls/${call.id}`}>
                    <Td>
                      <Link
                        href={`/calls/${call.id}`}
                        className="font-num text-text-link hover:underline"
                        title={call.id}
                      >
                        {formatTimeOfDay(call.started_at)}
                      </Link>
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
                      <TickStrip call={call} />
                    </Td>
                    <Td>
                      <Ending call={call} />
                    </Td>
                    <Td align="end">
                      <Rec call={call} config={config} />
                    </Td>
                    <Td num>
                      {cost === null ? (
                        <span className="text-text-muted" title="no leg of this call could be priced">
                          —
                        </span>
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
