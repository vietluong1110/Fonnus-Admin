# ADR 0006: One window, one search, one page — the URL contract of Overview and Calls

**Status:** accepted 2026-09-18 · **Date:** 2026-09-18

## Decision

Overview (`/`) and Calls (`/calls`) read the same window from the same URL keys, parsed by
one module (`src/window.ts`) that both screens import. Nothing about the population a
screen counts lives in component state: the URL is the whole input, so a link pasted into
chat reproduces the screen.

**The window.**

- `since=<spec>` — the pipeline's own `report-calls --since` forms (`7d`, `36h`, `90m`, an
  ISO instant). The three presets the control offers are `24h`, `7d`, `30d`; default `7d`.
  A preset window is **open-ended** — `call_log.started_at >= since` and nothing else —
  so the Overview's leg numbers equal `report-calls --since <same>` run at the same minute.
- `until=<date>` marks a **custom** window and is honoured only beside an absolute `since`
  (an ISO instant or a date). A date-only value (`YYYY-MM-DD`) on either key is a day in
  `Asia/Ho_Chi_Minh`, the zone every screen pins: `since` is that day's 00:00, `until` is
  the 00:00 of the **following** day, so "1 Sep to 10 Sep" on the control includes both
  days and the SQL stays half-open: `started_at >= since AND started_at < until`. A value
  with a time is taken literally. Refused with the screen's error line and the default
  window: `until` beside a relative `since`, `until <= since`, a span over 366 days (the
  cap ADR 0001's ten-second statement bound already imposes).
- The window is a filter on `call_log.started_at` and on nothing else; a turn belongs to
  the window through its call (a turn has no timestamp of its own — `docs/upstream.md`).

**The search (Calls only).** `q=<keyword>`, trimmed. While a keyword is present the window
is ignored and the search is over all history: the header says so ("N calls matching …,
all time"), and the window control renders disabled until the keyword is cleared. Two
predicates, ORed: the keyword's digits (everything else stripped) as a suffix of
`caller_phone_e164`, and the keyword lower-cased as a prefix of `id::text` when it is made
of hex digits and dashes. A keyword shorter than three characters after stripping matches
nothing and says so. The list, the four cards, the histogram and the chips all count the
search result. The predicates are built from sanitised input, so `%` and `_` cannot reach
the `LIKE`.

**The chips (Calls only).** `f=<token,token,…>`, tokens from the fixed vocabulary
`failed_turn · not_finalized · unconsented · hit_cap · has_recording`; unknown tokens are
dropped. Chips **intersect**: the list shows calls satisfying every active chip, and each
chip's count is "adding this chip leaves N" over the current combination; `All` is the
scope's count without chips. The cards and the histogram describe the scope (the window
or the search), not the chip intersection — the chips narrow the list, the cards say what
the population is (decided 2026-09-18: one stable population per screen, so the cards
always agree with the header count).

**The page (Calls only).** `page=<N>`, 100 calls a page, a slice of the scope in
`started_at DESC` order. "Older calls →" is `page+1` and never widens the window; it is
rendered only while older calls remain. The scope is read whole once per request and
paged in memory — the same bound the Overview already accepts for turns.

**The home route.** Overview is `/`; `/dashboard` is a permanent redirect to `/` declared
in `next.config.ts` (`redirects()`, `permanent: true`), so a bookmark and a link in an old
report keep working and no page file remains under `src/app/dashboard/`.

**The other keys**, for completeness: Overview keeps `group=<grouping>` (ADR 0009 for the
vocabulary) and gains `outside=all` (the inline "See all N →" expansion — a link, not a
client toggle); Call detail gains `turn=<idx>` (the turn selected on arrival, which the
Overview's outside-the-percentile rows and the Calls tick strip link to).

## Why

- **One population per screen.** The draft's Calls header counted 100 recent calls over
  cards counting 214 (`docs/redesign.md` §2). A shared window read by one parser makes
  the cards, the histogram, the chips and the list count one set, and makes the Overview
  and Calls agree on "the last 7 days".
- **Parity with the pipeline's own reader.** A preset without an upper bound is what
  `report-calls --since` computes, and the A2 acceptance ("the per-leg numbers equal
  `report-calls`") only holds if the window means the same thing. The upper bound exists
  for the comparison the loop is made of — this deploy's week against last week's — and
  is opt-in, so parity is the default.
- **Search ignores the window on purpose.** The operator searches for a number remembered
  from a call last month or an id pasted from the pipeline's log; a search inside the
  window would ask them to guess the window first. All-time search is the only reading
  of a keyword that cannot silently miss the call.
- **Offset paging in memory, not a cursor.** A keyset cursor on `started_at` would
  round-trip through a JavaScript `Date`, which drops the microseconds `timestamptz`
  carries, and would need `(started_at, id)` to break ties — code for a table this size
  does not need. Reading the scope whole and slicing it keeps the chip counts and the
  cards on the same rows as the list, in one query, with the `'granted'` and
  `'archived'` predicates evaluated by the two TypeScript functions that own them
  (`isConsentGranted`, `isFetchable`) instead of SQL twins that drift.

## Rejected

- **Separate `from` / `to` keys for the custom range.** Two spellings of the lower bound
  (`since` and `from`) in one app; the presets and the custom range are the same bound
  with or without a ceiling.
- **Search within the window, with a "search all history" checkbox.** Two modes for one
  box; the default mode is the one that misses calls.
- **SQL aggregates for the cards (`count(*) filter (where …)`, `percentile_disc`).**
  Cheaper per request, but the consent and bucket predicates would have to be spelled in
  SQL beside their TypeScript owners, or passed as parameters — the two tree-scan tests
  (`src/calls.test.ts`, `src/artifacts.test.ts`) exist to prevent exactly that second
  spelling. Kept as the revisit path below.
- **A client-side window control (state in React, data through `/api/*`).** Breaks the
  pasteable URL and the server-rendered posture of every screen so far.

## Revisit when

- The Calls query for a 30-day window exceeds one second on the box, or a window holds
  more than roughly twenty thousand calls: move the cards to SQL aggregates with the
  predicates' literals passed as parameters from `src/calls.ts` / `src/artifacts.ts`,
  and page by `LIMIT … OFFSET` on `call_log_started_idx`.
- A second reader needs the window (the baselines overlay in the backlog): the parser is
  the contract, not the URL string.
- Retention makes all-time search meaningless for phone numbers (trap 5): the caption
  already says a number can have aged out; nothing else changes.
