'use client';

/**
 * The Configuration form and its review step — one `useActionState` over the
 * one server action (ADR 0011 decision 5), rendering a form that is generated
 * from the copied schema and never written by hand (decision 4).
 *
 * The form always shows the values the pipeline runs on now: the newest row's
 * value where the row sets a leaf, "boot value" (with the value, when the last
 * call shows it) where it does not. A leaf edited in this session and not yet
 * saved wears the pending mark and a rollback button; "pending" is measured
 * against the newest row, never against whatever the form was loaded from, so
 * a row loaded from history shows what it would change as pending at once.
 * A blank control is the boot value (`isSetText`) — there is no tick.
 *
 * The five groups are tabs: one card on screen at a time, every card still in
 * the one `<form>` so an edit on one tab is submitted with the others.
 *
 * Everything here works with JavaScript off: the two steps are plain `<form>`
 * posts, every button is a `<button name="intent">`, the long-text editors are
 * `popover`s opened by `popovertarget`, and without script every tab's card is
 * shown at once (the `<noscript>` style). What script adds is the tab switch,
 * the vendor branch switch, the pending marks, rollback and "restore shipped
 * text" — conveniences, not the mechanism.
 *
 * The one rule script changes rather than decorates: with script running, only
 * the SELECTED vendor's branch is in the DOM, so the other branch's leaves are
 * not submitted at all. `documentFromForm` keeps every submitted leaf on
 * purpose — a leaf of the branch not chosen is an `unrecognized_keys` refusal
 * the operator reads, never a silently dropped edit — so with JavaScript off
 * every branch renders and the schema refuses the wrong one at review. That is
 * the designed fallback, and the `<noscript>` under each provider says so.
 */

import { Fragment, useActionState, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import {
  mergedVoices,
  providerOptions,
  voiceList,
  voiceUncheckable,
  type BootReportVoice,
  type Offered,
} from '@/boot-report';
import {
  isSetText,
  mergeBranches,
  valueAt,
  vendorsOf,
  type BranchMerge,
  type Field,
  type Layer,
} from '@/configuration/document';
import { GROUPS, type Group } from '@/configuration/groups';
import { renderValue } from '@/dashboard';
import Badge from '@/ui/badge';
import Button from '@/ui/button';
import Card from '@/ui/card';
import { PILL, PILL_OFF, PILL_ON } from '@/ui/chip';
import Caveat, { Hint } from '@/ui/caveat';
import Input, { CONTROL } from '@/ui/input';
import Overlay, { closeProps } from '@/ui/overlay';
import Select from '@/ui/select';
import { Table, Td, Th } from '@/ui/table';
import Textarea from '@/ui/textarea';
import { submitConfiguration, type FormState } from './actions';

const FORM_ID = 'configuration-form';
const BOOT_FORM_ID = 'configuration-boot';
const GREETING_FORM_ID = 'configuration-restore-greeting';

/** The store never changes: "is script running" is answered once and stays. */
const subscribeToNothing = (): (() => void) => () => undefined;

/** The option an unset select shows: the leaf is left out and the boot value applies. */
const BOOT_OPTION = 'boot value';

/** A voice id no boot report lists: named by what it is, since the id means nothing to read. */
const UNLISTED_VOICE = 'unlisted voice';

/** Rule 3 of `docs/redesign.md` §4.2, on the screen beside the Save button. */
const EFFECT = 'takes effect on the next call answered; no call in progress changes';

/**
 * Without script there is no tab switch, so every group's card is shown and
 * the tab strip, which could not switch anything, is not. Unlayered
 * `!important` outranks the utilities layer's `hidden`.
 */
const NO_SCRIPT_STYLE =
  '[data-config-panel]{display:block!important}[data-config-tabs]{display:none!important}';

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
  /**
   * The newest row's document as the form spells it (`formFromDocument` of
   * `from`): what "pending" is measured against and what rollback restores.
   */
  base: Record<string, string>;
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
        fields={props.fields}
        ranOn={props.ranOn}
        offered={props.offered}
      />
    );
  }
  return <EditStep {...props} state={state} formAction={formAction} pending={pending} />;
}

/* ------------------------------------------------------------ boot values */

/** A control's text as the row would carry it: blank is the leaf left out. */
function carried(raw: string | undefined): string {
  return raw !== undefined && isSetText(raw) ? raw : '';
}

/**
 * The boot value of a leaf, when the last call shows it: that call ran the leaf
 * from boot config ("boot" layer, rule 7 of `docs/redesign.md` §4.2), and — for
 * a per-vendor leaf — ran the vendor the leaf is asked about, since another
 * vendor's boot value is a different setting. Null when unknown: then the words
 * are "boot value" alone. It is the boot value of the process that answered
 * that call; a box restarted since may boot with another, which the name's
 * tooltip says.
 */
function bootValueOf(
  ranOn: Record<string, LastCall>,
  path: string,
  vendor: string | null,
  perVendor: boolean,
): string | null {
  const cell = ranOn[path];
  if (cell?.value == null || cell.layer?.kind !== 'boot') return null;
  if (perVendor) {
    const leg = path.slice(0, path.indexOf('.'));
    if (vendor === null || ranOn[`${leg}.provider`]?.value !== vendor) return null;
  }
  return cell.label != null ? `${cell.label} (${cell.value})` : cell.value;
}

/** What an unset leaf reads as: "boot value", with the value when it is known. */
function bootWords(boot: string | null, max = 48): string {
  if (boot === null) return BOOT_OPTION;
  const flat = boot.replace(/\s+/g, ' ');
  return `${BOOT_OPTION} (${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat})`;
}

/* ------------------------------------------------------------------ edit */

function EditStep({
  fields,
  base,
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
  const { tenant } = state;

  // Every control is controlled by this one record: the pending marks, the
  // long-text previews and rollback all read it, and 55 leaves re-rendering on
  // a keystroke is nothing a browser notices.
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...state.values }));
  const [group, setGroup] = useState<Group>(state.group);

  // False on the server and through hydration, true once React is driving the
  // page: exactly the divergence `useSyncExternalStore`'s server snapshot is
  // for. So the markup a browser without script keeps is the one carrying every
  // vendor branch, and the branch switch starts hiding the others only where
  // there is script to switch them back.
  const scripted = useSyncExternalStore(subscribeToNothing, () => true, () => false);

  const setValue = (path: string, next: string): void => {
    setValues((current) => ({ ...current, [path]: next }));
  };
  // Blank is how a leaf the newest row leaves out reads (boot value).
  const rollback = (path: string): void => {
    setValue(path, base[path] ?? '');
  };

  const providerOf = (of: Group): string => carried(values[`${of}.provider`]);
  // Whether a field is in the DOM, and so submitted: with script, a vendor
  // branch only while its vendor is the one chosen.
  const live = (field: Field): boolean =>
    field.vendor === null || !scripted || field.vendor === providerOf(field.group);

  // Pending: every leaf whose submitted value differs from the newest row's —
  // a leaf of a vendor no longer chosen counts, since the save drops it.
  const livePaths = new Set(fields.filter(live).map((field) => field.path));
  const paths = [...new Set(fields.map((field) => field.path))];
  const changed = new Set(
    paths.filter(
      (path) => (livePaths.has(path) ? carried(values[path]) : '') !== carried(base[path]),
    ),
  );

  /**
   * The leaves one group renders: with script, the chosen vendor's branch only;
   * without it, every branch, each path once — a path several branches share
   * (`stt.model`, `tts.params.speed`) is one control carrying the union of what
   * those branches offer, not the first branch's alone.
   */
  const visible = (of: Group): BranchMerge[] => {
    const byPath = new Map<string, Field[]>();
    for (const field of fields) {
      if (field.group !== of || !live(field)) continue;
      const branches = byPath.get(field.path);
      if (branches === undefined) byPath.set(field.path, [field]);
      else branches.push(field);
    }
    return [...byPath.values()].map(mergeBranches);
  };

  // The tab is in the address bar too (`?group=`), so a reload or a pasted
  // link opens on it; replacing the entry, not pushing one, because a tab is
  // not a page the back button should step through.
  const choose = (next: Group): void => {
    setGroup(next);
    const url = new URL(window.location.href);
    url.searchParams.set('group', next);
    url.searchParams.delete('saved');
    window.history.replaceState(null, '', url);
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = GROUPS[(index + step + GROUPS.length) % GROUPS.length];
    if (next === undefined) return;
    choose(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  // What rollback returns a leaf to, in words, for its tooltip.
  const rollbackWords = (field: Field): string => {
    const was = base[field.path];
    const row = disclosureRow === null ? 'boot config' : `row #${disclosureRow}`;
    if (was !== undefined && isSetText(was)) {
      const flat = was.replace(/\s+/g, ' ');
      return `${row}: ${flat.length > 60 ? `${flat.slice(0, 59)}…` : flat}`;
    }
    return `${row}: ${BOOT_OPTION}`;
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
            <input type="hidden" name="group" value="text" />
            <input type="hidden" name="from" value={JSON.stringify(from)} />
            {Object.entries(state.values)
              .filter(([path]) => path !== 'text.greeting')
              .map(([path, value]) => (
                <input key={path} type="hidden" name={path} value={value} />
              ))}
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

      {/* The five groups rarely matter together, so one is on screen at a
          time. The count on a tab is how many of its leaves are pending, so an
          edit left on another tab is never out of sight. */}
      <div
        role="tablist"
        aria-label="Configuration groups"
        data-config-tabs
        className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-surface-page py-2"
      >
        {GROUPS.map((of, index) => {
          const count = [...changed].filter((path) => path.startsWith(`${of}.`)).length;
          const on = of === group;
          return (
            <button
              key={of}
              type="button"
              role="tab"
              id={`tab-${of}`}
              aria-selected={on}
              aria-controls={`panel-${of}`}
              tabIndex={on ? 0 : -1}
              onClick={() => {
                choose(of);
              }}
              onKeyDown={(event) => {
                onTabKey(event, index);
              }}
              className={`${PILL} ${on ? PILL_ON : PILL_OFF} cursor-pointer`}
            >
              {of}
              {count === 0 ? null : (
                <span
                  className={`font-num tabular-nums ${on ? 'opacity-75' : 'text-text-link'}`}
                  title={`${String(count)} pending`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <noscript>
        <style>{NO_SCRIPT_STYLE}</style>
      </noscript>

      <form id={FORM_ID} action={formAction} className="flex flex-col gap-[18px]">
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="group" value={group} />
        {/* The document the diff is taken against, carried as JSON so the review
            step compares against the newest row the page read. */}
        <input type="hidden" name="from" value={JSON.stringify(from)} />

        {GROUPS.map((of) => (
          <div
            key={of}
            id={`panel-${of}`}
            role="tabpanel"
            aria-labelledby={`tab-${of}`}
            data-config-panel
            className={of === group ? undefined : 'hidden'}
          >
            <Card title={of}>
              <AsOfBoot group={of} offered={offered} />
              <div className="flex flex-col">
                <HeaderRow />
                {visible(of).map(({ field, vendorBounds }) => {
                  const perVendor = vendorsOf(fields, field.path) !== null;
                  const provider = providerOf(field.group);
                  return (
                    <FieldRow
                      key={field.path}
                      field={field}
                      vendorBounds={vendorBounds}
                      value={values[field.path] ?? ''}
                      onValue={(next) => {
                        setValue(field.path, next);
                      }}
                      isPending={scripted && changed.has(field.path)}
                      onRollback={() => {
                        rollback(field.path);
                      }}
                      rollbackWords={rollbackWords(field)}
                      boot={bootValueOf(ranOn, field.path, provider === '' ? null : provider, perVendor)}
                      shipped={
                        field.group === 'text'
                          ? shippedText[field.path.slice('text.'.length)]
                          : undefined
                      }
                      ranOn={ranOn[field.path] ?? null}
                      snapshotRecorded={snapshotRecorded}
                      offered={offered}
                      editable={editable}
                    />
                  );
                })}
              </div>
            </Card>
          </div>
        ))}
      </form>

      {/* "Back to boot config" is a form of its own with no leaf at all, so the
          document it proposes is `{}` — which is a legal row meaning the boot
          value applies to every leaf (contract §3.4). */}
      <form id={BOOT_FORM_ID} action={formAction} className="contents">
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="group" value={group} />
        <input type="hidden" name="from" value={JSON.stringify(from)} />
      </form>

      {editable ? (
        // The way out of the form stays on screen wherever the operator has
        // scrolled to; the buttons are outside every form and wired by `form=`,
        // because a form inside a form is not a thing.
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-hairline bg-surface-page py-3">
          <div className="flex min-w-0 flex-col">
            {scripted ? (
              <span className="text-[length:var(--size-ui)] font-medium">
                {changed.size === 0
                  ? 'No pending change'
                  : `${String(changed.size)} pending ${changed.size === 1 ? 'change' : 'changes'}`}
              </span>
            ) : null}
            <Caveat>{EFFECT}</Caveat>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
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
            {scripted ? (
              <Button
                variant="secondary"
                disabled={changed.size === 0}
                onClick={() => {
                  setValues({ ...base });
                }}
              >
                Rollback all
              </Button>
            ) : null}
            <Button
              type="submit"
              form={FORM_ID}
              name="intent"
              value="review"
              disabled={pending || (scripted && changed.size === 0)}
            >
              Review
            </Button>
          </div>
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
 * The one column template the header and every row share, so the names, the
 * controls, the last-call values and the rollback buttons each form a straight
 * column whatever kind of control a row holds. Below `md` the control and the
 * last-call value wrap under the name, the rollback button stays beside it.
 */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 md:grid-cols-[minmax(0,220px)_minmax(0,340px)_minmax(0,1fr)_28px]';

/** Contract §3.4: a key the snapshot lacks is a vendor that did not run, never a default. */
const LAST_CALL_HINT =
  'What the most recent answered call ran on, from its config snapshot. "—" means that call carried no such key: its vendor did not run. Beside each value, where it came from: "row #N" when the runtime_config row that call read set this leaf, "boot" when boot config supplied it.';

/** What a blank control means, read once on the column head. */
const VALUE_HINT =
  'What the pipeline runs on now: the current row\'s value, or "boot value" where the row leaves the leaf out (with the value when the last call shows it). Empty a box, or choose "boot value", to leave the leaf out.';

/** A column head per group card, in the Table's header style. */
function HeaderRow() {
  const head = 'text-[12px] leading-[1.4] font-semibold tracking-[.04em] text-text-muted';
  return (
    <div className={`${ROW_GRID} hidden border-b border-border-strong pb-2 md:grid`}>
      <span className={head}>setting</span>
      <span className={head}>
        <Hint hint={VALUE_HINT}>value</Hint>
      </span>
      <span className={head}>
        <Hint hint={LAST_CALL_HINT}>last call</Hint>
      </span>
      <span />
    </div>
  );
}

/** The mark of a leaf changed in this session and not saved yet. */
function PendingMark() {
  return (
    <span
      role="img"
      aria-label="pending"
      title="Pending: changed in this session, not saved yet"
      className="inline-block size-2 shrink-0 rounded-full bg-action-primary"
    />
  );
}

function FieldRow({
  field,
  vendorBounds,
  value,
  onValue,
  isPending,
  onRollback,
  rollbackWords,
  boot,
  shipped,
  ranOn,
  snapshotRecorded,
  offered,
  editable,
}: {
  field: Field;
  vendorBounds: string | null;
  value: string;
  onValue: (next: string) => void;
  isPending: boolean;
  onRollback: () => void;
  /** What rollback returns the leaf to, for the button's tooltip. */
  rollbackWords: string;
  /** The boot value when the last call shows it (`bootValueOf`), else null. */
  boot: string | null;
  shipped: string | undefined;
  ranOn: LastCall | null;
  snapshotRecorded: boolean;
  offered: Offered | null;
  editable: boolean;
}) {
  const { path } = field;
  const isProvider = path === 'stt.provider' || path === 'tts.provider';
  // The leaf name alone: the group is the tab, and the full path, the snapshot
  // key and the bounds are the name's tooltip — read once, so they do not take
  // a second line on each of 55 rows.
  const leaf = path.slice(path.lastIndexOf('.') + 1);
  const long = isLong(field);

  const name = (
    <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
      <label htmlFor={path} className="min-w-0 truncate text-[length:var(--size-ui)] font-medium">
        <Hint
          hint={nameHint({ field, vendorBounds, isProvider, ranOn, snapshotRecorded, offered, boot })}
        >
          {leaf}
        </Hint>
      </label>
      {isPending ? <PendingMark /> : null}
    </div>
  );

  const rollback = isPending ? (
    <button
      type="button"
      onClick={onRollback}
      title={`Rollback to ${rollbackWords}`}
      aria-label={`Rollback ${path} to ${rollbackWords}`}
      className="col-start-2 row-start-1 flex size-7 cursor-pointer items-center justify-center justify-self-end rounded-sm text-[16px] leading-none text-text-link hover:bg-[var(--action-secondary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] md:col-start-4"
    >
      ↺
    </button>
  ) : null;

  const lastCall = lastCallText(ranOn, snapshotRecorded);
  // The voice label's build caveat (ADR 0012 D6), under the value it qualifies.
  const labelCaveat =
    snapshotRecorded && ranOn?.labelCaveat != null ? (
      <Caveat className="col-span-2 md:col-span-1 md:col-start-3">{ranOn.labelCaveat}</Caveat>
    ) : null;
  // Only beside a value: "—" came from no layer, and "not recorded" has none.
  const layer = snapshotRecorded && ranOn?.value != null ? layerText(ranOn.layer) : null;
  // The voice id stays reachable on hover, for whoever has to look it up.
  const voiceId = ranOn?.label !== undefined && ranOn.value !== null ? ` (${ranOn.value})` : '';
  const lastCallTitle = `${lastCall}${voiceId}${layer === null ? '' : ` · ${layer}`}`;
  const layerCaption =
    layer === null ? null : (
      <Caveat as="span" className="ml-2 font-ui">
        {layer}
      </Caveat>
    );

  if (long) {
    return (
      <div className={`${ROW_GRID} border-t border-border-hairline py-2.5 first:border-t-0`}>
        {name}
        {rollback}
        <div className="col-span-2 md:col-span-2 md:col-start-2 md:row-start-1">
          <LongControl
            field={field}
            value={value}
            onValue={onValue}
            boot={boot}
            shipped={shipped}
            editable={editable}
          />
        </div>
        <p
          className="col-span-2 mb-0 truncate text-[length:var(--size-eyebrow)] text-text-muted md:col-span-2 md:col-start-2"
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
      {name}
      {rollback}
      <div className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1">
        <Control
          field={field}
          value={value}
          onValue={onValue}
          boot={boot}
          editable={editable}
          isProvider={isProvider}
          offered={offered}
          width={controlWidth(field)}
        />
      </div>
      <span
        className="col-span-2 truncate font-num text-[length:var(--size-ui)] tabular-nums text-text-muted md:col-span-1 md:col-start-3 md:row-start-1"
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

/** A long control is a preview opening an editor; every other kind fits on its row. */
function isLong(field: Field): boolean {
  return field.kind === 'textarea' || field.kind === 'list' || field.kind === 'record';
}

/**
 * How wide a short control is drawn inside its column: a number box to what it
 * holds plus its "boot value (…)" words, because a narrow box says "a number
 * goes here" the way a full-width one never does; everything else fills the
 * column.
 */
function controlWidth(field: Field): string {
  return field.kind === 'integer' || field.kind === 'number' ? 'w-[200px]' : 'w-full';
}

/**
 * The last-call cell, in words: "not recorded" before any call, "—" for a key it
 * lacked, and a voice by its label (ADR 0012 D6) — an id is a string no operator
 * tells apart, so it is only in the tooltip, and a voice no boot report knows
 * reads `UNLISTED_VOICE`.
 */
function lastCallText(ranOn: LastCall | null, snapshotRecorded: boolean): string {
  if (!snapshotRecorded) return 'not recorded';
  const value = ranOn?.value ?? null;
  if (value === null) return '—';
  // `label` is present, null or not, exactly on the voice cell (the page's `labelVoice`).
  if (ranOn?.label !== undefined) return ranOn.label ?? UNLISTED_VOICE;
  return value;
}

/** A voice id as the operator reads it: its label in any vendor's list the box reported. */
function voiceName(offered: Offered | null, id: string): string {
  for (const list of Object.values(offered?.voices ?? {})) {
    const entry = list.find((voice) => voice.id === id);
    if (entry !== undefined) return entry.label;
  }
  return UNLISTED_VOICE;
}

/** The layer caption of rule 7 of `docs/redesign.md` §4.2 (ADR 0012 D8). */
function layerText(layer: Layer | null): string | null {
  if (layer === null) return null;
  return layer.kind === 'row' ? `row #${layer.version}` : 'boot';
}

/**
 * The name's tooltip, one fact per line: the full path, the snapshot key the
 * last call's value was read under, the leaf's own bounds, the per-vendor bounds a merged
 * control cannot carry, what the kind of box expects, and where a boot value
 * shown on the row came from.
 */
function nameHint({
  field,
  vendorBounds,
  isProvider,
  ranOn,
  snapshotRecorded,
  offered,
  boot,
}: {
  field: Field;
  vendorBounds: string | null;
  isProvider: boolean;
  ranOn: LastCall | null;
  snapshotRecorded: boolean;
  offered: Offered | null;
  boot: string | null;
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
  if (boot !== null) {
    lines.push(
      'The boot value shown is what the last call ran from boot config; a box restarted since then may boot with another.',
    );
  }
  return lines.join('\n');
}

function Control({
  field,
  value,
  onValue,
  boot,
  editable,
  isProvider,
  offered,
  width,
}: {
  field: Field;
  value: string;
  onValue: (next: string) => void;
  boot: string | null;
  editable: boolean;
  isProvider: boolean;
  offered: Offered | null;
  /** The width class of the box itself, to the kind. */
  width: string;
}) {
  const { path, kind } = field;
  // An empty box says what applies instead of saying nothing; the same words
  // are a select's first option.
  const bootText = bootWords(boot, 24);

  if (isProvider) {
    const schema = field.options ?? [];
    const options = providerOptions(schema, offered, field.group === 'tts' ? 'tts' : 'stt');
    return (
      <>
        <div className={width}>
          <Select
            id={path}
            name={path}
            value={value}
            disabled={!editable}
            onChange={(event) => {
              onValue(event.target.value);
            }}
          >
            <option value="">{bootText}</option>
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
    const ids = voice.groups.flatMap(({ list }) => list.map((entry) => entry.id));
    // The merged control names no default: which vendor's applies depends on
    // the provider the row names, which that control cannot know.
    const defaultLabel = voice.merged
      ? undefined
      : voice.groups[0]?.list.find((entry) => entry.is_default)?.label;
    return (
      <div className={width}>
        <Select
          id={path}
          name={path}
          value={value}
          disabled={!editable}
          onChange={(event) => {
            onValue(event.target.value);
          }}
        >
          <option value="">
            {defaultLabel === undefined ? bootText : `${BOOT_OPTION} (${defaultLabel})`}
          </option>
          <Unknown
            value={value}
            options={ids}
            reason={voice.unknownReason}
            name={voiceName(offered, value)}
          />
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
          id={path}
          name={path}
          value={value}
          disabled={!editable}
          onChange={(event) => {
            onValue(event.target.value);
          }}
        >
          <option value="">{bootText}</option>
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
          value={value}
          placeholder={bootText}
          disabled={!editable}
          onChange={(event) => {
            onValue(event.target.value);
          }}
        />
      </div>
    );
  }

  return (
    <div className={width}>
      <Input
        id={path}
        name={path}
        value={value}
        placeholder={bootWords(boot)}
        disabled={!editable}
        onChange={(event) => {
          onValue(event.target.value);
        }}
      />
    </div>
  );
}

/** A long value on one or two lines of its row: a list's entries side by side, whitespace folded. */
function previewOf(value: string, kind: Field['kind']): string {
  if (kind === 'list') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .join(' · ');
  }
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * A long leaf — the prompt block, a spoken line, a list, a JSON object — as two
 * lines of preview on its row and an editor above the page. The textarea is
 * the form's control: it lives inside the popover, which stays in the `<form>`,
 * so it is submitted whether the editor is open or not.
 */
function LongControl({
  field,
  value,
  onValue,
  boot,
  shipped,
  editable,
}: {
  field: Field;
  value: string;
  onValue: (next: string) => void;
  boot: string | null;
  shipped: string | undefined;
  editable: boolean;
}) {
  const { path, kind } = field;
  const editor = `edit:${path}`;
  const set = isSetText(value);
  const help =
    kind === 'list'
      ? path === 'llm.params.stop'
        ? 'one entry per line; a stop sequence that itself contains a line break cannot be written here'
        : 'one entry per line'
      : kind === 'record'
        ? 'a JSON object, as stored'
        : null;

  return (
    <>
      {/* The row's label points here, so clicking the name opens the editor too. */}
      <button
        type="button"
        id={path}
        popoverTarget={editor}
        className={`${CONTROL} flex cursor-pointer items-start gap-3 text-left`}
      >
        <span
          className={`line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere] ${set ? '' : 'text-text-muted'}`}
        >
          {set ? previewOf(value, kind) : bootWords(boot, 120)}
        </span>
        <span className="shrink-0 font-medium text-text-link">{editable ? 'edit' : 'view'}</span>
      </button>

      <Overlay id={editor} title={path}>
        <Textarea
          aria-label={path}
          name={path}
          rows={kind === 'textarea' ? 18 : 10}
          value={value}
          placeholder={bootWords(boot, 200)}
          disabled={!editable}
          onChange={(event) => {
            onValue(event.target.value);
          }}
          className={kind === 'textarea' ? undefined : 'font-num'}
        />
        {help === null ? null : <Caveat>{help}</Caveat>}
        <div className="flex flex-wrap items-center gap-3">
          {shipped === undefined || !editable ? null : (
            <Button
              variant="secondary"
              onClick={() => {
                onValue(shipped);
              }}
            >
              Restore shipped text
            </Button>
          )}
          {editable ? (
            <Button
              variant="secondary"
              disabled={!set}
              onClick={() => {
                onValue('');
              }}
            >
              Use boot value
            </Button>
          ) : null}
          <Button {...closeProps(editor)} className="ml-auto">
            Done
          </Button>
        </div>
      </Overlay>
    </>
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
  name = value,
}: {
  value: string;
  options: readonly string[];
  /** Why it is not offered; the schema's words unless a boot report is the reason (ADR 0012 D3, D4). */
  reason?: string | undefined;
  /** What the option shows for the value; the value itself unless it is an id no one reads. */
  name?: string;
}) {
  if (value === '' || options.includes(value)) return null;
  return (
    <option value={value}>
      {name} — {reason}
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

/** A value longer than this, or on more than one line, is clamped with a "show all". */
const LONG_VALUE = 140;

/** A document's vendor for one leg, when it names one. */
function providerIn(document: unknown, leg: string): string | null {
  const provider = valueAt(document, `${leg}.provider`);
  return typeof provider === 'string' ? provider : null;
}

/**
 * The words for a leaf one side of the diff leaves out: "not a <vendor>
 * setting" when that side's vendor has no such leaf at all — the other
 * vendor's parameters a vendor switch drops — else the boot value, with the
 * value when the last call shows it (`bootValueOf`).
 */
function absentWords(
  path: string,
  document: unknown,
  fields: readonly Field[],
  ranOn: Record<string, LastCall>,
): string {
  const vendors = vendorsOf(fields, path);
  if (vendors === null) return bootWords(bootValueOf(ranOn, path, null, false), 200);
  const leg = path.slice(0, path.indexOf('.'));
  const provider = providerIn(document, leg) ?? bootValueOf(ranOn, `${leg}.provider`, null, false);
  if (provider !== null && !vendors.includes(provider)) return `not a ${provider} setting`;
  return bootWords(bootValueOf(ranOn, path, provider, true), 200);
}

/** One side of a diff line: the value clamped to three lines, or the words for an absent leaf (§3.4). */
function DiffValue({ text, absent }: { text: string | null; absent: string }) {
  if (text === null) return <span className="text-text-muted">{absent}</span>;
  return (
    <span className="line-clamp-3 font-num whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</span>
  );
}

function ReviewStep({
  state,
  formAction,
  pending,
  editable,
  from,
  fromRow,
  newestRow,
  fields,
  ranOn,
  offered,
}: {
  state: Extract<FormState, { step: 'review' }>;
  formAction: (formData: FormData) => void;
  pending: boolean;
  editable: boolean;
  from: Record<string, unknown>;
  fromRow: string | null;
  /** The newest row's id, the diff's base; null with no row. */
  newestRow: string | null;
  fields: Field[];
  ranOn: Record<string, LastCall>;
  /** The box's voice lists, so a voice in the diff reads by its label. */
  offered: Offered | null;
}) {
  const blocked = state.issues.length > 0;
  const changes = state.diff.length;
  // Nothing to save is never a save: a row identical to the current one would
  // only add a line to the history.
  const canSave = editable && !blocked && changes > 0;
  // The diff's base is the newest row (ADR 0012 D7), which is what the next
  // call runs on; a form loaded from an older row says so beside it.
  const loadedFromOlder = fromRow !== null && fromRow !== newestRow;
  const why = !editable
    ? 'read-only: nothing can be saved from this console'
    : changes === 0
      ? 'nothing to save: this document is the one the pipeline runs on now'
      : 'fix the refusals above to save';

  return (
    <form action={formAction} className="flex flex-col gap-[18px]">
      <input type="hidden" name="tenant" value={state.tenant} />
      <input type="hidden" name="group" value={state.group} />
      <input type="hidden" name="from" value={JSON.stringify(from)} />
      {/* The proposed document, carried back so `save` can parse it again on the
          server — the client's copy is read, never trusted. */}
      <input type="hidden" name="document" value={JSON.stringify(state.document)} />
      {/* The form as it was left, so "Back" gives it back leaf for leaf. */}
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
          // Fixed columns, before and after equal: the two values of a line are
          // read against each other, so neither may squeeze the other.
          <Table fixed>
            <colgroup>
              <col className="w-[34%] md:w-[28%]" />
              <col className="w-[33%] md:w-[36%]" />
              <col className="w-[33%] md:w-[36%]" />
            </colgroup>
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
              {state.diff.map((entry) => {
                const shown = (value: unknown): string | null =>
                  value === undefined
                    ? null
                    : entry.path === 'tts.voice' && typeof value === 'string'
                      ? voiceName(offered, value)
                      : renderValue(value);
                const before = shown(entry.from);
                const after = shown(entry.to);
                const beforeAbsent = absentWords(entry.path, from, fields, ranOn);
                const afterAbsent = absentWords(entry.path, state.document, fields, ranOn);
                const long = [before, after].some(
                  (text) => text !== null && (text.length > LONG_VALUE || text.includes('\n')),
                );
                const full = `diff:${entry.path}`;
                return (
                  <tr key={entry.path}>
                    <Td>
                      {/* A narrow column breaks a path at its dots first. */}
                      <span className="[overflow-wrap:anywhere]">
                        {entry.path.split('.').map((part, index) => (
                          <Fragment key={`${String(index)}:${part}`}>
                            {index === 0 ? null : (
                              <>
                                .<wbr />
                              </>
                            )}
                            {part}
                          </Fragment>
                        ))}
                      </span>
                      {long ? (
                        <>
                          <button
                            type="button"
                            popoverTarget={full}
                            className="mt-1 block cursor-pointer text-[length:var(--size-eyebrow)] font-medium text-text-link hover:underline"
                          >
                            show all
                          </button>
                          <Overlay id={full} title={entry.path}>
                            <div className="grid gap-4 md:grid-cols-2">
                              {[
                                { label: 'before', text: before, absent: beforeAbsent },
                                { label: 'after', text: after, absent: afterAbsent },
                              ].map((side) => (
                                <div key={side.label} className="flex min-w-0 flex-col gap-1.5">
                                  <span className="text-[12px] font-semibold tracking-[.04em] text-text-muted">
                                    {side.label}
                                  </span>
                                  {side.text === null ? (
                                    <span className="text-[length:var(--size-ui)] text-text-muted">
                                      {side.absent}
                                    </span>
                                  ) : (
                                    <pre className="m-0 rounded-md bg-surface-page p-3 font-num text-[length:var(--size-ui)] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere]">
                                      {side.text}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          </Overlay>
                        </>
                      ) : null}
                    </Td>
                    <Td>
                      <DiffValue text={before} absent={beforeAbsent} />
                    </Td>
                    <Td>
                      <DiffValue text={after} absent={afterAbsent} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
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

      {/* The save stays on screen however long the diff is: one line with the
          note, the way back and the save. */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-border-hairline bg-surface-page py-3">
        {state.failure === null ? null : (
          <p className="mb-0 text-[length:var(--size-ui)] text-[color:var(--error)]">
            {state.failure}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {canSave ? (
            // Stored on the row as written, so the history reads as a record
            // rather than as a list of documents.
            <div className="min-w-[220px] flex-1">
              <Input
                id="note"
                name="note"
                aria-label="note"
                defaultValue={state.note}
                placeholder="note — what this change is for (optional)"
              />
            </div>
          ) : (
            <Caveat className="min-w-[220px] flex-1">{why}</Caveat>
          )}
          {/* The two buttons wrap as one, so a phone keeps them on one line. */}
          <div className="flex items-center gap-3">
            <Button type="submit" name="intent" value="edit" variant="secondary" disabled={pending}>
              Back
            </Button>
            {canSave ? (
              <Button type="submit" name="intent" value="save" disabled={pending}>
                {pending ? 'Saving…' : 'Save as a new row'}
              </Button>
            ) : null}
          </div>
        </div>
        {canSave ? <Caveat>{EFFECT}</Caveat> : null}
      </div>
    </form>
  );
}
