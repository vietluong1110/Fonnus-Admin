/*
 * The exact configuration the call ran under, every key grouped by prefix for
 * reading (`src/snapshot-groups.ts`), each value that came from the call's
 * `runtime_config` row tagged "row" (`keysFromRow`).
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
 * Each group is a card of key/value rows; a key the runtime document can set
 * is labelled by the glossary's name over the snapshot key (ADR 0013), any
 * other key by itself. The whole snapshot, `runtime` row included, is folded
 * at the end as raw JSON: to be checked, not read.
 *
 * One value the card explains (ADR 0012 D6, D8): the effective voice id — the
 * `*_VOICE_ID` key `voiceIdOf` picks, the call's own `TTS_PROVIDER` first — reads by its label when
 * the boot report booted before the call lists it, the id only in its tooltip, and
 * says which layer chose it, because the snapshot's flat key alone cannot say.
 */

import { Fragment } from 'react';
import type { VoiceFact } from '@/boot-report';
import { keysFromRow, PATH_OF_KEY } from '@/call-config';
import { runtimeRow } from '@/configuration/document';
import { canonicalKey, parseSnapshot, renderValue } from '@/dashboard';
import { groupSnapshot } from '@/snapshot-groups';
import Card from '@/ui/card';
import Caveat from '@/ui/caveat';
import EmptyState from '@/ui/empty-state';
import { termFor } from '@/ui/glossary';
import Term from '@/ui/term';
import Tooltip from '@/ui/tooltip';
import ClampedText from './clamped-text';

/** Past this many characters, or on a second line, a value is clamped with "show all". */
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
              Values tagged <RowTag /> came from runtime_config row #{row.version}; the rest are
              boot config.
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
          their card takes the whole width. */}
      <div className="grid items-start gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <div
            key={group.name}
            className={`min-w-0 ${group.name === 'Texts' ? 'md:col-span-2' : ''}`}
          >
            <Card title={group.name} level={3}>
              <dl className="m-0 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] gap-y-2.5">
                {group.entries.map((entry) => (
                  <Entry
                    key={entry.key}
                    name={entry.key}
                    value={entry.value}
                    fromRow={fromRow.has(entry.key)}
                    voice={voice !== null && entry.key === voice.key ? voice : null}
                  />
                ))}
              </dl>
            </Card>
          </div>
        ))}
      </div>

      <details className="text-[length:var(--size-ui)]">
        <summary className="cursor-pointer font-medium text-text-link">
          Raw config_snapshot (JSON)
        </summary>
        <pre className="mt-2 mb-0 font-num text-[length:var(--size-eyebrow)] whitespace-pre-wrap [overflow-wrap:anywhere]">
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </details>
    </>
  );
}

/**
 * One key and its value, as a row of the group's two-column grid. A long value
 * — prose, JSON — is clamped to two lines with "show all".
 */
function Entry({
  name,
  value,
  fromRow,
  voice,
}: {
  name: string;
  value: unknown;
  fromRow: boolean;
  voice: VoiceFact | null;
}) {
  // An old spelling of a renamed Deepgram key finds its path through the new one.
  const path = PATH_OF_KEY.get(canonicalKey(name));
  const term = path === undefined ? null : termFor('configLeaf', path);
  const keyCell = (
    <dt className="min-w-0 text-[length:var(--size-ui)]">
      {term === null ? (
        <span className="font-num text-[length:var(--size-eyebrow)] text-text-muted">
          <KeyName name={name} />
        </span>
      ) : (
        <Term term={{ ...term, code: name }} />
      )}
    </dt>
  );
  const tag = fromRow ? <RowTag /> : null;

  if (voice !== null) {
    return (
      <>
        {keyCell}
        <VoiceValue voice={voice} />
      </>
    );
  }

  const text = valueText(name, value);
  const long = text.length > INLINE_MAX || text.includes('\n');
  return (
    <>
      {keyCell}
      <dd className="m-0 min-w-0">
        {long ? (
          <>
            <ClampedText
              text={text}
              className={
                typeof value === 'string'
                  ? 'text-[length:var(--size-ui)] leading-[1.5]'
                  : 'font-num text-[length:var(--size-eyebrow)]'
              }
            />
            {tag}
          </>
        ) : (
          <span className="font-num text-[length:var(--size-eyebrow)] [overflow-wrap:anywhere]">
            {text} {tag}
          </span>
        )}
      </dd>
    </>
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
    <dd className="m-0 min-w-0 text-[length:var(--size-ui)]">
      <Tooltip tip={voice.id}>
        <span className="cursor-help underline decoration-border-strong decoration-dotted underline-offset-[3px]">
          {voice.label ?? 'unlisted voice'}
        </span>
      </Tooltip>
      <Caveat as="span" className="ml-2">
        {layer}
      </Caveat>
      {voice.note !== null && <Caveat>{voice.note}</Caveat>}
    </dd>
  );
}
