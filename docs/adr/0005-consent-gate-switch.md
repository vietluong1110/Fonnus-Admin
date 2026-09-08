# ADR 0005: The consent gate is a deployment switch during the internal test phase

**Status:** accepted · **Date:** 2026-09-08

## Decision

- **One env key opens or closes the gate: `CONSENT_GATE=on|off`.** Read by `src/config.ts`
  as `consentGate: 'on' | 'off'`; unset → `on`; any value other than exactly `on` or `off`
  → `readConfig` throws (a misspelling must not land on either side by accident). The key's
  name is a console term, not a pipeline one (settled with the user 2026-09-08); it is
  listed in `.env.example` commented out, so the documented default is the closed gate.
- **Default `on`: withhold everything caller-derived unless `consent_record.outcome =
  'granted'`.** `off` is set only in the `.env` of the internal test deployment, where every
  caller is a team member who consented off-band. The pipeline's behaviour is untouched
  either way: it writes no caller audio, no caller text and no `turns/` objects for an
  unconsented call (contract §6), so `off` changes only what this reader *withholds*; what
  was never written stays "not on record" (trap 5).
- **What the gate governs** — every surface that renders a caller-derived byte:
  `turn.caller_text` (transcript bubbles, the per-turn cards), the recording (`call.wav`
  carries the caller's channel; the file is withheld whole, since the app never touches
  the bytes and cannot mute one channel), and later the `sensitive` records of
  `call_event` and everything under `turns/`. It does **not** govern `assistant_text`,
  marks, latency numbers, `caller_phone_e164` (trap 5 is age, not consent), or the consent
  record itself, which is shown precisely so the withholding is explained.
- **One enforcement point.** `showCallerText(outcome)` in `src/calls.ts` becomes
  `showCallerData(outcome, gate)` — `gate === 'off' || outcome === 'granted'` — and
  `src/calls.ts` is the only file in `src/` that compares an outcome to `'granted'`. The
  dashboard's "how many calls the percentiles stand on" count is not a gate — it must stay
  the truth about the data whatever the switch says — so it reads the bare fact through
  `isConsentGranted(outcome)`, exported from the same file. The transcript, the
  turn cards, and `recordingAccess` (ADR 0004: the player and the `/recording` route) all
  call it. Enforcers: the truth table in `src/calls.test.ts`; a test that scans `src/**`
  and fails on the literal `'granted'` outside `src/calls.ts`; and ESLint's existing
  `no-restricted-properties` rule keeping the env read inside `src/config.ts`.
- **The switch is said on every screen.** When `off`, `src/app/layout.tsx` renders one
  muted caveat line under the header — "consent gate off: caller text and recordings are
  shown for every call (internal test phase)" — from the config, so no page can forget
  it. A default is said, not drawn (Web-UI principles §7); a *non-default* is said louder.
  One exception, accepted: the 404 page (`/_not-found`) is prerendered at build time with
  the build machine's environment, so it carries the line only when the build had the key
  set — it shows no call data, so nothing is withheld or revealed there.
- **`CONTEXT.md` gains one sentence in trap 4 and in §Security posture** (the pm's edit,
  outside this ADR): "During the internal test phase the gate is a deployment switch
  (ADR 0005); it is on by default and off only in the test `.env`."

## Why

- The console is also the prototype of the clinic-facing call review, and in the test
  phase every call is the team calling itself; the "hung up before disclosure" calls are
  precisely the ones whose audio the team must hear to tune the disclosure. Withholding
  them serves nobody in this phase.
- A switch in configuration rather than in code: the same image runs in both postures,
  which is what the deploy path (ADR 0002, `deploy.sh`) assumes, and flipping the gate is a
  `.env` edit plus a restart, not a build.
- A strict `on | off` value, throwing otherwise, because the gate is the one place where
  "fail open" and "fail closed" differ in kind: an unset key fails closed by the default,
  a garbled key fails loud.
- One function, one test, one grep-test: the obligation lives in this reader (trap 4),
  and a reader with two gates has one that drifts.

## Rejected

- **No switch — every call treated as consented in code until the first outside
  account.** One less key, but the posture would then be a code change under time
  pressure on the day the first outsider arrives, and the default in `.env.example` would
  document the wrong world.
- **A per-call override** (a "show anyway" button). Turns a posture into a habit and puts
  a write-shaped control on a read-only console.
- **Gating only text, never audio.** The recording's left channel is the caller; there is
  no half-consent.
- **A boolean env (`true`/`false`).** `on`/`off` reads as a gate; a boolean invites
  `1`/`yes`/`TRUE` variants the strict parser would have to enumerate or reject anyway.

## Revisit when

- The first account for someone outside the team is created: the key is **deleted** from
  `config.ts`, `.env.example` and this reader, not left set to `on` — a switch that exists
  can be flipped. This ADR is then superseded by the one that adds accounts.
- The pipeline ever writes caller-derived data under an outcome other than `granted`
  (contract §6 changes): the truth table changes in one place.
