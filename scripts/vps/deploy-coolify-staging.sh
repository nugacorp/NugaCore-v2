#!/usr/bin/env bash
# Despliega una rama en Coolify staging (nugacore-staging) y opcionalmente añade env vars.
#
# Uso:
#   BRANCH=cursor/snmp-live-mikrotik-wizard-cb99 bash scripts/vps/deploy-coolify-staging.sh
#   ADD_SNMP_ENV=true bash scripts/vps/deploy-coolify-staging.sh
set -euo pipefail

BRANCH="${BRANCH:-cursor/snmp-live-mikrotik-wizard-cb99}"
APP_NAME="${COOLIFY_APP_NAME:-nugacore-staging}"
ADD_SNMP_ENV="${ADD_SNMP_ENV:-true}"
WAIT_SECS="${WAIT_SECS:-600}"
APP_URL="${APP_URL:-https://nugacore-staging.5.180.151.109.sslip.io}"

log() { printf '[coolify-deploy] %s\n' "$1"; }
fail() { printf '[coolify-deploy] ERROR: %s\n' "$1" >&2; exit 1; }

[[ "$(id -u)" -ne 0 ]] && fail "ejecutar como root en el VPS"

APP_ID="$(docker exec coolify-db psql -U coolify -d coolify -At -c \
  "SELECT id FROM applications WHERE name='${APP_NAME}' LIMIT 1;")"
[[ -n "$APP_ID" ]] || fail "app ${APP_NAME} no encontrada en Coolify"

log "app id=${APP_ID} branch=${BRANCH}"

docker exec coolify-db psql -U coolify -d coolify -c \
  "UPDATE applications SET git_branch='${BRANCH}', updated_at=NOW() WHERE id=${APP_ID};" >/dev/null

upsert_env() {
  local key="$1" val="$2" runtime="${3:-true}" buildtime="${4:-false}"
  local exists
  exists="$(docker exec coolify-db psql -U coolify -d coolify -At -c \
    "SELECT id FROM environment_variables WHERE resourceable_type='App\\\\Models\\\\Application' AND resourceable_id=${APP_ID} AND key='${key}' AND is_preview=false LIMIT 1;")"
  if [[ -n "$exists" ]]; then
    docker exec coolify-db psql -U coolify -d coolify -c \
      "UPDATE environment_variables SET value='${val}', is_runtime=${runtime}, is_buildtime=${buildtime}, resourceable_type='App\\Models\\Application', updated_at=NOW() WHERE id=${exists};" >/dev/null
  else
    local new_uuid
    new_uuid="$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)"
    docker exec coolify-db psql -U coolify -d coolify -c \
      "INSERT INTO environment_variables (uuid, key, value, is_preview, is_runtime, is_buildtime, version, is_literal, is_required, is_shared, resourceable_type, resourceable_id, created_at, updated_at)
       VALUES ('${new_uuid}', '${key}', '${val}', false, ${runtime}, ${buildtime}, '4.0', false, false, false, 'App\\Models\\Application', ${APP_ID}, NOW(), NOW());" >/dev/null
  fi
  log "env ${key}=${val}"
}

if [[ "$ADD_SNMP_ENV" == "true" ]]; then
  upsert_env "MIKROTIK_VPN_HOST" "5.180.151.109"
  upsert_env "MIKROTIK_VPN_CIDR" "10.70.0.0/16"
  upsert_env "MIKROTIK_MGMT_CIDR" "10.0.0.0/24"
  upsert_env "USE_DB_WIREGUARD" "true"
  upsert_env "SNMP_POLLER_ENABLED" "false"
  upsert_env "SNMP_POLLER_INTERVAL_MS" "120000"
  upsert_env "NOC_POLLER_ENABLED" "false"
  # MIKROTIK_WORKER_LIVE queda false (piloto CHR lo activará)
fi

log "limpiando cola de deploy..."
docker exec coolify php artisan cleanup:deployment-queue --force 2>/dev/null || true
docker exec coolify php artisan check:deployment-queue --force --seconds=0 2>/dev/null || true

log "disparando deploy (tinker)..."
DEPLOY_OUT="$(docker exec coolify php artisan tinker --execute="
\$app = App\\Models\\Application::find(${APP_ID});
if (!\$app) { echo 'ERR:no_app'; exit(1); }
\$app->git_branch = '${BRANCH}';
\$app->save();
\$uuid = (string) new Visus\\Cuid2\\Cuid2();
queue_application_deployment(application: \$app, deployment_uuid: \$uuid, force_rebuild: true, pull_request_id: 0, is_api: true);
echo 'queued:' . \$uuid;
" 2>&1)" || fail "no se pudo encolar deploy"
echo "$DEPLOY_OUT" | tail -3
echo "$DEPLOY_OUT" | grep -q 'queued:' || fail "deploy no encolado: $DEPLOY_OUT"

log "esperando health (max ${WAIT_SECS}s)..."
deadline=$((SECONDS + WAIT_SECS))
while (( SECONDS < deadline )); do
  code="$(curl -fsS -m 10 -o /dev/null -w '%{http_code}' "${APP_URL}/api/health/live" 2>/dev/null || echo 000)"
  if [[ "$code" == "200" ]]; then
    snmp_code="$(curl -fsS -m 10 -o /dev/null -w '%{http_code}' "${APP_URL}/api/snmp/health" 2>/dev/null || echo 000)"
    log "health/live=200 snmp/health=${snmp_code}"
    exit 0
  fi
  sleep 15
done

fail "timeout esperando ${APP_URL}/api/health/live"
