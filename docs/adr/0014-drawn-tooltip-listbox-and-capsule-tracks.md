# ADR 0014: A drawn tooltip and listbox, and one capsule-track chart shape — revising ADR 0011 D10 and ADR 0003 point 6

**Status:** accepted · **Date:** 2026-09-25 · **Row:** A19

## Decision

1. **Tooltips are drawn by the console, not by the browser.** `src/ui/tooltip.tsx` renders
   a trigger with a tooltip node the CSS shows on `:hover` and on `:focus-visible` of the
   trigger, with no delay. The `title=` attribute is no longer a tooltip anywhere in
   `src/app` or `src/ui`; a tree-scan test forbids it, allowing only `<abbr title>` and
   media elements. `Hint`, `Th`, `Stat`, `Field` and `Caveat`'s `title` prop switch to it.

2. **The tooltip is CSS-only and accessible by reference, not by hover.** Shape:

   ```
   <span class="tip" data-tip-side="top|bottom">
     <trigger aria-describedby={id} tabindex=0 …/>   ← the labelled thing
     <span role="tooltip" id={id} class="tip-body">…</span>
   </span>
   ```

   The tooltip node is in the DOM always, visually hidden (`opacity: 0; visibility:
   hidden; pointer-events: none`) until `.tip:hover > .tip-body, .tip:focus-within >
   .tip-body` makes it visible; the trigger keeps its own accessible name and the
   tooltip's text is its accessible description through `aria-describedby`, which screen
   readers announce whether or not the node is visible. `useId()` supplies the id, so the
   component works in a server component (no state, no effect). Escape is not handled:
   the tooltip follows focus and hover and holds no state to dismiss. Style from tokens
   only (ADR 0003): ink surface (`--surface-inverse`), cream text
   (`--text-on-inverse`), `--radius-sm`, `--shadow-overlay`, `--size-eyebrow`,
   `--font-ui`, `--duration-fast` fade. Edge behaviour: `max-width: 28rem`, `white-space:
   normal`, `overflow-wrap: anywhere`; placed above the trigger by default and below it
   when the trigger is inside the top 6 rem of the viewport — decided by the caller
   (`side="bottom"` on the first row of a table, the page head) since CSS cannot measure.
   The tooltip is `position: absolute` inside a `position: relative` trigger wrapper, so
   it is clipped by an `overflow: hidden` ancestor; the two tables that clip
   (`overflow-x-auto` wrappers) get `overflow: visible` on the axis that does not scroll,
   and a trigger in a scrolling table cell places its tooltip below.

3. **The dropdown is the Web-UI's drawn listbox, copied, as an enhancement over a native
   `<select>`.** `src/ui/listbox.tsx` is a client component copied from
   `../Fonnus-Web-UI/src/app/ui/Field.tsx` `SelectField` (`:197-407` @ 302e3e8) and
   `Field.module.css` `.popup`, `.option*` (`:195-277`), re-expressed with this repo's
   Tailwind aliases (ADR 0003, tokens only). It renders the native `<select>` of
   `src/ui/select.tsx` server-side, and after hydration hides it (`sr-only`, still in the
   form, still named, still submitted) behind a `role="combobox"` button and a portalled
   `role="listbox"` panel; choosing an option sets the hidden select's value and dispatches
   `change` on it, so every existing `onChange` and every GET form keeps working. Keyboard
   (arrows, Home, End, type-ahead, Enter, Space, Escape), the drop-up measure
   (`POPUP_GAP 6`, `POPUP_MAX 320`, `OPTION_HEIGHT 37`), `data-active` and the check mark
   are copied as they stand. ADR 0011 D10 ("native `<select>`, not the Web-UI's drawn
   listbox") is revised to: the native select is the form control, the drawn listbox is its
   face.

4. **The JS-off fallback is kept, because it costs nothing.** With scripts off the native
   select is what renders and submits; that is the same markup the enhancement starts
   from, not a second code path. It stays a stated property of the Configuration form
   (ADR 0011) and of the Overview's group-by control, and the tenant picker of
   `src/app/configuration/page.tsx` moves onto `Select` so it is covered too.

5. **Recharts is removed.** `src/app/calls/[id]/waterfall.tsx` is deleted with
   `turn-waterfall.tsx`'s chart, the `recharts` dependency leaves `package.json`, the
   allow-list block of `src/interval-lane.test.ts:227-257` becomes "no file imports
   `recharts`", and ADR 0003 point 6 is revised to: charts are hand-drawn from tokens
   (`VBars`, `HBar`); no chart library. `CONTEXT.md`'s Stack row "Charts" changes to
   "Hand-drawn (`src/ui/vbars.tsx`, `src/ui/hbar.tsx`)".

6. **`tts.voice` is a text input with suggestions, revising ADR 0012 D4.** The
   Configuration form renders `tts.voice` as a text input in every state, with a
   `<datalist>` of the vendor's voices from the newest `boot_report` row (`label` shown,
   `id` the value; empty when the row lists none or there is no row). The review-step
   refusal for an id outside the list stays (`offeredIssues`), and its sentence says why:
   the pipeline refuses the merged row and the call silently runs on boot config. One
   control for three states replaces the select / text-box / text-box split of ADR 0012,
   and an operator can paste a voice id the report has not seen yet.

7. **One capsule-track shape for every horizontal measure.** `src/ui/hbar.tsx` gains a
   `thick` variant: a 10 px, fully rounded track on `--surface-page` inside a hairline,
   the span in `tone`, a dashed `target` mark and a solid `playhead` mark, with the label
   in a fixed-width column on the left (`Term`, two lines) and the value in a
   right-aligned numeric column. The same row shape draws the Overview's two gauges
   (`pipeline_ms` / `caller_perceived_ms` P95 against target), the reply-composition bar
   ("Where the reply's time goes", four stacked spans on one track), and every row of the
   selected turn (the two headline spans, the six legs, model reasoning, the three
   end-of-turn spans) on one shared scale from the turn's first mark to `playback_end`.
   `VBars` stays the shape for counts over time and gets its value labels above the
   columns.

## Why

The team's feedback named the native `title` tooltip (a second's delay, the operating
system's look) and the native `<select>` (the same) as the two controls that made the
console feel unfinished, and the Recharts waterfall as the chart that did not read at a
glance — pushed 200 px right by its axis label column, with the playhead as a reference
line the eye loses. The forces:

- **The tooltip carries facts, not decoration.** Every caveat that "travels with its
  number" (CLAUDE.md) that does not fit beside the number lives in a tooltip: the P95
  rule, the trap-1 count, the price source. A tooltip the reader gives up on after 300 ms
  is a caveat that did not travel. No delay, and keyboard focus showing it, is the
  requirement; the look is the Web-UI's.
- **Accessibility must not regress from `title`.** `title` is announced by screen readers
  as a description; a hover-only CSS tooltip is not. `aria-describedby` to an always-present
  node restores exactly that, without JavaScript, which is why the tooltip is CSS-only
  rather than a positioned portal: no measure, no state, and it renders in server
  components where `Th`, `Stat` and `Field` live.
- **The Web-UI listbox already exists and is the house look** (ADR 0003: copy, never
  fork). Copying it wholesale, including its keyboard model, is less work and less risk
  than styling a native control, which cannot be styled across browsers anyway.
- **Enhancement over replacement** keeps ADR 0011's promise: the form the operator saves
  a runtime row with still works with scripts off, and the enhancement cannot desync from
  the form because the select *is* the form control. Replacing the select with a
  button-and-hidden-input would have to reimplement `required`, `name`, `defaultValue`
  and form reset.
- **Recharts was one chart.** ADR 0003 kept it for the waterfall; the capsule tracks are
  the waterfall's replacement, so the dependency (and the runtime colour reads it forced,
  `waterfall.tsx:17-59`) go with it. One shape for every horizontal measure means the
  Overview gauge and the selected-turn row are read the same way, which is the comparison
  the tuning loop makes.

## Rejected

- **A JavaScript tooltip (portal, `position: fixed`, measured placement).** Never
  clipped, always positioned; but it needs a client boundary around every `Th`, `Stat`
  and `Field`, state for open/close, and an Escape handler — and the reason `title` was
  wrong was delay and look, not placement. Revisit trigger below.
- **Popover API (`popover="hint"`) tooltips.** No script and top-layer placement; but
  `popover=hint` is not in every browser the team uses in 2026 and the interaction
  (`interesttarget`) is still experimental. The overlay of ADR 0011 uses `popover=auto`
  for a different job.
- **Replacing the native select outright** (the Web-UI's `SelectField` as it stands: a
  button plus a hidden `<input name>`). Fewer moving parts in the component; loses the
  JS-off path for no gain, since the native select costs one `sr-only` class.
- **Styling the native `<select>`'s options** (`appearance: base-select`, customizable
  select). The right long-term answer; shipped in one engine only as of this ADR.
- **Keeping Recharts for the selected turn and styling it.** Its axis label width, tooltip
  and colour handling were the complaints; each fix is a fight with the library over a
  chart with eleven rows.
- **A separate gauge component for the Overview.** One more shape to keep consistent;
  the thick `HBar` with a target mark is the gauge.
- **Keeping the `tts.voice` select and adding a "type an id" escape.** Two controls for
  one value, and the boot-report list is a hint about the box, not the contract's bound
  (`LEAF.tts.voice` is a string); the refusal at review is where the list belongs.

## Revisit when

- A tooltip is needed on a control inside a scrolling region where "place it below" is
  not enough (clipped on both sides): that is the JavaScript tooltip, as one component
  behind the same `Tooltip` props.
- Customizable `<select>` (`appearance: base-select`) ships in the browsers the team uses:
  the listbox copy is deleted and the native control styled.
- A chart needs more than one dimension (a scatter, a real waterfall over events): a
  library returns through a new ADR, not by reviving point 6.

## Verified facts

- WAI-ARIA APG tooltip pattern (w3.org/WAI/ARIA/apg/patterns/tooltip, read 2026-09-25):
  `role="tooltip"`, the trigger references it with `aria-describedby`, focus stays on the
  trigger, hover- and focus-triggered display are both acceptable.
- Next.js App Router `useRouter().replace(href, { scroll: boolean })`
  (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md:45`).
- The Web-UI listbox: `Field.tsx:197-407` (`measure`, `onKeyDown`, the render with
  `createPortal`), `Field.module.css:195-277` (`.popup` with `--shadow-overlay`,
  `popIn` on `--duration-base --ease-arc`, `.option*`), @ 302e3e8.
- Recharts is imported by `src/app/calls/[id]/waterfall.tsx` only; the allow-list is
  `src/interval-lane.test.ts:227-257`; `package.json` pins `recharts ^3.10.1`.
- `title=` today: `Hint` (`src/ui/caveat.tsx:45-54`), `Caveat` (`:28-36`), `Vocabulary`'s
  `Badge title` (`src/ui/vocabulary.tsx:26`), plus loose uses on the Overview (brief).
- Tokens available for the tooltip and the track: `--surface-inverse`, `--text-on-inverse`,
  `--surface-page`, `--border-hairline`, `--radius-sm`, `--radius-pill`,
  `--shadow-overlay`, `--duration-fast`, `--size-eyebrow` (`src/styles/tokens/*.css`
  @ 302e3e8).

## Assumed

- **A1.** `aria-describedby` to a `visibility: hidden` node is announced by the screen
  readers in use — the APG pattern relies on it, and the description is computed from the
  DOM, not from visibility; ASSUMED until checked once with VoiceOver or NVDA on one
  `Th`. Failing it, the node is hidden with the `sr-only` clip instead of `visibility`,
  which is a one-line CSS change.
- **A2.** Dispatching a synthetic `change` event on the hidden select reaches React's
  `onChange` handlers on it. React listens for `change`/`input` at the root and a
  `new Event('change', { bubbles: true })` after setting `.value` is the documented
  workaround; ASSUMED until `listbox.test.tsx` exercises it. Failing it, the listbox
  calls the `onChange` prop directly and forwards the event shape.
- **A3.** The `overflow: visible` change on the two clipping wrappers does not break the
  horizontal scroll they exist for (`overflow-x: auto` with `overflow-y: visible` is
  computed as `auto/auto` by the CSS spec, so the vertical axis clips too); settled by
  the builder's browser pass on `/calls/<id>` with a tooltip on the first turn-table row.
  Failing it, table-cell tooltips place below and the wrapper keeps its clip.
