# WIREGUARD MANAGER — Fase 4.6.1 (Resultado)

Fecha: 2026-06-05
Objetivo: NugaCore administra centralmente WireGuard (claves, peers,
direccionamiento, estado, revocación). Solo infraestructura — **no** ejecuta
acciones reales en routers, **no** live read-only, **no** commit mode.

Auditoría: [WIREGUARD_MANAGER_AUDIT.md](../audits/WIREGUARD_MANAGER_AUDIT.md).

## 1. Arquitectura

```
NugaCore (WireGuard Manager)
  ├─ servidores: par de claves + endpoint + VPN CIDR (10.70.0.0/16)
  ├─ peers: par de claves + preshared key + IP /32 asignada (IPAM)
  ├─ rotaciones: auditoría de cambio de clave
  └─ provisioning: inyecta private-key/preshared-key/IP/serverPubKey en el script
```

Dominio `backend/domains/wireguard/`: `keys.ts` (x25519 + PSK), `ipam.ts`
(pool 10.70.0.0/16), `types.ts`, `mappers.ts`, `repository.ts` (Store + Supabase),
`service.ts` (orquesta keygen + IPAM + cifrado), `routes.ts`.

## 2. Migraciones

`supabase/migrations/20260605160000_wireguard_manager.sql`: `wireguard_servers`,
`wireguard_peers`, `wireguard_ip_allocations`, `wireguard_key_rotations`. RLS
deny-by-default. **No se aplica** por defecto (`USE_DB_WIREGUARD=false` → memoria).

## 3. APIs (RBAC: Super Admin / Administrador)

| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/wireguard/servers` | Vista (sin secretos). |
| POST | `/api/wireguard/servers` | Crea servidor; devuelve `serverPrivateKey` **una vez**. |
| GET | `/api/wireguard/peers` | Vista (sin secretos; `hasSecrets`). |
| POST | `/api/wireguard/peers` | Crea peer; devuelve `privateKey`/`presharedKey` **una vez** + IP asignada. |
| POST | `/api/wireguard/peers/:id/rotate` | Rota claves; secretos **una vez**. |
| DELETE | `/api/wireguard/peers/:id` | Revoca peer y libera su IP. |
| GET | `/api/wireguard/peers/:id/rotations` | Auditoría de rotaciones. |

## 4. IPAM

Pool `10.70.0.0/16`. `.1` reservada al servidor; peers desde `.2`. Asignación
secuencial, sin duplicados; las IPs de peers **revocados se liberan y reutilizan**
(la más baja primero).

## 5. Generación de claves

WireGuard usa Curve25519 (X25519, `crypto.generateKeyPairSync('x25519')`):
private/public en base64 (44 chars). Preshared key = 32 bytes aleatorios base64.
Las **privadas y preshared** se guardan **cifradas** (AES-256-GCM con
`MIKROTIK_CREDENTIALS_KEY`); las **públicas** en claro. Los secretos se muestran
**una sola vez** al crear/rotar; los listados nunca los devuelven.

## 6. Integración con provisioning

`POST /api/mikrotik/routers/:id/provisioning-script` con
`{ connectionType: 'wireguard_managed', wireguardServerId }`:
- NugaCore asigna (o reutiliza) el peer del router (claves + IP).
- El script `wireguard_managed` se genera **sin intercambio manual**: fija
  `private-key`/`preshared-key` del router e `ip address` con la IP asignada; el
  peer del servidor usa la public key del servidor.
- La respuesta incluye `wireguard: { serverId, peerId, assignedIp, peerPublicKey, managed:true }`.
  Los secretos van **solo** dentro del script (no como campos sueltos).

Sin `wireguardServerId`, el comportamiento previo (placeholders / manual) se conserva.

## 7. UI

Módulo **WireGuard Manager** (SA/Admin): servidores (endpoint, CIDR, public key,
nº de peers), tabla de peers (IP, router, estado, fecha, rotación), crear servidor,
crear/rotar/revocar peer. Modal que muestra los secretos **una sola vez** con copiar.

## 8. Seguridad

- Secretos cifrados; nunca en texto plano ni en logs (redacción incluye `private-key`/`preshared-key`).
- Secretos mostrados una sola vez; vistas/listados saneados.
- RLS deny-by-default; RBAC SA/Admin.
- Revocación libera IP y desactiva el peer.

## 9. Validación

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm test` | ✅ 322 passed / 34 skipped (20 nuevos) |
| `npm run build` | ✅ |

## 10. Host-apply automático (wg0)

Tras `createPeer` / `rotatePeer` / `revokePeer`, NugaCore empuja el **conjunto completo**
de peers activos al agente del VPS (`WIREGUARD_HOST_APPLY_URL`). El agente reescribe
`/etc/wireguard/wg0.conf` y aplica con `wg syncconf` (sin teardown). Un reconcile
periódico (`WIREGUARD_HOST_APPLY_INTERVAL_MS`, default 60s) corrige drift y claves viejas.

| Pieza | Rol |
|---|---|
| `backend/domains/wireguard/host-apply.ts` | Cliente HTTP + reconcile |
| `scripts/vps/wg-host-apply-agent.py` | Agente root en el VPS |
| `scripts/vps/install-wg-host-apply-agent.sh` | systemd `nugacore-wg-host-apply` |
| Env Coolify | `WIREGUARD_HOST_APPLY_URL`, `WIREGUARD_HOST_APPLY_TOKEN` |

`scripts/vps/sync-wireguard-peers.sh` queda solo como recuperación manual.

## 11. Riesgos restantes

- El agente host-apply debe estar instalado y alcanzable desde el contenedor de la app.
- Por defecto en memoria (`USE_DB_WIREGUARD=false`): se reinicia con el proceso. Activar DB para persistencia.
- No hay ejecución en routers; sin live read-only ni commit mode.

## 12. Instrucciones para Hermes

1. **RBAC**: con Técnico/Cobranza, `/api/wireguard/*` → 403; con SA/Admin → 200.
2. **Servidor**: `POST /api/wireguard/servers {name, endpointHost}` → `server.publicKey` + `serverPrivateKey` (una vez).
3. **Peer**: `POST /api/wireguard/peers {serverId, name, routerId}` → `assignedIp` (/32) + `privateKey`/`presharedKey` (una vez). `GET /peers` no debe traer secretos.
4. **Rotar/Revocar**: `POST /peers/:id/rotate` (nuevas claves) · `DELETE /peers/:id` (libera IP). Crear otro peer → reutiliza la IP liberada.
5. **Integración**: crear servidor + router; `POST /provisioning-script {connectionType:'wireguard_managed', wireguardServerId}` → el script contiene `private-key="..."` y la IP asignada; `response.wireguard.managed=true`. Verificar que el secreto va solo en el script.
6. **UI**: módulo WireGuard Manager visible para SA/Admin; crear servidor/peer muestra los secretos una sola vez.
7. (Opcional) `USE_DB_WIREGUARD=true` + migración aplicada para persistencia en Supabase.

No se avanza a Live Read Only ni Commit Mode.
