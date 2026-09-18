# ADR 0010: The call timeline — intervals derived in TypeScript by copy of contract §8

**Status:** accepted · **Date:** 2026-09-18

## Decision

The call detail's upper axis lane and the interval card under "The call" (PLAN row A1b)
are drawn from one list of **intervals** — contiguous stretches of the recording clock,
each held by the bot, the caller, silence, or a deaf recogniser — derived from the call's
`call_event` trail by the rules of `../Fonnus/docs/read-contract.md` §8. The rules this
console adds to the contract, which defines the derivation but not where it runs or how
its result reaches a screen:

1. **The derivation runs in TypeScript, in a pure module `src/intervals.ts`, as a copy of
   the pipeline's own reader** (`../Fonnus/tools/call-evidence.ts`: `trailVerdict`,
   `callIntervals` and their helpers), function by function, with the source line cited
   at each copied rule — never imported across repos (pipeline ADR 0013), never
   re-expressed in SQL. The module's tests port the pipeline's reference cases
   (`../Fonnus/test/tools/call-evidence.test.ts`, the `callIntervals` describe block) with
   the same fixture trail for call `330052e1`, so a rule that drifts from the pipeline's
   fails a test here, not a reading on screen.
2. **One statement reads the trail**, on the `console` pool, parameterised by `call_id`,
   ordered by `seq`, with no `LIMIT`: `count(*)` and `max(seq)` for the completeness
   verdict come from the array, not from a second statement. It does not share a
   transaction with `getCall` or `getTurns` (see Why).
3. **The verdict comes first.** `trailVerdict` is computed before any interval and rendered
   above the card as a state of the trail — `complete · open · truncated · gap · absent` —
   in the pipeline's words; on `absent` the lane falls back to today's turn-block drawing
   (`turnSpans`, `greetingSpan`) under a caveat, and on every other verdict the intervals
   drive the lane. A `gap` names the seq the hole starts at and says every interval after
   it is unsupported; a `gap` never hides the intervals.
4. **Intervals are placed in milliseconds on the recording clock,
   `ts − recording_started_at`, and a negative offset is kept**, not clamped: the trail's
   first record can precede the recording origin by the ~100 ms the recorder takes to
   open, and clamping would hide a fact the pipeline's reader deliberately keeps
   (`call-evidence.ts:622-624`). `recordingOffsetMs` in `src/playback.ts`, which clamps at
   0 for turn blocks, is not reused for intervals. A null `recording_started_at` places
   nothing, as for turn blocks.
5. **An `Interval` carries facts, never caller text.** The derivation returns the holder
   (a kind plus the pipeline's exact label), the energy instants and whether the feed was
   muted, the `turn_end` sources verbatim, and the *references* to recogniser text
   (which record, sensitive or not, payload present or not). Text is resolved once, on
   the server, through `showCallerData(outcome, gate)` — the one gate of ADR 0005 — when
   the card's cells are built; the lane never sees text. A `sensitive` record whose `data`
   is null is rendered as withheld when the consent outcome is not `granted`, and as
   expired otherwise (trap 10); the "segmented, returned nothing (source)" signature and
   every holder and energy fact are shown on every call, consented or not, because they
   carry no words.
6. **The lane and the card consume the same `Interval[]`.** The card is a sibling of the
   recording block under "The call", so a call whose recording is withheld, not archived
   or gone still shows its intervals as a table; the lane is drawn only where the player
   is, because it is an axis over audio.
7. **The contract is copied as written, including what it gets wrong.** The known reference
   bug `../Fonnus/ISSUES.md` L10-260917-1 (a canned line whose synthesis returned no bytes
   holds the line until the next intent, swallowing the caller's energy and `turn_end`
   under it) is reproduced here, stated as a caveat on the card, and tracked as a backlog
   row that closes when the pipeline changes §8. Fixing it here would make this console
   disagree with `call-evidence` on the same trail.

## Why

- **TypeScript, not SQL, for the derivation.** §8 is a sequence machine: a bot span opens
  at an intent and closes at the first of five events *for that generation* inside a window
  bounded by the next intent; a mute stretch is a latch toggled by two effect records; a
  caller cut is every `turn_end` strictly inside a span. Window functions can express each
  rule, but the result would be a second implementation of §8 with no reference to test
  against — the pipeline's reference is TypeScript, and the contract's change policy (§4)
  says a reader that copies the reference and pins it with the reference's own cases sees a
  rule change as a failing test. The Overview already follows the same rule for
  percentiles (`docs/upstream.md` §Overview: "computation is in TypeScript, never in SQL").
  The cost is one round trip that returns every record of the call (≈72 rows median,
  ≈1 200 for a five-minute call with `chunk_played`, pipeline ADR 0018), well inside the
  pool's 10 s statement bound.
- **No shared transaction.** `getCall` and `getTurns` already run as two independent
  statements on the pool; the only race a third statement adds — the call finalizing
  between `getCall` and the trail read — is exactly what the verdict models (`open` when
  the call has no `ended_at`, `truncated` when it has one and no `recorder/finalized`), a
  state the screen renders, never an error. A `REPEATABLE READ READ ONLY` transaction (the
  Overview's pattern) would buy a consistent snapshot at the price of pinning three
  round trips to one connection of a pool the whole process shares; the Overview needs it
  because its two statements must agree on *which* calls exist, and the detail's three
  read one call by primary key. The trail statement runs after `getCall` (it needs
  `recording_started_at` and `outcome` from it) and in parallel with `getTurns`.
- **Facts, not text, through the derivation.** The consent obligation is this reader's
  (`CONTEXT.md`, trap 4) and it is enforced by a tree-scan test that allows the literal
  `'granted'` in `src/calls.ts` alone (ADR 0005). Keeping caller text out of the interval
  values means `src/intervals.ts` cannot be the place the gate is bypassed: it has nothing
  to bypass with, and the one call to `showCallerData` sits where the card cells are
  built, in the same file and the same shape as `bubbleView` in `src/playback.ts`.
- **Verdict before intervals** because a trail that is missing its tail is not "a shorter
  call" — trap 8 — and the pipeline's requirement (`docs/console-call-view.md`) lists the
  verdict first among what must be visible. Falling back to turn blocks on `absent` keeps
  the axis useful for a call recorded with `RECORD_CALLS` off (no rows at all), where the
  intervals would be an empty lane with no explanation.
- **Not clamping a negative offset** keeps the interval list contiguous from the first
  record to `recorder/finalized`, the invariant the reference's tests hold
  (`expectContiguous`); clamping the first record to 0 while placing `recorder/finalized`
  by `ts` would leave a gap the test cannot distinguish from a real hole.

## Rejected

- **Deriving intervals in SQL** (window functions over `call_event`, one row per
  interval) — fewer bytes over the wire and the verdict as a cheap aggregate, but a second
  implementation of §8 with no reference case to test against, and every §8 change would
  be a SQL diff the pipeline's tests cannot see. The row counts do not justify it.
- **A derived or materialised interval table** — this console reads as `console`, which
  cannot write (pipeline migration 0006), and a table of the pipeline's facts owned by the
  console would drift from `call_event` the moment §8 changed. Deriving per render is
  cheap and always current.
- **Drawing the lane inside the player only, no card** — one surface less, but a call
  whose recording is withheld (consent), not yet archived, or gone (TTL) would show no
  trail at all, although `call_event` has one; and the signatures the pipeline's
  requirement wants read at a glance ("segmented, returned nothing", "partial overtaken")
  are text, which a coloured segment cannot carry.
- **Reusing `recordingOffsetMs` for interval placement** — one clock helper for the
  screen, but its clamp at 0 contradicts the reference's placement (Decision 4).
- **Fixing ISSUES L10-260917-1 in the copy** — a truer picture on that one trail shape,
  but this reader would then disagree with the pipeline's on the same call, and the
  contract's rule 3 is what both are held to until the pipeline changes it.

## Revisit when

- The pipeline publishes `callIntervals` and `trailVerdict` as a package this repo may
  depend on — then the copy goes and the tests pin the package version.
- Contract §8 changes (a §4 change notice), or L10-260917-1 lands upstream: the copy is
  updated to the new rule in the same commit that updates `docs/upstream.md`.
- Trail statement time on the box approaches the 10 s bound for a real call (it should
  not: the read is a primary-key range scan), or the row-volume revisit trigger of pipeline
  ADR 0018 fires — then a bounded read (by `seq` window) is designed.
- Row A7 puts annotations on the same axis: the card's reserved annotation column and
  `textCover` (`call-evidence.ts:940-990`) are copied then, not now.
