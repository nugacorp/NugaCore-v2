#!/usr/bin/env bash
# Sincroniza peers activos de NugaCore → /etc/wireguard/wg0.conf y recarga wg0.
# No imprime secretos. Requiere servidor WG ya creado en la app.
set -euo pipefail

SECRETS_FILE="${SECRETS_FILE:-/root/nugacore-staging-secrets.env}"
APP_URL="${APP_URL:-https://nugacore-staging.5.180.151.109.sslip.io}"
KEY_DIR="${WG_KEY_DIR:-/root/.wireguard}"
SERVER_KEY_FILE="${KEY_DIR}/nugacore-server.key"
WG_CONF="/etc/wireguard/wg0.conf"
WG_PORT="${WG_PORT:-13231}"
WG_SERVER_IP="${WG_SERVER_IP:-10.70.0.1}"
AUTH_EMAIL="${WG_AUTH_EMAIL:-superadmin@staging.nugacore.local}"

log() { printf '[wg-sync] %s\n' "$1"; }
fail() { printf '[wg-sync] ERROR: %s\n' "$1" >&2; exit 1; }

[[ -f "$SERVER_KEY_FILE" ]] || fail "falta ${SERVER_KEY_FILE}; ejecuta setup-wireguard-host.sh primero"
[[ -f "$SECRETS_FILE" ]] || fail "falta ${SECRETS_FILE}"

set -a && source "$SECRETS_FILE" && set +a
ANON_KEY="${VITE_SUPABASE_ANON_KEY:-${SUPABASE_PUBLISHABLE_KEY:-}}"
[[ -n "$ANON_KEY" && -n "${STAGING_AUTH_PASSWORD:-}" ]] || fail "secrets incompletos"

AUTH_JSON="$(mktemp)"
PEERS_JSON="$(mktemp)"
trap 'rm -f "$AUTH_JSON" "$PEERS_JSON"' EXIT

curl -fsS -m 20 \
  -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${AUTH_EMAIL}\",\"password\":\"${STAGING_AUTH_PASSWORD}\"}" \
  >"$AUTH_JSON"
JWT="$(python3 -c "import json; print(json.load(open('$AUTH_JSON'))['access_token'])")"

curl -fsS -m 20 -H "Authorization: Bearer ${JWT}" \
  "${APP_URL}/api/wireguard/peers?status=active" >"$PEERS_JSON"

python3 - "$SERVER_KEY_FILE" "$WG_CONF" "$WG_SERVER_IP" "$WG_PORT" "$PEERS_JSON" <<'PY'
import json, pathlib, sys
server_key, wg_conf, server_ip, wg_port, peers_path = sys.argv[1:6]
peers = json.load(open(peers_path))
lines = [
    "[Interface]",
    f"Address = {server_ip}/16",
    f"ListenPort = {wg_port}",
    f"PrivateKey = {pathlib.Path(server_key).read_text().strip()}",
    "SaveConfig = false",
    "",
]
for p in peers:
    if p.get("status") != "active":
        continue
    ip = p["allocatedIp"]
    allowed = p.get("allowedCidr") or "10.0.0.0/24"
    lines += [
        f"# {p.get('name', p['id'])}",
        "[Peer]",
        f"PublicKey = {p['publicKey']}",
        f"AllowedIPs = {ip}/32,{allowed}",
        "PersistentKeepalive = 25",
        "",
    ]
pathlib.Path(wg_conf).write_text("\n".join(lines))
print(f"peers activos: {sum(1 for p in peers if p.get('status')=='active')}")
PY

chmod 600 "$WG_CONF"
systemctl restart wg-quick@wg0 2>/dev/null || { wg-quick down wg0 2>/dev/null || true; wg-quick up wg0; }
log "wg0 recargado"
wg show wg0 | sed 's/^/  /'
