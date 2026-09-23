/*
 * The exact configuration the call ran under, every key grouped by prefix for
 * reading (`src/snapshot-groups.ts`), each value that came from the call's
 * `runtime_config` row tagged "row" (`keysFromRow`). The row itself, the
 * nested `runtime` key, is folded under the groups as raw JSON: its values are
 * the tagged keys above, so it is there to be checked, not read.
 *
 * Three rules of contract §3.4 the card carries on screen, because none of them
 * can be read off the values:
 *   - `PROVIDERS` says only whether real vendors answered, not which ones;
 *     `STT_PROVIDER` and `TTS_PROVIDER` name the vendor of each leg and head
 *     their groups, read before any vendor key.
 *   - a vendor's keys are present only on a call that ran that vendor, so an
 *     absent `DEEPGRAM_*` key means that vendor did not run, never "the default
 *     applied". A key the process had no value for is absent, never null.
 *   - a key this console does not know is shown, never dropped (trap 6), and a
 *     value is not always a scalar: `runtime` and `SPEECHMATICS_SOUNDS_LIKE`
 *     are objects and four keys are arrays.
 *
 * One value the card explains (ADR 0012 D6, D8): the effective voice id — the
 * `*_VOICE_ID` key of the call's own `TTS_PROVIDER` — reads by its label when
 * the boot report booted before the call lists it, the id only on hover, and
 * says which layer chose it, because the snapshot's flat key alone cannot say.
 */

import { Fragment } from 'react';
import type { VoiceFact } from '@/boot-report';
import { keysFromRow } from '@/call-config';
import { runtimeRow } from '@/configuration/document';
import { parseSnapshot, renderValue } from '@/dashboard';
import { groupSnapshot } from '@/snapshot-groups';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import ClampedText from './clamped-text';

/** Past this many characters a value gets a line of its own under its key. */
const INLINE_MAX = 48;

/** `PROVIDERS` is `real` or `fake` and says only whether real vendors answered. */
function providersLine(value: string): string {
  if (value === 'real') return 'real — real vendors answered';
  if (value === 'fake') return 'fake — no vendor was called';
  return value;
}

/**
 * A value as the card prints it. An empty string is drawn as `""`, never blank,
 * so it cannot be mistaken for a key the process had no value for — that key
 * would be absent from the object entirely. An array reads as one line of JSON,
 * an object as indented JSON, so the operator can see which leaf changed.
 */
function valueText(key: string, value: unknown): string {
  if (value === '') return '""';
  if (key === 'PROVIDERS' && typeof value === 'string') return providersLine(value);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return JSON.stringify(value, null, 2);
  }
  return renderValue(value);
}

export default function ConfigSnapshot({
  value,
  voice,
}: {
  value: unknown;
  /** `voiceFact` of this snapshot; null when it names no voice, and then no row changes. */
  voice: VoiceFact | null;
}) {
  // `parseSnapshot` is the column's one trust boundary (`src/dashboard.ts`), so
  // the dashboard and this card agree on what counts as a snapshot at all.
  const snapshot = parseSnapshot(value);
  if (snapshot === null) {
    return (
      <EmptyState title="Not recorded.">
        The call was written before the pipeline&rsquo;s migration 0007, which added config
        provenance.
      </EmptyState>
    );
  }

  const row = runtimeRow(snapshot);
  const fromRow = keysFromRow(snapshot);
  const flat = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'runtime'));
  const groups = groupSnapshot(flat);

  return (
    <>
      <div>
        <p className="m-0 text-[length:var(--size-ui)]">
          {row === null ? (
            <>No runtime_config row applied: every value below is boot config.</>
          ) : (
            <>
              Values tagged <RowTag /> came from runtime_config row #{row.version}; the rest
              are boot config.
            </>
          )}
        </p>
        <Caveat>
          a vendor&rsquo;s keys are present only on a call that ran that vendor — an absent key
          means it did not run, never that a default applied
        </Caveat>
      </div>

      {/* Grouped by prefix, a rendering choice only: a key with an unknown
          prefix falls to Other and none is ever dropped. Texts are prose, so
          they take the whole width. */}
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.name} className={`min-w-0 ${group.name === 'Texts' ? 'md:col-span-2' : ''}`}>
            <h3 className="m-0 border-b border-border-hairline pb-1 text-[length:var(--size-eyebrow)] font-semibold tracking-[.1em] text-text-accent uppercase">
              {group.name}
            </h3>
            <dl className="m-0 mt-1 flex flex-col">
              {group.entries.map((entry) => (
                <Entry
                  key={entry.key}
                  name={entry.key}
                  value={entry.value}
                  fromRow={fromRow.has(entry.key)}
                  stacked={group.name === 'Texts'}
                  voice={voice !== null && entry.key === voice.key ? voice : null}
                />
              ))}
            </dl>
          </div>
        ))}
      </div>

      {Object.hasOwn(snapshot, 'runtime') ? (
        <details className="text-[length:var(--size-ui)]">
          <summary className="cursor-pointer font-medium text-text-link">
            Raw runtime row (JSON)
          </summary>
          <pre className="mt-2 mb-0 font-num text-[length:var(--size-eyebrow)] whitespace-pre-wrap [overflow-wrap:anywhere]">
            {JSON.stringify(snapshot['runtime'], null, 2)}
          </pre>
        </details>
      ) : null}
    </>
  );
}

/**
 * One key and its value. A short value sits beside its key, left-aligned, so
 * the eye does not cross the column to find it; a long one — prose, JSON — or
 * any value of a `stacked` group takes a line of its own under the key and is
 * cut to three lines.
 */
function Entry({
  name,
  value,
  fromRow,
  stacked,
  voice,
}: {
  name: string;
  value: unknown;
  fromRow: boolean;
  stacked: boolean;
  voice: VoiceFact | null;
}) {
  const keyCell = (
    <dt className="font-num text-[length:var(--size-eyebrow)] [overflow-wrap:anywhere] text-text-muted">
      <KeyName name={name} />
    </dt>
  );
  const tag = fromRow ? <RowTag /> : null;

  if (voice !== null) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 py-0.5">
        {keyCell}
        <VoiceValue voice={voice} />
      </div>
    );
  }

  const text = valueText(name, value);
  if (!stacked && text.length <= INLINE_MAX && !text.includes('\n')) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 py-0.5">
        {keyCell}
        <dd className="m-0 font-num text-[length:var(--size-eyebrow)] [overflow-wrap:anywhere]">
          {text} {tag}
        </dd>
      </div>
    );
  }

  const prose = typeof value === 'string';
  return (
    <div className="py-1">
      <dt className="flex items-baseline gap-2 font-num text-[length:var(--size-eyebrow)] [overflow-wrap:anywhere] text-text-muted">
        <span>
          <KeyName name={name} />
        </span>
        {tag}
      </dt>
      <dd className="m-0 mt-0.5">
        <ClampedText
          text={text}
          className={
            prose
              ? 'text-[length:var(--size-ui)] leading-[1.5]'
              : 'font-num text-[length:var(--size-eyebrow)]'
          }
        />
      </dd>
    </div>
  );
}

/**
 * A snapshot key that may wrap after any underscore rather than mid-word;
 * `<wbr>` adds no character, so a copied key is still the key.
 */
function KeyName({ name }: { name: string }) {
  const parts = name.split('_');
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? (
            <>
              _<wbr />
            </>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

/** The mark on a value that came from the call's `runtime_config` row. */
function RowTag() {
  return (
    <span className="rounded-pill bg-[rgba(184,92,43,.12)] px-1.5 py-px font-ui text-[length:var(--size-eyebrow)] font-medium whitespace-nowrap text-text-accent">
      row
    </span>
  );
}

/**
 * The effective voice: its label when a report knows it, else "unlisted voice"
 * — an id is a string no operator tells apart, so it is only in the tooltip;
 * beside it the layer that chose it — "chosen by row #N" when the call's
 * `runtime.config` carries `tts.voice`, "boot value" otherwise (rule 7 of
 * `docs/redesign.md` §4.2, the form select's words); under it the D6 build
 * caveat, which never withholds the label.
 */
function VoiceValue({ voice }: { voice: VoiceFact }) {
  const layer = voice.layer.kind === 'row' ? `chosen by row #${voice.layer.version}` : 'boot value';
  return (
    <dd className="m-0 text-[length:var(--size-eyebrow)]">
      <span title={voice.id}>{voice.label ?? 'unlisted voice'}</span>
      <Caveat as="span" className="ml-2">
        {layer}
      </Caveat>
      {voice.note !== null && <Caveat>{voice.note}</Caveat>}
    </dd>
  );
}
