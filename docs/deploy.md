# Deploying the console on the phone box

The console runs on the same VPS that answers the phone (ADR 0002), as its own compose
project `fonnus-admin` in `~/fonnus-admin`, beside the pipeline's `fonnus` project in
`~/fonnus`. The box itself — host, user, what else runs there — is described once, in
`../Fonnus/CONTEXT.md` §Deployment.

## What runs where

`~/fonnus-admin` holds exactly this, and no source tree:

| File | Who writes it |
|---|---|
| `compose.yml` | CI, every deploy (from this repo) |
| `deploy.sh` | CI, every deploy (the copy of `ops/deploy.sh`, at the top level — `bash deploy.sh`, never `ops/deploy.sh`) |
| `caddy/Caddyfile` | CI, every deploy |
| `caddy/users` | **you, by hand.** One `<name> <bcrypt hash>` line per team member. CI never touches it |
| `.env` | **you, by hand.** `DATABASE_URL`, `ADMIN_DOMAIN`, `ADMIN_IMAGE`. CI never touches it |
| `.admin-last-good`, `.admin-previous` | `deploy.sh`, on every successful deploy |

Two containers: `admin` (this app, no published port, on the pipeline's network
`fonnus_default` where it reaches `postgres:5432` as role `console`) and `caddy` (the only
process on the box bound to `0.0.0.0:80` and `:443`).

A hand edit to `compose.yml`, `deploy.sh` or `caddy/Caddyfile` on the box is overwritten by
the next deploy. Change them in this repo and push.

## 1. One-time setup, in this order

The order matters: DNS must resolve before Caddy first starts, and the database role must
be able to log in before the health gate can pass.

### 1.1 GitHub

Create the repository **private**, and point this checkout at it:

```bash
gh repo create VoidKeishi/Fonnus-Admin --private
git remote add origin git@github.com:VoidKeishi/Fonnus-Admin.git
git push -u origin main
```

Private is not a preference. This file and `PLAN.md` name the box's address and the deploy
user, so making the repository public would publish them, and taking them back out means
rewriting history — the same condition the pipeline repo records for itself
(`../Fonnus/CONTEXT.md` §Deployment).

Then, in Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| Environment `production` secret | `VPS_SSH_KEY` | Private half of a CI keypair generated for this repo, whole file including the header lines |
| Environment `production` secret | `VPS_KNOWN_HOSTS` | Same value as the pipeline repo's — the same box (`ssh-keyscan 103.74.100.161`, from a machine you trust) |
| Environment `production` variable | `VPS_HOST` | `103.74.100.161` |
| Environment `production` variable | `VPS_USER` | `deploy` |
| **Repository** variable | `DEPLOY_ENABLED` | `true` to deploy; anything else builds and pushes only |

`DEPLOY_ENABLED` must be a *repository* variable. The deploy job's
`if: vars.DEPLOY_ENABLED == 'true'` is evaluated before the job enters the `production`
environment, so an environment-level value reads as empty there and the job is silently
skipped (`../Fonnus/docs/runbook.md` §6.2). Leave it unset until §1.8 has passed by hand.

The CI keypair is this repo's own — one more line in the box's `~/.ssh/authorized_keys`,
so it can be revoked without touching the pipeline's deploys:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/fonnus_admin_ci -C 'fonnus-admin CI'
ssh fonnus 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/fonnus_admin_ci.pub
```

### 1.2 DNS

The console's hostname is `admin.fonnus.me`. Give it an A record pointing at
`103.74.100.161`. Confirm it resolves **before** Caddy ever starts — Let's Encrypt
rate-limits failed validation attempts, so a premature first start costs an hour of waiting:

```bash
dig +short admin.fonnus.me      # must answer 103.74.100.161
```

### 1.3 Directories and the registry login

```bash
ssh fonnus
mkdir -p ~/fonnus-admin/caddy
docker login ghcr.io      # username = GitHub login, password = a PAT with read:packages
```

The box already has this login for the pipeline's images (`../Fonnus/docs/runbook.md` §6.1);
the same owner's PAT pulls this package too, so the login is usually already in place —
`grep ghcr.io ~/.docker/config.json` confirms it.

### 1.4 The accounts file

One account per team member, never a shared one (ADR 0002 point 2). `hash-password` prompts
for the password and prints the bcrypt hash:

```bash
docker run --rm -it caddy:2.11 caddy hash-password
printf '%s %s\n' '<name>' '<hash>' >> ~/fonnus-admin/caddy/users
chmod 600 ~/fonnus-admin/caddy/users
```

Repeat per person. The file is read by the committed `Caddyfile` through
`import /etc/caddy/users`; it never enters git.

### 1.5 Give the `console` role a login

The pipeline's migration 0006 creates the role without a password — a committed migration
cannot carry one. `../Fonnus/docs/runbook.md` §9 is the procedure; generate the value
without a `$`, because compose interpolates `$` in `.env` values:

```bash
openssl rand -hex 24
ssh fonnus 'cd ~/fonnus && docker compose exec -T postgres psql -U fonnus -d fonnus \
  -c "alter role console login password '"'"'<value>'"'"';"'
ssh fonnus 'cd ~/fonnus && docker compose exec -T postgres psql -U fonnus -d fonnus -c "\du console"'
# Attributes reads "Cannot login" before, and is empty after.
```

### 1.6 `~/fonnus-admin/.env`

```bash
cat > ~/fonnus-admin/.env <<'ENV'
DATABASE_URL=postgres://console:<value>@postgres:5432/fonnus
ADMIN_DOMAIN=admin.fonnus.me
ADMIN_IMAGE=ghcr.io/voidkeishi/fonnus-admin
ENV
chmod 600 ~/fonnus-admin/.env
```

`ADMIN_IMAGE_TAG` is deliberately absent: `deploy.sh` passes it per run, and compose falls
back to `:local` — which does not exist in the registry — so a command that forgets the tag
fails at `pull` instead of starting something unexpected.

### 1.7 Firewall

The only change to the set in `../Fonnus/docs/runbook.md` §3.2. Look before you add:

```bash
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Nothing for 5432 — the database stays on the bridge network
(`../Fonnus/docs/adr/0017-console-read-access.md` §3). Know what these rules do and do not
do: Docker's published ports are DNAT'd before the host's INPUT chain, so `ufw` does not
actually gate 80 and 443 for the `caddy` container. The rules record intent and cover any
future host-networked listener; the real off-switch for the console is
`docker compose stop caddy`.

### 1.8 The first deploy, by hand

Do it by hand once, so the certificate is obtained while you are watching:

```bash
scp compose.yml ops/deploy.sh fonnus:~/fonnus-admin/
scp caddy/Caddyfile fonnus:~/fonnus-admin/caddy/
ssh fonnus 'cd ~/fonnus-admin && ADMIN_IMAGE_TAG='"$(git rev-parse origin/main)"' bash deploy.sh'
ssh fonnus 'cd ~/fonnus-admin && docker compose logs -f caddy'   # wait for "certificate obtained"
```

The image must already be in GHCR: push to `main` first and let `build-admin` finish.
Then set `DEPLOY_ENABLED=true` and every later push deploys itself.

### 1.9 Record the new listeners in the pipeline repo — same sitting as 1.8

The box now has a process on `0.0.0.0:80` and `:443` that was not there before, and
`../Fonnus/CONTEXT.md` §Deployment is the one place the box's live state is written down
(this repo's ADR 0002 point 5 requires the two to move together). Open a session in
`../Fonnus` — never edit that repo from here — and replace its live-state block's account of
what listens on the box with this paragraph, filling in the two dates, the domain and the
deployed SHA:

> Since <date> the console (`../Fonnus-Admin`, its ADR 0002) runs on this box too, as
> compose project `fonnus-admin` in `~/fonnus-admin`: `caddy` (`caddy:2.11`) is the only
> process bound to `0.0.0.0:80` and `:443` — auto-TLS for `admin.fonnus.me`, `basic_auth`
> with one account per team member in `~/fonnus-admin/caddy/users` — and `admin`
> (`ghcr.io/voidkeishi/fonnus-admin:<sha>`, recorded in `~/fonnus-admin/.admin-last-good`)
> publishes no port and is attached to `fonnus_default`, reaching `postgres:5432` as role
> `console` (runbook §9 run <date>). `ufw` gained `80/tcp` and `443/tcp`, the only change to
> §3.2's set; Postgres is still `127.0.0.1` only. Consequence: `docker compose down` here
> fails to remove `fonnus_default` while `admin` is attached (runbook §9).

Until that is done, the pipeline's own docs describe a box that no longer exists.

## 2. What a deploy does

`ops/deploy.sh`, in order:

1. **Preflight** — `ADMIN_IMAGE_TAG` set; `.env` present with a non-empty `DATABASE_URL`
   and `ADMIN_DOMAIN`; `caddy/users` non-empty; the Caddyfile validates (in a throwaway
   caddy container, so a broken file that CI just copied in is caught before anything moves).
2. **Pull** the new image, before anything is swapped.
3. **Up** `admin` on the new tag.
4. **Health gate**, up to 60 s (`HEALTH_SEC`): `node -e fetch(...)` inside the container
   against `/api/healthz`, which must answer `200` **and** `"role":"console"`. A `503`
   `degraded` means the app connected as some other role — the wrong credential in `.env`.
5. **Record**: the superseded SHA into `.admin-previous`, the new one into
   `.admin-last-good`.
6. **Caddy**: `up -d`, which starts it on the first deploy and recreates it whenever the
   caddy service itself changed (image, ports, volumes, `ADMIN_DOMAIN`); a container that
   survived that is sent SIGUSR1 to reload the Caddyfile in place. Then the script asserts
   caddy is actually running and exits 1 if it is not — a healthy `admin` behind a caddy
   that cannot bind 80/443 is a site that is down.
7. **Prune** to two images of `ghcr.io/voidkeishi/fonnus-admin` — the running one and the
   rollback target. Repository-scoped on purpose: a blanket `docker image prune -a` on this
   box would also delete the pipeline's rollback image and its FreeSWITCH image.

On failure: the last health body and the last 50 log lines are printed, the SHA in
`.admin-last-good` is brought back up, and the script exits 1. The very first deploy has
nothing to roll back to, so it leaves the broken container running for debugging.

## 3. Restart or roll back by hand

Every compose command in `~/fonnus-admin` names the tag — a bare `docker compose up -d`
pulls `:local` and fails.

```bash
cd ~/fonnus-admin
ADMIN_IMAGE_TAG=$(cat .admin-last-good) docker compose up -d admin   # restart what runs
ADMIN_IMAGE_TAG=$(cat .admin-previous) bash deploy.sh                # roll back one version
```

The probe the health gate uses, to run by hand:

```bash
docker compose exec -T admin node -e \
  'fetch("http://127.0.0.1:3000/api/healthz").then(async r=>console.log(r.status, await r.text()))'
```

## 4. Team accounts

Adding, removing and rotating are all one line in `~/fonnus-admin/caddy/users`. A departure
is one deleted line; never a shared account (ADR 0002 point 2).

```bash
cd ~/fonnus-admin
docker run --rm -it caddy:2.11 caddy hash-password        # add or rotate
$EDITOR caddy/users
docker compose kill -s USR1 caddy                          # in-process reload
docker compose logs --tail 5 caddy                         # expect a reload line, no error
```

If the reload does not take, `docker compose restart caddy` — about a second of refused
connections, and it re-reads everything.

## 5. Rotating the console database password

`../Fonnus/docs/runbook.md` §9 with a new `$`-free value, then this side:

```bash
openssl rand -hex 24
ssh fonnus 'cd ~/fonnus && docker compose exec -T postgres psql -U fonnus -d fonnus \
  -c "alter role console password '"'"'<new>'"'"';"'
# then on the box, in ~/fonnus-admin:
$EDITOR .env                                                  # DATABASE_URL
ADMIN_IMAGE_TAG=$(cat .admin-last-good) docker compose up -d admin
docker compose exec -T admin node -e \
  'fetch("http://127.0.0.1:3000/api/healthz").then(async r=>console.log(r.status, await r.text()))'
```

Revoking access entirely, without touching grants, is `alter role console nologin` on the
pipeline side.

## 6. Changing the Caddyfile

Edit `caddy/Caddyfile` in this repo and push: the next deploy copies it in, validates it and
reloads Caddy. A hand edit on the box lives only until the next deploy.

## 7. Known consequences

- While `admin` is attached to `fonnus_default`, `docker compose down` in `~/fonnus`
  removes the pipeline's containers but cannot remove that network, and says so
  (`../Fonnus/docs/runbook.md` §9). Nothing depends on the network being deleted.
- `docker compose down -v` in `~/fonnus-admin` deletes the `caddy-data` volume, and with it
  the certificates and the ACME account. Re-issuing runs into Let's Encrypt's rate limits.
- Disk: two console images of roughly 300 MB each (ASSUMED — measure with
  `docker image ls ghcr.io/voidkeishi/fonnus-admin` after the first deploy) beside the
  pipeline's own two. The box had 8.6 GB free on 2026-09-08.
