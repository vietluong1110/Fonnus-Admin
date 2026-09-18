/*
 * "Where the reply's time goes" — the four legs that tile `caller_perceived_ms`
 * laid end to end at their P50, and under them every leg's P50→P95 range on one
 * shared scale. Layout: `docs/design/Main-html` band 2.
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
import HBar from '@/ui/hbar';
import { Table, TableScroll, Td, Th } from '@/ui/table';

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

export default function ReplyComposition({
  data,
  standsOn,
}: {
  data: Dashboard;
  standsOn: string;
}) {
  const measured = data.medianReply.filter((leg) => leg.p50 !== null);
  const total = measured.reduce((sum, leg) => sum + (leg.p50 ?? 0), 0);
  const missing = data.medianReply.filter((leg) => leg.p50 === null).map((leg) => leg.leg);
  // The share of the bar the three `pipeline_ms` legs occupy — everything after
  // `endpoint_wait`, which is inside the caller's wait but outside the target.
  const waited = measured.find((leg) => leg.leg === 'endpoint_wait')?.p50 ?? 0;
  const pipelineShare = total === 0 ? 0 : ((total - waited) / total) * 100;

  const scaleMax = Math.max(
    1,
    ...LEGS.map((leg) => data.legs[leg.name].p95 ?? 0),
  );

  return (
    <Card
      title="Where the reply's time goes"
      sub="Nearest-rank percentiles, the pipeline's own rule"
      actions={
        <div className="flex flex-wrap items-center gap-3.5">
          <Legend outlined={false} label="counted in caller_perceived_ms" />
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
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-3">
            <Caveat as="span">
              A median reply — <code className="font-num">speech_end</code> to first audio
            </Caveat>
            <Caveat as="span">
              <code className="font-num">caller_perceived_ms</code> P50 ·{' '}
              {formatMs(data.perceived.p50)}
            </Caveat>
          </div>

          <div className="flex h-[30px] overflow-hidden rounded-md">
            {measured.map((leg) => (
              <div
                key={leg.leg}
                title={`${leg.leg} · ${formatMs(leg.p50)}`}
                className="flex items-center overflow-hidden px-2.5"
                style={{
                  width: `${String(((leg.p50 ?? 0) / total) * 100)}%`,
                  background: TONE[leg.leg as LegName],
                }}
              >
                <span className="truncate font-num text-[13px] font-medium text-text-on-accent">
                  {leg.leg} · {formatNumber(leg.p50 ?? 0)}
                </span>
              </div>
            ))}
          </div>

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
              pipeline_ms P50 · {formatMs(data.pipeline.p50)}
            </span>
          </div>

          <Caveat>
            <code className="font-num">endpoint_wait</code> is the silence before the reply
            starts — inside <code className="font-num">caller_perceived_ms</code>, outside{' '}
            <code className="font-num">pipeline_ms</code>, which the bracketed three partition.{' '}
            <code className="font-num">llm_ttft</code> is the only leg a model change moves. The
            P50s of the legs do not sum to the P50 of{' '}
            <code className="font-num">caller_perceived_ms</code> — a percentile is not a total.
            {missing.length === 0
              ? ''
              : ` No turn stamped both marks of ${missing.join(', ')}, so ${missing.length === 1 ? 'that leg is' : 'those legs are'} not in the bar.`}
          </Caveat>
        </div>
      )}

      <TableScroll>
        <Table>
          <thead>
            <tr>
              <Th>Leg</Th>
              <Th>P50 → P95, on one {formatNumber(Math.round(scaleMax))} ms scale</Th>
              <Th align="end">P50</Th>
              <Th align="end">P95</Th>
              <Th align="end">Max</Th>
              <Th align="end">
                Turns
                {/* The sample is turns that stamped BOTH marks of the leg,
                    which is never the turn count. */}
                <Caveat>turns with both marks, not turns</Caveat>
              </Th>
            </tr>
          </thead>
          <tbody>
            {LEGS.map((leg) => {
              const pct = data.legs[leg.name];
              return (
                <tr key={leg.name}>
                  <Td>
                    <code className="font-num text-[13px]">{leg.name}</code>
                    {leg.name === 'tts_ttfb' ? (
                      // CONTEXT.md trap 7: later sentences synthesize behind the
                      // one playing and are not in this leg.
                      <Caveat>first sentence of the reply only</Caveat>
                    ) : null}
                  </Td>
                  <Td>
                    {pct.p50 === null || pct.p95 === null ? (
                      <Caveat as="span">no sample</Caveat>
                    ) : (
                      <HBar
                        from={pct.p50}
                        to={pct.p95}
                        scaleMax={scaleMax}
                        tone={TONE[leg.name]}
                        outlined={!IN_PARTITION.includes(leg.name)}
                      />
                    )}
                  </Td>
                  <Td num>{formatMs(pct.p50)}</Td>
                  <Td num>{formatMs(pct.p95)}</Td>
                  <Td num>{formatMs(pct.max)}</Td>
                  <Td num>{formatNumber(pct.count)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableScroll>
      <Caveat>{standsOn}</Caveat>
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
