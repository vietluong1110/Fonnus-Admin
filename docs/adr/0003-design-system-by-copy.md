# ADR 0003: The design system is inherited from Fonnus-Web-UI by copy

**Status:** accepted · **Date:** 2026-09-07

## Decision

The console takes its look from the product's design system, which lives in the sibling
repository `../Fonnus-Web-UI` (the marketing site and the clinic app). That repository
publishes no package; the only way to consume it is to copy files, and this ADR fixes how.

1. **Tokens are copied verbatim.** `src/styles/tokens/{colors,typography,spacing,shape,
   motion,base}.css` are byte copies of `../Fonnus-Web-UI/src/styles/tokens/`, each with one
   header comment naming the source commit. The `src/` copy over there is the source of
   truth — its `design-reference/_ds/` export is stale (it lacks `--icon-accent`). Code here
   uses the alias layer (`--surface-card`, `--text-muted`, `--border-hairline`,
   `--chart-1/2/3`, …), never the base hex names. A token change is re-copied, never edited
   here.
2. **Fonts load through `next/font/google`**, not the CSS `@import` the Web-UI uses: Baloo 2
   (display), Be Vietnam Pro (UI), IBM Plex Sans (numbers), with the `vietnamese` and `latin`
   subsets — the Vietnamese subset is why those faces were chosen; without it every accented
   glyph falls back. The three are assigned to `--font-display / --font-ui / --font-num`, the
   names the copied typography tokens expect.
3. **Tailwind v4 stays** (ADR 0001) — the deliberate deviation from the Web-UI's "no
   Tailwind, one CSS Module per component" rule. `globals.css` maps the copied variables into
   Tailwind's theme with `@theme inline` so utility classes resolve to the guide's tokens.
   Cost accepted: a component is not copy-pasteable between the repos; what is shared is the
   token layer and the geometry, not the markup.
4. **Real `<table>` elements** for the numeric lists, styled to the guide's header/row
   values (12 px / 600 / `.04em` header, 13.5 px rows, hairline dividers, numbers in
   `--font-num` with tabular figures, right-aligned). The Web-UI draws its lists as CSS Grid
   rows because they expand for editing; nothing here is edited, and a screen reader gets
   row/column semantics for free.
5. **The shell geometry is the Web-UI's `AppShell`**: a 216 px sidebar on the card surface
   (lockup, nav, active item in terracotta with cream text), a content column of
   `max-width: 1180px` on the page surface, icon-rail collapse at ≤ 900 px. The phone-width
   bottom tab bar is not copied — one operator on a laptop.
6. **Recharts stays** for charts (ADR 0001); the Web-UI has none. Chart series read
   `--chart-1/2/3` at runtime; no hex is written in a component.
7. **Icons** are the Web-UI's own inline-SVG glyphs (`visual-language.md`: one terracotta
   accent per glyph, no stock set); only the glyphs a screen uses are copied.

The UI language stays English (`CONTEXT.md` §Language). Casing and caveat placement follow
the guide: sentence case everywhere, a caveat once beside the number it qualifies (in the
column header for a column, not on every row).

## Why

- The console is the seed of the clinic-facing call history (pipeline ADR 0013); it should
  look like the product from the first screen, not be restyled at the handover.
- Copying is the only mechanism that exists today, and the tokens are the part that changes
  least; the components would have cost a rewrite of the two shipped screens for a
  convention the console does not otherwise need.

## Rejected

- **Full adoption (drop Tailwind, CSS Modules per component, copy the kit)** — one
  convention across the repos, but a builder round spent restyling A1 before A2 could
  start; chosen against by the user on 2026-09-07 for this milestone.
- **Tokens only, no shell** — cheapest, but every later screen would sit in a header-only
  frame that the guide does not have, and the dashboard would be built on it twice.

## Revisit when

- Fonnus-Web-UI publishes a package (tokens or components) — switch from copy to import.
- A component needs to move between the repos — the Tailwind/CSS-Modules split is then a
  cost with a number on it; reopen point 3.
- The clinic-facing UI starts (`../Fonnus` W5-A) and the phone layout is needed — copy the
  bottom tab bar then.
