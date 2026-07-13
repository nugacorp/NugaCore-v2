#!/usr/bin/env bash
# Prueba conectividad SSH al VPS NugaCore desde este entorno (Cloud Agent o local).
set -euo pipefail

HOST="${VPS_SSH_HOST:-5.180.151.109}"
USER="${VPS_SSH_USER:-root}"
KEY_PATH="${VPS_SSH_KEY_PATH:-$HOME/.ssh/id_ed25519}"
TARGET="${USER}@${HOST}"

echo "== 1. Ping (red) =="
if ping -c 2 -W 3 "$HOST" >/dev/null 2>&1; then
  echo "OK: host alcanzable por ICMP"
else
  echo "WARN: ping falló (puede estar filtrado; SSH puede funcionar igual)"
fi

echo ""
echo "== 2. Llave local =="
if [[ -f "$KEY_PATH" ]]; then
  echo "OK: existe $KEY_PATH"
else
  echo "FAIL: no hay $KEY_PATH"
  echo "Ejecuta: bash scripts/vps/setup-ssh-from-secret.sh"
  echo "Ver: docs/CLOUD_AGENT_VPS_SSH.md"
  exit 1
fi

echo ""
echo "== 3. SSH auth =="
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -i "$KEY_PATH")
if ssh "${SSH_OPTS[@]}" "$TARGET" 'echo SSH_OK && hostname && whoami'; then
  echo "OK: autenticación SSH"
else
  echo "FAIL: Permission denied o timeout"
  echo "Revisa: clave pública en authorized_keys del VPS, usuario ($USER), firewall puerto 22"
  exit 1
fi

echo ""
echo "== 4. WireGuard host (opcional) =="
ssh "${SSH_OPTS[@]}" "$TARGET" 'wg show wg0 2>/dev/null || echo "wg0: no configurado"'

echo ""
echo "RESULTADO: OK — SSH operativo desde este entorno"
