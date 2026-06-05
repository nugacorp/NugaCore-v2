# WIREGUARD MANAGER AUDIT — Fase 4.6.1

Fecha: 2026-06-05
Alcance: auditar lo que falta para que NugaCore sea el **administrador central
de WireGuard** de todos los routers. Esta fase construye SOLO la infraestructura
de administración (claves, peers, direccionamiento, estado, revocación). NO
ejecuta acciones reales sobre routers, NO commit mode.

## 1. Qué existe hoy

| Pieza | Estado |
|---|---|
| `provisioning/script-generator.ts` | Genera el script `wireguard_managed`: crea `NugaCoreWG` y un peer hacia el servidor. Usa `wgServerPublicKey`, `routerVpnIp`, endpoint. |
| Flujo de claves | **Parcialmente manual**: el router genera su propia private-key (RouterOS) y el operador copia su public-key para registrarla. La public key del servidor se pega como placeholder/env. |
| Direccionamiento | Manual: `routerVpnIp` se escribe a mano o por env; no hay IPAM. |
| Servidor WireGuard | No modelado en NugaCore (host/port/clave del servidor viven en `.env`). |
| Peers / estado / revocación | No existen como entidades. |

## 2. Qué sigue siendo manual

- **Intercambio de claves**: NugaCore no genera el par de claves del peer ni conoce su public key sin intervención humana.
- **Asignación de IP**: sin pool ni IPAM; riesgo de duplicados/colisiones.
- **Registro de peers en el servidor**: manual.
- **Rotación / revocación**: inexistente.

## 3. Qué falta para operación completa

1. **Modelo**: `wireguard_servers`, `wireguard_peers`, `wireguard_ip_allocations`, `wireguard_key_rotations`.
2. **Generación de claves** centralizada: private/public (Curve25519/x25519) + preshared key. Secretos cifrados, mostrados una sola vez.
3. **IPAM** sobre `10.70.0.0/16`: asignación automática, sin duplicados, reutilización de IPs liberadas.
4. **Service/repository/mappers/types** del dominio `wireguard`.
5. **Endpoints** (SA/Admin): CRUD de servidores y peers + rotate + revoke.
6. **Integración con provisioning**: `wireguard_managed` consume del manager la public key del servidor, la config del peer y la IP asignada.
7. **UI** "WireGuard Manager": servidores, peers, IP, estado, fechas, rotaciones.

## 4. Modelo de claves (decisión)

NugaCore **genera el par de claves del peer** (private + public) y la **preshared key**:
- Devuelve `private-key`/`preshared-key` **una sola vez** (para incrustarlos en el script del router).
- Persiste: public key del peer (pública), private/psk **cifrados** (AES-256-GCM con `MIKROTIK_CREDENTIALS_KEY`), IP asignada, estado.
- El servidor también tiene su par; se persiste public (plana) + private (cifrada).

Esto elimina el intercambio manual: el script puede fijar la private-key del router y el servidor ya conoce la public key del peer.

## 5. Riesgos actuales (sin esta fase)

- Colisiones de IP en la VPN por asignación manual.
- Claves del peer fuera del control de NugaCore → no se pueden rotar/revocar centralizadamente.
- Public key del servidor en `.env` sin versionado/rotación.
- Sin auditoría de rotaciones.

## 6. Seguridad de esta fase

- Secretos (private keys, preshared keys) **cifrados**; nunca en texto plano ni en logs.
- `private-key`/`preshared-key` se muestran **una sola vez** al crear/rotar.
- Listados/GET devuelven solo metadata (public key, IP, estado, fechas) — nunca secretos.
- RLS deny-by-default en las tablas.
- RBAC: solo Super Admin / Administrador.

## 7. Límites (NO en esta fase)

- NO ejecutar nada en routers reales, NO live read-only, NO commit mode.
- NO tocar queues/PPP/hotspot/suspensiones.
- El servidor WireGuard físico (VPS) y el registro real de peers en wg0 se operan fuera de NugaCore (esta fase deja el modelo y la generación listos).
