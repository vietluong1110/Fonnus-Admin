'use client';

/*
 * The group-by control of "Configurations compared": the drawn listbox over a
 * native select (ADR 0014), which on change replaces the URL's `group` and lets
 * the server render the screen again — no Show button, no full page load, and
 * the scroll position kept (`scroll: false`). The URL is still the whole input
 * (ADR 0006): the new address is the old one with `group` set.
 *
 * With scripts off the listbox is the native select inside a GET form, and the
 * `<noscript>` button submits it with the window's keys (ADR 0014 decision 4:
 * the fallback is the same markup, not a second path). With scripts on there
 * is no button and the form is never submitted.
 */

import { useRouter } from 'next/navigation';
import type { Grouping } from '@/dashboard';
import Listbox from '@/ui/listbox';
import { groupHref, groupOptions } from './overview';

export default function GroupControl({
  grouping,
  hidden,
}: {
  grouping: Grouping;
  /** The window keys, re-emitted by the scripts-off submit (ADR 0006). */
  hidden: Record<string, string>;
}) {
  const router = useRouter();
  return (
    <form method="get" action="/" className="flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([key, value]) =>
        value === '' ? null : <input key={key} type="hidden" name={key} value={value} />,
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[length:var(--size-eyebrow)] text-text-muted">group by</span>
        <Listbox
          name="group"
          defaultValue={grouping}
          options={groupOptions(grouping)}
          className="w-64"
          onChange={(event) => {
            router.replace(groupHref(window.location.href, event.target.value), {
              scroll: false,
            });
          }}
        />
      </label>
      <noscript>
        <button
          type="submit"
          className="rounded-pill border border-border-hairline bg-surface-card px-[14px] py-2 font-ui text-[length:var(--size-ui)] font-medium text-text-muted hover:bg-[var(--action-secondary-hover)]"
        >
          Show
        </button>
      </noscript>
    </form>
  );
}
