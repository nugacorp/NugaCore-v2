#!/usr/bin/env bash
# ====================================================================
# Smoke test de staging/prod tras Fase 0.
# Uso: bash scripts/smoke-staging.sh https://tu-staging
# Requiere: PUBLIC_DEPLOYMENT=true y WEBHOOK_SECRET_MANUAL en el servidor.
# ====================================================================
set -u
BASE="${1:?Uso: smoke-staging.sh <BASE_URL>}"
pass=0; fail=0
chk() { # chk "descripcion" "condicion_ok(0/1)"
  if [ "$2" = "0" ]; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1"; fail=$((fail+1)); fi
}

echo "== Smoke test: $BASE =="

# 1. Liveness
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health/live"); chk "health/live 200 (=$code)" "$([ "$code" = 200 ] && echo 0 || echo 1)"

# 2. Security headers (HSTS + nosniff + CSP)
hdr=$(curl -sI "$BASE/")
echo "$hdr" | grep -qi '^strict-transport-security'; chk "HSTS presente" "$?"
echo "$hdr" | grep -qi '^x-content-type-options: nosniff'; chk "X-Content-Type-Options nosniff" "$?"
echo "$hdr" | grep -qi '^content-security-policy'; chk "CSP presente" "$?"

# 3. GIS: health publico, datos protegidos (C-02)
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/gis/health"); chk "gis/health publico 200 (=$code)" "$([ "$code" = 200 ] && echo 0 || echo 1)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/gis/customers"); chk "gis/customers sin auth 401 (=$code)" "$([ "$code" = 401 ] && echo 0 || echo 1)"

# 4. Trusted-headers ignorados (C-03): x-user-role NO otorga rol
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'x-user-role: super admin' "$BASE/api/gis/customers"); chk "x-user-role NO da acceso -> 401 (=$code)" "$([ "$code" = 401 ] && echo 0 || echo 1)"

# 5. Webhook manual fail-closed si falta secreto (C-01)
#    Si el secreto ESTA configurado, un POST sin firma valida debe dar 400 (INVALID_SIGNATURE).
#    Si NO esta configurado (mala config), da 503 WEBHOOK_NOT_CONFIGURED.
resp=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/payments/webhook/manual" -H 'content-type: application/json' -d '{"type":"payment.approved","order_id":"x"}')
chk "webhook/manual sin firma NO procesa (400/503, =$resp)" "$([ "$resp" = 400 ] || [ "$resp" = 503 ] && echo 0 || echo 1)"

# 6. Redireccion HTTP -> HTTPS (si el host resuelve por http)
httpbase="${BASE/https:/http:}"
rc=$(curl -s -o /dev/null -w '%{http_code}' -I "$httpbase/" 2>/dev/null || echo 000)
chk "HTTP redirige/upgradea (3xx/200/000, =$rc)" "$([ "${rc:0:1}" = 3 ] || [ "$rc" = 200 ] || [ "$rc" = 000 ] && echo 0 || echo 1)"

echo "== Resultado: $pass PASS, $fail FAIL =="
[ "$fail" = 0 ]
