/*
 * The window control both Overview and Calls carry (ADR 0006): three preset
 * pills and a custom range, as links and a GET form.
 * The rules it enforces: the URL is the whole input, so a preset is an anchor
 * and the range is a form that navigates — no client state, nothing to rehydrate,
 * and a window pasted into chat reproduces the screen. `Custom` opens a
 * `<details>` rather than a scripted panel, so it works with JavaScript off.
 */

import Link from 'next/link';
import { CALL_TIME_ZONE } from '@/calls';
import { WINDOW_PRESETS, windowHref, type Window } from '@/window';
import Caveat from './caveat';

const PILL =
  'inline-flex items-center rounded-pill border px-[14px] py-[7px] font-ui text-[length:var(--size-ui)] leading-[1.4] whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

const OFF =
  'border-border-hairline bg-surface-card font-medium text-text-muted hover:bg-[var(--action-secondary-hover)] hover:text-text-body';

const ON = 'border-transparent bg-action-primary font-semibold text-text-on-accent';

/** Inert, not hidden: the operator sees the window the search is ignoring. */
const DISABLED = 'border-border-hairline bg-surface-card font-medium text-text-muted opacity-60';

const FIELD =
  'rounded-sm border border-border-hairline bg-surface-card px-3 py-2 font-num text-[length:var(--size-ui)]';

// The clinic's zone, the one every screen pins (`src/calls.ts`): the fields
// name days, and a day read in the process's zone would be another day on a
// box set to UTC.
const DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
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
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2" title={disabled ? disabledNote : undefined}>
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
              className={`${PILL} ${window.preset === preset ? ON : OFF}`}
            >
              {preset}
            </Link>
          ),
        )}

        {disabled ? (
          <span className={`${PILL} ${DISABLED}`}>Custom</span>
        ) : (
          <details className="relative" open={window.preset === 'custom'}>
            <summary
              className={`${PILL} ${window.preset === 'custom' ? ON : OFF} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              Custom
            </summary>
            <form
              method="get"
              action={base}
              className="mt-2 flex flex-wrap items-end gap-3 rounded-md border border-border-hairline bg-surface-card p-3"
            >
              {/* The screen's other keys ride along hidden, so choosing a range
                  does not clear the keyword or the grouping. */}
              {Object.entries(extra).map(([key, value]) =>
                key === 'since' || key === 'until' || value === '' ? null : (
                  <input key={key} type="hidden" name={key} value={value} />
                ),
              )}
              <label className="flex flex-col gap-1">
                <span className="text-[length:var(--size-eyebrow)] text-text-muted">from</span>
                <input
                  type="date"
                  name="since"
                  defaultValue={dateValue(window.since)}
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[length:var(--size-eyebrow)] text-text-muted">
                  to (included)
                </span>
                <input
                  type="date"
                  name="until"
                  defaultValue={dateValue(window.until === null ? null : lastDay(window.until))}
                  className={FIELD}
                />
              </label>
              <button
                type="submit"
                className={`${PILL} ${ON} cursor-pointer`}
              >
                Apply
              </button>
              <Caveat>
                both days included; the range is read in {CALL_TIME_ZONE}
              </Caveat>
            </form>
          </details>
        )}
      </div>

      {disabled && disabledNote !== undefined ? <Caveat>{disabledNote}</Caveat> : null}
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
