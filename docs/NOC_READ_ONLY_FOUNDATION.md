# NOC Read-Only Foundation (Fase 4.11.2)

Fecha: 2026-06-18
Estado: Implementación local (pendiente validación Hermes en staging)

## Qué es esta fase

La Fase 4.11.2 crea la base del dashboard NOC en modo estrictamente READ-ONLY.

Objetivo:

- Exponer visibilidad operativa inicial de routers y alertas derivadas.
- Reutilizar datos que ya existen en NugaCore.
- Mantener un alcance seguro para local/staging sin acciones sobre infraestructura real.

## Fuentes de datos usadas

Esta fase usa únicamente datos internos existentes:

- `store.MIKROTIK_ROUTERS` (registro local de routers, base del inventario read-only).
- Estado local derivado (`isOnline`, `vpnIp`, `hasCredentials`, `cpuUsagePct`, `memoryUsagePct`, timestamps de health).

No se leen routers reales y no se activa runtime DB MikroTik.

## Restricciones (obligatorias)

READ-ONLY estricto:

- Sin RouterOS real.
- Sin Worker live.
- Sin ping/polling real.
- Sin Telegram/email/push externos.
- Sin acciones correctivas.
- Sin write actions.
- Sin auto-provisioning.
- Sin commit mode.

Flags que deben permanecer apagados:

- `USE_DB_MIKROTIK`
- `USE_DB_WIREGUARD`
- `MIKROTIK_WORKER_LIVE`

## Endpoints expuestos

Todos son GET y READ-ONLY:

- `GET /api/noc/summary`
- `GET /api/noc/routers`
- `GET /api/noc/alerts`

No existen endpoints `POST`, `PUT`, `PATCH`, `DELETE` para `/api/noc/*` en esta fase.

### `GET /api/noc/summary`

Devuelve:

- `totalRouters`
- `onlineRouters`
- `offlineRouters`
- `routersWithVpn`
- `routersWithCredentials`
- `pendingProvisioning`
- `staleRouters`
- `activeAlerts`
- `criticalAlerts`
- `warningAlerts`

Debe ser estable con 0 routers (valores en 0).

### `GET /api/noc/routers`

Devuelve formato operativo read-only por router:

- `id`
- `name`
- `status`
- `isOnline`
- `connectionType`
- `managementIp`
- `vpnIp`
- `lastSeenAt`
- `lastHealthCheckAt`
- `routerosVersion`
- `cpuUsagePct`
- `memoryUsagePct`
- `healthStatus`

### `GET /api/noc/alerts`

Devuelve alertas derivadas de forma determinística desde datos existentes.

Tipos iniciales:

- `router_offline`
- `missing_vpn`
- `missing_credentials`
- `health_stale`
- `high_cpu`
- `high_memory`

No dispara notificaciones externas en esta fase.

## RBAC de lectura

Pueden ver NOC read-only:

- Super Admin
- Administrador
- Técnico
- Soporte
- Solo lectura

No puede ver NOC read-only:

- Cobranza

## Qué NO hace esta fase

- No modifica routers.
- No ejecuta comandos MikroTik.
- No aplica migraciones.
- No hace deploy.
- No toca datos/infra de producción.

## Qué queda para fases futuras

Fuera de 4.11.2:

- Health real por worker live (gated).
- Polling real y métricas en tiempo real.
- Alertas externas (Telegram/email/push).
- Acciones manuales seguras (manual safe mode).
- Cola de comandos segura (dry-run/commit por aprobación).
- Provisioning real.
