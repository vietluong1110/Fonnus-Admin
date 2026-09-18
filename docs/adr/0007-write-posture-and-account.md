# ADR 0007: A bounded write posture — the two inserts of contract §7 as `console_editor`, signed with the account Caddy authenticated

**Status:** accepted 2026-09-18 · **Date:** 2026-09-18 · Supersedes the "never writes" clause of this
repo's posture (`CLAUDE.md` "Read-only, enforced twice", `CONTEXT.md` §Security posture,
ADR 0002 point 3 "the database role is read-only") and fires the write trigger ADR 0002
lists. Stands on the pipeline's answer to the same trigger: ADR 0021 and ADR 0027 there
opened an INSERT-only role instead of the service boundary ADR 0013 first named, and wrote
the terms down as `../Fonnus/docs/read-contract.md` §2 (the role) and §7 (the write
contract). Shares ADR 0005's revisit trigger. Caddy and Next.js facts were verified
2026-09-18 (context7 `/websites/caddyserver_caddyfile`, `/vercel/next.js` v16); Postgres role
semantics against the PostgreSQL 16 manual (`/websites/postgresql_16`) — §Verified facts.

## Decision

**1. What this console writes: the two inserts of contract §7, verbatim, and nothing
else.** A `runtime_config` row (a configuration edit, pipeline ADRs 0020/0021/0028) and a
`call_annotation` row (a human-authored fact about an interval, ADR 0027), each with
`created_by = console:<account>`. No `UPDATE`, no `DELETE`, no insert into any other table
— a correction or a retraction is a superseding row, a restore is a new row. The grants
already make every other verb a Postgres refusal (SQLSTATE `42501`); this repo adds the
promise on its side so a refusal is never the first sign of a mistake.

*Enforcer:* a tree-scan test over `src/**/*.ts(x)` (tests excluded), in the shape of the
`'granted'` scan of `src/calls.test.ts`: the SQL verb `insert into` appears only in files
under `src/writes/`; `update … set` and `delete from` appear nowhere.

**2. Two roles, two connection strings, two pools — the `console` pool untouched.**
`.env` gains one optional key, `EDITOR_DATABASE_URL`, the `console_editor` role's
connection string on the same two paths the contract §2 names for `console`. `src/config.ts`
reads it as `editorDatabaseUrl?: string` (absent when the key is unset or blank); `src/db.ts`
gains `getEditorPool(): Pool | undefined` beside `getPool()`, created on first use with the
same four pool bounds and the same idle-error listener, cached under its own `globalThis`
key. `getPool()` and every read screen are unchanged: a reader's credential never carries
the write (`../Fonnus/docs/runbook.md` §9).

At boot the key is optional: unset, the read screens run exactly as before and every write
surface renders "editing not configured" (the same shape as the artifact store's "recording
access not configured", ADR 0004). Set, the value must parse as a URL whose username is
`console_editor`; anything else — an unparsable value, the `console` string pasted under
the wrong key — stops the server at `src/instrumentation.ts` naming the key, because a
wrong editor credential would otherwise surface as `42501` on the first save, weeks later.

*Enforcers:* `src/config.test.ts` (unset, blank, a valid value, a value naming another
role, an unparsable value); the existing lint rule keeping `process.env` inside
`src/config.ts`; `src/db.test.ts` (`getEditorPool()` is `undefined` without the key and one
pool per process with it); `/api/healthz` (decision 6) proves the login on the box.

**3. The write modules: one file per table under `src/writes/`, and only they touch the
editor pool.** `src/writes/runtime-config.ts` and `src/writes/call-annotation.ts` (rows A9
and A10 — neither exists in this row) each hold one insert, the contract's statement
copied verbatim with `returning id, created_at`, parameterised through `getEditorPool()`.
A write function takes the account as a value of the branded type `Account` (decision 4)
and builds `created_by` through `createdBy(account)`; it never composes the string itself,
and it never reads through `getPool()` — a form's reads (the current row, the diff, the
history) are ordinary queries in `src/queries/`.

*Enforcers:* the tree-scan of decision 1, extended: the identifier `getEditorPool` appears
only in `src/db.ts`, under `src/writes/`, and in `src/app/api/healthz/route.ts`; the
identifier `getPool` appears nowhere under `src/writes/`. The scan passes with the directory
absent, so it is wired in this row and holds from the first write module on.

**4. The account is the `basic_auth` name Caddy authenticated, forwarded as one request
header, read in one place, and no write proceeds without it.**

Caddy: inside the `reverse_proxy` block of `caddy/Caddyfile`,

```caddyfile
reverse_proxy admin:3000 {
	header_up X-Console-Account {http.auth.user.id}
	header_up -Authorization
}
```

`{http.auth.user.id}` is the placeholder `basic_auth` fills after a successful
authentication; `header_up <field> <value>` without a prefix *sets* the field, replacing
any value the client sent, so a browser cannot smuggle a name past Caddy; and
`basic_auth` runs before `reverse_proxy` in Caddy's directive order, so every proxied
request is an authenticated one. The second line drops the `Authorization` header before
the request reaches the app: the app has no use for the password, and a process that
never sees it cannot log it.

The app: `src/account.ts` is the one reader, the way `src/calls.ts` is the one consent
gate. It exports:

- `ACCOUNT_HEADER = 'x-console-account'` — the header's name, written nowhere else;
- `type Account` — a branded string minted only here, so a write function's signature
  (`by: Account`) cannot be satisfied by a literal, a placeholder or a form field without a
  cast that the scan below forbids;
- `readAccount(headers): Account | undefined` — pure: the header's value trimmed; absent,
  empty, or containing whitespace → `undefined`. No other shape rule: the value is a line
  of `caddy/users`, which `deploy.sh` already holds to "no whitespace", and `created_by` is
  opaque text to the contract;
- `currentAccount(): Promise<Account | undefined>` — `readAccount(await headers())` from
  `next/headers`, usable in Server Components, Server Actions and Route Handlers (Next.js
  16: `headers()` is asynchronous and returns a read-only `Headers`);
- `requireAccount(): Promise<Account>` — the write path's gate: throws `NoAccountError`
  ("no account on this request — writes are accepted only through the reverse proxy,
  ADR 0007") when absent; every write surface calls it before it touches the editor pool
  and renders the message as a refusal, never a placeholder;
- `createdBy(account): string` — `` `console:${account}` ``, the contract's form, written
  once.

Nothing on the read side is gated by the header: a request without it renders every screen
it renders today (the compose healthcheck, `pnpm dev` on a laptop and the tunnel all arrive
without Caddy). The header is read server-side only; nothing about it is exposed to the
client beyond the footer text.

*Enforcers:* `src/account.test.ts` — the truth table of `readAccount` and the `createdBy`
form; a tree-scan that the literals `x-console-account` and `console:` and the cast
`as Account` appear under `src/` only in `src/account.ts`; TypeScript's brand for the
"no write without an account" invariant. The Caddyfile is validated by `deploy.sh`'s
preflight in a throwaway `caddy` container before anything moves (`docs/deploy.md` §2).

**5. The trust boundary: the header is trusted within the box, and the ADR says what that
does not cover.** `admin` publishes no port and sits on two bridge networks
(`fonnus-admin_default`, where Caddy is; `fonnus_default`, where Postgres is). A process
that can reach `admin:3000` without passing Caddy — another container on either network,
or a host process, since the pipeline's `app` runs with host networking — could send the
header itself and write under any name. Accepted (user decision 2026-09-18) because that
position already holds more than the header opens: whoever can run a container or a shell
on the box reads `~/fonnus/.env`, which carries the `fonnus` superuser password, and can
insert the same rows as `sql:<name>` through `psql` — the form the contract reserves for
exactly that. The header opens no door that was not open; a signed header would guard a
door whose other side is the same person.

What the posture therefore guarantees: a name in `created_by` is the `basic_auth` account
that made the request over `admin.fonnus.me`, or the name someone with box access chose to
write — the same two cases the audit trail already has for `sql:<name>`. What it does not
guarantee: non-repudiation against an insider with box access. That is the revisit trigger.

**6. The verifiable slice shipped in this row (PLAN A8), with no write module.**

- The shell footer (`src/app/layout.tsx`, the sidebar's foot; the A6 redesign draws the
  line "console · read-only" there) reads **`console · read-only · <account>`**, and
  **`console · read-only · no account`** when the header is absent, with a `title` of "no
  account: this request did not come through the reverse proxy (local development or the
  tunnel)". "read-only" stays in the line until the first write module lands; the row that
  adds it (A9) changes the text, and this ADR's decision 1 is what the new text must not
  overstate. The account is read once, in the layout, through `currentAccount()`.
- `/api/healthz` reports the editor credential beside the reader's, in the same shape and
  through the same `healthBody` function with the expected role as a parameter: `editor:
  { role: "console_editor", status: "ok" }` after a successful `select current_user` on the
  editor pool; `{ status: "not configured" }` when the key is unset; `{ role: "<other>",
  status: "degraded" }`; `{ error: "…", status: "error" }`. The HTTP status stays the
  reader's alone: an optional credential must not take the read console out of service, so
  the compose healthcheck and `deploy.sh`'s gate keep their meaning unchanged. `deploy.sh`
  prints one warning line when `EDITOR_DATABASE_URL` is set in `.env` and the body's
  `editor.status` is not `ok` — a warning, never a failed deploy.
- `.env.example` lists `EDITOR_DATABASE_URL` commented out, with the role's purpose and the
  "optional; a wrong value refuses to start" rule.

**7. Operations.** The `console_editor` role exists since pipeline migration 0012 and can log
in on the box since 2026-09-18 (`../Fonnus/CONTEXT.md` §Deployment live-state block, runbook
§9 run by the operator, who holds the value). `docs/deploy.md` gains: the key in the "What
runs where" `.env` row; in §1.5 the same `alter role … login password` and the
from-another-container `psql` proof for `console_editor`; in §1.6 the optional line
`EDITOR_DATABASE_URL=postgres://console_editor:<value>@postgres:5432/fonnus` (generated
without `$`, like the other); in §5 rotation for both roles; and one new step after the
deploy that carries the Caddyfile change: open the console and read your own account in the
footer, then probe `/api/healthz` for `"editor":{"role":"console_editor","status":"ok"}`.
`README.md` says that `pnpm dev` has no Caddy in front, so the footer reads "no account"
and a write is refused there unless the header is sent by hand — the trust model's honest
consequence, not a development switch.

**8. The words that change elsewhere** (the pm's edits, outside this ADR): `CLAUDE.md`
"Read-only, enforced twice" and its intro sentence "It never writes pipeline data";
`CONTEXT.md` §Security posture "the database role it holds cannot write"; ADR 0002 point 3
gains an amendment note pointing here; `docs/upstream.md` §Connection gains the second role,
its key, and the probe's second statement. ADR 0001's "the app has no write path to lose"
is left as the record of its date.

## Why

- **Two pools rather than one pool switched by statement.** Postgres lets a session switch
  only *down* the membership chain: `SET ROLE console_editor` from a `console` login is
  refused, because `console` is not a member of `console_editor` (the session user must
  hold the SET option on the target role). The one-pool shape therefore has to log in as
  `console_editor` everywhere and `SET ROLE console` around every read — every connection
  in the process then carries the write credential, `current_user` reports `console` while
  `session_user` is `console_editor` so the health probe's role check stops meaning what it
  says, and one forgotten `SET ROLE` on one client is a reader running as the editor. The
  constraint "the `console` pool untouched" and the runbook's "a reader's credential never
  carries the write" are the same sentence; two pools keep it without discipline.
- **Optional at boot, strict when set.** The two write surfaces are rows A9 and A10; the
  read console must deploy and run without the credential, and a box that never edits
  never needs it. But "set and wrong" is a typo, and the console's own precedent (ADR 0004,
  the half-configured `S3_*` group) is that a typo fails at start, loud, rather than
  degrading into a message weeks later.
- **A header from Caddy rather than the app decoding `Authorization`.** Caddy forwards
  request headers to the upstream, so the app *could* read the `Basic` credentials itself
  and take the username. That re-implements what Caddy has already done, hands the app the
  password on every request for no purpose, and is exactly as forgeable from the bridge.
  Reading the name Caddy vouches for, and dropping the password, is the smaller surface.
- **A distinct header name (`X-Console-Account`) rather than the conventional
  `Remote-User`.** The name says what the value is in this repo's vocabulary
  (`console:<account>`), grep finds every use, and no library or proxy default sets or
  strips it by accident. `Remote-User` would ease a later identity proxy that emits it —
  but that proxy is the revisit, and renaming a header is one line in two files.
- **A branded type for the account.** The invariant "no write without an account" needs an
  enforcer that runs before the insert (ADR 0011 P3). A runtime check in each write module
  is one per module and drifts; a type that only `src/account.ts` can produce makes the
  compiler the check, and the scan on `as Account` closes the cast.
- **Trust within the box, now.** Decision 5 has the reasoning. The alternatives cost more
  than they protect (§Rejected) while every account holder is a team member with box
  access; the trigger that changes that is named and shared with ADR 0005, so both flip on
  the same day.
- **The health probe reports, never fails, on the editor.** The probe's HTTP status is
  what the compose healthcheck and the deploy gate read; letting an optional credential
  turn it 503 would make "editing misconfigured" indistinguishable from "the console is
  down" and would roll back a deploy for a key the read screens do not use. The warning
  line in `deploy.sh` is how the operator learns, at deploy time, without that cost.

## Rejected

- **A placeholder account** (`console:admin`, `console:unknown`) until a login exists — the
  reason this ADR precedes A9 and A10: `created_by` is an append-only audit trail, and a
  false name in it cannot be corrected (`docs/redesign.md` §7).
- **A signed header** — Caddy adds an HMAC of the account under a shared secret, the app
  verifies. Protects against a forger on the bridge who does *not* hold the secret; but the
  secret lives in `~/fonnus-admin/.env` beside `~/fonnus/.env`, so the position that can
  forge the header can read the secret. A second secret, a verifier, and a rotation
  procedure for no closed door. The right shape when an account holder is *not* a box
  insider — the revisit.
- **A real login now** (sessions in the app, `basic_auth` removed) — the backlog row
  behind ADR 0002's clinic trigger. Right when the first outsider arrives; today it
  replaces one line per team member in `caddy/users` with an accounts table this console
  would have to write, on a repo whose write posture is being opened by this very ADR.
- **A Next.js `proxy.ts` that strips the header when the request did not come from
  Caddy** — it cannot tell: the app sees only a bridge address either way, and Caddy's
  `header_up` already replaces the client's value on every request that does pass through.
- **A development-only override key** (`ACCOUNT_OVERRIDE=<name>` in `.env` for `pnpm dev`)
  — a placeholder path by another name: a laptop on the tunnel writes to the real
  `runtime_config`, and a key that exists can be set on the box. Sending the header by hand
  in development is the trust model applied honestly.
- **Failing `/api/healthz` on a bad editor credential** — see Why.
- **Validating the `console` URL's username the same way** — not in this row: the read
  pool is untouched by the constraints block, and `deploy.sh`'s gate already fails a deploy
  whose role is not `console`.

## Revisit when

- **The first account for someone outside the team** (ADR 0005's trigger, ADR 0002's
  clinic trigger): the account path is flipped to a signed header or a real login, the
  branded `Account` is then minted by that mechanism, and the write modules are restructured
  behind whatever tenant scoping arrives with it. This ADR is superseded by the one that
  adds accounts.
- **Caddy is replaced or fronted by an identity proxy** (ADR 0002's credential-stuffing
  trigger): the header is then the proxy's, and decision 4 changes its source, not its
  reader.
- **A third writable table** appears in the contract: one more file under `src/writes/`
  under the same scan; a table that needs `UPDATE` is a new decision, not a grant.
- **A write must be validated against state only the pipeline process holds** before it
  lands (pipeline ADR 0021's trigger): the service boundary ADR 0013 named, and this
  posture's insert path is replaced by a call to it.

## Verified facts

1. Caddy `basic_auth`: after a successful authentication the placeholder
   `{http.auth.user.id}` holds the authenticated username (context7
   `/websites/caddyserver_caddyfile`, directive `basic_auth`, 2026-09-18).
2. Caddy `reverse_proxy` `header_up <field> <value>` sets the field, overwriting any
   existing value; `header_up -<field>` deletes it before the request reaches the backend
   (same source, directive `reverse_proxy`).
3. Caddy's default directive order evaluates `basic_auth` before `reverse_proxy` (same
   source, "Directive order").
4. Next.js 16: `headers()` from `next/headers` returns `Promise<ReadonlyHeaders>` and is
   documented for Server Components, Server Actions, Route Handlers and `proxy.ts`
   (context7 `/vercel/next.js`, `packages/next/src/server/request/headers.ts` JSDoc and
   `docs/01-app/03-api-reference/04-functions/headers.mdx`).
5. PostgreSQL 16 `SET ROLE`: the session user must have the SET option on the target role,
   directly or through a chain of memberships; after `SET ROLE`, `current_user` is the new
   role and `session_user` is unchanged (`/websites/postgresql_16`, `sql-set-role.html`,
   `functions-info.html`). `console_editor` is a member of `console`, not the reverse
   (`../Fonnus/app/drizzle/0012_console_editor_role.sql`).
6. Node's WHATWG `URL` parses `postgres://console_editor:<pw>@postgres:5432/fonnus` with
   `username === 'console_editor'` and throws `ERR_INVALID_URL` on a non-URL (run on Node 22,
   2026-09-18).
7. `console_editor` can log in on the box since 2026-09-18, and rows were inserted as it over
   the tunnel that day (`../Fonnus/CONTEXT.md` §Deployment live-state block).

## Assumed

- Caddy's JSON access log carries the authenticated user of a `basic_auth` request as a
  field (`user_id`) — useful as the second record of who did what, not relied on by any
  decision above. Settle by reading `docker compose logs caddy` after the first deploy; if
  absent, `log_append account {http.auth.user.id}` adds it.
- The pipeline's `app` container, running with host networking, can reach `admin`'s bridge
  address — assumed from Docker's default forwarding on bridge networks. Decision 5 does not
  depend on it: the box-insider argument holds through `psql` regardless. Settle with
  `curl http://<admin bridge ip>:3000/api/healthz` from the host.
