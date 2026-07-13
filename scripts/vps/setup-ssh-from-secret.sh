#!/usr/bin/env bash
# Materializa la llave SSH del VPS desde variables de entorno (Cloud Agent secrets).
# Uso: export VPS_SSH_PRIVATE_KEY="$(cat mi-clave-privada)" && bash scripts/vps/setup-ssh-from-secret.sh
set -euo pipefail

HOST="${VPS_SSH_HOST:-5.180.151.109}"
USER="${VPS_SSH_USER:-root}"
KEY_PATH="${VPS_SSH_KEY_PATH:-$HOME/.ssh/cloud-agent-nugacore-cb99}"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

if [[ -n "${VPS_SSH_PRIVATE_KEY:-}" ]]; then
  printf '%s\n' "$VPS_SSH_PRIVATE_KEY" > "$KEY_PATH"
  chmod 600 "$KEY_PATH"
  echo "SSH: clave escrita en $KEY_PATH (desde VPS_SSH_PRIVATE_KEY)"
elif [[ -f "$KEY_PATH" ]]; then
  echo "SSH: usando clave existente en $KEY_PATH"
else
  echo "ERROR: no hay VPS_SSH_PRIVATE_KEY ni archivo en $KEY_PATH" >&2
  echo "Configura el secreto en Cursor Cloud Environment o crea ~/.ssh/id_ed25519 manualmente." >&2
  echo "Ver docs/CLOUD_AGENT_VPS_SSH.md" >&2
  exit 1
fi

# Config opcional para alias (no requerido si usas root@host en comandos)
if [[ ! -f "$HOME/.ssh/config" ]] || ! grep -q "Host nugacore-vps" "$HOME/.ssh/config" 2>/dev/null; then
  cat >> "$HOME/.ssh/config" <<EOF

Host nugacore-vps
  HostName ${HOST}
  User ${USER}
  IdentityFile ${KEY_PATH}
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking accept-new
EOF
  chmod 600 "$HOME/.ssh/config"
  echo "SSH: alias 'nugacore-vps' añadido en ~/.ssh/config"
fi

echo "Listo. Prueba: bash scripts/vps/test-ssh-connection.sh"
