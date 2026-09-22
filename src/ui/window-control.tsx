'use client';

/*
 * The window control both Overview and Calls carry (ADR 0006): three preset
 * pills and a custom range.
 * The rules it enforces: the URL is the whole input, so a preset is an anchor
 * and the range navigates to a URL — nothing survives a reload that the address
 * does not spell, and a window pasted into chat reproduces the screen.
 *
 * `Custom` opens a panel the operator is filling IN, so the pill lights while
 * the panel is open, and the preset pill of the window on screen goes dark —
 * one pill lit, the one being chosen. Choosing a preset, pressing Escape or
 * clicking anywhere else closes the panel; a half-typed range is dropped, not
 * left open to swallow the next keystroke.
 *
 * The fields are `dd / mm / yyyy`, typed or picked from the calendar, whatever
 * the browser's locale — a native date input prints its own order and cannot
 * be told otherwise. They open filled: a custom window shows its own days, and
 * any other opens on the current month with the first day blank and today as
 * the last, so the usual range is one or two digits away.
 *
 * The panel is an overlay, not a box in the flow: opening it must not move the
 * pills beside it, the search form under it, or the heading across from it.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { CALL_TIME_ZONE } from '@/calls';
import { WINDOW_PRESETS, dayParts, partsIso, windowHref, type DayParts, type Window } from '@/window';
import { PILL, PILL_OFF, PILL_ON } from './chip';
import { CONTROL } from './input';

/** Inert, not hidden: the operator sees the window the search is ignoring. */
const DISABLED = 'border-border-hairline bg-surface-card font-medium text-text-muted opacity-60';

/** The pill's own short form of a day — `12 Sep`, in the clinic's zone. */
const SHORT_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  day: 'numeric',
  month: 'short',
});

/**
 * What the Custom pill says. The panel is closed on load, so the range has to
 * read off the pill itself; an open-ended custom window (a `since` the operator
 * typed with no `until`) says so rather than inventing a last day.
 */
function customLabel(window: Window): string {
  if (window.preset !== 'custom') return 'Custom';
  const since = SHORT_DAY.format(window.since);
  if (window.until === null) return `since ${since}`;
  return `${since} – ${SHORT_DAY.format(lastDay(window.until))}`;
}

/** What the fields open with — see the header for the rule. */
function initialRange(window: Window, now: Date): { from: DayParts; to: DayParts } {
  const today = dayParts(now);
  if (window.preset === 'custom') {
    return {
      from: dayParts(window.since),
      to: window.until === null ? today : dayParts(lastDay(window.until)),
    };
  }
  return { from: { ...today, day: '' }, to: today };
}

export default function WindowControl({
  base,
  window,
  extra = {},
  disabled = false,
  disabledNote,
}: {
  /** The route the pills point at, e.g. `/` or `/calls`. */
  base: string;
  window: Window;
  /** The screen's other query keys, re-emitted so a window switch keeps them. */
  extra?: Record<string, string>;
  disabled?: boolean;
  disabledNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Anywhere outside the control closes the panel; so does Escape, wherever
  // the focus is.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (disabled) {
    return (
      <div className="flex items-center gap-2" title={disabledNote}>
        {WINDOW_PRESETS.map((preset) => (
          <span key={preset} className={`${PILL} ${DISABLED}`}>
            {preset}
          </span>
        ))}
        <span className={`${PILL} ${DISABLED}`}>Custom</span>
      </div>
    );
  }

  return (
    <div ref={root} className="relative flex items-center gap-2">
      {WINDOW_PRESETS.map((preset) => {
        const on = !open && window.preset === preset;
        return (
          <Link
            key={preset}
            href={windowHref(base, preset, extra)}
            onClick={() => { setOpen(false); }}
            aria-current={window.preset === preset ? 'true' : undefined}
            className={`${PILL} ${on ? PILL_ON : PILL_OFF}`}
          >
            {preset}
          </Link>
        );
      })}

      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-current={window.preset === 'custom' ? 'true' : undefined}
        onClick={() => { setOpen((was) => !was); }}
        className={`${PILL} ${open || window.preset === 'custom' ? PILL_ON : PILL_OFF} cursor-pointer`}
      >
        {customLabel(window)}
      </button>

      {/* Mounted only while open, so every opening starts from the rule in
          the header rather than from what was typed and abandoned last time. */}
      {open ? (
        <RangePanel base={base} window={window} extra={extra} onDone={() => { setOpen(false); }} />
      ) : null}
    </div>
  );
}

function RangePanel({
  base,
  window,
  extra,
  onDone,
}: {
  base: string;
  window: Window;
  extra: Record<string, string>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [range, setRange] = useState(() => initialRange(window, new Date()));
  const since = partsIso(range.from);
  const until = partsIso(range.to);
  const reversed = since !== null && until !== null && since > until;
  const ready = since !== null && until !== null && !reversed;

  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!ready) return;
    // The screen's other keys ride along, so choosing a range does not clear
    // the keyword or the grouping.
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(extra)) {
      if (value !== '' && key !== 'since' && key !== 'until') search.set(key, value);
    }
    search.set('since', since);
    search.set('until', until);
    onDone();
    router.push(`${base}?${search.toString()}`);
  };

  return (
    <form
      role="dialog"
      aria-label="Custom range"
      onSubmit={submit}
      className="absolute top-full right-0 z-10 mt-2 flex w-max flex-col gap-2 rounded-md border border-border-hairline bg-surface-card p-3 shadow-[var(--shadow-overlay)]"
    >
      <div className="flex items-end gap-3">
        <DayField
          label="From"
          value={range.from}
          onChange={(from) => { setRange((was) => ({ ...was, from })); }}
          autoFocusBlank
        />
        {/* "To" is the last day included; the tooltip keeps that fact out of
            the panel's width (`src/window-control.test.ts`). */}
        <DayField
          label="To"
          title="last day included"
          value={range.to}
          onChange={(to) => { setRange((was) => ({ ...was, to })); }}
        />
        <button
          type="submit"
          disabled={!ready}
          className={`${PILL} ${PILL_ON} cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`}
        >
          Apply
        </button>
      </div>
      {reversed ? (
        <p role="alert" className="mb-0 text-[length:var(--size-eyebrow)] text-error">
          From is after To.
        </p>
      ) : null}
    </form>
  );
}

/** The three parts in field order, with the width each one takes. */
const SEGMENTS = [
  { key: 'day', size: 2, placeholder: 'dd', width: 'w-[2.2ch]' },
  { key: 'month', size: 2, placeholder: 'mm', width: 'w-[2.2ch]' },
  { key: 'year', size: 4, placeholder: 'yyyy', width: 'w-[4.4ch]' },
] as const;

/**
 * One day as `dd / mm / yyyy`: three digit fields that advance on their own
 * once full and step back on Backspace from an empty one, plus a calendar
 * button that opens the browser's own picker and writes its choice back.
 */
function DayField({
  label,
  title,
  value,
  onChange,
  autoFocusBlank = false,
}: {
  label: string;
  title?: string;
  value: DayParts;
  onChange: (next: DayParts) => void;
  /** Focus the first blank part on mount — the one the operator came to fill. */
  autoFocusBlank?: boolean;
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocusBlank) return;
    const blank = SEGMENTS.findIndex((segment) => value[segment.key] === '');
    inputs.current[blank === -1 ? 0 : blank]?.focus();
    // Once, on opening — not every time a part empties while being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const type = (index: number, raw: string): void => {
    const segment = SEGMENTS[index];
    if (segment === undefined) return;
    const digits = raw.replace(/\D/g, '').slice(0, segment.size);
    onChange({ ...value, [segment.key]: digits });
    if (digits.length === segment.size) inputs.current[index + 1]?.select();
  };

  const back = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    const segment = SEGMENTS[index];
    if (event.key === 'Backspace' && segment !== undefined && value[segment.key] === '') {
      inputs.current[index - 1]?.focus();
    }
  };

  const iso = partsIso(value);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[length:var(--size-eyebrow)] text-text-muted" title={title}>
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className={`${CONTROL} relative flex items-center gap-0.5 py-[9px] pr-2 font-num tabular-nums`}
      >
        {SEGMENTS.map((segment, index) => (
          <span key={segment.key} className="flex items-center gap-0.5">
            {index === 0 ? null : <span className="text-text-muted">/</span>}
            <input
              ref={(element) => {
                inputs.current[index] = element;
              }}
              aria-label={`${label} ${segment.key}`}
              inputMode="numeric"
              autoComplete="off"
              maxLength={segment.size}
              placeholder={segment.placeholder}
              value={value[segment.key]}
              onChange={(event) => { type(index, event.target.value); }}
              onKeyDown={(event) => { back(index, event); }}
              onFocus={(event) => { event.target.select(); }}
              className={`${segment.width} bg-transparent text-center outline-none placeholder:text-text-muted`}
            />
          </span>
        ))}
        <button
          type="button"
          aria-label={`${label}: pick from a calendar`}
          onClick={() => picker.current?.showPicker()}
          className="ml-1.5 cursor-pointer rounded-xs p-0.5 text-text-muted hover:text-text-body"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
        </button>
        {/* The browser's picker, never seen: it only lends its calendar. */}
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={iso ?? ''}
          onChange={(event) => {
            const [year = '', month = '', day = ''] = event.target.value.split('-');
            if (year !== '') onChange({ day, month, year });
          }}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
      </div>
    </div>
  );
}

/**
 * The last day the range includes. `parseWindow` turned "to 10 Sep" into 00:00
 * of the 11th so the SQL stays half-open (ADR 0006); the field must show the
 * 10th again, or every visit to the form would move the range on by a day. One
 * millisecond back lands inside the last included day whether the bound is a
 * zone midnight or an instant the operator spelled with a time.
 */
function lastDay(until: Date): Date {
  return new Date(until.getTime() - 1);
}
