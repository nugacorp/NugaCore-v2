# WireGuard Host-Apply — sincronización automática a `wg0`

Fecha: 2026-07-15  
Estado: **implementado en staging** (commit `c914439`).

## Problema

NugaCore creaba/rotaba/revocaba peers en DB (Supabase), pero el servidor físico
WireGuard del VPS (`wg0`) no se enteraba. Un sync manual
(`scripts/vps/sync-wireguard-peers.sh`) era obligatorio tras cada alta.
Si se olvidaba, el router importaba el `.rsc` con claves nuevas y el host seguía
con claves viejas → **sin handshake** → ping a la IP VPN del servidor en timeout.

## Diseño

```
WireguardService.createPeer | rotatePeer | revokePeer
        │
        ▼
  listPeers(status=active)   ← fuente de verdad = DB
        │
        ▼
  POST WIREGUARD_HOST_APPLY_URL
  Authorization: Bearer <token>
  body: { peers: [{ publicKey, allocatedIp, name }] }
        │
        ▼
  Agente host (systemd) → reescribe /etc/wireguard/wg0.conf
                       → wg syncconf (preferido) / wg-quick up (fallback)
```

- **Full reconcile** en cada apply: el set activo reemplaza por completo a los
  peers del host (elimina claves viejas y peers huérfanos).
- **Reconcile periódico** en la app (`WIREGUARD_HOST_APPLY_INTERVAL_MS`, default 60s).
- La app **no** ejecuta `wg` (sin `NET_ADMIN` en el contenedor).

## Componentes

| Archivo | Función |
| --- | --- |
| `backend/domains/wireguard/host-apply.ts` | Cliente, debounce/flush, reconcile |
| `backend/domains/wireguard/service.ts` | Hooks post-mutación (`flushHostPeerSync`) |
| `server.ts` | Arranca reconcile al listen |
| `backend/jobs/runner.ts` | Job `wireguard-host-apply` (manual/API jobs) |
| `scripts/vps/wg-host-apply-agent.py` | HTTP `GET /health`, `POST /apply` |
| `scripts/vps/install-wg-host-apply-agent.sh` | Instala systemd + token |
| `scripts/vps/sync-wireguard-peers.sh` | Recuperación: API → POST al agente |
| `scripts/vps/deploy-coolify-staging.sh` | Inyecta URL/token en Coolify si el agente está activo |

## Variables de entorno (app)

| Variable | Descripción |
| --- | --- |
| `WIREGUARD_HOST_APPLY_URL` | Ej. `http://<docker0-ip>:18765/apply` |
| `WIREGUARD_HOST_APPLY_TOKEN` | Bearer compartido con el agente (secreto) |
| `WIREGUARD_HOST_APPLY_ENABLED` | `false`/`off` desactiva aunque haya URL |
| `WIREGUARD_HOST_APPLY_INTERVAL_MS` | Reconcile (default `60000`) |
| `WIREGUARD_HOST_APPLY_TIMEOUT_MS` | Timeout HTTP (default `5000`) |

Si el apply falla, **no** se rompe el alta en DB: se loguea warn/error y el
reconcile reintenta.

## Operación en el VPS

```bash
# Instalar / reinstal ar agente (root)
bash scripts/vps/install-wg-host-apply-agent.sh

# Estado
systemctl status nugacore-wg-host-apply
journalctl -u nugacore-wg-host-apply -n 50 --no-pager
wg show wg0   # no imprimir private keys en tickets/docs

# Recuperación si hace falta
bash scripts/vps/sync-wireguard-peers.sh
```

El installer genera `/root/.wireguard/host-apply.token` y puede añadir el valor
a `nugacore-staging-secrets.env` (nunca commitear ese archivo).

## Seguridad

- Token Bearer obligatorio en el agente.
- Payload solo claves **públicas** + IP `/32` (sin private/PSK del peer).
- La private key del **servidor** vive solo en el host (`nugacore-server.key`).
- No documentar ni loguear el token en GitHub.

## Pruebas

```bash
npm test -- tests/unit/wireguard.host-apply.test.ts tests/unit/wireguard.service.test.ts
```

## Relación con enrollment

Al hacer **Dar de alta** → `getPeerConfigForRouter` / `createPeer` → host-apply
antes de entregar el `.rsc`. El técnico puede importar de inmediato; el peer ya
debe existir en `wg0`.
