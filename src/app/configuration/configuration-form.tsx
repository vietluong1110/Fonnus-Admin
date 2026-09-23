'use client';

/**
 * The Configuration form and its review step — one `useActionState` over the
 * one server action (ADR 0011 decision 5), rendering a form that is generated
 * from the copied schema and never written by hand (decision 4).
 *
 * Everything here works with JavaScript off: the two steps are plain `<form>`
 * posts, every button is a `<button name="intent">`, and the controls are
 * native. What script adds is the vendor branch switch, "restore shipped text",
 * and the pending state — conveniences, not the mechanism.
 *
 * The one rule script changes rather than decorates: with script running, only
 * the SELECTED vendor's branch is in the DOM, so the other branch's leaves are
 * not submitted at all. `documentFromForm` keeps every submitted leaf on
 * purpose — a leaf of the branch not chosen is an `unrecognized_keys` refusal
 * the operator reads, never a silently dropped edit — so with JavaScript off
 * every branch renders and the schema refuses the wrong one at review. That is
 * the designed fallback, and the `<noscript>` under each provider says so.
 */

import { useActionState, useState, useSyncExternalStore } from 'react';
import {
  mergedVoices,
  providerOptions,
  voiceList,
  voiceUncheckable,
  type BootReportVoice,
  type Offered,
} from '@/boot-report';
import { mergeBranches, type BranchMerge, type Field, type Layer } from '@/configuration/document';
import { renderValue } from '@/dashboard';
import Badge from '@/ui/badge';
import Button from '@/ui/button';
import Card from '@/ui/card';
import { PILL, PILL_OFF } from '@/ui/chip';
import Caveat, { Hint } from '@/ui/caveat';
import Checkbox from '@/ui/checkbox';
import Input from '@/ui/input';
import Select from '@/ui/select';
import { Table, TableScroll, Td, Th } from '@/ui/table';
import Textarea from '@/ui/textarea';
import { submitConfiguration, type FormState } from './actions';

/** The document's top-level keys, in the pipeline's own names (ADR 0013). */
const GROUPS = ['turn', 'stt', 'llm', 'tts', 'text'] as const;
type Group = (typeof GROUPS)[number];

const FORM_ID = 'configuration-form';
const BOOT_FORM_ID = 'configuration-boot';
const GREETING_FORM_ID = 'configuration-restore-greeting';

/** The store never changes: "is script running" is answered once and stays. */
const subscribeToNothing = (): (() => void) => () => undefined;

/** Rule 3 of `docs/redesign.md` §4.2, on the screen beside the Save button. */
const EFFECT = 'takes effect on the next call answered; no call in progress changes';

/** One leaf's "last call" cell, as the page resolves it from the newest snapshot. */
export interface LastCall {
  value: string | null;
  key: string | null;
  layer: Layer | null;
  /** `tts.voice` only: the id's label from the boot report ADR 0012 D6 chose; null when none knows it. */
  label?: string | null;
  /** `tts.voice` only: that report's build differs from the call's (D6). */
  labelCaveat?: string | null;
}

export interface ConfigurationFormProps {
  tenant: string;
  initial: FormState;
  fields: Field[];
  /**
   * What the last answered call ran on, per leaf path, precomputed on the server
   * so nothing here reaches for a query or a pool: `value` is `renderValue` of
   * it, null where the snapshot carries no such key; `key` is the snapshot key it
   * was read under, null where the snapshot names no vendor for a per-vendor
   * leaf (ADR 0012 D9); `layer` is the row or boot config it came from, null
   * with no snapshot (D8).
   */
  ranOn: Record<string, LastCall>;
  /** False when the tenant has answered no call: then "—" would be a lie. */
  snapshotRecorded: boolean;
  /**
   * The tenant's newest `boot_report` row, as the selects use it: the vendors,
   * the voice lists, the "as of boot" words and the parse caveats (ADR 0012
   * D2–D5). Null is the no-report state: every vendor offered, `tts.voice` a
   * text box.
   */
  offered: Offered | null;
  editable: boolean;
  /**
   * The newest row's document — boot config, `{}`, with no row or a refused one
   * — which the review diffs against, whichever row the form was loaded from
   * (ADR 0012 D7).
   */
  from: Record<string, unknown>;
  /** The id of the row the form was loaded from (`?from=` or the newest); null with none. */
  fromRow: string | null;
  /** `SHIPPED_TEXT`, keyed by the leaf under `text.`. */
  shippedText: Record<string, string>;
  /**
   * `disclosureAdvice` on the greeting of the row the pipeline runs on now —
   * the newest one, not the document this form started from; empty when there
   * is none.
   */
  disclosure: string[];
  /** The id of that row, for the banner to name; null when there is no row. */
  disclosureRow: string | null;
}

export default function ConfigurationForm(props: ConfigurationFormProps) {
  const [state, formAction, pending] = useActionState(submitConfiguration, props.initial);

  if (state.step === 'review') {
    return (
      <ReviewStep
        state={state}
        formAction={formAction}
        pending={pending}
        editable={props.editable}
        from={props.from}
        fromRow={props.fromRow}
        newestRow={props.disclosureRow}
      />
    );
  }
  return <EditStep {...props} state={state} formAction={formAction} pending={pending} />;
}

/* ------------------------------------------------------------------ edit */

function EditStep({
  fields,
  ranOn,
  snapshotRecorded,
  offered,
  editable,
  from,
  shippedText,
  disclosure,
  disclosureRow,
  state,
  formAction,
  pending,
}: ConfigurationFormProps & {
  state: Extract<FormState, { step: 'edit' }>;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const { values, set, tenant } = state;

  // Only what script has to own: which leaves are in the row, which vendor
  // branch is chosen, and the texts a restore button has refilled. Every other
  // control is uncontrolled, so typing in one does not re-render the other 54.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(set));
  const [providers, setProviders] = useState<Record<string, string>>(() => ({
    'stt.provider': set.includes('stt.provider') ? (values['stt.provider'] ?? '') : '',
    'tts.provider': set.includes('tts.provider') ? (values['tts.provider'] ?? '') : '',
  }));
  const [restored, setRestored] = useState<Record<string, { value: string; generation: number }>>(
    {},
  );

  // False on the server and through hydration, true once React is driving the
  // page: exactly the divergence `useSyncExternalStore`'s server snapshot is
  // for. So the markup a browser without script keeps is the one carrying every
  // vendor branch, and the branch switch starts hiding the others only where
  // there is script to switch them back.
  const scripted = useSyncExternalStore(subscribeToNothing, () => true, () => false);

  const tick = (path: string, on: boolean): void => {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  /**
   * The leaves one group renders: with script, the chosen vendor's branch only;
   * without it, every branch, each path once — a path several branches share
   * (`stt.model`, `tts.params.speed`) is one control carrying the union of what
   * those branches offer, not the first branch's alone.
   */
  const visible = (group: Group): BranchMerge[] => {
    const provider = providers[`${group}.provider`] ?? '';
    const byPath = new Map<string, Field[]>();
    for (const field of fields) {
      if (field.group !== group) continue;
      if (field.vendor !== null && scripted && field.vendor !== provider) continue;
      const branches = byPath.get(field.path);
      if (branches === undefined) byPath.set(field.path, [field]);
      else branches.push(field);
    }
    return [...byPath.values()].map(mergeBranches);
  };

  return (
    <>
      {disclosure.length === 0 ? null : (
        <Card
          tone="warm"
          title={
            disclosureRow === null
              ? 'Disclosure advice on the greeting in the current row'
              : `Disclosure advice on the greeting in row #${disclosureRow}`
          }
        >
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[length:var(--size-ui)]">
            {disclosure.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {/* Pipeline ADR 0021 D5: advice, never a refusal. */}
          <Caveat>advice only: the pipeline speaks whatever greeting the row carries</Caveat>
          {/* Its own form, carrying the starting document with one leaf
              replaced: a click here must not depend on what the operator has
              since typed into the form below. */}
          <form id={GREETING_FORM_ID} action={formAction} className="contents">
            <input type="hidden" name="tenant" value={tenant} />
            <input type="hidden" name="from" value={JSON.stringify(from)} />
            {set
              .filter((path) => path !== 'text.greeting')
              .map((path) => (
                <input key={path} type="hidden" name={`set:${path}`} value="on" />
              ))}
            {Object.entries(values)
              .filter(([path]) => path !== 'text.greeting')
              .map(([path, value]) => (
                <input key={path} type="hidden" name={path} value={value} />
              ))}
            <input type="hidden" name="set:text.greeting" value="on" />
            <input type="hidden" name="text.greeting" value={shippedText['greeting'] ?? ''} />
            {editable ? (
              <div>
                <Button type="submit" name="intent" value="review" disabled={pending}>
                  Review with the shipped greeting
                </Button>
              </div>
            ) : null}
          </form>
        </Card>
      )}

      {state.failure === null ? null : (
        <p className="mb-0 text-[length:var(--size-ui)] text-[color:var(--error)]">
          {state.failure}
        </p>
      )}

      {/* 55 leaves is more than a screen however dense the rows are, so the five
          groups are one click apart from anywhere in the form. Plain anchors:
          no script, and the address bar keeps the group. The count is how many
          of the group's leaves the row sets, so where the row departs from boot
          config shows before any scrolling. */}
      <nav
        aria-label="Configuration groups"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-surface-page py-2"
      >
        {GROUPS.map((group) => {
          const count = [...chosen].filter((path) => path.startsWith(`${group}.`)).length;
          return (
            <a key={group} href={`#${group}`} className={`${PILL} ${PILL_OFF}`}>
              {group}
              {count === 0 ? null : (
                <span
                  className="font-num tabular-nums text-text-link"
                  title={`${String(count)} set in this row`}
                >
                  {count}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      <form id={FORM_ID} action={formAction} className="flex flex-col gap-[18px]">
        <input type="hidden" name="tenant" value={tenant} />
        {/* The document the diff is taken against, carried as JSON so the review
            step compares against the same starting point the form opened on. */}
        <input type="hidden" name="from" value={JSON.stringify(from)} />

        {GROUPS.map((group) => (
          // The anchor's target, offset by the sticky strip's own height so the
          // card's title is not the line the strip covers.
          <div key={group} id={group} className="scroll-mt-[64px]">
            <Card title={group}>
              <AsOfBoot group={group} offered={offered} />
              <div className="flex flex-col">
                <HeaderRow />
                {visible(group).map(({ field, vendorBounds }) => (
                  <FieldRow
                    key={field.path}
                    field={field}
                    vendorBounds={vendorBounds}
                    isSet={chosen.has(field.path)}
                    onTick={tick}
                    value={restored[field.path]?.value ?? values[field.path] ?? ''}
                    generation={restored[field.path]?.generation ?? 0}
                    provider={providers[`${field.group}.provider`] ?? ''}
                    onProvider={(next) => {
                      setProviders((current) => ({ ...current, [field.path]: next }));
                      tick(field.path, next !== '');
                    }}
                    onRestore={(text) => {
                      setRestored((current) => ({
                        ...current,
                        [field.path]: {
                          value: text,
                          generation: (current[field.path]?.generation ?? 0) + 1,
                        },
                      }));
                      tick(field.path, true);
                    }}
                    shipped={
                      field.group === 'text' ? shippedText[field.path.slice('text.'.length)] : undefined
                    }
                    ranOn={ranOn[field.path] ?? null}
                    snapshotRecorded={snapshotRecorded}
                    offered={offered}
                    editable={editable}
                  />
                ))}
              </div>
            </Card>
          </div>
        ))}
      </form>

      {/* "Back to boot config" is a form of its own with no `set:` entry at all,
          so the document it proposes is `{}` — which is a legal row meaning the
          boot value applies to every leaf (contract §3.4). A button inside the
          form above could not express "nothing ticked" without unticking 55
          boxes. */}
      <form id={BOOT_FORM_ID} action={formAction} className="contents">
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="from" value={JSON.stringify(from)} />
      </form>

      {editable ? (
        // The way out of a 55-leaf form stays on screen wherever the operator
        // has scrolled to; the buttons are still outside every form and wired
        // by `form=`, because a form inside a form is not a thing.
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border-hairline bg-surface-page py-3">
          <Button type="submit" form={FORM_ID} name="intent" value="review" disabled={pending}>
            Review
          </Button>
          <Button
            type="submit"
            form={BOOT_FORM_ID}
            name="intent"
            value="review"
            variant="secondary"
            disabled={pending}
          >
            Back to boot config
          </Button>
          <Caveat>
            {chosen.size} {chosen.size === 1 ? 'value' : 'values'} set in this row · {EFFECT}
          </Caveat>
        </div>
      ) : null}
    </>
  );
}

/**
 * The line the `stt` and `tts` cards carry under their title (ADR 0012 D5):
 * which boot report the selects below are drawn from — a caveat, because it
 * changes with the data — and one line per part of that report the parse
 * skipped (D2), on the card of the leg it concerns. Nothing without a report:
 * the head then carries the fixed caveat instead.
 */
function AsOfBoot({ group, offered }: { group: Group; offered: Offered | null }) {
  if (offered === null || (group !== 'stt' && group !== 'tts')) return null;
  // A skipped stt vendor is the stt card's; every other skipped part (a tts
  // vendor, a voice entry, a whole object) is the tts card's.
  const concernsStt = (line: string): boolean =>
    line.startsWith('stt ') || line.startsWith('vendors.stt ');
  const caveats = offered.caveats.filter((line) => concernsStt(line) === (group === 'stt'));
  return (
    <div className="flex flex-col gap-1">
      <Caveat>
        {group === 'stt' ? 'vendors' : 'vendors and voices'} {offered.asOf}
      </Caveat>
      {caveats.map((line) => (
        <Caveat key={line}>{line}</Caveat>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- one leaf */

/**
 * The one column template the header and every row share, so the boxes, the
 * names, the controls and the last-call values each form a straight column
 * whatever kind of control a row holds. Below `md` the control and the
 * last-call value wrap under the name.
 */
const ROW_GRID =
  'grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 md:grid-cols-[28px_minmax(0,240px)_260px_minmax(0,1fr)]';

/** What the tick means, read once and then known. */
const SET_HINT =
  'Ticked: this row carries the value. Unticked: the leaf is left out of the row and the pipeline boot value applies. Typing a value ticks it; emptying a number or choosing "boot value" unticks it.';

/** Contract §3.4: a key the snapshot lacks is a vendor that did not run, never a default. */
const LAST_CALL_HINT =
  'What the most recent answered call ran on, from its config snapshot. "—" means that call carried no such key: its vendor did not run. Beside each value, where it came from: "row #N" when the runtime_config row that call read set this leaf, "boot" when boot config supplied it.';

/** A column head per group card, in the Table's header style. */
function HeaderRow() {
  const head = 'text-[12px] leading-[1.4] font-semibold tracking-[.04em] text-text-muted';
  return (
    <div className={`${ROW_GRID} hidden border-b border-border-strong pb-2 md:grid`}>
      <span className={head}>
        <Hint hint={SET_HINT}>set</Hint>
      </span>
      <span className={head}>setting</span>
      <span className={head}>value</span>
      <span className={head}>
        <Hint hint={LAST_CALL_HINT}>last call</Hint>
      </span>
    </div>
  );
}

function FieldRow({
  field,
  vendorBounds,
  isSet,
  onTick,
  value,
  generation,
  provider,
  onProvider,
  onRestore,
  shipped,
  ranOn,
  snapshotRecorded,
  offered,
  editable,
}: {
  field: Field;
  vendorBounds: string | null;
  isSet: boolean;
  onTick: (path: string, on: boolean) => void;
  value: string;
  /** Bumped by a restore; it is the control's `key`, so the box refills. */
  generation: number;
  provider: string;
  onProvider: (next: string) => void;
  onRestore: (text: string) => void;
  shipped: string | undefined;
  ranOn: LastCall | null;
  snapshotRecorded: boolean;
  offered: Offered | null;
  editable: boolean;
}) {
  const { path } = field;
  const isProvider = path === 'stt.provider' || path === 'tts.provider';
  // The leaf name alone: the group is the card's title, and the full path, the
  // snapshot key and the bounds are the name's tooltip — read once, so they do
  // not take a second line on each of 55 rows.
  const leaf = path.slice(path.lastIndexOf('.') + 1);
  const long = isLong(field);

  const box = (
    <Checkbox
      name={`set:${path}`}
      label={`set ${path}`}
      labelHidden
      checked={isSet}
      disabled={!editable}
      onChange={(event) => {
        onTick(path, event.target.checked);
      }}
    />
  );

  const name = (
    <label htmlFor={path} className="min-w-0 truncate text-[length:var(--size-ui)] font-medium">
      <Hint hint={nameHint({ field, vendorBounds, isProvider, ranOn, snapshotRecorded, offered })}>
        {leaf}
      </Hint>
    </label>
  );

  const restore =
    shipped === undefined ? null : (
      <button
        type="button"
        disabled={!editable}
        onClick={() => {
          onRestore(shipped);
        }}
        className="cursor-pointer justify-self-end text-[length:var(--size-eyebrow)] font-medium text-text-link hover:underline disabled:cursor-default disabled:text-text-muted disabled:no-underline"
      >
        restore shipped text
      </button>
    );

  const control = (
    // Unticked is dimmed, never disabled or read-only: a disabled control
    // submits nothing, and a value typed before the box is ticked must still be
    // the one that is submitted when it is.
    <div className={isSet ? undefined : 'opacity-60'}>
      <Control
        field={field}
        value={value}
        generation={generation}
        provider={provider}
        onProvider={onProvider}
        onTick={onTick}
        isSet={isSet}
        editable={editable}
        isProvider={isProvider}
        offered={offered}
        width={long ? 'w-full' : controlWidth(field)}
      />
    </div>
  );

  const lastCall = lastCallText(ranOn, snapshotRecorded);
  // The voice label's build caveat (ADR 0012 D6), under the value it qualifies.
  const labelCaveat =
    snapshotRecorded && ranOn?.labelCaveat != null ? (
      <Caveat className="col-start-2 md:col-start-4">{ranOn.labelCaveat}</Caveat>
    ) : null;
  // Only beside a value: "—" came from no layer, and "not recorded" has none.
  const layer = snapshotRecorded && ranOn?.value != null ? layerText(ranOn.layer) : null;
  const lastCallTitle = layer === null ? lastCall : `${lastCall} · ${layer}`;
  const layerCaption =
    layer === null ? null : (
      <Caveat as="span" className="ml-2 font-ui">
        {layer}
      </Caveat>
    );

  if (long) {
    return (
      <div className={`${ROW_GRID} border-t border-border-hairline py-3 first:border-t-0`}>
        {box}
        <div className="flex min-w-0 items-center justify-between gap-3 md:col-span-3">
          {name}
          {restore}
        </div>
        <div className="col-[2/3] md:col-[2/5]">{control}</div>
        <p
          className="col-[2/3] mb-0 truncate text-[length:var(--size-eyebrow)] text-text-muted md:col-[2/5]"
          title={lastCallTitle}
        >
          last call: {lastCall}
          {layerCaption}
        </p>
      </div>
    );
  }

  return (
    <div className={`${ROW_GRID} border-t border-border-hairline py-2 first:border-t-0`}>
      {box}
      {name}
      <div className="col-start-2 md:col-start-auto">{control}</div>
      <span
        className="col-start-2 truncate font-num text-[length:var(--size-ui)] tabular-nums text-text-muted md:col-start-auto"
        title={lastCallTitle}
      >
        {/* The column head is hidden below `md`, so the value names itself. */}
        <span className="font-ui md:hidden">last call: </span>
        {lastCall}
        {layerCaption}
      </span>
      {labelCaveat}
    </div>
  );
}

/** A long control takes a line of its own; every other kind fits on its row. */
function isLong(field: Field): boolean {
  return field.kind === 'textarea' || field.kind === 'list' || field.kind === 'record';
}

/**
 * How wide a short control is drawn inside its column: a number box to what it
 * holds, because a 120px box says "a number goes here" the way a full-width
 * one never does; everything else fills the column.
 */
function controlWidth(field: Field): string {
  return field.kind === 'integer' || field.kind === 'number' ? 'w-[120px]' : 'w-full';
}

/**
 * The last-call cell, in words: "not recorded" before any call, "—" for a key it
 * lacked, and a voice id as `label (id)` when a boot report knows it (ADR 0012 D6).
 */
function lastCallText(ranOn: LastCall | null, snapshotRecorded: boolean): string {
  if (!snapshotRecorded) return 'not recorded';
  const value = ranOn?.value ?? null;
  if (value === null) return '—';
  return ranOn?.label != null ? `${ranOn.label} (${value})` : value;
}

/** The layer caption of rule 7 of `docs/redesign.md` §4.2 (ADR 0012 D8). */
function layerText(layer: Layer | null): string | null {
  if (layer === null) return null;
  return layer.kind === 'row' ? `row #${layer.version}` : 'boot';
}

/**
 * The name's tooltip, one fact per line: the full path, the snapshot key the
 * last call's value was read under, the leaf's own bounds, the per-vendor bounds a merged
 * control cannot carry, and what the kind of box expects.
 */
function nameHint({
  field,
  vendorBounds,
  isProvider,
  ranOn,
  snapshotRecorded,
  offered,
}: {
  field: Field;
  vendorBounds: string | null;
  isProvider: boolean;
  ranOn: LastCall | null;
  snapshotRecorded: boolean;
  offered: Offered | null;
}): string {
  const lines = [field.path];
  if (typeof field.flatKey === 'string') {
    lines.push(`snapshot key ${field.flatKey}`);
  } else if (ranOn?.key != null) {
    // The key the value beside it was read under — the last call's vendor, not
    // the one this form selects (ADR 0012 D9).
    lines.push(`snapshot key ${ranOn.key}`);
  } else {
    const perVendor = `snapshot key per vendor: ${Object.entries(field.flatKey)
      .map(([vendor, key]) => `${vendor} ${key}`)
      .join(', ')}`;
    const leg = field.group === 'tts' ? 'TTS_PROVIDER' : 'STT_PROVIDER';
    lines.push(
      snapshotRecorded ? `${perVendor} (the last call's snapshot names no ${leg})` : perVendor,
    );
  }
  if (field.min !== null) {
    lines.push(`${field.minExclusive ? 'greater than' : 'at least'} ${String(field.min)}`);
  }
  if (field.max !== null) {
    lines.push(`${field.maxExclusive ? 'less than' : 'at most'} ${String(field.max)}`);
  }
  // A merged control carries no bound of its own: each vendor bounds the leaf
  // its own way.
  if (vendorBounds !== null) lines.push(vendorBounds);
  if (field.kind === 'list') {
    lines.push(
      field.path === 'llm.params.stop'
        ? 'one entry per line; a stop sequence that itself contains a line break cannot be written here'
        : 'one entry per line',
    );
  }
  if (field.kind === 'record') lines.push('a JSON object, as stored');
  // Rule 4 of `docs/redesign.md` §4.2 (ADR 0012 D3): the vendors of the box's
  // newest boot report when there is one, every vendor when there is none.
  if (isProvider) {
    lines.push(
      offered === null
        ? 'Every vendor is offered. The box refuses a row naming a vendor it holds no keys for, and those calls run on boot config; its /healthz lists them under vendors.'
        : `Offered: the vendors this box's newest boot report lists, ${offered.asOf}. A row naming another is refused whole, and those calls run on boot config.`,
    );
  }
  // D4: why the voice is a text box, when it is one.
  if (field.path === 'tts.voice') {
    const vendors = field.vendor === null ? (offered?.vendors.tts ?? []) : [field.vendor];
    const uncheckable = voiceUncheckable(offered, vendors);
    if (uncheckable !== null && voiceControl(field, offered) === null) lines.push(uncheckable);
  }
  return lines.join('\n');
}

/** The option an unset select shows: the leaf is left out and the boot value applies. */
const BOOT_OPTION = 'boot value';

function Control({
  field,
  value,
  generation,
  provider,
  onProvider,
  onTick,
  isSet,
  editable,
  isProvider,
  offered,
  width,
}: {
  field: Field;
  value: string;
  generation: number;
  provider: string;
  onProvider: (next: string) => void;
  onTick: (path: string, on: boolean) => void;
  isSet: boolean;
  editable: boolean;
  isProvider: boolean;
  offered: Offered | null;
  /** The width class of the box itself: to the kind, or `w-full` on a long row. */
  width: string;
}) {
  const { path, kind } = field;
  // The control is uncontrolled and remounts when a restore bumps the
  // generation; that is the whole mechanism by which "restore shipped text"
  // refills a box without making every keystroke a re-render.
  const key = `${path}:${String(generation)}`;
  // An empty unset box says what applies instead of saying nothing.
  const placeholder = isSet ? undefined : BOOT_OPTION;

  // Editing a leaf is what "set this leaf" means, so a first keystroke ticks
  // the box rather than asking for it. Guarded on `isSet` so only that first
  // one re-renders the form; the rest stay a keystroke in an uncontrolled box.
  const autoTick = (): void => {
    if (!isSet) onTick(path, true);
  };
  // A select's "boot value" and an emptied number box both mean "leave this
  // leaf out" — an empty number is no value the schema could accept — so they
  // untick rather than send a refusal to the review.
  const tickFor = (next: string): void => {
    if (next === '') {
      if (isSet) onTick(path, false);
    } else autoTick();
  };

  if (isProvider) {
    const schema = field.options ?? [];
    const options = providerOptions(schema, offered, field.group === 'tts' ? 'tts' : 'stt');
    return (
      <>
        <div className={width}>
          <Select
            id={path}
            name={path}
            value={provider}
            disabled={!editable}
            onChange={(event) => {
              onProvider(event.target.value);
            }}
          >
            <option value="">{BOOT_OPTION}</option>
            {/* The stored value, kept selectable so the select does not quietly
                change the row: outside the schema, the schema's words; inside
                it but outside the report, the report's (ADR 0012 D3). */}
            <Unknown
              value={value}
              options={options}
              reason={
                offered !== null && schema.includes(value)
                  ? `not offered by this box (${offered.asOfAt})`
                  : undefined
              }
            />
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
        <noscript>
          <Caveat>
            without JavaScript every vendor&apos;s parameters are shown at once; a parameter of
            a vendor this row does not name refuses the whole row at review, which is where
            you will read it
          </Caveat>
        </noscript>
      </>
    );
  }

  const voice = voiceControl(field, offered);
  if (voice !== null) {
    // D4: labels shown, ids written; "boot value" first, which leaves the leaf
    // unset and names the voice boot config speaks with when the list marks one.
    // Keyed by vendor too, so switching the vendor remounts the list on the
    // stored value rather than keeping a selection of the other vendor's.
    const ids = voice.groups.flatMap(({ list }) => list.map((entry) => entry.id));
    // The merged control names no default: which vendor's applies depends on
    // the provider the row names, which that control cannot know.
    const defaultLabel = voice.merged
      ? undefined
      : voice.groups[0]?.list.find((entry) => entry.is_default)?.label;
    return (
      <div className={width}>
        <Select
          key={`${key}:${field.vendor ?? 'merged'}`}
          id={path}
          name={path}
          defaultValue={value}
          disabled={!editable}
          onChange={(event) => {
            tickFor(event.target.value);
          }}
        >
          <option value="">{defaultLabel === undefined ? BOOT_OPTION : `${BOOT_OPTION} (${defaultLabel})`}</option>
          <Unknown value={value} options={ids} reason={voice.unknownReason} />
          {voice.merged ? (
            // Without script every vendor's voices at once, one group each
            // (ADR 0011 D4); `offeredIssues` refuses another vendor's id at review.
            voice.groups.map(({ vendor, list }) => (
              <optgroup key={vendor} label={vendor}>
                <VoiceOptions list={list} />
              </optgroup>
            ))
          ) : (
            <VoiceOptions list={voice.groups[0]?.list ?? []} />
          )}
        </Select>
      </div>
    );
  }

  if (kind === 'boolean' || kind === 'enum') {
    // A boolean is a two-option select, never a checkbox: an HTML checkbox
    // submits `on`, which the copied schema refuses, and an unticked one
    // submits nothing at all — which would read as "not set" (contract §3.4:
    // absent ≠ false).
    const options = kind === 'boolean' ? ['true', 'false'] : (field.options ?? []);
    return (
      <div className={width}>
        <Select
          key={key}
          id={path}
          name={path}
          defaultValue={value}
          disabled={!editable}
          onChange={(event) => {
            tickFor(event.target.value);
          }}
        >
          <option value="">{BOOT_OPTION}</option>
          <Unknown value={value} options={options} />
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  if (kind === 'integer' || kind === 'number') {
    return (
      <div className={width}>
        <Input
          key={key}
          id={path}
          name={path}
          type="number"
          step={kind === 'integer' ? '1' : 'any'}
          // An exclusive bound is not expressible as `min`/`max`, so it stays
          // out of the attribute and lives in the name's tooltip instead — the
          // browser must not accept a value the schema then refuses, nor refuse
          // one it accepts.
          min={field.min !== null && !field.minExclusive ? field.min : undefined}
          max={field.max !== null && !field.maxExclusive ? field.max : undefined}
          defaultValue={value}
          placeholder={placeholder}
          disabled={!editable}
          onInput={(event) => {
            tickFor(event.currentTarget.value);
          }}
        />
      </div>
    );
  }

  if (kind === 'textarea' || kind === 'list' || kind === 'record') {
    // Five rows for a spoken line or the prompt block; three for a list, a JSON
    // object, and the one biasing text that is not a `text.*` leaf.
    const rows = kind === 'textarea' && field.group === 'text' ? 5 : 3;
    return (
      <div className={width}>
        <Textarea
          key={key}
          id={path}
          name={path}
          rows={rows}
          defaultValue={value}
          placeholder={placeholder}
          disabled={!editable}
          onInput={autoTick}
          className={kind === 'textarea' ? undefined : 'font-num'}
        />
      </div>
    );
  }

  return (
    <div className={width}>
      <Input
        key={key}
        id={path}
        name={path}
        defaultValue={value}
        placeholder={placeholder}
        disabled={!editable}
        onInput={autoTick}
      />
    </div>
  );
}

/**
 * A stored value the schema does not offer — a row written by hand, or a
 * catalogue the pipeline has moved on from (trap 6). It is offered as its own
 * option rather than dropped, so the select does not silently change the row's
 * value to the first legal one.
 */
function Unknown({
  value,
  options,
  reason = 'not a value this build offers',
}: {
  value: string;
  options: readonly string[];
  /** Why it is not offered; the schema's words unless a boot report is the reason (ADR 0012 D3, D4). */
  reason?: string | undefined;
}) {
  if (value === '' || options.includes(value)) return null;
  return (
    <option value={value}>
      {value} — {reason}
    </option>
  );
}

/** One voice list as options: the label shown, the id written, `.env` order kept. */
function VoiceOptions({ list }: { list: readonly BootReportVoice[] }) {
  return list.map((entry) => (
    <option key={entry.id} value={entry.id}>
      {entry.label}
    </option>
  ));
}

/**
 * Whether `tts.voice` is a select, and of what (ADR 0012 D4): with script, the
 * field is the chosen vendor's branch and the select is that vendor's list;
 * without it, the field is the merged one and the select is every offered
 * vendor's list, one group each. Null — the text box — with no report, or a
 * vendor whose list the report does not carry.
 */
function voiceControl(
  field: Field,
  offered: Offered | null,
): { groups: { vendor: string; list: BootReportVoice[] }[]; merged: boolean; unknownReason: string } | null {
  if (field.path !== 'tts.voice' || offered === null) return null;
  if (field.vendor === null) {
    const groups = mergedVoices(offered);
    return groups === null
      ? null
      : { groups, merged: true, unknownReason: `not in this box's voice lists (${offered.asOfAt})` };
  }
  const list = voiceList(offered, field.vendor);
  return list === null
    ? null
    : {
        groups: [{ vendor: field.vendor, list }],
        merged: false,
        unknownReason: `not in this box's ${field.vendor} voice list (${offered.asOfAt})`,
      };
}

/* ---------------------------------------------------------------- review */

/** One side of a diff line: the value, or the words for an absent leaf (§3.4). */
function DiffValue({ value }: { value: unknown }) {
  if (value === undefined) return <span className="text-text-muted">{BOOT_OPTION}</span>;
  return <span className="font-num">{renderValue(value)}</span>;
}

function ReviewStep({
  state,
  formAction,
  pending,
  editable,
  from,
  fromRow,
  newestRow,
}: {
  state: Extract<FormState, { step: 'review' }>;
  formAction: (formData: FormData) => void;
  pending: boolean;
  editable: boolean;
  from: Record<string, unknown>;
  fromRow: string | null;
  /** The newest row's id, the diff's base; null with no row. */
  newestRow: string | null;
}) {
  const blocked = state.issues.length > 0;
  const changes = state.diff.length;
  // The diff's base is the newest row (ADR 0012 D7), which is what the next
  // call runs on; a form loaded from an older row says so beside it.
  const loadedFromOlder = fromRow !== null && fromRow !== newestRow;

  return (
    <form action={formAction} className="flex flex-col gap-[18px]">
      <input type="hidden" name="tenant" value={state.tenant} />
      <input type="hidden" name="from" value={JSON.stringify(from)} />
      {/* The proposed document, carried back so `save` can parse it again on the
          server — the client's copy is read, never trusted. */}
      <input type="hidden" name="document" value={JSON.stringify(state.document)} />
      {/* The form as it was left, so "Edit" gives it back leaf for leaf. */}
      {state.set.map((path) => (
        <input key={`set:${path}`} type="hidden" name={`set:${path}`} value="on" />
      ))}
      {Object.entries(state.values).map(([path, value]) => (
        <input key={path} type="hidden" name={path} value={value} />
      ))}

      {blocked ? (
        <Card tone="rose" title="The copied schema refuses this document">
          <div className="flex flex-col gap-2">
            {state.issues.map((issue) => (
              <div key={`${issue.path}:${issue.message}`} className="flex flex-wrap items-baseline gap-2">
                <Badge tone="error">{issue.path === '' ? 'the document' : issue.path}</Badge>
                <span className="text-[length:var(--size-ui)]">{issue.message}</span>
              </div>
            ))}
          </div>
          {/* The pipeline runs this same schema on the row, so a row it refuses
              would leave every call on boot config. */}
          <Caveat>Save comes back once these are fixed: the pipeline would refuse this row too</Caveat>
        </Card>
      ) : null}

      <Card title={changes === 1 ? '1 change' : `${String(changes)} changes`}>
        {loadedFromOlder ? (
          <Caveat>
            the form was loaded from row #{fromRow}; the changes are against the current row
            {newestRow === null ? null : <> #{newestRow}</>}
          </Caveat>
        ) : null}
        {changes === 0 ? (
          <Caveat>nothing changes: this document is the one the pipeline runs on now</Caveat>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>setting</Th>
                  <Th hint="What the pipeline runs on now: the newest row, or boot config when there is none or the schema refuses it — whichever row the form was loaded from.">
                    before
                  </Th>
                  <Th>after</Th>
                </tr>
              </thead>
              <tbody>
                {state.diff.map((entry) => (
                  <tr key={entry.path}>
                    <Td>{entry.path}</Td>
                    <Td>
                      <DiffValue value={entry.from} />
                    </Td>
                    <Td>
                      <DiffValue value={entry.to} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
        {/* The whole row as it will be stored, for whoever wants the bytes; the
            diff above is what a review reads. */}
        <details className="text-[length:var(--size-ui)]">
          <summary className="cursor-pointer text-text-link">the whole document</summary>
          <pre className="mt-2 mb-0 overflow-x-auto rounded-md bg-surface-page p-3 font-num text-[length:var(--size-ui)] leading-[1.5] whitespace-pre-wrap">
            {JSON.stringify(state.document, null, 2)}
          </pre>
        </details>
      </Card>

      {state.advice.length === 0 ? null : (
        // Advice never blocks a save; the pipeline evaluates none of it.
        <Card tone="warm" title="Worth knowing before you save">
          <div className="flex flex-col gap-2">
            {state.advice.map((line) => (
              <div key={line} className="flex flex-wrap items-baseline gap-2">
                <Badge tone="warning">advice</Badge>
                <span className="text-[length:var(--size-ui)]">{line}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Save this as a new row">
        <label htmlFor="note" className="text-[length:var(--size-ui)] font-medium">
          note
        </label>
        {/* Stored on the row as written, so the history reads as a record
            rather than as a list of documents. */}
        <Textarea
          id="note"
          name="note"
          rows={2}
          defaultValue={state.note}
          placeholder="optional — what this change is for"
        />

        {state.failure === null ? null : (
          <p className="mb-0 text-[length:var(--size-ui)] text-[color:var(--error)]">
            {state.failure}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" name="intent" value="edit" variant="secondary" disabled={pending}>
            Edit
          </Button>
          {editable && !blocked ? (
            <Button type="submit" name="intent" value="save" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          ) : null}
          <Caveat>{EFFECT}</Caveat>
        </div>
      </Card>
    </form>
  );
}
