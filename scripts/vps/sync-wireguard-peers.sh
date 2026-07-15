#!/usr/bin/env bash
# Reconcile manual/recovery: empuja peers activos de NugaCore → agente host-apply.
# En operación normal el apply es AUTOMÁTICO (create/rotate/revoke + reconcile).
# Este script queda como recuperación / primera sincronización.
set -euo pipefail

SECRETS_FILE="${SECRETS_FILE:-/root/nugacore-staging-secrets.env}"
APP_URL="${APP_URL:-https://nugacore-staging.5.180.151.109.sslip.io}"
AUTH_EMAIL="${WG_AUTH_EMAIL:-superadmin@staging.nugacore.local}"
AGENT_URL="${WIREGUARD_HOST_APPLY_URL:-http://127.0.0.1:18765/apply}"
TOKEN_FILE="${WG_HOST_APPLY_TOKEN_FILE:-/root/.wireguard/host-apply.token}"

log() { printf '[wg-sync] %s\n' "$1"; }
fail() { printf '[wg-sync] ERROR: %s\n' "$1" >&2; exit 1; }

[[ -f "$SECRETS_FILE" ]] || fail "falta ${SECRETS_FILE}"
[[ -f "$TOKEN_FILE" ]] || fail "falta ${TOKEN_FILE}; instala el agente host-apply"

set -a && source "$SECRETS_FILE" && set +a
ANON_KEY="${VITE_SUPABASE_ANON_KEY:-${SUPABASE_PUBLISHABLE_KEY:-}}"
[[ -n "$ANON_KEY" && -n "${STAGING_AUTH_PASSWORD:-}" ]] || fail "secrets incompletos"
TOKEN="$(tr -d '\n\r' <"$TOKEN_FILE")"

AUTH_JSON="$(mktemp)"
PEERS_JSON="$(mktemp)"
PAYLOAD_JSON="$(mktemp)"
trap 'rm -f "$AUTH_JSON" "$PEERS_JSON" "$PAYLOAD_JSON"' EXIT

curl -fsS -m 20 \
  -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${AUTH_EMAIL}\",\"password\":\"${STAGING_AUTH_PASSWORD}\"}" \
  >"$AUTH_JSON"
JWT="$(python3 -c "import json; print(json.load(open('$AUTH_JSON'))['access_token'])")"

curl -fsS -m 20 -H "Authorization: Bearer ${JWT}" \
  "${APP_URL}/api/wireguard/peers?status=active" >"$PEERS_JSON"

python3 - "$PEERS_JSON" "$PAYLOAD_JSON" <<'PY'
import json, sys
peers = json.load(open(sys.argv[1]))
payload = {
  "peers": [
    {
      "publicKey": p["publicKey"],
      "allocatedIp": p["allocatedIp"],
      "name": p.get("name") or p["id"],
    }
    for p in peers
    if p.get("status") == "active"
  ]
}
json.dump(payload, open(sys.argv[2], "w"))
print(f"peers activos: {len(payload['peers'])}")
PY

HTTP_CODE="$(curl -sS -m 20 -o /tmp/wg-apply-resp.json -w '%{http_code}' \
  -X POST "$AGENT_URL" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d @"$PAYLOAD_JSON")"

[[ "$HTTP_CODE" == "200" ]] || fail "agente respondió HTTP ${HTTP_CODE}: $(head -c 200 /tmp/wg-apply-resp.json 2>/dev/null || true)"
log "apply OK via agente"
wg show wg0 | sed 's/^/  /'
