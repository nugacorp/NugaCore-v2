#!/usr/bin/env bash
# Valida endpoints SNMP live en staging (requiere JWT para rutas protegidas).
set -euo pipefail

APP_URL="${1:-${APP_URL:-}}"
if [[ -z "$APP_URL" ]]; then
  echo "Uso: bash scripts/vps/validate-snmp-live.sh <APP_URL>"
  exit 1
fi

AUTH_HEADER=()
if [[ -n "${AUTH_BEARER:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${AUTH_BEARER}")
fi

echo "== SNMP health =="
curl -fsS "${AUTH_HEADER[@]}" "${APP_URL}/api/snmp/health" | head -c 2000
echo

echo "== SNMP targets =="
curl -fsS "${AUTH_HEADER[@]}" "${APP_URL}/api/snmp/targets" | head -c 2000
echo

echo "== Dashboard zones (snmp-live source cuando poller activo) =="
curl -fsS "${AUTH_HEADER[@]}" "${APP_URL}/api/dashboard/zones" | head -c 4000
echo

echo "RESULTADO: OK (revisar enabled/lastCycle en health)"
