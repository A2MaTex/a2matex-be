#!/usr/bin/env bash
#
# Runs ON THE VPS. Called by GitHub Actions over SSH on every deploy, and usable
# by hand for a rollback. Pulls the requested image tag and restarts the stack.
#
# Required environment: IMAGE_REPO, IMAGE_TAG, GHCR_USER.
# The registry token is read from stdin so it never appears in a process list:
#   echo "$TOKEN" | IMAGE_REPO=... IMAGE_TAG=... GHCR_USER=... bash deploy/vps-deploy.sh
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/a2matex}"
COMPOSE_FILE="${APP_DIR}/deploy/docker-compose.prod.yaml"
ENV_FILE="${APP_DIR}/.env.production"
DEPLOY_ENV_FILE="${APP_DIR}/.env.deploy"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

: "${IMAGE_REPO:?IMAGE_REPO is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${GHCR_USER:?GHCR_USER is required}"

log() { printf '\n==> %s\n' "$1"; }

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing ${ENV_FILE}. Create it from .env.production.example first." >&2
  exit 1
fi
if grep -q 'CHANGE_ME' "$ENV_FILE"; then
  echo "${ENV_FILE} still contains CHANGE_ME placeholders." >&2
  exit 1
fi

GHCR_TOKEN="$(cat)"
if [ -z "$GHCR_TOKEN" ]; then
  echo "No registry token received on stdin." >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" --env-file "$DEPLOY_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

cd "$APP_DIR"

# Remember what is currently pinned so a failed migration can restore the pin.
PREVIOUS_REPO="$(grep -E '^IMAGE_REPO=' "$DEPLOY_ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
PREVIOUS_TAG="$(grep -E '^IMAGE_TAG=' "$DEPLOY_ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
PREVIOUS_REPO="${PREVIOUS_REPO:-$IMAGE_REPO}"; PREVIOUS_TAG="${PREVIOUS_TAG:-$IMAGE_TAG}"

log "Pinning image ${IMAGE_REPO}:${IMAGE_TAG}"
printf 'IMAGE_REPO=%s\nIMAGE_TAG=%s\n' "$IMAGE_REPO" "$IMAGE_TAG" > "$DEPLOY_ENV_FILE"

log "Logging in to ghcr.io"
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null

log "Pulling images"
compose pull --quiet

# Run migrations as a one-off job BEFORE touching the running app. If this fails
# the old app and Caddy keep serving; `up` would otherwise remove the old app
# container while waiting on the migrate dependency.
log "Applying database migrations"
if ! compose run --rm migrate < /dev/null; then
  echo "Migration failed. The previous app version is still running; nothing was replaced." >&2
  printf 'IMAGE_REPO=%s\nIMAGE_TAG=%s\n' "$PREVIOUS_REPO" "$PREVIOUS_TAG" > "$DEPLOY_ENV_FILE"
  docker logout ghcr.io >/dev/null 2>&1 || true
  exit 1
fi

log "Starting stack"
compose up -d --remove-orphans

docker logout ghcr.io >/dev/null 2>&1 || true

log "Waiting for the API to report healthy"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while :; do
  status="$(docker inspect --format '{{.State.Health.Status}}' a2matex-app 2>/dev/null || echo missing)"
  if [ "$status" = "healthy" ]; then
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "API did not become healthy within ${HEALTH_TIMEOUT}s (status: ${status})." >&2
    compose ps
    docker logs --tail 50 a2matex-migrate 2>&1 || true
    docker logs --tail 50 a2matex-app 2>&1 || true
    exit 1
  fi
  sleep 3
done

log "Removing dangling images"
docker image prune -f >/dev/null

log "Deployed ${IMAGE_REPO}:${IMAGE_TAG}"
compose ps
