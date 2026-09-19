/*
 * The window control both Overview and Calls carry (ADR 0006): three preset
 * pills and a custom range, as links and a GET form.
 * The rules it enforces: the URL is the whole input, so a preset is an anchor
 * and the range is a form that navigates — no client state, nothing to rehydrate,
 * and a window pasted into chat reproduces the screen. `Custom` opens a
 * `<details>` rather than a scripted panel, so it works with JavaScript off.
 * The panel is an overlay, not a box in the flow: opening it must not move the
 * pills beside it, the search form under it, or the heading across from it.
 */

import Link from 'next/link';
import { CALL_TIME_ZONE } from '@/calls';
import { WINDOW_PRESETS, windowHref, type Window } from '@/window';
import { PILL, PILL_OFF, PILL_ON } from './chip';
import Input from './input';

/** Inert, not hidden: the operator sees the window the search is ignoring. */
const DISABLED = 'border-border-hairline bg-surface-card font-medium text-text-muted opacity-60';

// The clinic's zone, the one every screen pins (`src/calls.ts`): the fields
// name days, and a day read in the process's zone would be another day on a
// box set to UTC.
const DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The pill's own short form of a day — `12 Sep`, in the clinic's zone. */
const SHORT_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  day: 'numeric',
  month: 'short',
});

/** `YYYY-MM-DD` in the clinic's zone — what an `<input type="date">` carries. */
function dateValue(at: Date | null): string {
  if (at === null) return '';
  const parts = new Map<string, string>(
    DAY.formatToParts(at).map((part) => [part.type, part.value]),
  );
  const at2 = (type: string): string => parts.get(type) ?? '';
  return `${at2('year')}-${at2('month')}-${at2('day')}`;
}

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
  return (
    <div className="flex items-center gap-2" title={disabled ? disabledNote : undefined}>
      {WINDOW_PRESETS.map((preset) =>
        disabled ? (
          <span key={preset} className={`${PILL} ${DISABLED}`}>
            {preset}
          </span>
        ) : (
          <Link
            key={preset}
            href={windowHref(base, preset, extra)}
            aria-current={window.preset === preset ? 'true' : undefined}
            className={`${PILL} ${window.preset === preset ? PILL_ON : PILL_OFF}`}
          >
            {preset}
          </Link>
        ),
      )}

      {disabled ? (
        <span className={`${PILL} ${DISABLED}`}>Custom</span>
      ) : (
        <details className="relative">
          <summary
            className={`${PILL} ${window.preset === 'custom' ? PILL_ON : PILL_OFF} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
          >
            {customLabel(window)}
          </summary>
          <form
            method="get"
            action={base}
            className="absolute right-0 top-full z-10 mt-2 w-max rounded-md border border-border-hairline bg-surface-card p-3 shadow-[var(--shadow-overlay)] flex items-end gap-3"
          >
            {/* The screen's other keys ride along hidden, so choosing a range
                does not clear the keyword or the grouping. */}
            {Object.entries(extra).map(([key, value]) =>
              key === 'since' || key === 'until' || value === '' ? null : (
                <input key={key} type="hidden" name={key} value={value} />
              ),
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[length:var(--size-eyebrow)] text-text-muted">From</span>
              <Input type="date" name="since" defaultValue={dateValue(window.since)} />
            </label>
            <label className="flex flex-col gap-1">
              <span
                className="text-[length:var(--size-eyebrow)] text-text-muted"
                title="last day included"
              >
                To
              </span>
              <Input
                type="date"
                name="until"
                defaultValue={dateValue(window.until === null ? null : lastDay(window.until))}
              />
            </label>
            <button type="submit" className={`${PILL} ${PILL_ON} cursor-pointer`}>
              Apply
            </button>
          </form>
        </details>
      )}
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
