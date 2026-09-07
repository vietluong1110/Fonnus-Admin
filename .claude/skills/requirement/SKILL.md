---
name: requirement
description: Requirement + problem-framing interview for Fonnus-Admin — challenge the need, then land either a screen brief or a posture problem brief BEFORE any design or code. Run from the pm persona at the start of any L task, or when the user says "spec this" / "new screen" / "new view".
---

# Requirement — the front of every L task

A repeatable interview that lands the non-technical truth of a task before anything
technical. Two shapes; pick by what the work changes. NO solution detail here — that is
the architect's dispatch, after ⏸①.

## Existing docs — import, don't re-derive

`CONTEXT.md` already settles who the user is (one operator), what the console shows
(§What the console shows), why it exists (§Why now — the hypothesis loop), the traps every
screen renders, and the posture. `docs/upstream.md` settles what each existing screen
reads. `../Fonnus/docs/read-contract.md` settles what may be read at all. Read the relevant
section, restate what it settles, and interview only the genuinely open points.

## Shape A — screen-shaped (a screen, a view, a grouping, a filter the operator reads)

1. **Challenge the need.** Which reading of the pipeline does this enable — what hypothesis
   would the operator form or verify on it that they cannot today? How often, on which
   calls? What breaks if we build nothing — do they ssh to the box, run a pipeline tool,
   or simply not know? "Don't build it" is a valid verdict, recorded so it isn't
   re-litigated.
2. **Who reads it and when.** The operator mid-tuning (fast, comparative, many calls) vs
   reviewing one call in depth (slow, verbatim). Later a clinic — does this screen survive
   a tenant filter or need a rethink?
3. **What it shows, in words + data per element.** Each number, text or bar on the screen:
   the contract column, record or computed value behind it; whether it exists in the
   contract today, is coming (`PLAN.md` §Waiting on `../Fonnus`, with the row), or is not
   recorded at all (then the ask goes to the pipeline repo first, and this screen waits);
   the trap it carries and how the screen renders it. This table becomes the builder's
   contract sketch — an incomplete table forces a smaller first slice.
4. **Direction.** 2–3 GENUINELY different screen-level directions with trade-offs (one
   dense screen vs two; a table vs a chart; compute here vs import the pipeline's
   baseline files), recommend one, the user picks. Record chosen + rejected + why each
   lost.

Write it down as decisions land, never batched to the end: the screen brief lives in the
⏸① summary and, when the design lands, in `CONTEXT.md` §What the console shows and
`docs/upstream.md`. New vocabulary that is the console's own → grill → it is named before
anything in code is; pipeline vocabulary is never renamed.

## Shape B — posture-shaped (deployment, auth, a dependency, how the box is exposed)

1. **Challenge the need.** What is measurably wrong or blocked? Who cannot do what today?
2. **Constraint.** Which `CONTEXT.md` §Security posture line or pipeline ADR (0013, 0017)
   binds it; what must not widen (listeners on the box, secrets held, write paths).
3. **Directions.** 2–3 genuinely different approaches at the level of mechanism, with
   trade-offs and a recommendation; the user picks the ones worth designing.

Output: a problem brief (problem · constraint · directions to pursue) — it lives in the ⏸①
summary and seeds the architect MODE design dispatch verbatim.

## Exit = ⏸①

Present the summary — settled / open / size estimate — and wait for the user's go-ahead
before any architect dispatch.
