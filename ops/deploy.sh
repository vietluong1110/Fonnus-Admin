#!/usr/bin/env bash
#
# Swap the running `admin` container for the image tagged ADMIN_IMAGE_TAG.
#
# Runs ON THE BOX, from the deploy directory (~/fonnus-admin) that holds the live
# .env, caddy/users, compose.yml and this script. CI copies compose.yml, this file
# and caddy/Caddyfile in and then runs `ADMIN_IMAGE_TAG=<sha> bash deploy.sh`; it is
# equally usable by hand (docs/deploy.md §3).
#
# What the pipeline's ops/deploy.sh has and this does not, all on purpose: no drain
# (this console holds no calls — a restart costs a page reload), no ESL assertion
# (there is no telephony here), no migrations (the role `console` cannot write).
set -euo pipefail

HEALTH_SEC="${HEALTH_SEC:-60}"
LAST_GOOD_FILE=".admin-last-good"
# The path inside the caddy container; ./caddy is mounted there read-only.
CADDYFILE=/etc/caddy/Caddyfile

log() { printf '[deploy] %s\n' "$*"; }
fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

# ── Preconditions: name the missing thing instead of rolling back later ──────
[ -n "${ADMIN_IMAGE_TAG:-}" ] || fail "ADMIN_IMAGE_TAG is not set - pass the image tag to deploy"
# A tag that is not a tag reaches `docker pull` as an invalid reference, whose
# error names neither the variable nor where it came from. The usual source is a
# `$(git rev-parse …)` that was never expanded, because the ssh command carrying
# it was quoted so the substitution stayed literal (docs/deploy.md §1.8).
case "$ADMIN_IMAGE_TAG" in
  *[!A-Za-z0-9._-]* | -* | .* | '')
    fail "ADMIN_IMAGE_TAG is not a Docker tag: '${ADMIN_IMAGE_TAG}' - if it still shows a \$(...) command, resolve the SHA before the ssh command (docs/deploy.md §1.8)" ;;
esac
[ -f ./.env ] || fail "no .env in $(pwd) - the live secrets file is hand-maintained on this box"

# DATABASE_URL gates the app's every screen; ADMIN_DOMAIN is what Caddy serves and
# requests a certificate for, and compose refuses to start caddy without it.
for key in DATABASE_URL ADMIN_DOMAIN; do
  if ! grep -Eq "^${key}=.+" ./.env; then
    fail "${key} is missing or empty in .env"
  fi
done

# Without accounts the Caddyfile's `import` fails and the site would come up open
# to the world if it came up at all.
[ -s ./caddy/users ] || fail "caddy/users is missing or empty - one '<name> <bcrypt>' line per person (docs/deploy.md §4)"
# Every account line must be a name and a bcrypt hash. The hash is full of `$`,
# which a double-quoted shell command mangles on the way into this file; Caddy
# then fails deep inside module provisioning with a base64 complaint that names
# neither the file nor the line. Catch it here instead.
# shellcheck disable=SC2016  # the `$` are literal: they are bcrypt's own separators.
if grep -vE '^[[:space:]]*(#|$)' ./caddy/users | grep -qvE '^[^[:space:]]+[[:space:]]+\$2[aby]\$[0-9]{2}\$.{53}$'; then
  fail "caddy/users has a line that is not '<name> <bcrypt hash>' - a hash mangled by shell expansion of its \$ is the usual cause (docs/deploy.md §1.4)"
fi
[ -f ./caddy/Caddyfile ] || fail "caddy/Caddyfile is missing"

# Compose interpolates ADMIN_IMAGE from .env; this shell does not. Mirror it so the
# prune below lists the same repository compose pulls from.
if [ -z "${ADMIN_IMAGE:-}" ]; then
  ADMIN_IMAGE="$(grep -E '^ADMIN_IMAGE=.+' ./.env | head -n1 | cut -d= -f2- || true)"
fi
ADMIN_IMAGE="${ADMIN_IMAGE:-ghcr.io/voidkeishi/fonnus-admin}"

# The Caddyfile CI just copied in may be broken; find that out before anything
# moves. `run`, not `exec`: on the first deploy there is no caddy container yet.
docker compose run --rm -T caddy caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null ||
  fail "caddy/Caddyfile does not validate (caddy/users is imported into it)"

LAST_GOOD="$(cat "$LAST_GOOD_FILE" 2>/dev/null || true)"
log "deploying ${ADMIN_IMAGE_TAG}${LAST_GOOD:+ (last good: ${LAST_GOOD})}"

# ── Health helpers ──────────────────────────────────────────────────────────
# `admin` publishes no port, so the probe runs inside the container with node's
# fetch rather than curl from the host.
PROBE_JS='fetch("http://127.0.0.1:3000/api/healthz",{signal:AbortSignal.timeout(3000)}).then(async r=>process.stdout.write(r.status+" "+await r.text())).catch(e=>process.stdout.write("ERR "+e.message))'
HEALTH_BODY=""

probe() { HEALTH_BODY="$(docker compose exec -T admin node -e "$PROBE_JS" 2>/dev/null || true)"; }

# 200 with role `console`. A 503 "degraded" means the app connected as some other
# role — the wrong credential in .env — and is not a deploy worth keeping (README.md).
healthy() {
  case "$HEALTH_BODY" in
    200\ *'"role":"console"'*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_healthy() {
  local deadline=$((SECONDS + HEALTH_SEC))
  while [ "$SECONDS" -lt "$deadline" ]; do
    probe
    if healthy; then return 0; fi
    sleep 3
  done
  return 1
}

# ── 1. Pull the new image, before anything is swapped ───────────────────────
log "pulling admin image"
ADMIN_IMAGE_TAG="$ADMIN_IMAGE_TAG" docker compose pull admin

# ── 2. Swap ─────────────────────────────────────────────────────────────────
log "starting admin on ${ADMIN_IMAGE_TAG}"
ADMIN_IMAGE_TAG="$ADMIN_IMAGE_TAG" docker compose up -d admin

# ── 3. Health gate ──────────────────────────────────────────────────────────
if wait_healthy; then
  log "healthy on ${ADMIN_IMAGE_TAG}"

  # The editor credential is optional and never gates the deploy (ADR 0007): the
  # read screens do not use it, so a bad value must not roll a good image back.
  # But a key set in .env that the app cannot log in with would otherwise stay
  # silent until the first save, so say it here, once, where it is being read.
  if grep -Eq '^EDITOR_DATABASE_URL=.+' ./.env; then
    case "$HEALTH_BODY" in
      *'"editor":{"role":"console_editor","status":"ok"}'*) ;;
      *) log "warning: EDITOR_DATABASE_URL is set but the editor probe is not ok: ${HEALTH_BODY}" ;;
    esac
  fi
  # Remember what is being superseded BEFORE last-good is overwritten: after this
  # deploy .admin-last-good is the SHA now running, so a hand rollback reads the
  # previous good SHA from .admin-previous (docs/deploy.md §3).
  if [ -n "$LAST_GOOD" ] && [ "$LAST_GOOD" != "$ADMIN_IMAGE_TAG" ]; then
    printf '%s\n' "$LAST_GOOD" >.admin-previous
  fi
  printf '%s\n' "$ADMIN_IMAGE_TAG" >"$LAST_GOOD_FILE"

  # ── 4. Caddy: `up -d` first, so that a change to the caddy service itself
  #      (image, ports, volumes, ADMIN_DOMAIN) is actually applied — it recreates
  #      the container then, and is a no-op otherwise. A container that survived
  #      `up -d` still runs the Caddyfile it started with, so it gets SIGUSR1, the
  #      in-process reload (`caddy reload` would need the admin API, which the
  #      Caddyfile turns off). Then assert caddy is up: the public surface is the
  #      whole point of the deploy, and a caddy that cannot bind 80/443 must not
  #      pass as success.
  caddy_before="$(docker compose ps -q caddy 2>/dev/null || true)"
  log "starting caddy"
  docker compose up -d caddy
  caddy_after="$(docker compose ps -q caddy 2>/dev/null || true)"
  if [ -n "$caddy_before" ] && [ "$caddy_before" = "$caddy_after" ]; then
    log "reloading caddy"
    docker compose kill -s USR1 caddy
  fi
  sleep 3
  if [ -z "$(docker compose ps -q --status running caddy)" ]; then
    log "ERROR: caddy is not running - the site is down even though admin is healthy"
    docker compose logs --tail 50 caddy || true
    exit 1
  fi

  # ── 5. Keep exactly two admin images: the running one and the rollback target.
  #      Repository-scoped, never `docker image prune -a`: this box also holds the
  #      pipeline's rollback image and its FreeSWITCH image, whose rebuild is an hour.
  while read -r image; do
    [ -n "$image" ] || continue
    tag="${image##*:}"
    case "$tag" in
      "$ADMIN_IMAGE_TAG" | "${LAST_GOOD:-$ADMIN_IMAGE_TAG}" | latest | '<none>') continue ;;
    esac
    log "removing superseded image ${image}"
    docker rmi "$image" >/dev/null 2>&1 || true
  done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' "$ADMIN_IMAGE" || true)
  log "done"
  exit 0
fi

# ── 6. Failure: roll back to the last image that passed this same gate ──────
log "ERROR: ${ADMIN_IMAGE_TAG} did not become healthy within ${HEALTH_SEC}s"
log "last health body: ${HEALTH_BODY:-<no response>}"
docker compose logs --tail 50 admin || true

if [ -z "$LAST_GOOD" ]; then
  # First deploy on this box: there is nothing to roll back to, and a stopped
  # container tells the next person less than a running broken one.
  fail "no ${LAST_GOOD_FILE} to roll back to - leaving the container up for debugging"
fi

log "rolling back to ${LAST_GOOD}"
ADMIN_IMAGE_TAG="$LAST_GOOD" docker compose up -d admin
if wait_healthy; then
  log "rolled back to ${LAST_GOOD}, healthy"
else
  log "ERROR: rollback to ${LAST_GOOD} is also unhealthy - last body: ${HEALTH_BODY:-<no response>}"
fi
exit 1
