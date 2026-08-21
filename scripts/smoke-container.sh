#!/usr/bin/env bash
# ====================================================================
# NugaCore — smoke hermético de la imagen de contenedor.
#
# ÚNICA implementación, compartida por:
#   - .github/workflows/production-gates.yml  (imagen construida en el PR)
#   - .github/workflows/release.yml           (imagen publicada, por digest)
#
# POR QUÉ ES UN SCRIPT Y NO DOS BLOQUES DE SHELL
#
# Antes había dos copias. Divergieron: la de release omitía
# MIKROTIK_CREDENTIALS_KEY, que `validateEnvironment()` exige porque el
# Dockerfile fija NODE_ENV=production. El primer release habría publicado la
# imagen y sólo después habría fallado al arrancarla, dejando etiquetas
# publicadas sin release. Con una sola implementación, ese fallo no puede
# reaparecer por divergencia.
#
# USO
#   scripts/smoke-container.sh <referencia-de-imagen>
#
# La imagen debe estar YA disponible localmente: este script no hace `pull`
# ni `push`. Quien lo llama decide de dónde viene la imagen.
#
# GARANTÍAS
#   - Arranca en NODE_ENV=production, que es como corre en un despliegue real.
#   - Satisface el fail-fast de producción con valores FICTICIOS.
#   - AUTH_TRUST_HEADERS=false: identidad sólo por JWT.
#   - Todos los USE_DB_*, pollers y gates live apagados de forma explícita,
#     para que el contenedor no intente contactar ningún servicio externo.
#   - Dominios `.invalid`: reservados por RFC 2606, nunca resuelven.
#   - Espera acotada y detección de contenedor muerto: nunca cuelga.
# ====================================================================

set -euo pipefail

IMAGE_REF="${1:-}"
if [ -z "$IMAGE_REF" ]; then
  echo "::error::uso: scripts/smoke-container.sh <referencia-de-imagen>" >&2
  exit 2
fi

# ── Valores ficticios ────────────────────────────────────────────────
# Públicos: DEBEN aparecer en /runtime-config.js.
readonly PUBLIC_URL="https://smoke.supabase.invalid"
readonly PUBLIC_ANON_KEY="anon-smoke-public-value"
# Marcador de secreto: NO debe aparecer jamás. No se imprime.
readonly SECRET_MARKER="SERVICE-ROLE-MARKER-MUST-NOT-LEAK"

readonly HEALTH_TIMEOUT_SECONDS=60

CID=""
cleanup() {
  if [ -n "$CID" ]; then
    echo "--- últimas líneas del log del contenedor ---"
    docker logs "$CID" 2>&1 | tail -40 || true
    docker rm -f "$CID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "=== smoke hermético de contenedor ==="
echo "imagen: ${IMAGE_REF}"

# `-P` deja que el kernel asigne un puerto libre: dos jobs concurrentes en el
# mismo runner no pueden colisionar.
CID=$(docker run -d -P \
  -e NODE_ENV=production \
  -e AUTH_TRUST_HEADERS=false \
  -e PUBLIC_DEPLOYMENT=false \
  -e SUPABASE_URL="$PUBLIC_URL" \
  -e SUPABASE_ANON_KEY="$PUBLIC_ANON_KEY" \
  -e SUPABASE_SERVICE_ROLE_KEY="$SECRET_MARKER" \
  -e SUPABASE_SECRET_KEY="$SECRET_MARKER" \
  -e DATABASE_URL="$SECRET_MARKER" \
  -e MIKROTIK_CREDENTIALS_KEY="$SECRET_MARKER" \
  -e WEBHOOK_SECRET_MANUAL="$SECRET_MARKER" \
  -e WEBHOOK_SECRET_OPENPAY="$SECRET_MARKER" \
  -e USE_DB_CUSTOMERS=false \
  -e USE_DB_PLANS=false \
  -e USE_DB_BILLING=false \
  -e USE_DB_PAYMENTS=false \
  -e USE_DB_SUSPENSION=false \
  -e USE_DB_INVENTORY=false \
  -e USE_DB_SUPPORT=false \
  -e USE_DB_MIKROTIK=false \
  -e USE_DB_NETWORK=false \
  -e USE_DB_TENANCY=false \
  -e USE_DB_ROUTER_ENROLLMENT=false \
  -e USE_DB_WIREGUARD=false \
  -e NOC_POLLER_ENABLED=false \
  -e SNMP_POLLER_ENABLED=false \
  -e WIREGUARD_HOST_APPLY_ENABLED=false \
  -e NUGACORE_LIVE_MODE=false \
  -e MIKROTIK_WORKER_LIVE=false \
  -e MIKROTIK_WORKER_COMMIT=false \
  -e PAYMENTS_ROUTER_LIVE=false \
  -e NOTIFICATIONS_LIVE=false \
  -e AUTOMATION_EXECUTE=false \
  -e PROVISIONING_EXECUTE=false \
  -e SAFE_COMMAND_QUEUE_LIVE=false \
  -e SERVICE_STATUS_LIVE=false \
  "$IMAGE_REF")

PORT=$(docker port "$CID" 3000/tcp | head -1 | sed 's/.*://')
echo "contenedor: ${CID:0:12}  puerto: ${PORT}"

# ── Espera acotada, con detección de muerte temprana ─────────────────
# Sin esto, un fail-fast de `validateEnvironment()` se manifestaría como 60s
# de timeout opaco en vez de "el contenedor se murió, aquí está el log".
healthy=0
for _ in $(seq 1 "$HEALTH_TIMEOUT_SECONDS"); do
  if ! docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null | grep -q true; then
    code=$(docker inspect -f '{{.State.ExitCode}}' "$CID" 2>/dev/null || echo '?')
    echo "::error::el contenedor terminó antes de responder health (exit ${code})"
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [ "$healthy" -ne 1 ]; then
  echo "::error::el contenedor no respondió /api/health/live en ${HEALTH_TIMEOUT_SECONDS}s"
  exit 1
fi
echo "health OK"

# ── Configuración pública de runtime ─────────────────────────────────
HEADERS_FILE=$(mktemp)
BODY=$(curl -fsS -D "$HEADERS_FILE" "http://127.0.0.1:${PORT}/runtime-config.js")

grep -qi '^cache-control: *no-store' "$HEADERS_FILE" \
  || { echo "::error::falta Cache-Control: no-store en /runtime-config.js"; exit 1; }
grep -qi '^content-type: *application/javascript' "$HEADERS_FILE" \
  || { echo "::error::content-type inesperado en /runtime-config.js"; exit 1; }

printf '%s' "$BODY" | grep -q "$PUBLIC_URL" \
  || { echo "::error::la URL pública inyectada no aparece en /runtime-config.js"; exit 1; }
printf '%s' "$BODY" | grep -q "$PUBLIC_ANON_KEY" \
  || { echo "::error::la anon key pública inyectada no aparece en /runtime-config.js"; exit 1; }

# El marcador nunca se imprime: sólo se reporta si apareció o no.
if printf '%s' "$BODY" | grep -q "$SECRET_MARKER"; then
  echo "::error::FUGA DE SECRETO: un marcador de secreto del servidor apareció en /runtime-config.js"
  exit 1
fi

echo "runtime-config OK: cabeceras correctas, config pública presente, secretos ausentes"
echo "=== smoke OK ==="
