# Inventory Read-Only Foundation (Fase 4.11.1)

> Auditoría y alcance de la primera subfase de Inventory Read-Only. Trabajo local
> staging-safe: NO activa `USE_DB_MIKROTIK`, NO conecta RouterOS, NO ejecuta comandos.
> Fecha: 2026-06-18.

## Qué existe hoy

- **Modelo canónico `mikrotik_routers`** (DB-1): migración
  `supabase/migrations/20260618000000_mikrotik_routers_reconciliation.sql` (schema-only) +
  tipos alineados (`CANONICAL_MIKROTIK_ROUTER_COLUMNS`, `MikrotikRouterRegistryItem`).
- **Store en memoria** `store.MIKROTIK_ROUTERS` (`MikrotikRouterRegistryItem[]`), fuente de
  datos actual mientras `USE_DB_MIKROTIK` está apagado.
- **Dominio mikrotik/provisioning** con `toProvisionedView` (vista saneada existente).
- **Dominio inventory** existente, dedicado a **almacén/ERP** (`WarehouseItem`), distinto del
  inventario de routers. Esta fase añade un submódulo `inventory/routers/` sin tocar el almacén.

> Nota de estado: a la fecha de esta implementación, en el repo **no constan** el commit
> `e65cbf6` ni `docs/MIKROTIK_SCHEMA_RECONCILIATION_STAGING_RESULT.md`. La aprobación
> staging de DB-1 por Hermes no es verificable en el repo todavía. Esta fase es local y
> NO depende de esa aprobación (usa el store en memoria), pero la validación staging de
> 4.11.1 y la confirmación de DB-1 siguen siendo de Hermes.

## Qué datos salen de `mikrotik_routers`

La vista saneada `InventoryRouterView` (sin secretos) expone:

| Campo | Origen canónico | Notas |
|---|---|---|
| `id`, `name` | id, name | Identidad |
| `status` | is_online | Derivado: `online`/`offline` |
| `isOnline` | is_online | |
| `provisioningStatus` | provisioning_status | Estado canónico (espejo `status`) |
| `connectionType` | connection_type | |
| `managementIp` | management_ip ?? ip_address | Canónico con espejo legacy |
| `vpnIp` | vpn_ip | |
| `apiPort`, `apiSslPort` | api_port, api_ssl_port | |
| `routerOsVersion` | routeros_version | |
| `towerId` | linked_tower_id | Topología |
| `hasCredentials` | has_credentials | Derivado de credencial cifrada |
| `cpuUsagePct`, `memoryUsagePct` | cpu/memory_usage_pct | Último muestreo |
| `lastSeenAt`, `lastHealthCheckAt` | last_seen_at, last_health_check_at | |
| `notes` | notes | |

**NUNCA se expone:** `encrypted_password`, `username`, claves, tokens ni scripts.

## Qué queda pendiente para NOC (no en esta fase)

Ver `docs/NOC_READ_ONLY_ARCHITECTURE.md`. Pendiente: health en vivo (ping/latencia,
CPU/RAM en tiempo real), lectura de interfaces/queues/PPP en vivo, topología visual,
alertas con rate limit. Todo eso requiere el worker en modo lectura (gated) y queda fuera
de 4.11.1.

## Qué NO hace esta fase

- No lee RouterOS real ni conecta a routers.
- No ejecuta comandos ni dry-run.
- No sincroniza estado en vivo (los datos son del store local).
- No tiene acciones de escritura (ningún POST/PUT/PATCH/DELETE de routers).
- No activa la persistencia DB del dominio MikroTik.

## Flags que deben permanecer apagados

- `USE_DB_MIKROTIK` (apagado).
- `USE_DB_WIREGUARD` (apagado).
- `MIKROTIK_WORKER_LIVE=false`.
- commit mode (apagado).
