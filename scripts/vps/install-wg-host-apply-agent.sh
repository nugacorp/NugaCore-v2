#!/usr/bin/env bash
# Instala y arranca el agente que aplica peers WireGuard desde NugaCore → wg0.
# Idempotente. Genera token si no existe y deja listo el apply automático.
#
# Uso (root en el VPS):
#   bash scripts/vps/install-wg-host-apply-agent.sh
#   # o embebido vía SSH:
#   ssh nugacore-vps 'sudo bash -s' < scripts/vps/install-wg-host-apply-agent.sh
set -euo pipefail

KEY_DIR="${WG_KEY_DIR:-/root/.wireguard}"
TOKEN_FILE="${WG_HOST_APPLY_TOKEN_FILE:-${KEY_DIR}/host-apply.token}"
AGENT_DIR="${WG_HOST_APPLY_DIR:-/opt/nugacore/wg-host-apply}"
AGENT_PY="${AGENT_DIR}/wg-host-apply-agent.py"
UNIT_PATH="/etc/systemd/system/nugacore-wg-host-apply.service"
LISTEN_PORT="${WG_HOST_APPLY_PORT:-18765}"
LISTEN_HOST="${WG_HOST_APPLY_LISTEN:-0.0.0.0}"
SERVER_KEY_FILE="${KEY_DIR}/nugacore-server.key"
SECRETS_FILE="${SECRETS_FILE:-/root/nugacore-staging-secrets.env}"

log() { printf '[wg-agent-install] %s\n' "$1"; }
fail() { printf '[wg-agent-install] ERROR: %s\n' "$1" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "ejecutar como root"
command -v wg >/dev/null 2>&1 || fail "wireguard-tools no instalado (corre setup-wireguard-host.sh)"
command -v python3 >/dev/null 2>&1 || fail "python3 requerido"
[[ -f "$SERVER_KEY_FILE" ]] || fail "falta ${SERVER_KEY_FILE}"

mkdir -p "$KEY_DIR" "$AGENT_DIR"
chmod 700 "$KEY_DIR" "$AGENT_DIR"

# ── Token ─────────────────────────────────────────────────────────────
if [[ ! -f "$TOKEN_FILE" ]] || [[ ! -s "$TOKEN_FILE" ]]; then
  log "generando token host-apply..."
  TOKEN="$(openssl rand -hex 32)"
  printf '%s\n' "$TOKEN" >"$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
else
  TOKEN="$(tr -d '\n\r' <"$TOKEN_FILE")"
  log "reutilizando token existente"
fi

# Persistir en secrets de staging (sin echo del valor)
if [[ -f "$SECRETS_FILE" ]]; then
  if grep -q '^WIREGUARD_HOST_APPLY_TOKEN=' "$SECRETS_FILE" 2>/dev/null; then
    sed -i "s|^WIREGUARD_HOST_APPLY_TOKEN=.*|WIREGUARD_HOST_APPLY_TOKEN=${TOKEN}|" "$SECRETS_FILE"
  else
    printf '\nWIREGUARD_HOST_APPLY_TOKEN=%s\n' "$TOKEN" >>"$SECRETS_FILE"
  fi
  chmod 600 "$SECRETS_FILE" || true
  log "token guardado en ${SECRETS_FILE}"
fi

# ── Copiar agente (desde argv heredoc o desde repo local) ─────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
if [[ -n "${SCRIPT_DIR}" && -f "${SCRIPT_DIR}/wg-host-apply-agent.py" ]]; then
  cp -f "${SCRIPT_DIR}/wg-host-apply-agent.py" "$AGENT_PY"
elif [[ -f /dev/stdin ]] && [[ "${INSTALL_AGENT_EMBEDDED:-}" == "true" ]]; then
  : # se espera que el caller escriba el archivo
else
  # Si se invoca vía `bash -s` sin archivo al lado, usar copia embebida mínima
  # solo si AGENT_PY ya existe; si no, fallar con pista clara.
  if [[ ! -f "$AGENT_PY" ]]; then
    fail "no se encontró wg-host-apply-agent.py junto al installer; copia el repo o pásalo en AGENT_PY"
  fi
fi
chmod 750 "$AGENT_PY"

# ── systemd unit ──────────────────────────────────────────────────────
cat >"$UNIT_PATH" <<EOF
[Unit]
Description=NugaCore WireGuard host-apply agent
Wants=network-online.target
After=network-online.target wg-quick@wg0.service

[Service]
Type=simple
User=root
Environment=WG_CONF=/etc/wireguard/wg0.conf
Environment=WG_SERVER_KEY_FILE=${SERVER_KEY_FILE}
Environment=WG_HOST_APPLY_TOKEN_FILE=${TOKEN_FILE}
Environment=WG_HOST_APPLY_LISTEN=${LISTEN_HOST}
Environment=WG_HOST_APPLY_PORT=${LISTEN_PORT}
Environment=WG_PORT=13231
Environment=WG_SERVER_IP=10.70.0.1
ExecStart=/usr/bin/python3 ${AGENT_PY}
Restart=always
RestartSec=3
Nice=-5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nugacore-wg-host-apply.service >/dev/null
systemctl restart nugacore-wg-host-apply.service

sleep 1
systemctl is-active --quiet nugacore-wg-host-apply.service || fail "servicio no activo"
curl -fsS -m 3 "http://127.0.0.1:${LISTEN_PORT}/health" >/dev/null \
  || fail "health del agente falló en :${LISTEN_PORT}"

# Gateway docker0 típico para Coolify/app containers
DOCKER_GW="$(ip -4 addr show docker0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 || true)"
DOCKER_GW="${DOCKER_GW:-172.17.0.1}"

log "agente OK en ${LISTEN_HOST}:${LISTEN_PORT}"
log "URL sugerida para Coolify: http://${DOCKER_GW}:${LISTEN_PORT}/apply"
log "token file: ${TOKEN_FILE}"
printf '%s\n' "${DOCKER_GW}"
