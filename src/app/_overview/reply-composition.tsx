/*
 * "Where the reply's time goes" — the four legs that tile `caller_perceived_ms`
 * laid end to end at their P50 on one capsule track, and under them every leg's
 * P50→P95 range on one shared scale. Layout: `docs/design/Main-html` band 2,
 * redrawn on the capsule track of ADR 0014 decision 7 with the glossary's names
 * (ADR 0013).
 *
 * The partition is the pipeline's (`../Fonnus/PIPELINE_ARCHITECTURE.md` §6,
 * copied into `src/latency.ts`): `endpoint_wait + llm_ttft + tts_ttfb + send`
 * tile `caller_perceived_ms` and the last three tile `pipeline_ms`, while
 * `stt_emit` overlaps `endpoint_wait` and `playback` is advisory — so those two
 * are drawn outlined, as a measurement that is not a share of the whole.
 */

import { formatMs, formatNumber } from '@/calls';
import type { Dashboard } from '@/dashboard';
import { LEGS, PARTITION_LEGS, type LegName } from '@/latency';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import { termFor } from '@/ui/glossary';
import HBar from '@/ui/hbar';
import { Table, Td, Th } from '@/ui/table';
import Term from '@/ui/term';
import Tooltip from '@/ui/tooltip';
import { endToEnd, legP95Tip, legTurnsCaveat, smallSampleNote, SPAN } from './overview';

/** One voice per leg, so the composition bar and the range track agree. */
const TONE: Record<LegName, string> = {
  stt_emit: 'var(--chart-3)',
  endpoint_wait: 'var(--chart-3)',
  llm_ttft: 'var(--chart-1)',
  tts_ttfb: 'var(--chart-2)',
  send: 'var(--info)',
  playback: 'var(--chart-3)',
};

const IN_PARTITION: readonly string[] = PARTITION_LEGS;

/**
 * The first partition leg, `endpoint_wait`: inside `caller_perceived_ms` and
 * outside `pipeline_ms` — the other three tile `pipeline_ms` (§6). Read from
 * the partition rather than written, so the leg's code appears on screen only
 * through the glossary.
 */
const [OUTSIDE_PIPELINE] = PARTITION_LEGS;

export default function ReplyComposition({ data }: { data: Dashboard }) {
  const measured = data.medianReply.filter((leg) => leg.p50 !== null);
  const total = measured.reduce((sum, leg) => sum + (leg.p50 ?? 0), 0);
  const missing = data.medianReply.filter((leg) => leg.p50 === null).map((leg) => leg.leg);
  // The share of the bar the three `pipeline_ms` legs occupy — everything after
  // `endpoint_wait`, which is inside the caller's wait but outside the target.
  const waited = measured.find((leg) => leg.leg === OUTSIDE_PIPELINE)?.p50 ?? 0;
  const pipelineShare = total === 0 ? 0 : ((total - waited) / total) * 100;

  // The legs end to end on one track, each segment from where the last ended.
  const segments = endToEnd(
    measured.map((leg) => ({ length: leg.p50 ?? 0, tone: TONE[leg.leg as LegName] })),
  );

  const scaleMax = Math.max(1, ...LEGS.map((leg) => data.legs[leg.name].p95 ?? 0));
  const turnsCaveat = legTurnsCaveat(LEGS.map((leg) => data.legs[leg.name].count));

  return (
    <Card
      title="Where the reply's time goes"
      // The per-leg sample is turns that stamped BOTH marks of the leg, which
      // is never the turn count — said once, here, for the whole table.
      {...(turnsCaveat === null ? {} : { sub: turnsCaveat })}
      actions={
        <div className="flex flex-wrap items-center gap-3.5">
          <Legend outlined={false} label={`counted in ${SPAN.perceived.name}`} />
          <Legend outlined label="outside it" />
        </div>
      }
    >
      {total === 0 ? (
        <EmptyState title="No leg has a median in this window.">
          No turn stamped both marks of any partition leg, so the reply cannot be taken apart.
        </EmptyState>
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
            <Caveat as="span">
              A median reply — <code className="font-num">speech_end</code> to first audio
            </Caveat>
            <Tooltip align="end" tip="a percentile is not a total: the legs' P50s do not sum to it">
              <Caveat as="span">
                {SPAN.perceived.name} P50 · {formatMs(data.perceived.p50)}
              </Caveat>
            </Tooltip>
          </div>

          <HBar thick from={0} to={total} scaleMax={total} segments={segments} />

          {/* The bracket says which part of the bar the tuning target covers. */}
          <div className="relative mt-1 h-6">
            <span
              className="absolute top-0 right-0 h-[7px] rounded-b-[5px] border border-t-0 border-border-strong"
              style={{ left: `${String(100 - pipelineShare)}%` }}
              aria-hidden
            />
            <span
              className="absolute top-2.5 right-0 text-center font-num text-[length:var(--size-eyebrow)] text-text-muted tabular-nums"
              style={{ left: `${String(100 - pipelineShare)}%` }}
            >
              {SPAN.pipeline.name} P50 · {formatMs(data.pipeline.p50)}
            </span>
          </div>

          {/* The key of the track: each segment's leg, by name over its term
              (the leg's meaning is the name's tooltip), and its P50. */}
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
            {measured.map((leg) => {
              const term = termFor('leg', leg.leg);
              return (
                <span key={leg.leg} className="flex items-start gap-2">
                  <span
                    className="mt-[5px] size-2.5 flex-none rounded-xs"
                    style={{ background: TONE[leg.leg as LegName] }}
                    aria-hidden
                  />
                  <span className="text-[length:var(--size-ui)]">
                    {term === null ? leg.leg : <Term term={term} />}
                  </span>
                  <span className="font-num text-[length:var(--size-ui)] font-semibold tabular-nums">
                    {formatMs(leg.p50)}
                  </span>
                </span>
              );
            })}
          </div>

          {/* Only what changes with the window is written; what the legs mean
              is on each name's tooltip. */}
          {missing.length === 0 ? null : (
            <Caveat className="mt-2">
              No turn stamped both marks of{' '}
              {missing.map((leg) => termFor('leg', leg)?.name ?? leg).join(', ')}, so{' '}
              {missing.length === 1 ? 'that leg is' : 'those legs are'} not in the bar.
            </Caveat>
          )}
        </div>
      )}

      {/* Not in `TableScroll`: a leg's tooltip opens beside the first column
          and above the first row, and a scroll box would clip it there. */}
      <Table>
        <thead>
          <tr>
            <Th>Leg</Th>
            <Th>P50 → P95, on one {formatNumber(Math.round(scaleMax))} ms scale</Th>
            <Th align="end">P50</Th>
            <Th align="end">P95</Th>
            <Th align="end">Max</Th>
          </tr>
        </thead>
        <tbody>
          {LEGS.map((leg) => {
            const pct = data.legs[leg.name];
            const term = termFor('leg', leg.name);
            const small = smallSampleNote(pct.count);
            return (
              <tr key={leg.name}>
                <Td>
                  {/* `tts_ttfb`'s name carries its caveat — the first sentence
                      of the reply only (CONTEXT.md trap 7). */}
                  {term === null ? leg.name : <Term term={term} />}
                </Td>
                <Td>
                  {pct.p50 === null || pct.p95 === null ? (
                    <Caveat as="span">no sample</Caveat>
                  ) : (
                    <div className="pt-1.5">
                      <HBar
                        thick
                        from={pct.p50}
                        to={pct.p95}
                        scaleMax={scaleMax}
                        tone={TONE[leg.name]}
                        outlined={!IN_PARTITION.includes(leg.name)}
                      />
                    </div>
                  )}
                </Td>
                <Td num>{formatMs(pct.p50)}</Td>
                <Td num>
                  {/* Each leg's own sample (the card head gives the range):
                      under 20 turns the nearest-rank P95 is the maximum, and
                      the row says so beside the number. */}
                  <Tooltip align="end" tip={legP95Tip(pct.count)}>
                    {formatMs(pct.p95)}
                  </Tooltip>
                  {small === null ? null : (
                    <Caveat as="span" className="ml-1.5 whitespace-nowrap">
                      {small}
                    </Caveat>
                  )}
                </Td>
                <Td num>{formatMs(pct.max)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

function Legend({ outlined, label }: { outlined: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[length:var(--size-eyebrow)] leading-[1.4] text-text-muted">
      <span
        className="h-2.5 w-3.5 rounded-xs"
        style={
          outlined
            ? { border: '1.5px solid var(--chart-3)' }
            : { background: 'var(--chart-3)' }
        }
      />
      {label}
    </span>
  );
}
