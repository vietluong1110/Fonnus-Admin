/*
 * The "Ran on" strip under the call detail's head: the configuration the call
 * ran under, which is what the operator changes between test calls — the
 * `runtime_config` row (a link to it in Configuration) or boot config with the
 * FAQ entries the call ran with under it (`faq.count`, pipeline ADR 0031), then the
 * STT, LLM and TTS legs with vendor and model, the voice with the layer that
 * chose it, and the build. Every fact comes from `ranOnOf` and `voiceFact`;
 * this file only lays them out.
 */

import Link from 'next/link';
import type { VoiceFact } from '@/boot-report';
import { faqCountText, type RanOn } from '@/call-config';
import { formatNumber, shortSha } from '@/calls';
import Badge from '@/ui/badge';
import Caveat from '@/ui/caveat';
import Field from '@/ui/field';
import { termFor } from '@/ui/glossary';
import Tooltip from '@/ui/tooltip';

// The leg names the glossary gives a failed turn's leg, so the strip and the
// failure chip spell LLM and TTS once (ADR 0013 decision 6).
const LLM_LABEL = termFor('failedLeg', 'llm')?.name ?? '';
const TTS_LABEL = termFor('failedLeg', 'tts')?.name ?? '';

/** "vendor · model", either part omitted when absent; "not reported" when both are. */
function leg(vendor: string | null, model: string | null): string {
  const parts = [vendor, model].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'not reported' : parts.join(' · ');
}

export default function RanOnStrip({
  ran,
  voice,
  tenantId,
}: {
  ran: RanOn;
  voice: VoiceFact | null;
  tenantId: string;
}) {
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-5 gap-y-3 rounded-[var(--radius-card)] border border-border-hairline bg-surface-card px-[var(--pad-card)] py-3 sm:grid-cols-2 md:grid-cols-[auto_repeat(3,minmax(0,1fr))_auto]">
      <Field
        label="Config"
        hint="The runtime_config row the call ran under; values it does not set are boot config"
      >
        {ran.row === null ? (
          <Tooltip tip="No row applied: none existed, or the process refused the newest one">
            boot config
          </Tooltip>
        ) : (
          <Link
            href={`/configuration?${new URLSearchParams({ tenant: tenantId, from: ran.row }).toString()}`}
            className="font-medium text-text-link hover:underline"
          >
            row #{ran.row}
          </Link>
        )}
        {/* Under the row, not a column of its own: the strip's five columns
            stay as they are at 1280. The entries themselves are on the
            snapshot card. */}
        <span className="block whitespace-nowrap">
          <Tooltip tip="faq.count in config_snapshot: the tenant's FAQ entries the call ran with, as read at call time; none means none enabled, or the read failed">
            {faqCountText(ran.faq)}
          </Tooltip>
        </span>
      </Field>
      <Field label="STT">
        <span className="[overflow-wrap:anywhere]">{leg(ran.stt.vendor, ran.stt.model)}</span>
      </Field>
      <Field label={LLM_LABEL} hint="OPENROUTER_MODEL, the configured model">
        <span className="[overflow-wrap:anywhere]">{ran.llm.model ?? 'not configured'}</span>
        {ran.llm.others.map((other) => (
          <Caveat key={other.model}>
            {formatNumber(other.turns)} {other.turns === 1 ? 'turn' : 'turns'} reported{' '}
            <span className="[overflow-wrap:anywhere]">{other.model}</span>
          </Caveat>
        ))}
      </Field>
      <Field label={TTS_LABEL}>
        <span className="[overflow-wrap:anywhere]">{leg(ran.tts.vendor, ran.tts.model)}</span>
        {voice === null ? null : (
          <Caveat>
            voice <Tooltip tip={voice.id}>{voice.label ?? 'unlisted voice'}</Tooltip>
            {' · '}
            {voice.layer.kind === 'row' ? `chosen by row #${voice.layer.version}` : 'boot value'}
            {voice.note === null ? null : <span className="block">{voice.note}</span>}
          </Caveat>
        )}
      </Field>
      <Field label="Build">
        {ran.build === null ? (
          'not recorded'
        ) : (
          <Tooltip tip={ran.build}>
            <span className="font-num">{shortSha(ran.build)}</span>
          </Tooltip>
        )}
        {ran.fakeProviders ? (
          <span className="mt-1 block">
            <Tooltip tip="PROVIDERS = fake: no vendor was called">
              <Badge tone="warning">fake providers</Badge>
            </Tooltip>
          </span>
        ) : null}
      </Field>
    </dl>
  );
}
