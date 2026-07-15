#!/usr/bin/env bash
# Instala WireGuard en el host VPS y levanta wg0 para NugaCore.
# Idempotente. No imprime claves privadas.
#
# Uso (en el VPS, con secrets de staging):
#   SECRETS_FILE=/root/nugacore-staging-secrets.env \
#   APP_URL=https://nugacore-staging.example.com \
#   VPS_PUBLIC_HOST=5.180.151.109 \
#   bash scripts/vps/setup-wireguard-host.sh
set -euo pipefail

SECRETS_FILE="${SECRETS_FILE:-/root/nugacore-staging-secrets.env}"
APP_URL="${APP_URL:-https://nugacore-staging.5.180.151.109.sslip.io}"
VPS_PUBLIC_HOST="${VPS_PUBLIC_HOST:-5.180.151.109}"
WG_PORT="${WG_PORT:-13231}"
WG_POOL="${WG_POOL:-10.70.0.0/16}"
WG_SERVER_IP="${WG_SERVER_IP:-10.70.0.1}"
KEY_DIR="${WG_KEY_DIR:-/root/.wireguard}"
SERVER_KEY_FILE="${KEY_DIR}/nugacore-server.key"
WG_CONF="/etc/wireguard/wg0.conf"
AUTH_EMAIL="${WG_AUTH_EMAIL:-superadmin@staging.nugacore.local}"

log() { printf '[wg-setup] %s\n' "$1"; }
fail() { printf '[wg-setup] ERROR: %s\n' "$1" >&2; exit 1; }

if [[ "$(id -u)" -ne 0 ]]; then
  fail "ejecutar como root"
fi

# ── 1) Paquetes ──────────────────────────────────────────────────────
if ! command -v wg >/dev/null 2>&1; then
  log "instalando wireguard..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq wireguard wireguard-tools iproute2
fi

mkdir -p "$KEY_DIR" /etc/wireguard
chmod 700 "$KEY_DIR" /etc/wireguard

# ── 2) Si wg0 ya escucha, validar y salir (salvo FORCE_WG_RECREATE) ───
if [[ "${FORCE_WG_RECREATE:-false}" != "true" ]] && wg show wg0 >/dev/null 2>&1 && ss -ulnp | grep -q ":${WG_PORT} "; then
  log "wg0 ya activo en UDP ${WG_PORT}"
  wg show wg0 | sed 's/^/  /'
  exit 0
fi

# ── 3) Clave del servidor ──────────────────────────────────────────────
if [[ ! -f "$SERVER_KEY_FILE" ]]; then
  [[ -f "$SECRETS_FILE" ]] || fail "falta $SECRETS_FILE para crear servidor WG vía API"
  # shellcheck disable=SC1090
  set -a && source "$SECRETS_FILE" && set +a
  : "${SUPABASE_URL:?SUPABASE_URL requerido}"
  : "${VITE_SUPABASE_ANON_KEY:=${SUPABASE_PUBLISHABLE_KEY:-}}"
  : "${STAGING_AUTH_PASSWORD:?STAGING_AUTH_PASSWORD requerido}"

  ANON_KEY="${VITE_SUPABASE_ANON_KEY:-${SUPABASE_PUBLISHABLE_KEY:-}}"
  [[ -n "$ANON_KEY" ]] || fail "falta anon/publishable key en secrets"

  log "obteniendo JWT de staging..."
  AUTH_JSON="$(mktemp)"
  trap 'rm -f "$AUTH_JSON"' EXIT
  curl -fsS -m 20 \
    -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${AUTH_EMAIL}\",\"password\":\"${STAGING_AUTH_PASSWORD}\"}" \
    >"$AUTH_JSON"
  JWT="$(python3 -c "import json; print(json.load(open('$AUTH_JSON'))['access_token'])")"

  log "consultando servidores WireGuard existentes..."
  SERVERS_JSON="$(curl -fsS -m 20 -H "Authorization: Bearer ${JWT}" "${APP_URL}/api/wireguard/servers")"
  SERVER_PRIV=""
  if python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d else 1)" <<<"$SERVERS_JSON" 2>/dev/null; then
    log "servidor(es) ya registrados en NugaCore; generando clave local nueva para host"
  fi

  log "creando servidor WireGuard default en NugaCore..."
  CREATE_JSON="$(mktemp)"
  CREATE_RESP="$(mktemp)"
  trap 'rm -f "$AUTH_JSON" "$CREATE_JSON" "$CREATE_RESP"' EXIT
  cat >"$CREATE_JSON" <<EOF
{"name":"NugaCore VPS WireGuard","endpointHost":"${VPS_PUBLIC_HOST}","endpointPort":${WG_PORT},"listenPort":${WG_PORT},"vpnCidr":"${WG_POOL}","serverVpnIp":"${WG_SERVER_IP}","isDefault":true}
EOF
  HTTP_CODE="$(curl -fsS -m 30 -o "$CREATE_RESP" -w '%{http_code}' \
    -X POST "${APP_URL}/api/wireguard/servers" \
    -H "Authorization: Bearer ${JWT}" \
    -H "Content-Type: application/json" \
    -d @"$CREATE_JSON")"
  if [[ "$HTTP_CODE" != "201" ]]; then
    fail "POST /api/wireguard/servers -> ${HTTP_CODE}"
  fi
  python3 -c "import json; d=json.load(open('$CREATE_RESP')); open('$SERVER_KEY_FILE','w').write(d['serverPrivateKey']+'\n')"
  chmod 600 "$SERVER_KEY_FILE"
  log "clave del servidor guardada en ${SERVER_KEY_FILE} (no se imprime)"
fi

# ── 4) wg0.conf ────────────────────────────────────────────────────────
if [[ ! -f "$WG_CONF" ]]; then
  log "escribiendo ${WG_CONF}..."
  cat >"$WG_CONF" <<EOF
[Interface]
Address = ${WG_SERVER_IP}/16
ListenPort = ${WG_PORT}
PrivateKey = $(cat "$SERVER_KEY_FILE")
SaveConfig = false

# Peers: añadir con scripts/vps/sync-wireguard-peers.sh tras enrollment
EOF
  chmod 600 "$WG_CONF"
fi

# ── 5) Levantar interfaz ───────────────────────────────────────────────
systemctl enable wg-quick@wg0 >/dev/null 2>&1 || true
if ! systemctl restart wg-quick@wg0; then
  # fallback sin systemd
  wg-quick down wg0 2>/dev/null || true
  wg-quick up wg0
fi

sleep 1
if ! wg show wg0 >/dev/null 2>&1; then
  fail "wg0 no levantó; revisar journalctl -u wg-quick@wg0"
fi

if ss -ulnp | grep -q ":${WG_PORT} "; then
  log "OK: wg0 escuchando UDP ${WG_PORT}"
else
  fail "wg0 activo pero UDP ${WG_PORT} no visible en ss"
fi

wg show wg0 | sed 's/^/  /'

# Agente de apply automático (alta/revocación/rotación sin sync manual).
SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SETUP_DIR}/install-wg-host-apply-agent.sh" ]]; then
  log "instalando agente host-apply..."
  bash "${SETUP_DIR}/install-wg-host-apply-agent.sh"
else
  log "aviso: install-wg-host-apply-agent.sh no encontrado; el apply automático queda pendiente"
fi
