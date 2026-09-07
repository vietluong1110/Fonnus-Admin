# ADR 0002: A public console on the phone box

**Status:** proposed · **Date:** 2026-09-06 · flips to accepted when PLAN row A3 ships

## Decision

The console is served from the same VPS that answers the phone, behind a public domain,
with these defences and no others in v1:

1. **Caddy is the only process bound to a public interface** (`0.0.0.0:80` and `:443`,
   auto-TLS). The `admin` container sits on the pipeline's bridge network
   `fonnus_default` (`external: true`) and publishes no port; Caddy reaches it by service
   name. Postgres keeps its `127.0.0.1` clamp (ADR 0017 §3) — nothing here reopens it.
2. **`basic_auth` in Caddy, one operator account**, bcrypt hash in the `Caddyfile`, the
   password in the operator's password manager. The app itself has no login and trusts
   nothing from the request beyond what Caddy forwards.
3. **The database role is read-only** (`console`, ADR 0017). A compromise of the web tier
   yields reads of what the console already shows — call logs, consented transcripts,
   consent-gated caller numbers for 90 days (ADR 0008) — and no write path to the pipeline.
4. **`ufw allow 80,443/tcp`** and nothing more. Fail2ban or Caddy rate limiting on the auth
   endpoint is ASSUMED unnecessary for one account with a long random password; the
   observation that settles it is the Caddy access log showing brute-force volume.
5. **The pipeline's `CONTEXT.md` §Deployment live-state block gains the new listeners in
   the same change** that opens them, so the phone repo's deploy runbook never describes a
   box that does not exist.

## Why

- The user chose a public domain over a laptop-only tunnel: the console is meant to be
  opened from anywhere during hand-tests without an SSH session first.
- The box already runs a public UDP listener for the phone (FreeSWITCH, ADR 0009); a TLS
  listener on 443 behind an auth wall adds a second public surface but not a new class of
  exposure, and the data behind it is bounded by the read-only role.
- A second VPS for the console would double the operating surface for one operator's
  convenience and force Postgres off its loopback clamp (or a tunnel between boxes) — the
  wider posture, not the narrower.

## Rejected

- **Laptop-only via SSH tunnel, no public listener** — zero new surface; rejected by the
  user for reach. Remains the dev path (`README.md`).
- **A separate VPS** — see Why.
- **Cloudflare Tunnel / Tailscale in front** — hides the origin and adds an identity layer,
  but a third-party dependency on the phone box's network path is a decision for the
  pipeline repo (ADR 0009 territory), not this one. Revisit trigger below.

## Revisit when

- A second person needs access, or a clinic does (`../Fonnus` W5-A): `basic_auth` is
  replaced by a real login with sessions, and per-tenant scoping is a query predicate this
  ADR does not cover.
- The Caddy access log shows credential-stuffing volume: rate limiting or an identity
  proxy (Cloudflare Access, Tailscale) is added, as a pipeline-repo network decision.
- The console gains a write path (bookings, notes): ADR 0013's trigger — a service
  boundary, not a shared table, and this ADR's "read-only tier" defence no longer holds.
- The phone box moves or the pipeline goes multi-box: the console follows the database,
  not the phone.
