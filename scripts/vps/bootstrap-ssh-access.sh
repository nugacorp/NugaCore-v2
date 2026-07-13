#!/usr/bin/env bash
# Bootstrap SSH al VPS NugaCore desde Cloud Agent.
# Flujos soportados (en orden):
#   1) VPS_SSH_PRIVATE_KEY → materializa llave y prueba
#   2) Llave local existente en VPS_SSH_KEY_PATH
#   3) VPS_SSH_PASSWORD → instala la pública vía ssh-copy-id y prueba
#   4) Genera par ed25519 nuevo y muestra la pública para instalación manual
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${VPS_SSH_HOST:-5.180.151.109}"
USER="${VPS_SSH_USER:-root}"
KEY_PATH="${VPS_SSH_KEY_PATH:-$HOME/.ssh/cloud-agent-nugacore-cb99}"
TARGET="${USER}@${HOST}"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

echo "== Bootstrap SSH → ${TARGET} =="

# --- 1) Secreto de clave privada (recomendado si ya está en authorized_keys) ---
if [[ -n "${VPS_SSH_PRIVATE_KEY:-}" ]]; then
  export VPS_SSH_KEY_PATH="$KEY_PATH"
  bash "$ROOT/scripts/vps/setup-ssh-from-secret.sh"
  bash "$ROOT/scripts/vps/test-ssh-connection.sh"
  exit 0
fi

# --- 2) Llave local ya presente ---
if [[ -f "$KEY_PATH" ]]; then
  echo "SSH: usando clave existente $KEY_PATH"
  export VPS_SSH_KEY_PATH="$KEY_PATH"
  if bash "$ROOT/scripts/vps/test-ssh-connection.sh"; then
    exit 0
  fi
  echo "WARN: la llave local no autenticó; continuando con instalación o nueva clave..."
fi

# --- 3) Generar par si no existe ---
if [[ ! -f "$KEY_PATH" ]]; then
  ssh-keygen -t ed25519 -f "$KEY_PATH" -C "cursor-cloud-agent-cb99" -N ""
  chmod 600 "$KEY_PATH"
  echo "SSH: par generado en $KEY_PATH"
fi

export VPS_SSH_KEY_PATH="$KEY_PATH"

# --- 4) Instalar con contraseña (una vez) ---
if [[ -n "${VPS_SSH_PASSWORD:-}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "Instalando sshpass para instalación por contraseña..."
    sudo apt-get update -qq && sudo apt-get install -y -qq sshpass
  fi
  echo "SSH: instalando clave pública en ${TARGET} (VPS_SSH_PASSWORD)..."
  SSHPASS="$VPS_SSH_PASSWORD" sshpass -e ssh-copy-id \
    -o StrictHostKeyChecking=accept-new \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    -i "${KEY_PATH}.pub" \
    "$TARGET"
  bash "$ROOT/scripts/vps/test-ssh-connection.sh"
  exit 0
fi

# --- 5) Sin credenciales: instrucciones ---
echo ""
echo "PENDIENTE: no hay VPS_SSH_PRIVATE_KEY ni VPS_SSH_PASSWORD en este entorno."
echo ""
echo "Añade UNA de estas opciones en Cursor → Cloud → Environment secrets y relanza el agente:"
echo "  • VPS_SSH_PRIVATE_KEY  (clave privada ya autorizada en el VPS)"
echo "  • VPS_SSH_PASSWORD     (root password; este script instalará la pública automáticamente)"
echo ""
echo "O instala manualmente esta clave pública en el VPS (consola del proveedor):"
echo ""
cat "${KEY_PATH}.pub"
echo ""
echo "En el VPS:"
echo "  mkdir -p ~/.ssh && chmod 700 ~/.ssh"
echo "  echo '<línea de arriba>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
echo ""
echo "Luego en el agente: bash scripts/vps/bootstrap-ssh-access.sh"
exit 2
