#!/usr/bin/env bash
# ====================================================================
# NugaCore — Preflight para el VPS (lo ejecuta HERMES en el servidor)
#
# SOLO VERIFICA. No instala, no modifica, no escribe nada. Idempotente.
# Pensado para correr DENTRO del repo clonado, antes de desplegar en Coolify.
#
# Uso:
#   bash scripts/vps/preflight.sh
#
# Salida: resumen PASS/WARN/FAIL. Exit 0 si no hay FAIL; 1 si hay algún FAIL.
# No imprime secretos.
# ====================================================================
set -u

REPO_URL="https://github.com/nugacorp/NugaCore-v2.git"
APP_PORT="${APP_PORT:-3000}"
PASS=0; WARN=0; FAIL=0

ok()   { printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
warn() { printf '  [WARN] %s\n' "$1"; WARN=$((WARN+1)); }
bad()  { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
have() { command -v "$1" >/dev/null 2>&1; }

echo "==================================================================="
echo " NugaCore preflight VPS  ·  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "==================================================================="

echo "[1] Herramientas base"
for tool in docker git curl; do
  if have "$tool"; then ok "$tool instalado ($("$tool" --version 2>/dev/null | head -n1))"; else bad "$tool NO instalado"; fi
done
if docker compose version >/dev/null 2>&1; then ok "docker compose v2 disponible"
elif have docker-compose; then warn "docker-compose v1 (legacy) disponible; Coolify usa v2"
else bad "docker compose NO disponible"; fi

echo "[2] Docker operativo"
if have docker; then
  if docker info >/dev/null 2>&1; then ok "docker daemon accesible"; else warn "docker info falló (¿requiere sudo o el usuario no está en el grupo docker?)"; fi
fi

echo "[3] Coolify"
if have docker && docker ps >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qi 'coolify'; then
    ok "contenedores de Coolify detectados ($(docker ps --format '{{.Names}}' | grep -i coolify | tr '\n' ' '))"
  else
    warn "no se detectaron contenedores 'coolify' (verifica que Coolify esté corriendo)"
  fi
else
  warn "no se pudo consultar docker ps para verificar Coolify"
fi

echo "[4] Acceso a GitHub (repo)"
if have git; then
  if git ls-remote --heads "$REPO_URL" main >/dev/null 2>&1; then ok "repo alcanzable y rama main visible"; else bad "no se pudo alcanzar $REPO_URL (red/credenciales)"; fi
fi

echo "[5] Acceso a internet"
if have curl; then
  code=$(curl -fsS -m 10 -o /dev/null -w '%{http_code}' https://api.github.com 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then ok "salida a internet OK (api.github.com 200)"; else warn "no se confirmó salida a internet (código $code)"; fi
fi

echo "[6] Puerto de la app ($APP_PORT)"
listening=""
if have ss; then listening=$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E "[:.]${APP_PORT}\$" || true)
elif have netstat; then listening=$(netstat -ltn 2>/dev/null | awk '{print $4}' | grep -E "[:.]${APP_PORT}\$" || true); fi
if [ -n "$listening" ]; then
  warn "puerto $APP_PORT en uso ($listening). En Coolify el puerto del contenedor es interno; documenta si hay conflicto de host."
else
  ok "puerto $APP_PORT libre en el host (o gestionado internamente por Coolify)"
fi

echo "[7] Recursos del sistema"
if have df; then ok "disco /: $(df -h / | awk 'NR==2{print $4" libres de "$2" ("$5" usado)"}')"; fi
if have free; then ok "memoria: $(free -h | awk '/Mem:/{print $7" disponibles de "$2}')"; fi
echo "  [INFO] hora del servidor (UTC): $(date -u '+%Y-%m-%dT%H:%M:%SZ')  ·  local: $(date '+%Y-%m-%d %H:%M:%S %Z')"

echo "[8] Higiene de secretos en el repo (si se corre dentro del repo)"
if [ -d .git ]; then
  if git ls-files 2>/dev/null | grep -qxE '\.env'; then bad ".env ESTÁ versionado (no debe estarlo)"; else ok ".env NO está versionado"; fi
  if git ls-files 2>/dev/null | grep -q 'supabase/\.temp'; then bad "supabase/.temp versionado"; else ok "supabase/.temp no versionado"; fi
  if git grep -nI -e 'sbp_[A-Za-z0-9]' -e 'eyJ[A-Za-z0-9_-]\{10,\}\.' -- . ':!package-lock.json' ':!*.md' >/dev/null 2>&1; then
    warn "posibles patrones tipo token en archivos versionados; revisar manualmente (excluye package-lock y docs)"
  else
    ok "sin JWT/PAT evidentes en archivos versionados (fuera de package-lock/docs)"
  fi
else
  warn "no se ejecutó dentro del repo (.git ausente); omito chequeos de versionado"
fi

echo "==================================================================="
echo " Resumen: PASS=$PASS  WARN=$WARN  FAIL=$FAIL"
echo "==================================================================="
if [ "$FAIL" -gt 0 ]; then
  echo "RESULTADO: FAIL — corrige los puntos marcados antes de desplegar."
  exit 1
fi
echo "RESULTADO: OK para continuar (revisa los WARN)."
exit 0
