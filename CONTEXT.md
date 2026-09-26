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

1. **Call list** (`/calls`) — the calls of one window (`24h` · `7d` · `30d` or a from–to
   range, shared with the Overview; ADR 0006), headed by four cards over the whole window —
   calls, median duration, turns per consented call, recordings that reached the bucket —
   and the calls per bucket across the window (hour, day or week, as the Overview's charts);
   then five chips that narrow only the list (failed turn · not finalized · unconsented ·
   hit a cap · has recording, intersecting, each counting what adding it would leave); then the rows, banded by day: when, the caller's number masked
   to its last four digits (ADR 0008), how long, how it ended (consent outcome and end
   reason together — quiet when ordinary, a pill when not), the turns as a tick strip with
   the failed ones marked, whether a recording can be fetched, cost with its floor caveat.
   A search box finds a phone number (its last digits, the whole number typed either way, or the masked form pasted back) or an id prefix across all history, outside the
   window. Pages of 100.
2. **Call detail** (`/calls/<id>`) — built for the call review, non-technical reader first:
   the head (masked number, when, how it ended), the "Ran on" strip (models, voice, config
   row), then **the call** — the recording player over two lanes on the recording's axis
   with a legend, the greeting and each turn's voice on one, the turn's `pipeline_ms` as a
   bar on the other, with the playhead — and five figures: call duration, number of turns,
   total cost and cost per minute (list price, ADR 0015), average turn latency (the mean of
   `pipeline_ms`); then the **transcript** as chat bubbles (caller left, assistant right; a
   click on the bubble selects the turn and seeks, the play glyph plays that utterance and
   stops) beside **the selected turn** — the latency legs (`stt_emit`, `endpoint_wait`,
   `llm_ttft`, `tts_ttfb`, `send`, `playback`, and `holding_line` on a turn where the bot
   spoke a holding line while the answer was still being generated —
   `../Fonnus/PIPELINE_ARCHITECTURE.md` §6, pipeline ADR 0030),
   the two headline spans against their ADR 0007 targets, the thinking span
   (`llm_first_reasoning → llm_first_token`) and the three end-of-turn spans, drawn as
   capsule tracks on one scale with the playhead, and the turn's LLM and TTS cost and
   tokens under them. Under those, the **Intervals** card (row A1b, ADR 0010), drawn from
   the sequence of contiguous intervals contract §8 derives from `call_event` — who held
   the line (the holding line as the bot speaking, with its text, never as the answer) and
   what the recogniser returned, with the caller-line facts (sound heard while
   nothing was recognised, sound while the feed was muted) noted inside the latter — with
   the trail's completeness verdict above it, so a non-turn line, an utterance that
   returned nothing and an overtaken partial become visible; rows are tinted by side
   (Fonnus, caller); the annotations of row A7 (`call_annotation` — the current rows on the
   intervals they overlap, texts under the consent rule, the history of corrections and
   retractions) sit under the table. The per-turn research detail (the turn table with
   per-turn cost and latency, the config snapshot by group with each leaf's plain name and
   the FAQ entries the call ran with as the snapshot recorded them, the consent record, the full number and the identity fields) sits last in a collapsed
   "Pipeline detail" section, and the bucket (W2-L1) serves the verbatim files behind a step.
3. **Overview** (`/`) — over the same window: P50 / P95 / max per leg against the ADR 0007
   targets, calls per bucket (one hour up to two days, one day up to 45 days, one week beyond;
   the buckets cover the whole window, edge buckets marked partial), the reply's
   composition, how calls ended (end reason and consent outcome), turn failures by leg and
   stage, the window's cost (list price, the unpriced models named), the turns that never
   became audible, and the same latency numbers **compared by configuration** — one of
   eight groupings offered on screen (LLM, STT and TTS model, voice, reasoning effort, STT
   and TTS vendor, and `runtime.version`, the console-edited row a call ran under; ADR 0009,
   default `OPENROUTER_MODEL`; any other flat key of `call_log.config_snapshot` still works
   from the URL) — so a change to an endpointing or flush setting, or a console config edit,
   is visible as a step and not guessed at. Changing the grouping re-renders that card in
   place. Every pipeline change from W3 on is one snapshot, and this comparison is how it is
   judged.
4. **Audio and per-sentence views** — the call itself plays on the detail page (row A5,
   ADR 0004: the browser reads `call.wav` straight from the bucket through a short-lived
   presigned URL; the playhead drives the transcript and the waterfall, and no new pipeline
   data was needed because the recording clock is the wall clock — `docs/upstream.md`
   §Artifacts). Each synthesized sentence on the timeline is row A4. The artifact bucket on
   Vietnix S3 landed with `../Fonnus` PLAN row W2-L1 on 2026-09-07; `call_log.artifact_state`
   says whether a given call's files are in the bucket yet. The bucket holds internal test calls only for as long as this
   repo's account-wide key exists off the VPS (`../Fonnus` ADR 0019).
5. **Configuration** (`/configuration`, row A9, ADR 0011) — the console's first write
   surface: the tenant's current `runtime_config` row, a form generated from a byte-exact
   copy of the pipeline's runtime document schema (drift-tested against the two
   `contract-hash` lines of contract §7), each leaf beside the value the last answered call
   actually ran on, a review step that shows the proposed document and its diff against the
   current row before anything is written, then a new row appended as a whole-document
   replace under `console:<account>` — it takes effect on the next call answered, no call
   in progress changes. The row history opens from the head; any row can be loaded back into
   the form, so a restore is a new row too. Three warnings travel with what they qualify:
   the latest row not applied (counted from `config_snapshot->'runtime'->>'version'` on
   the calls since the row, the reason pointed at the pipeline's log and
   `fonnus_runtime_config_fallbacks_total`, never inferred), the disclosure advice on the
   greeting (advice, never a refusal), and the vendor and voice selects drawn from the
   tenant's newest `boot_report` row — the vendors the box holds keys for and, per TTS
   vendor, its voice list by label — said "as of boot at <time>, build <sha>", with a
   warning when the newest call ran a different build after that boot; without a row (a
   box before migration 0015, the dev database) every vendor is offered and `tts.voice` is
   a text box the box cannot check. Beside every "last call" value the form says which
   layer it came from: "row #N" when the leaf is in the call's `runtime.config`, "boot"
   otherwise (ADR 0012).

Not here: any write beyond the two the read contract's §7 allows — a configuration edit
(row A9, shipped) and an annotation on a call (row A10), both appended as rows under the account
the proxy authenticated (ADR 0007). Bookings, notes, tenant configuration, the onboarding
UI, the landing page are other repos; a third kind of write is ADR 0007's revisit trigger.

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
   the instant the generation request left as `tts/generation_sent`; until the per-sentence
   view (`PLAN.md` row A4) draws it, label the first sentence of a call — or of a reply
   after a five-minute gap — as "includes connection". The trap retires with A4.

### Security posture

The console is deployed on the same VPS that answers the phone, with a public domain.
ADR 0013 kept a web surface out of the pipeline *process*; this puts one on the pipeline's
*machine*. The defence is ADR 0002 of this repo: the reverse proxy is the only thing bound
to the public interface, the console container sits on the compose bridge network, one
`basic_auth` account per team member guards it — the bcrypt hashes hand-maintained on the
box, outside the repo — and the database role every screen reads through cannot write.
The second role, `console_editor`, can insert exactly two tables and is used only under
`src/writes/`, with the account the proxy authenticated (`X-Console-Account`, set by
Caddy after `basic_auth`, trusted within the box — ADR 0007); the first account for
someone outside the team is the trigger to replace that header with a signed one. A
clinic-facing surface is ADR 0002's revisit trigger. Caller-derived bytes (text, the recording) are
withheld unless consent was granted; during the internal test phase that gate is a
deployment switch, on by default and off only in the test `.env` (ADR 0005) — the first
account for someone outside the team deletes the switch. The recording is never proxied:
the browser plays it from the bucket through a URL presigned for 15 minutes by the
`/calls/<id>/recording` route, which enforces the same gate (ADR 0004).

### Language

The UI is in English for v1 (the internal team). Call content is Vietnamese and is rendered
verbatim. Since row A19 (ADR 0013) every pipeline term is shown as a pair: a plain-language
name first ("End-of-speech wait") and the pipeline's own identifier always beside or under it
(`endpoint_wait`), never replaced — the identifier is what a hypothesis and a pipeline commit
are written in. The names live in one glossary module and nowhere else; model ids, voice ids
and build SHAs have no friendly name and appear verbatim. A one-sentence description of the
term is its tooltip.

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
A dashed border means "no content yet", never a button. Tooltips and dropdowns are drawn by
the console, not the browser (ADR 0014): a tooltip opens at once on hover and on keyboard
focus, and a dropdown is the Web-UI's listbox over a native `<select>` that still submits
with scripts off. Horizontal charts share one shape — a fully rounded capsule track with a
fixed label column, the span, and target and playhead marks — and vertical bar charts write
each value above its column.

The artboards draw one state each — the 7-day window, the Custom chip closed, no
Configuration screen — so a screen is built for its range of states, not for the drawing's
sample: a bar chart is fluid (columns share the card's width, at most the artboard's 40 px,
labels thinned when they would collide, the plot filling the card's height); a control that
reveals a panel overlays its neighbours instead of reflowing them; a form row is sized to
its value (a number takes a short box on one line, a prompt takes the width); and an
explanatory note never sits beside an input competing for its width.

## Stack

| Layer | Choice | Why (full rationale: `docs/adr/0001-stack.md`) |
|---|---|---|
| Framework | Next.js (App Router, TypeScript) | One container; server components query Postgres directly; a login and a tenant filter are additions, not a rewrite |
| Database access | `pg` (node-postgres) with hand-written SQL | The read contract is the schema; an ORM copy would drift. Pool bounds mirror the pipeline's `app/src/persistence/db.ts` |
| Charts | Hand-drawn (`src/ui/hbar.tsx`, `src/ui/vbars.tsx`) | Recharts was removed in row A19 (ADR 0014): every chart is a capsule track or a column chart, drawn from tokens, no client bundle |
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
