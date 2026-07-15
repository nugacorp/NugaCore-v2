# RESULT — WireGuard host-apply automático (staging)

Fecha: 2026-07-15  
Commit en `origin/main`: `c914439`  
Resultado: **APROBADA** (evidencia sanitizada)

## Alcance validado

- Agente `nugacore-wg-host-apply` instalado y activo en el VPS.
- Coolify con `WIREGUARD_HOST_APPLY_URL` + token + interval 60s.
- Contenedor de la app alcanza `GET /health` del agente y envía `POST /apply`.
- Tras deploy, reconcile aplica el set de peers activos (log agente: “aplicados N peers”).
- `wg show` refleja public keys de DB (no claves viejas huérfanas).
- Túnel CHR piloto: handshake presente y ping VPN bidireccional tras reconcile
  (validación previa al cierre del handoff; sin dumps de claves).

## No validado / fuera de alcance

- `MIKROTIK_WORKER_LIVE=true` (sigue apagado).
- Multi-servidor WG o multi-VPS.
- Prometheus métricas dedicadas de host-apply.

## Comandos de verificación (sanitizados)

```bash
# En VPS (root)
systemctl is-active nugacore-wg-host-apply
curl -fsS http://127.0.0.1:18765/health
wg show wg0 | sed '/private key/d'

# Confirm commit
git fetch origin main && git rev-parse --short origin/main   # esperar c914439 o posterior con el fix
```

## Regresión a vigilar

Si el contenedor no puede rutear al gateway Docker del host, el apply falla con
warn en logs de app y el reconcile reintenta. Corregir URL en Coolify
(`WIREGUARD_HOST_APPLY_URL`) o red del agente; no volver al sync manual salvo
emergencia (`scripts/vps/sync-wireguard-peers.sh`).
