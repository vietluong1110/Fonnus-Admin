---
name: requirement
description: Requirement + problem-framing interview for Fonnus-Admin — challenge the need, then land either a screen brief or a posture problem brief BEFORE any design or code. Run from the pm persona at the start of any L task, or when the user says "spec this" / "new screen" / "new view".
---

# Requirement — the front of every L task

Settle what the task is for before anything technical. No solution detail here; that is
the architect's job, after ⏸①.

**Start from what is written.** `CONTEXT.md` already settles who the user is (one
operator), why the console exists (§Why now), what it shows, the traps and the posture.
`docs/upstream.md` settles what each screen reads; the read contract settles what can be
read at all. Restate what they settle and interview only what is open.

Pick the shape by what the task changes.

## Shape A — a screen, view, grouping or filter the operator reads

1. **Challenge the need.** Which hypothesis about the pipeline would the operator form or
   check here that they cannot today? How often, on which calls? What happens if we build
   nothing — ssh to the box, run a pipeline tool, or simply not know? "Don't build it" is
   a valid verdict; record it so it is not reopened.
2. **Who reads it, and when.** Mid-tuning (fast, comparative, many calls) or reviewing one
   call in depth (slow, verbatim)? Would it survive a per-clinic filter later?
3. **Every element, with its data.** For each number, text or bar: the contract column,
   record or computed value behind it; whether it exists today, is coming (a `PLAN.md`
   §Waiting on `../Fonnus` row), or is not recorded at all (the ask goes to the pipeline
   first and this screen waits); the trap it carries and how the screen shows it. This
   table becomes the builder's contract sketch. Gaps in it mean a smaller first slice.
4. **Direction.** Two or three genuinely different screen-level options (one dense screen
   or two; a table or a chart; compute here or reuse the pipeline's baselines), with
   trade-offs and a recommendation. The user picks. Record the choice and why the others
   lost.

Write decisions down as they land. The brief lives in the ⏸① summary and, once designed,
in `CONTEXT.md` §What the console shows and `docs/upstream.md`. A term that is the
console's own is agreed before anything in code is named; pipeline terms are never
renamed.

## Shape B — deployment, auth, a dependency, how the box is exposed

1. **Challenge the need.** What is measurably wrong or blocked, and for whom?
2. **Constraint.** Which `CONTEXT.md` §Security posture line or pipeline ADR (0013, 0017)
   binds it, and what must not widen: listeners, secrets held, write paths.
3. **Directions.** Two or three genuinely different mechanisms, with trade-offs and a
   recommendation. The user picks which to design.

The output is a problem brief — problem, constraint, directions to pursue — which seeds
the architect's design dispatch verbatim.

## Exit: ⏸①

Present what is settled, what is open, and the size. Wait for the user's go-ahead before
any architect dispatch.
