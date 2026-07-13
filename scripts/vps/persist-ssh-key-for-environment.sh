#!/usr/bin/env bash
# Persiste acceso SSH Cloud Agent ↔ VPS NugaCore para futuros runs.
# - VPS: asegura clave pública en authorized_keys (idempotente)
# - Local: materializa ~/.ssh + alias nugacore-vps
# - Cursor: prepara .cursor/local/ (gitignored) para copiar a secret VPS_SSH_PRIVATE_KEY
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${VPS_SSH_HOST:-5.180.151.109}"
USER="${VPS_SSH_USER:-root}"
KEY_PATH="${VPS_SSH_KEY_PATH:-$HOME/.ssh/cloud-agent-nugacore-cb99}"
TARGET="${USER}@${HOST}"
KEY_COMMENT="cursor-cloud-agent-cb99"
LOCAL_DIR="$ROOT/.cursor/local"
LOCAL_KEY="$LOCAL_DIR/vps-ssh-private-key"

mkdir -p "$HOME/.ssh" "$LOCAL_DIR"
chmod 700 "$HOME/.ssh" "$LOCAL_DIR"

if [[ ! -f "$KEY_PATH" ]]; then
  echo "ERROR: no existe $KEY_PATH — ejecuta primero bash scripts/vps/bootstrap-ssh-access.sh" >&2
  exit 1
fi

export VPS_SSH_KEY_PATH="$KEY_PATH"
export VPS_SSH_HOST="$HOST"
export VPS_SSH_USER="$USER"

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -i "$KEY_PATH")

echo "== Persistir SSH → ${TARGET} =="

# --- Local: config + copia segura para secretos Cursor ---
bash "$ROOT/scripts/vps/setup-ssh-from-secret.sh" 2>/dev/null || true
cp -f "$KEY_PATH" "$LOCAL_KEY"
chmod 600 "$LOCAL_KEY"
cp -f "${KEY_PATH}.pub" "$LOCAL_DIR/vps-ssh-public-key.pub"
chmod 644 "$LOCAL_DIR/vps-ssh-public-key.pub"

PUB_LINE="$(cat "${KEY_PATH}.pub")"
FINGERPRINT="$(ssh-keygen -lf "${KEY_PATH}.pub" | awk '{print $2}')"

# --- VPS: authorized_keys idempotente ---
echo "SSH: verificando authorized_keys en el VPS..."
ssh "${SSH_OPTS[@]}" "$TARGET" bash -s -- "$KEY_COMMENT" "$PUB_LINE" <<'REMOTE'
set -euo pipefail
COMMENT="$1"
PUB="$2"
mkdir -p /root/.ssh/authorized_keys.d
chmod 700 /root/.ssh
echo "$PUB" > "/root/.ssh/authorized_keys.d/${COMMENT}.pub"
chmod 644 "/root/.ssh/authorized_keys.d/${COMMENT}.pub"
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
if ! grep -qF "$PUB" /root/.ssh/authorized_keys 2>/dev/null; then
  echo "$PUB" >> /root/.ssh/authorized_keys
  echo "VPS: clave pública añadida a authorized_keys"
else
  echo "VPS: clave pública ya presente en authorized_keys"
fi
REMOTE

# --- Verificación final ---
if bash "$ROOT/scripts/vps/test-ssh-connection.sh"; then
  echo ""
  echo "PERSISTENCIA OK"
  echo "  Huella: $FINGERPRINT"
  echo "  Llave local: $KEY_PATH"
  echo "  Alias SSH: ssh nugacore-vps"
  echo "  Copia para Cursor secret VPS_SSH_PRIVATE_KEY: $LOCAL_KEY"
  echo ""
  echo "Para futuros Cloud Agent runs, añade en Cursor → Cloud → Environment → Secrets:"
  echo "  VPS_SSH_PRIVATE_KEY = contenido de $LOCAL_KEY"
  echo "  VPS_SSH_HOST = $HOST"
  echo "  VPS_SSH_USER = root"
  echo ""
  echo "Con .cursor/environment.json el install ejecutará bootstrap-ssh-access.sh automáticamente."
else
  echo "ERROR: persistencia falló en verificación SSH" >&2
  exit 1
fi
