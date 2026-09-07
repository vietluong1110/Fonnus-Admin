# Fonnus-Admin

Admin console for the Fonnus voice pipeline (`../Fonnus`). Read-only: it shows calls,
transcripts, per-leg latency and cost from the pipeline's Postgres. What it is and what
it must never do: `CONTEXT.md`. Working here with Claude Code: `CLAUDE.md`.

## Status

No code yet — `PLAN.md` row A0 scaffolds the app. This file already describes how it
will be run so the scaffold has a target.

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

The `console` password is the one set on the box per `../Fonnus/docs/runbook.md` §9. It is
the only credential this repo holds.

## Run locally against the pipeline's dev database

`../Fonnus/docker-compose.yml` runs a dev Postgres on `127.0.0.1:5432`; the pipeline's
fake-caller scenarios fill it with calls without any API key
(`../Fonnus/README.md`). Migration 0006 creates the `console` role there too; enable its
login the same way as on the box (runbook §9), then
`DATABASE_URL=postgres://console:<pw>@127.0.0.1:5432/fonnus`.

## Deploy

Not yet — `PLAN.md` row A3. The target shape is in `CONTEXT.md` §Deployment.
