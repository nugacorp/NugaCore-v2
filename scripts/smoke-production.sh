#!/usr/bin/env bash
# ====================================================================
# Smoke test de PRODUCCIÓN (extiende smoke-staging.sh).
# Uso: bash scripts/smoke-production.sh https://nugacore.tudominio.com
# Opcional: AUTH_BEARER=<jwt> para validar production-readiness API.
# ====================================================================
set -u
BASE="${1:?Uso: smoke-production.sh <BASE_URL>}"
pass=0; fail=0
chk() { if [ "$2" = "0" ]; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1"; fail=$((fail+1)); fi }

echo "== Smoke PRODUCCIÓN: $BASE =="

# Ejecutar smoke base de staging (seguridad HTTP, GIS, webhooks)
if bash "$(dirname "$0")/smoke-staging.sh" "$BASE"; then
  chk "smoke-staging base" 0
else
  chk "smoke-staging base" 1
fi

# Ready debe responder (200 si DB ok, 503 si Supabase caído con flags DB)
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health/ready")
chk "health/ready responde (200/503, =$code)" "$([ "$code" = 200 ] || [ "$code" = 503 ] && echo 0 || echo 1)"

# Prometheus deshabilitado por defecto (404 esperado)
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/metrics/prometheus")
chk "metrics/prometheus 404 si deshabilitado (=$code)" "$([ "$code" = 404 ] && echo 0 || echo 1)"

# Production readiness (requiere JWT)
if [ -n "${AUTH_BEARER:-}" ]; then
  body=$(curl -s -H "Authorization: Bearer $AUTH_BEARER" "$BASE/api/system/production-readiness")
  echo "$body" | grep -q '"readyForProduction"'; chk "production-readiness JSON" "$?"
  echo "$body" | grep -q '"readyForProduction":true'; ready=$?
  if [ "$ready" = 0 ]; then chk "readyForProduction=true" 0; else chk "readyForProduction=true (aún hay blockers)" 1; fi
else
  echo "  INFO  AUTH_BEARER no definido — omitiendo production-readiness"
fi

echo "== Resultado producción: $pass PASS, $fail FAIL =="
[ "$fail" = 0 ]
