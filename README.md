# Fonnus-Admin

Admin console for the Fonnus voice pipeline (`../Fonnus`). It shows calls, transcripts,
per-leg latency and cost from the pipeline's Postgres, and writes back only what the
pipeline's read contract allows: a configuration edit and an annotation on a call, each
under the account that logged in (`docs/adr/0007-write-posture-and-account.md`). What it is and what
it must never do: `CONTEXT.md`. Working here with Claude Code: `CLAUDE.md`.

## Commands

```bash
pnpm install
pnpm dev          # http://localhost:3000 — `/` the overview, `/calls` the call list, `/calls/<id>` one call (`/dashboard` redirects to `/`)
pnpm build        # needs no database; does need egress to fonts.googleapis.com once (next/font downloads the three faces at build time)
pnpm start        # the built app
pnpm typecheck
pnpm lint
pnpm test
```

The smoke check, once the app is running:

```bash
curl -s localhost:3000/api/healthz
```

Three answers, and only three:

| Answer | Means |
|---|---|
| `200 {"role":"console","status":"ok"}` | connected, and as the read-only role; the body's `editor` object says the same for `EDITOR_DATABASE_URL` (`{"status":"not configured"}` when unset) and never changes the HTTP status |
| `503 {"role":"<other>","status":"degraded"}` | connected as some other role — the wrong credential is in `.env` |
| `503 {"error":"<code>","status":"error"}` | no `DATABASE_URL`, or the database refused / timed out; the body carries only a code (`ECONNREFUSED`, `SQLSTATE 28P01`, …) and the full message is in the server log (`docker compose logs admin`) |

## Run locally against the live box

The database is reachable only from the VPS (`../Fonnus/docs/adr/0017-console-read-access.md`).
Locally, open an SSH tunnel to it and point `DATABASE_URL` at the tunnel:

```bash
# one-off
ssh -N -L 15432:127.0.0.1:5432 fonnus
# or permanently, in ~/.ssh/config under `Host fonnus` (outside any repo):
#   LocalForward 15432 127.0.0.1:5432
```

```bash
cp .env.example .env      # DATABASE_URL=postgres://console:<pw>@127.0.0.1:15432/fonnus
pnpm install
pnpm dev                  # http://localhost:3000
```

The `console` password is the one set on the box per `../Fonnus/docs/runbook.md` §9. It,
the optional `console_editor` password (`EDITOR_DATABASE_URL`, needed only to edit the
runtime configuration or annotate a call) and the bucket key below are the only
credentials this repo holds. Locally there is no reverse proxy, so no request carries an
account and every write surface refuses; the footer reads "no account". As of 2026-09-08 that step has not been run: the role
exists but cannot log in, so the tunnel path cannot connect either until the operator runs
§9 — which is step 1.5 of the box's one-time setup (`docs/deploy.md`).

### Recordings and the consent gate (optional keys)

The call detail plays `call.wav` from the artifact bucket (ADR 0004). That needs the five
`S3_*` keys of `.env.example` — this repo's own account-wide `console` key pair for the
bucket `recordinginternal`. Set all five or none: with none the pages render and every
recording surface says "recording access not configured"; with some but not all the app
refuses to start and names the missing keys. The browser fetches the audio straight from
the bucket through a short-lived presigned URL (`/calls/<id>/recording` redirects to it);
this app never proxies the bytes.

`CONSENT_GATE` (ADR 0005) is `on` when unset: caller text and recordings are withheld
unless the call's consent outcome is `granted`. During the internal test phase, where
every caller is a team member, the test deployment's `.env` sets `CONSENT_GATE=off` and
every screen then carries a muted line saying so. Any other value refuses to start.

Every key is checked once, when the server starts (`src/instrumentation.ts`): a bad
`.env` stops `pnpm dev`, `pnpm start` and the container at boot with the message naming
the key, in the terminal or `docker logs` — never as a page error after the first request.

### The Configuration tab (the one write surface so far)

`/configuration` shows the tenant's current `runtime_config` row and a form generated
from a byte-exact copy of the pipeline's runtime document schema (`src/contract/`,
drift-tested against the two `contract-hash` lines of the read contract §7 — re-copy
from `../Fonnus/app/src/...` when that test fails, never edit the bytes). A save appends
a new row through `EDITOR_DATABASE_URL` under `console:<account>`; without that key the
form is read-only and says so, and without the account header it refuses to write. The
smoke check of a save, on the box: save one row, then

```bash
select id, created_by, note from runtime_config order by id desc limit 1;
```

shows `console:<account>`, and the next call's `config_snapshot->'runtime'->>'version'`
equals that id (the tab's "latest row not applied" warning stays silent).

## Run locally against the pipeline's dev database

`../Fonnus/docker-compose.yml` runs a dev Postgres on `127.0.0.1`; the port is whatever
`POSTGRES_PORT` says in `../Fonnus/.env` (5432 by default, 55432 on this laptop). The
pipeline's fake-caller scenarios fill it with calls without any API key
(`../Fonnus/README.md`).

Migration 0006 creates the `console` role there too, but without a login. Enable it the
same way as on the box (runbook §9):

```bash
docker exec fonnus-postgres-1 psql -U fonnus -d fonnus \
  -c "alter role console login password '<pw>'"
```

Then `DATABASE_URL=postgres://console:<pw>@127.0.0.1:<port>/fonnus`.

## Deploy

On the phone box, behind Caddy at `admin.fonnus.me` with one `basic_auth` account per team
member. Every push to `main` deploys itself: `.github/workflows/deploy.yml` runs the four
gates, pushes the image to GHCR tagged by the full commit SHA, and runs `ops/deploy.sh` on
the box over ssh (health gate on `/api/healthz`, rollback to the last good SHA).

The one-time box setup in order, deploys and rollbacks by hand, adding and removing team
accounts, rotating the `console` password: `docs/deploy.md`. What the box looks like:
`CONTEXT.md` §Deployment. Why it is deployed this way:
`docs/adr/0002-public-console-on-the-phone-box.md`.
