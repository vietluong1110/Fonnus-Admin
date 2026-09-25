'use client';

/*
 * The drawn dropdown, as a face over a native `<select>` (ADR 0014 decision 3,
 * revising ADR 0011 decision 10). Copied from `SelectField` of
 * ../Fonnus-Web-UI/src/app/ui/Field.tsx:197-407 and the `.popup` / `.option*`
 * rules of Field.module.css @ 302e3e8 — the drop-up measure, the keyboard
 * model (arrows, Home, End, type-ahead, Enter, Space, Escape, Tab), the active
 * row and the check mark as they stand — re-expressed with this repo's aliases.
 *
 * What differs from the source is where the value lives. The server renders
 * the plain `Select` with its options, and that select stays the form control:
 * after hydration it is visually hidden (`sr-only`, still named, still
 * submitted) behind a `role="combobox"` button and a portalled
 * `role="listbox"` panel. Choosing an option writes the select's value and
 * dispatches `change` on it (`commitSelect`), so a React `onChange` and a GET
 * form both keep working, and with scripts off the native select is what the
 * operator gets (ADR 0014 decision 4).
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { CONTROL } from './input';
import Select from './select';

export interface ListboxOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Consecutive options with the same group render under one `<optgroup>`. */
  group?: string;
}

const POPUP_GAP = 6;
/** Tall enough that a list of eight opens without a scrollbar (the source's reasoning). */
const POPUP_MAX = 320;
/** 35.6 of option and 1 of gap, rounded up: under-counting makes the panel scroll for nothing. */
const OPTION_HEIGHT = 37;
/** How long type-ahead keeps adding keys to one query. */
const TYPE_AHEAD_MS = 700;

/** Next selectable index in `dir`, wrapping, skipping disabled rows (the source's `step`). */
export function stepOption(
  options: readonly Pick<ListboxOption, 'disabled'>[],
  from: number,
  dir: 1 | -1,
): number {
  const n = options.length;
  if (n === 0) return from;
  for (let i = 1; i <= n; i += 1) {
    const next = (((from + dir * i) % n) + n) % n;
    if (options[next]?.disabled !== true) return next;
  }
  return from;
}

/** The first enabled option whose label starts with the typed query, or -1. */
export function typeAheadMatch(
  options: readonly Pick<ListboxOption, 'label' | 'disabled'>[],
  query: string,
): number {
  const q = query.toLowerCase();
  return options.findIndex((o) => o.disabled !== true && o.label.toLowerCase().startsWith(q));
}

/**
 * Write a value into the native select and tell its listeners, the way a
 * person choosing an option would: React listens for `change` at the root, so
 * a bubbling event after the write reaches the select's `onChange`.
 */
export function commitSelect(
  select: Pick<HTMLSelectElement, 'value' | 'dispatchEvent'>,
  value: string,
): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * The `change` listener that keeps the drawn face on the native select's
 * value, read once the change has settled rather than inside it. A controlled
 * select is put back by React at the end of the very dispatch that carries
 * the `change` (react-dom 19.2.8 `restoreStateOfTarget`, run in
 * `batchedUpdates$1`'s `finally`, cjs/react-dom-client.development.js), after
 * this listener at the target has already run — so a parent that keeps its
 * `value` would otherwise leave the face showing the option it refused.
 */
export function followSelect(
  select: Pick<HTMLSelectElement, 'value'>,
  show: (value: string) => void,
  defer: (task: () => void) => void = queueMicrotask,
): () => void {
  return () => {
    defer(() => {
      show(select.value);
    });
  };
}

/** The options as `<option>` / `<optgroup>` children, runs of one group together. */
function nativeOptions(options: readonly ListboxOption[]) {
  const runs: { group: string | undefined; options: ListboxOption[] }[] = [];
  for (const option of options) {
    const last = runs.at(-1);
    if (last !== undefined && last.group === option.group) last.options.push(option);
    else runs.push({ group: option.group, options: [option] });
  }
  return runs.map((run, index) => {
    const items = run.options.map((o) => (
      <option key={o.value} value={o.value} disabled={o.disabled}>
        {o.label}
      </option>
    ));
    return run.group === undefined ? (
      items
    ) : (
      <optgroup key={`group-${String(index)}-${run.group}`} label={run.group}>
        {items}
      </optgroup>
    );
  });
}

interface Placement {
  left: number;
  width: number;
  top?: number | undefined;
  bottom?: number | undefined;
  maxHeight: number;
}

export default function Listbox({
  options,
  className,
  id,
  disabled,
  'aria-label': ariaLabel,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { options: readonly ListboxOption[] }) {
  const autoId = useId();
  const buttonId = id ?? `${autoId}-combobox`;
  const listId = `${autoId}-list`;
  const selectRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ query: '', at: 0 });

  // Null until hydrated: the server HTML (and a JS-off page) is the plain select.
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Placement | null>(null);

  // The select is the source of truth; follow it, whoever changed it (this
  // face, a controlled `value`, a form reset), once the change has settled
  // (`followSelect`).
  useEffect(() => {
    const select = selectRef.current;
    if (select === null) return;
    const sync = (): void => {
      setCurrent(select.value);
    };
    sync();
    const onChange = followSelect(select, setCurrent);
    select.addEventListener('change', onChange);
    const form = select.form;
    const onReset = (): void => {
      window.setTimeout(sync, 0);
    };
    form?.addEventListener('reset', onReset);
    return () => {
      select.removeEventListener('change', onChange);
      form?.removeEventListener('reset', onReset);
    };
  }, []);
  useEffect(() => {
    if (rest.value !== undefined && selectRef.current !== null) setCurrent(selectRef.current.value);
  }, [rest.value]);

  const selectedIndex = options.findIndex((o) => o.value === current);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - POPUP_GAP - 8;
    const above = r.top - POPUP_GAP - 8;
    const wanted = Math.min(POPUP_MAX, options.length * OPTION_HEIGHT + 10);
    const dropUp = below < wanted && above > below;
    setPlace({
      left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
      width: r.width,
      top: dropUp ? undefined : r.bottom + POPUP_GAP,
      bottom: dropUp ? window.innerHeight - r.top + POPUP_GAP : undefined,
      maxHeight: Math.max(120, Math.min(POPUP_MAX, dropUp ? above : below)),
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) === true || listRef.current?.contains(t) === true) return;
      setOpen(false);
    };
    // Any ancestor scrolling would leave the fixed panel behind, so close rather than chase it.
    const onScroll = (e: Event): void => {
      if (listRef.current !== null && e.target instanceof Node && listRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const commit = (index: number): void => {
    const option = options[index];
    if (option === undefined || option.disabled === true || selectRef.current === null) return;
    if (option.value !== selectRef.current.value) commitSelect(selectRef.current, option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled === true) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setActive(Math.max(selectedIndex, 0));
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => stepOption(options, i, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => stepOption(options, i, -1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(stepOption(options, -1, 1));
        break;
      case 'End':
        e.preventDefault();
        setActive(stepOption(options, 0, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(active);
        break;
      default: {
        if (e.key.length !== 1) return;
        const now = Date.now();
        typed.current.query = now - typed.current.at > TYPE_AHEAD_MS ? e.key : typed.current.query + e.key;
        typed.current.at = now;
        const hit = typeAheadMatch(options, typed.current.query);
        if (hit >= 0) setActive(hit);
      }
    }
  };

  const hydrated = current !== null;

  return (
    <span className="relative block min-w-0">
      <Select
        {...rest}
        ref={selectRef}
        // Hydrated, the button carries the id (a `<label for>` lands on it) and
        // the select leaves the tab order; it stays named and submitted.
        id={hydrated ? undefined : id}
        disabled={disabled}
        aria-label={ariaLabel}
        className={hydrated ? 'sr-only' : className}
        tabIndex={hydrated ? -1 : rest.tabIndex}
        aria-hidden={hydrated ? true : undefined}
      >
        {nativeOptions(options)}
      </Select>
      {!hydrated ? null : (
        <button
          ref={triggerRef}
          id={buttonId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={ariaLabel}
          disabled={disabled}
          className={`${CONTROL} flex cursor-pointer items-center gap-2 text-left disabled:cursor-not-allowed disabled:text-text-muted${
            open ? ' shadow-[inset_0_0_0_1.5px_var(--focus-ring),0_0_0_3px_rgba(184,92,43,0.13)]' : ''
          }${className === undefined ? '' : ` ${className}`}`}
          onClick={() => {
            setActive(Math.max(selectedIndex, 0));
            setOpen((o) => !o);
          }}
          onKeyDown={onKeyDown}
        >
          <span className={`min-w-0 flex-1 truncate${selected === undefined ? ' text-text-muted' : ''}`}>
            {selected?.label ?? '—'}
          </span>
          <span
            className={`inline-flex flex-none transition-transform duration-[var(--duration-base)] ease-[var(--ease-arc)]${
              open ? ' rotate-180 text-text-accent' : ' text-text-muted'
            }`}
            aria-hidden
          >
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 1.5 6 6.5l5-5" />
            </svg>
          </span>
        </button>
      )}
      {open && place !== null
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              className="listbox-popup"
              style={{
                left: place.left,
                top: place.top,
                bottom: place.bottom,
                minWidth: place.width,
                maxHeight: place.maxHeight,
              }}
            >
              {options.map((o, i) => {
                const on = o.value === current;
                const heading =
                  o.group !== undefined && options[i - 1]?.group !== o.group ? o.group : null;
                return (
                  <Fragment key={o.value}>
                    {heading === null ? null : (
                      <div
                        role="presentation"
                        className="px-2.5 pt-2 pb-1 text-[length:var(--size-eyebrow)] font-semibold text-text-muted"
                      >
                        {heading}
                      </div>
                    )}
                    <div
                      role="option"
                      aria-selected={on}
                      aria-disabled={o.disabled === true ? true : undefined}
                      data-active={i === active}
                      className={`listbox-option${i === active ? ' listbox-option-active' : ''}${
                        on ? ' listbox-option-on' : ''
                      }${o.disabled === true ? ' listbox-option-disabled' : ''}`}
                      onPointerEnter={() => {
                        if (o.disabled !== true) setActive(i);
                      }}
                      onClick={() => {
                        commit(i);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      <span className="inline-flex w-[15px] flex-none text-text-accent" aria-hidden>
                        {on ? (
                          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 8.5 6.5 12 13 4.5" />
                          </svg>
                        ) : null}
                      </span>
                    </div>
                  </Fragment>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
