# Inventory Read-Only — Resultado de implementación (Fase 4.11.1)

> Trabajo local staging-safe: backend + frontend + tests + docs. NO activa flags, NO
> conecta RouterOS, NO ejecuta comandos, NO toca routers reales ni staging/producción.
> Fecha: 2026-06-18. Diseño: `docs/NOC_READ_ONLY_ARCHITECTURE.md` §1,
> `docs/INVENTORY_READ_ONLY_FOUNDATION.md`.

## Resultado

✅ **4.11.1 Inventory Read-Only Foundation implementada localmente.** Pendiente: validación
en staging por Hermes.

## Endpoints creados (todos READ-ONLY)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/inventory/routers` | Lista saneada de routers |
| GET | `/api/inventory/routers/:id` | Detalle de un router (404 si no existe) |
| GET | `/api/inventory/summary` | Resumen agregado |

`GET /api/inventory/summary` devuelve: `totalRouters`, `onlineRouters`, `offlineRouters`,
`provisionedRouters`, `pendingRouters`, `routersWithVpn`, `routersWithCredentials`,
`lastSeenCount`. Estable con cero routers (todo en 0).

Backend nuevo (submódulo, sin tocar el inventario de almacén):

- `backend/domains/inventory/routers/types.ts` — `InventoryRouterView`, `InventorySummary`.
- `backend/domains/inventory/routers/mappers.ts` — `toInventoryRouterView` (saneado).
- `backend/domains/inventory/routers/repository.ts` — lee `store.MIKROTIK_ROUTERS` (sin `USE_DB_MIKROTIK`).
- `backend/domains/inventory/routers/service.ts` — list/getRouter/getSummary.
- `backend/domains/inventory/routes.ts` — +3 rutas read-only.

## RBAC

Lectura permitida a: **Super Admin, Administrador, Técnico, Soporte, Solo lectura**.
**Cobranza: 403** (no opera infraestructura de red; coherente con el RBAC del provisioning
de routers `PROV_VIEW_ROLES`). No hay escritura para ningún rol (no existen endpoints write).

## UI

- `src/components/InventoryRoutersModule.tsx` — resumen (cards) + tabla read-only + empty
  state + badge `READ-ONLY`. Sin acciones de escritura.
- Navegación: tab `inventory-routers` («Inventario Routers (Read-Only)») en `Sidebar.tsx`,
  visible para los 5 roles de operación (no Cobranza) vía `src/lib/rbac.ts`.
- Conectado en `src/App.tsx`.

> El nombre `InventoryModule.tsx` ya estaba ocupado por el módulo de almacén/ERP; por eso
> el módulo de routers es `InventoryRoutersModule.tsx` (decisión para no romper el existente).

## Tests

- `tests/contract/inventory.routers.contract.test.ts` (13) — endpoints, RBAC (5 roles 200,
  Cobranza 403), detalle 200/404, sanitización (sin `encryptedPassword`/`username`),
  ausencia de endpoints de escritura (POST/PUT/DELETE → 404).
- `tests/unit/inventory.routers.test.ts` (5) — summary con cero routers, summary con mock,
  `getRouter` null, vista saneada, preferencia `managementIp` y derivación de `status`.
- `tests/unit/inventory.routers.ui.test.ts` (9) — scan: read-only, columnas, empty state,
  sin llamadas de escritura, visibilidad por rol (no Cobranza), menú.

## Restricciones respetadas

- `USE_DB_MIKROTIK`, `USE_DB_WIREGUARD`, `MIKROTIK_WORKER_LIVE`, commit mode: **apagados**.
- Sin RouterOS real, sin comandos, sin escritura sobre routers.
- Sin aplicar migraciones, sin deploy, sin tocar staging/producción.
- Sin secretos ni scripts en logs/respuestas.

## Validación local

- `npm run typecheck` → PASS.
- `npm test` → PASS (incluye los 27 tests nuevos).
- `npm run build` → PASS.

## Pendiente para Hermes

- Validar 4.11.1 en staging (RBAC real con usuarios, endpoints, UI).
- Confirmar el estado de aprobación de DB-1 en el repo: a la fecha **no constan** `e65cbf6`
  ni `docs/MIKROTIK_SCHEMA_RECONCILIATION_STAGING_RESULT.md`. Si DB-1 ya fue aprobada,
  conviene crear ese documento para cerrar la trazabilidad.

## Siguiente fase recomendada

NOC Read-Only (health/topología/alertas en vivo) — ver
`docs/NOC_READ_ONLY_ARCHITECTURE.md`. **No iniciar hasta validar 4.11.1 en staging.**
