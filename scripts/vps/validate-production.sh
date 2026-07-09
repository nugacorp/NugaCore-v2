#!/usr/bin/env bash
# ====================================================================
# NugaCore — Validación post-deploy de PRODUCCIÓN (ejecuta el operador)
#
# Uso:
#   APP_URL=https://nugacore.tudominio.com bash scripts/vps/validate-production.sh
#   APP_URL=... AUTH_BEARER=<jwt> bash scripts/vps/validate-production.sh
# ====================================================================
set -u

APP_URL="${APP_URL:-}"
AUTH_BEARER="${AUTH_BEARER:-}"
PASS=0; FAIL=0

ok()  { printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
info(){ printf '  [INFO] %s\n' "$1"; }

if [ -z "$APP_URL" ]; then
  echo "ERROR: define APP_URL"
  exit 2
fi
APP_URL="${APP_URL%/}"

echo "==================================================================="
echo " NugaCore validate-production  ·  $APP_URL"
echo "==================================================================="

if bash "$(dirname "$0")/../smoke-production.sh" "$APP_URL"; then
  ok "smoke-production.sh"
else
  bad "smoke-production.sh"
fi

code=$(curl -fsS -m 15 -o /dev/null -w '%{http_code}' "$APP_URL/api/health/ready" 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then ok "/api/health/ready -> 200 (DB alcanzable)"
elif [ "$code" = "503" ]; then bad "/api/health/ready -> 503 (Supabase no alcanzable con flags DB)"
else bad "/api/health/ready -> $code"; fi

if [ -n "$AUTH_BEARER" ]; then
  TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
  code=$(curl -fsS -m 15 -o "$TMP" -w '%{http_code}' \
    -H "Authorization: Bearer $AUTH_BEARER" \
    "$APP_URL/api/system/production-readiness" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    if grep -q '"readyForProduction":true' "$TMP"; then
      ok "production-readiness -> readyForProduction=true"
    else
      bad "production-readiness -> aún hay blockers"
      grep -o '"id":"[^"]*"' "$TMP" | head -5 | while read -r line; do info "gate: $line"; done
    fi
  else
    bad "production-readiness -> $code"
  fi
else
  info "Sin AUTH_BEARER — omitiendo gate production-readiness"
fi

echo "==================================================================="
echo " Resumen: PASS=$PASS  FAIL=$FAIL"
echo "==================================================================="
[ "$FAIL" -eq 0 ]
