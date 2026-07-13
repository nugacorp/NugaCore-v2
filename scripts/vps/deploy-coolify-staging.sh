#!/usr/bin/env bash
# Despliega una rama en Coolify staging (nugacore-staging) y opcionalmente añade env vars.
#
# Uso:
#   BRANCH=cursor/snmp-live-mikrotik-wizard-cb99 bash scripts/vps/deploy-coolify-staging.sh
#   ADD_SNMP_ENV=true bash scripts/vps/deploy-coolify-staging.sh
set -euo pipefail

BRANCH="${BRANCH:-main}"
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
  docker exec coolify php -r "
require '/var/www/html/vendor/autoload.php';
\$app = require_once '/var/www/html/bootstrap/app.php';
\$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
\$appId = ${APP_ID};
\$key = '${key}';
\$plain = '${val}';
\$runtime = ${runtime};
\$buildtime = ${buildtime};
\$rows = App\Models\EnvironmentVariable::where('resourceable_id', \$appId)
  ->where('resourceable_type', 'App\\\\Models\\\\Application')
  ->where('key', \$key)->where('is_preview', false)->get();
foreach (\$rows as \$row) { \$row->delete(); }
\$v = new App\Models\EnvironmentVariable();
\$v->uuid = (string) new Visus\Cuid2\Cuid2();
\$v->key = \$key;
\$v->value = \$plain;
\$v->is_preview = false;
\$v->is_runtime = \$runtime;
\$v->is_buildtime = \$buildtime;
\$v->version = '4.0';
\$v->is_literal = false;
\$v->is_required = false;
\$v->is_shared = false;
\$v->resourceable_type = 'App\\\\Models\\\\Application';
\$v->resourceable_id = \$appId;
\$v->save();
" >/dev/null
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

DEPLOY_UUID="$(echo "$DEPLOY_OUT" | grep -o 'queued:[^[:space:]]*' | head -1 | cut -d: -f2)"
[[ -n "$DEPLOY_UUID" ]] || fail "deploy no encolado: $DEPLOY_OUT"
log "deploy uuid=${DEPLOY_UUID}"

log "esperando deploy finished (max ${WAIT_SECS}s)..."
deadline=$((SECONDS + WAIT_SECS))
while (( SECONDS < deadline )); do
  status="$(docker exec coolify-db psql -U coolify -d coolify -At -c \
    "SELECT status FROM application_deployment_queues WHERE deployment_uuid='${DEPLOY_UUID}' LIMIT 1;" 2>/dev/null || echo unknown)"
  if [[ "$status" == "finished" ]]; then
    log "deploy status=finished"
    break
  fi
  if [[ "$status" == "failed" ]]; then
    fail "deploy status=failed (uuid=${DEPLOY_UUID})"
  fi
  sleep 15
done
[[ "$status" == "finished" ]] || fail "timeout esperando deploy finished (last status=${status})"

log "validando health..."
code="$(curl -fsS -m 10 -o /dev/null -w '%{http_code}' "${APP_URL}/api/health/live" 2>/dev/null || echo 000)"
[[ "$code" == "200" ]] || fail "health/live=${code}"
log "health/live=200 — deploy OK"
