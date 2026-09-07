# ADR 0001: Stack — Next.js, hand-written SQL over `pg`, Recharts

**Status:** accepted · **Date:** 2026-09-06

## Decision

- **Next.js** (App Router, TypeScript) — pages and the handful of JSON routes the charts
  fetch, one process, one container.
- **`pg`** with hand-written SQL, every query written against
  `../Fonnus/docs/read-contract.md` and nothing else. No ORM and no copy of the pipeline's
  Drizzle schema: the contract is the boundary ADR 0013 defines, and a schema copy would
  drift from it silently. The pool carries the same four bounds as the pipeline's
  (`../Fonnus/app/src/persistence/db.ts`) so a stuck query cannot hold the `console` role's
  connections open. The connection is the `console` role only (ADR 0017); the app has no
  write path to lose.
- **Recharts** for the waterfall and the percentile trends — declarative, React-native,
  enough for bars and lines; nothing here needs a canvas.
- **Tailwind CSS v4** for styling — it is what `create-next-app` sets up, so the scaffold
  carries no styling decision of its own, and the tables, badges and caveat lines every
  screen repeats are written once as utility classes rather than as a growing stylesheet.
- Toolchain mirrors the pipeline so a session that knows one repo knows both: pnpm 11,
  Node 22, `tsconfig` strict flags (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`), ESLint flat config with
  `strictTypeChecked`, vitest for the pure functions (leg spans, percentiles, the consent
  gate).
  One deliberate gap in the mirror: ESLint stays on 9.x here while the pipeline is on 10.x,
  because `eslint-config-next` (the React, hooks and Next.js rules every screen leans on)
  pulls `eslint-plugin-react`, which crashes on ESLint 10. Raise the pin when that plugin
  catches up; the lint rules a UI codebase needs are worth one major of parity. The three
  core rules ESLint 10 added to `recommended` are switched on by hand in the meantime, so
  the rule set itself is equal.

## Why

- One operator, one box, read-only data: the cost of a framework is paid back the first
  time a page needs server-side data and a chart on the same route, and Next.js is the one
  the user chose knowing the alternatives.
- Hand SQL keeps every column this app depends on visible in `grep` — the drift gate the
  pipeline's backlog names ("read-contract drift gate") can then be run from either side.
- Pure functions copied from the pipeline (`legSpans`, nearest-rank percentiles) rather
  than imported: the repos share no package, and an import across `../` would couple
  release cadence. The copy is pinned by a test against the leg names the pipeline's
  `PIPELINE_ARCHITECTURE.md` §6 publishes.

## Rejected

- **No framework (a Node server + static HTML + a chart library by hand)** — smaller image,
  but every screen would rebuild routing, data fetching and hydration that Next.js ships;
  hand-drawn waterfalls cost more than the framework saves.
- **SvelteKit** — lighter runtime, but the user does not want a second component model
  across the two repos' futures (the clinic-facing UI seeds from this one).
- **Importing the pipeline's Drizzle schema** — see Decision; the contract, not the schema,
  is what this repo may rely on.
- **Plain CSS instead of Tailwind** — two fewer dependencies and no build step for styles,
  but every table, badge and caveat line would be styled by hand, and the template would
  have to be un-wired from Tailwind before the first screen exists.
- **Grafana over Postgres** — dashboards in minutes, but no call-detail page, no consent
  gate in the reader (trap 4 would be a per-panel SQL discipline nobody checks), and a
  third container on the phone box.

## Revisit when

- The clinic-facing UI starts (`../Fonnus` W5-A): tenant scoping and real login may want a
  different auth layer than a Next.js middleware, and that is decided then.
- A screen needs the artifact bucket (A4): the S3 client is added then, not now.
