#!/usr/bin/env bash
# ====================================================================
# NugaCore — Validación post-deploy de STAGING (la ejecuta HERMES)
#
# Uso:
#   APP_URL=https://staging.nugacore.com bash scripts/vps/validate-staging.sh
#
# Opcional (crear cliente de prueba; en prod requiere JWT por Fase 2):
#   APP_URL=... CREATE_TEST_CLIENT=true AUTH_BEARER=<jwt> bash scripts/vps/validate-staging.sh
#
# No imprime secretos. Resumen claro PASS/FAIL. Exit 0 si todo PASS.
# ====================================================================
set -u

APP_URL="${APP_URL:-}"
CREATE_TEST_CLIENT="${CREATE_TEST_CLIENT:-false}"
AUTH_BEARER="${AUTH_BEARER:-}"
PASS=0; FAIL=0

ok()  { printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
info(){ printf '  [INFO] %s\n' "$1"; }

if [ -z "$APP_URL" ]; then
  echo "ERROR: define APP_URL. Ej: APP_URL=https://staging.nugacore.com bash scripts/vps/validate-staging.sh"
  exit 2
fi
APP_URL="${APP_URL%/}"  # quitar slash final
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT

# http GET <path> -> imprime status; deja el body en $TMP
http_get() {
  curl -fsS -m 15 -o "$TMP" -w '%{http_code}' "$APP_URL$1" 2>/dev/null || echo "000"
}

echo "==================================================================="
echo " NugaCore validate-staging  ·  $APP_URL  ·  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "==================================================================="

# 1) Health endpoints
code=$(http_get /api/health/live)
[ "$code" = "200" ] && ok "/api/health/live -> 200" || bad "/api/health/live -> $code"

code=$(http_get /api/health/ready)
[ "$code" = "200" ] && ok "/api/health/ready -> 200" || bad "/api/health/ready -> $code"

code=$(http_get /api/health)
if [ "$code" = "200" ]; then
  ok "/api/health -> 200"
  body="$(cat "$TMP")"
  # version/env (no secretos)
  ver=$(printf '%s' "$body" | grep -o '"version":"[^"]*"' | head -n1)
  env=$(printf '%s' "$body" | grep -o '"env":"[^"]*"' | head -n1)
  info "salud: ${ver:-version?} ${env:-env?}"
  # persistencia: debe indicar customers en DB (mixed o domainsOnDb con customers)
  if printf '%s' "$body" | grep -q '"persistence":"mixed"' && printf '%s' "$body" | grep -q 'customers'; then
    ok "persistence=mixed con customers en DB"
  elif printf '%s' "$body" | grep -q '"persistence":"in-memory"'; then
    bad "persistence=in-memory (USE_DB_CUSTOMERS no está activo; se esperaba DB)"
  else
    bad "no se pudo confirmar persistence=mixed con customers"
  fi
else
  bad "/api/health -> $code"
fi

# 2) Customers (lectura abierta; en prod los GET no exigen auth)
code=$(http_get /api/clients)
if [ "$code" = "200" ]; then
  if head -c1 "$TMP" | grep -q '\['; then
    n=$(grep -o '"id"' "$TMP" | wc -l | tr -d ' ')
    ok "/api/clients -> 200 (arreglo, ~$n registros)"
  else
    bad "/api/clients -> 200 pero la respuesta no es un arreglo JSON"
  fi
else
  bad "/api/clients -> $code"
fi

# 3) (Opcional) crear cliente ficticio de prueba
if [ "$CREATE_TEST_CLIENT" = "true" ]; then
  echo "[opcional] CREATE_TEST_CLIENT=true"
  if [ -z "$AUTH_BEARER" ]; then
    info "No se pasó AUTH_BEARER. En producción (Fase 2) la escritura exige JWT -> el alta daría 401."
    info "Para probar el alta: obtén un JWT (login Supabase) y pásalo en AUTH_BEARER. Omitido."
  else
    body='{"name":"VALIDATE STAGING (borrar)","type":"residential","address":"calle test","city":"CDMX","planId":"plan-basic"}'
    created_code=$(curl -fsS -m 15 -o "$TMP" -w '%{http_code}' \
      -H "Authorization: Bearer $AUTH_BEARER" -H "Content-Type: application/json" \
      -X POST "$APP_URL/api/clients" -d "$body" 2>/dev/null || echo "000")
    if [ "$created_code" = "201" ]; then
      cid=$(grep -o '"id":"[^"]*"' "$TMP" | head -n1 | sed 's/.*:"//;s/"//')
      ok "alta de cliente -> 201 (id=$cid)"
      rcode=$(curl -fsS -m 15 -o "$TMP" -w '%{http_code}' -H "Authorization: Bearer $AUTH_BEARER" "$APP_URL/api/clients/$cid" 2>/dev/null || echo "000")
      [ "$rcode" = "200" ] && ok "lectura del cliente creado -> 200" || bad "lectura del cliente creado -> $rcode"
      # limpieza: DELETE requiere rol super admin/administrador
      dcode=$(curl -fsS -m 15 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $AUTH_BEARER" -X DELETE "$APP_URL/api/clients/$cid" 2>/dev/null || echo "000")
      if [ "$dcode" = "204" ]; then ok "limpieza (DELETE) del cliente de prueba -> 204"; else info "no se pudo borrar (código $dcode). LIMPIEZA MANUAL del cliente $cid recomendada."; fi
    else
      bad "alta de cliente -> $created_code (¿rol del token suficiente?)"
    fi
  fi
fi

echo "==================================================================="
echo " Resumen: PASS=$PASS  FAIL=$FAIL"
echo "==================================================================="
if [ "$FAIL" -gt 0 ]; then echo "RESULTADO: FAIL"; exit 1; fi
echo "RESULTADO: PASS — staging operativo."
exit 0
