# ADR 0008: The caller's number is masked everywhere but one card

**Status:** accepted 2026-09-18 · **Date:** 2026-09-18

## Decision

`call_log.caller_phone_e164` renders as **`+84 90 ••• 4417`** — the country code, the first
two national digits, three bullets, the last four digits — on the Calls list, in the call
detail head and in the document title. The full value renders in exactly one place: the
Call card inside the call detail's collapsed "Pipeline detail" block, where the operator
opens it on purpose.

The rule is the pure function `maskPhone(value)` in `src/calls.ts`: a value matching
`^\+84\d{8,}$` keeps `+84`, the next two digits and the last four, the rest replaced by
one `•••` regardless of how many digits it hides; any other non-null shape (the contract
promises `+84…` or null, so this is defensive) keeps only its last four digits behind
`•••`; null stays "not on record" (trap 5), never a blank.

Enforced by a tree-scan test beside the two that already exist (`src/calls.test.ts`):
under `src/app/`, every mention of `caller_phone_e164` outside the one Call-card file is
wrapped in `maskPhone(`. The gate of ADR 0005 is untouched — the number is call metadata,
not caller speech, and is masked whether or not consent was granted.

## Why

- The console is read on a shared desk and pasted into chat as screenshots. The last four
  digits are enough to recognise a repeat caller and to search for the call again (ADR
  0006's suffix search); the whole number on every row is exposure with no reading.
- Masking in one function with one allowed raw site keeps the rule testable; a rule that
  lives in each component's JSX is a rule until the next component.

## Rejected

- **No number at all outside the card.** The operator loses "this is the same caller as
  this morning" on the list, which is the reading the column exists for.
- **Behind the consent gate.** The gate governs caller speech; folding metadata into it
  makes the gate mean two things, and an unconsented caller's number would then appear in
  full — the opposite of the intent.
- **A `?reveal=1` toggle.** A URL that reveals is a URL that gets pasted.

## Revisit when

- An account outside the team can open the console (the trigger of ADR 0005): the raw
  site moves behind a per-account permission.
- Retention removes numbers early enough that the last four are the only thing left to
  read — then the card's raw site is redundant and goes.
