# Fonnus-Admin — Product, Users, Constraints

## What this is

The internal admin console for Fonnus (`../Fonnus`), the AI voice receptionist for
Vietnamese clinics. The pipeline answers the phone and writes a record of every call —
Postgres rows and, on disk, an artifact directory per call. This console is the place
where a person reads that record: which calls happened, what was said, how long each
stage of a reply took, what the call cost, and how those numbers move when a pipeline
setting is changed.

It is the operator's tool first. ADR 0013 of the pipeline repo names it "the seed of the
clinic-facing call history": a clinic reviewing its own calls is the same read path with
a tenant filter, so the screens are built so that a filter can be added, not so that a
second console has to be written.

## Users

- **v1: the internal team** — the people tuning the pipeline, one account each at the
  reverse proxy. Nobody outside the team has a way in.
- **Later: a clinic** viewing its own calls. Out of scope until `../Fonnus` PLAN row W5-A
  gives calls a tenant to filter by and a real login replaces the proxy accounts.

## Why now — the hypothesis loop

From 2026-09-07 the pipeline is tuned in a loop that runs through this console
(`../Fonnus/CONTEXT.md` §Quality gates, "How the pipeline is tuned"): the operator opens a
call here, reads where the time went and what each stage produced, names a hypothesis
("the endpointing wait is the dead air", "the model's reasoning costs the first two
seconds") and a change to try; the pipeline repo investigates and implements it; the
operator verifies the next calls on the same screens, against the dated baseline. Nothing
in the pipeline is decided by ear or from a report alone any more, which makes this
console the instrument the whole roadmap waits on — `../Fonnus/PLAN.md` W3 and W4 are
sequenced behind rows A0–A2 here. The console is a reader with opinions rendered as
caveats; the decisions stay with the person reading it.

## What the console shows (target state; `PLAN.md` says what exists)

1. **Call list** — recent calls, one click target per row, with when, the caller's number,
   how long, how it ended (consent outcome and end reason together — quiet when ordinary,
   a pill when not), turns on record, whether a recording can be fetched, cost.
2. **Call detail** — built for the call review, non-technical reader first: an overview
   strip, then the recording player beside the transcript as chat bubbles (caller left,
   assistant right, each with its voice length; a click seeks the audio), and under the
   player the **call strip** (one block per turn on the recording's axis with the
   playhead) over the **waterfall of the six latency legs** of the turn being heard (`stt_emit`, `endpoint_wait`, `llm_ttft`,
   `tts_ttfb`, `send`, `playback` — `../Fonnus/PIPELINE_ARCHITECTURE.md` §6) with the
   two headline spans against their ADR 0007 targets; the per-turn research detail
   (tokens, marks, the config snapshot, the consent record, identity fields, cost) sits
   below in a collapsed "Pipeline detail" section. The waterfall grows into a **call
   timeline**: one time axis per turn carrying every step and sub-step with its
   timestamp — each STT partial and the final (text under the consent rule), the turn
   end, the LLM request sent / first token / last token with the model's reasoning
   collapsed under the reply, each TTS sentence as sent → generation frame sent → first
   byte → settled, first audio out, playback start and end, and a failure marker naming
   the stage and the milliseconds it failed after; the greeting gets the same axis from
   the moment the call was answered. Data arrives in three steps: `turn.marks` (ten
   instants per turn since `../Fonnus` W2-L3 F2, plus the failure scalars and the
   greeting's own marks); the call event table (`call_event`, W2-L3 F5, on record since
   2026-09-07) with the sub-stage instants of F6 and, once F7 lands, the reasoning; and
   the bucket (W2-L1) for the verbatim files behind a step (the LLM stream, the sentence
   audio).
3. **Latency dashboard** — P50 / P95 / max per leg over a chosen window, the trend by
   day, and the same numbers **grouped by the pipeline configuration the calls ran
   under** (`call_log.config_snapshot`, on record since `../Fonnus` W2-L3 F1, 2026-09-06),
   so a change to an endpointing or flush setting is visible as a step and not guessed at.
   Every pipeline change from W3 on is one snapshot, and this grouping is how it is judged.
4. **Audio and per-sentence views** — the call itself plays on the detail page (row A5,
   ADR 0004: the browser reads `call.wav` straight from the bucket through a short-lived
   presigned URL; the playhead drives the transcript and the waterfall, and no new pipeline
   data was needed because the recording clock is the wall clock — `docs/upstream.md`
   §Artifacts). Each synthesized sentence on the timeline is row A4. The artifact bucket on
   Vietnix S3 landed with `../Fonnus` PLAN row W2-L1 on 2026-09-07; `call_log.artifact_state`
   says whether a given call's files are in the bucket yet. The bucket holds internal test calls only for as long as this
   repo's account-wide key exists off the VPS (`../Fonnus` ADR 0019).

Not here: any write (bookings, notes, tenant configuration), the onboarding UI, the
landing page. The first is ADR 0013's revisit trigger; the other two are other repos.

## Constraints

### It reads under a contract, and only under it

`../Fonnus/docs/read-contract.md` names the tables, columns and vocabularies this repo
may rely on. Anything else in the database is not read, even when visible. The contract
is additive-only; a renamed column arrives as a new column plus a deprecation note there,
and `docs/upstream.md` here is updated in the same commit that first consumes it.

### Five traps, each rendered, never hidden

From the contract's §5, restated as what the screen must do:

1. `call_log.turn_count` is turns *on record*. An unconsented call reads 0 however much
   the caller spoke. Label it "turns on record".
2. A call with no `consent_record` row is **not finalized** — in progress if `ended_at`
   is null, otherwise the process died or the finish transaction failed. Show that state;
   never show it as "no consent".
3. `total_cost_vnd` is a **floor** while any model the call ran on has no price row. The
   pipeline's `/healthz` lists `unpricedModels`; until the console can read that, every
   cost figure carries the floor caveat.
4. **Caller text is shown only when `consent_record.outcome = 'granted'`.** Otherwise the
   cell shows the outcome. The store does not enforce this; this code does — one function,
   `showCallerData`, gates caller text and the recording alike. During the internal test
   phase the gate is a deployment switch (ADR 0005, `CONSENT_GATE`): on by default, off
   only in the test `.env`, and every screen says so while it is off.
5. Null transcripts and null caller numbers may be **age** (retention TTLs), and
   `artifact_dir` may point at a swept directory. Compare `started_at` against the TTLs
   before calling anything "missing". Since the pipeline's migration 0010 the row says this
   itself: `artifact_state = 'expired'` means the disk copy is gone, and the files are
   reached in the bucket through `artifact_key_prefix` instead (contract §6, trap 12).

Two more that are the console's own:

6. Latency percentiles are drawn from consented calls only — unconsented calls have no
   `turn` rows. Say how many calls the number stands on.
7. `tts_ttfb` covers the first sentence of a reply only; later sentences synthesize behind
   the one playing. The leg is labelled so wherever it appears.
8. The first TTS sentence after an idle period pays the Cartesia socket handshake: the
   `tts/sentence` record is written before the socket is (re)opened, so on the timeline that
   sentence reads slower than the provider was. `../Fonnus` W2-L3 F6 (2026-09-07) records
   the instant the generation request left as `tts/generation_sent`; until the call
   timeline (`PLAN.md` row A1b) draws it, label the first sentence of a call — or of a reply
   after a five-minute gap — as "includes connection". The trap retires with A1b.

### Security posture

The console is deployed on the same VPS that answers the phone, with a public domain.
ADR 0013 kept a web surface out of the pipeline *process*; this puts one on the pipeline's
*machine*. The defence is ADR 0002 of this repo: the reverse proxy is the only thing bound
to the public interface, the console container sits on the compose bridge network, one
`basic_auth` account per team member guards it — the bcrypt hashes hand-maintained on the
box, outside the repo — and the database role it holds cannot write. A clinic-facing
surface is that ADR's revisit trigger. Caller-derived bytes (text, the recording) are
withheld unless consent was granted; during the internal test phase that gate is a
deployment switch, on by default and off only in the test `.env` (ADR 0005) — the first
account for someone outside the team deletes the switch. The recording is never proxied:
the browser plays it from the bucket through a URL presigned for 15 minutes by the
`/calls/<id>/recording` route, which enforces the same gate (ADR 0004).

### Language

The UI is in English for v1 (one operator, an engineer). Call content is Vietnamese and is
rendered verbatim. Pipeline vocabulary appears on screen as-is (`endpoint_wait`, not a
translation), with a one-line plain-language gloss where a term first appears.

### Look and feel — the product's design system, by copy

The look is Fonnus-Web-UI's (`../Fonnus-Web-UI`, the marketing site and the clinic app):
its rulebook is `design-reference/ui-ux-principles.md` there, its tokens are copied verbatim
into `src/styles/tokens/` here (ADR 0003 — copy, never edit; a token change is re-copied).
Code uses the alias layer only (`--surface-card`, `--text-muted`, `--border-hairline`,
`--chart-1/2/3`, `--font-display/ui/num`), never a base hex name. Fonts: Baloo 2 for
headings, Be Vietnam Pro for UI text, IBM Plex Sans for numbers, loaded with the
Vietnamese subset. The shell is the Web-UI's `AppShell` geometry — a 216 px sidebar with
the lockup and the nav, a 1180 px content column on the cream page ground — without the
phone-width tab bar (one operator on a laptop).

Two deliberate deviations from the Web-UI's conventions, both recorded in ADR 0003:
Tailwind stays (utilities resolve to the copied tokens through `@theme inline`), and
numeric lists are real `<table>` elements, not grid rows.

Rendering rules that follow: warm cream ground, rounded cards on it, one accent for
anything clickable, no dark mode, sentence case everywhere. Caveats (cost floor,
consented-only, first-sentence-only, retention age) use muted text next to their number —
once per column, in the header — never the accent: the accent is for actions, not warnings.
A dashed border means "no content yet", never a button.

## Stack

| Layer | Choice | Why (full rationale: `docs/adr/0001-stack.md`) |
|---|---|---|
| Framework | Next.js (App Router, TypeScript) | One container; server components query Postgres directly; a login and a tenant filter are additions, not a rewrite |
| Database access | `pg` (node-postgres) with hand-written SQL | The read contract is the schema; an ORM copy would drift. Pool bounds mirror the pipeline's `app/src/persistence/db.ts` |
| Charts | Recharts | Waterfall and percentile charts without hand-drawn SVG |
| Toolchain | pnpm 11, Node 22, strict TypeScript, ESLint flat config with `strictTypeChecked` | Same as `../Fonnus/app` so a reader moves between the repos without re-learning |
| Reverse proxy | Caddy | Automatic TLS, `basic_auth` in three lines |

## Deployment

The box itself — host, user, what runs on it, the compose project `fonnus`, the network
`fonnus_default`, the `~/fonnus` layout — is described once, in
`../Fonnus/CONTEXT.md` §Deployment, and is not repeated here. That section also carries the
live-state block that must be updated when this console goes live (a new listener on
80/443 is a change to the box's network posture).

What this repo adds on the box — the compose project `fonnus-admin`; the procedure is
`docs/deploy.md`:

- A directory `~/fonnus-admin` holding `compose.yml`, `deploy.sh` and `caddy/Caddyfile`
  (all three copied in by CI on every deploy), the hand-maintained `.env` (`DATABASE_URL`
  with the `console` password, `ADMIN_DOMAIN`, `ADMIN_IMAGE`) and `caddy/users` (the
  bcrypt hashes, one line per team member), and `.admin-last-good` / `.admin-previous`,
  the SHAs `deploy.sh` writes.
- Two containers: `admin` (this app, no published port, joins `fonnus_default` declared
  `external: true`, reaches `postgres:5432`) and `caddy` (the only process bound to
  `0.0.0.0:80` and `:443`, TLS from Let's Encrypt, `basic_auth` with one account per team
  member imported from `caddy/users`).
- Two `ufw` rules: 80/tcp and 443/tcp. Nothing for 5432 — the database stays on the
  bridge (`../Fonnus/docs/adr/0017-console-read-access.md` §3). The rules record intent:
  Docker's published ports are DNAT'd ahead of the host's INPUT chain, so the off-switch
  for the public surface is `docker compose stop caddy`.
- The image comes from GHCR tagged by full commit SHA; every push to `main` runs the four
  gates, builds it and deploys it (`.github/workflows/deploy.yml`).
- The hostname `admin.fonnus.me`, chosen 2026-09-08; Caddy holds its Let's Encrypt
  certificate and `ADMIN_DOMAIN` in `~/fonnus-admin/.env` is the only place it is configured.

Consequence to know: while `admin` is attached to `fonnus_default`, `docker compose down`
in `~/fonnus` cannot remove that network and says so (`../Fonnus/docs/runbook.md` §9).
Detach or ignore; nothing depends on the network being deleted.
