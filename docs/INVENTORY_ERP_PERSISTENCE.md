# Inventario ERP — Persistencia (Fase 5.1)

> Diseño de la capa de persistencia del dominio Inventario tipo ERP.
> Migración: `supabase/migrations/20260622000000_inventory_schema.sql`.
> Flag: `USE_DB_INVENTORY` (default `false` → store en memoria).

## Contexto

Hasta la Fase 5.1, el dominio `inventory` operaba 100% en memoria
(`backend/state/store.ts`): los artículos (`WarehouseItem`), su estado
operativo (`InventoryItemState`), movimientos y asignaciones vivían en el store
y `routes.ts` los mutaba directo. El almacén era solo un `string` en el item y
la "transferencia" duplicaba el artículo en destino sin entidad propia.

Esta fase introduce **persistencia real** detrás de `USE_DB_INVENTORY`,
siguiendo el patrón de customers/plans/billing (interface repository + dos
implementaciones + factoría por flag), **sin romper el contrato API v1** que
consume el frontend congelado.

## Decisión clave de contrato (visual freeze)

El `InventoryModule.tsx` congelado envía y filtra el almacén por **nombre**
(`'Principal'`, `'Torre Alfa'`, …), no por id. Por eso:

- `inventory_items.warehouse` es **TEXT** (el nombre/etiqueta del almacén).
- `warehouses.name` es **UNIQUE**: el nombre es la clave lógica que vincula
  items ↔ almacén.
- Movimientos y transferencias referencian el almacén por nombre (TEXT), igual
  que `InventoryMovementLog.fromWarehouse/toWarehouse` del store.

Así el almacén pasa a ser una **entidad gestionable de primera clase** sin FKs
frágiles que rompan la UI v1 ni el contrato de `/api/inventory`.

## Modelo de datos

| Tabla | Propósito |
|-------|-----------|
| `warehouses` | Almacén (principal/torre/vehiculo/tecnico/otro), `name` UNIQUE, `is_active`. |
| `inventory_items` | Artículo + estado operativo fundido (qty, serials, `operational_status`, `assigned_to_*`). `warehouse` = nombre. |
| `inventory_movements` | Bitácora `in`/`out`/`transfer`/`adjust`. |
| `inventory_transfers` | Transferencia de primera clase: `pending → completed | cancelled`. El stock se mueve al **completar**. |
| `inventory_assignments` | Asignación/retorno a torre/cliente/técnico. |

Todas con RLS **deny-by-default** (el backend usa service-role, bypass RLS).
La migración es **aditiva e idempotente** (`CREATE TABLE IF NOT EXISTS`), sin
DROP ni renombres; segura de re-aplicar.

## Capas (backend/domains/inventory)

- `types.ts` — tipos del dominio (reexporta los del store + `Warehouse`,
  `InventoryTransfer`, `InventoryItemView`, `WarehouseStock`).
- `mappers.ts` — única traducción snake_case ↔ camelCase (filas DB ↔ app).
- `repository.ts` — `InventoryRepository` (interface) +
  `StoreInventoryRepository` (replica EXACTA del comportamiento previo;
  almacenes/transferencias en la instancia) + `SupabaseInventoryRepository`.
- `service.ts` — validaciones y reglas; factoría `getInventoryService()` que
  elige repo por `isDomainOnDb('inventory')`, con fail-fast si DB sin Supabase.
- `routes.ts` — delega al service vía `asyncHandler`; contrato v1 preservado +
  endpoints aditivos de almacenes y transferencias.

## Contrato API

Preservado (modo store idéntico al previo):
`GET /api/inventory`, `GET /api/inventory/movements`,
`GET /api/inventory/assignments`, `GET|PUT /api/inventory/:id/state`,
`PUT /api/inventory/:id`, `POST /api/inventory/movement`,
`POST /api/inventory/:id/assign|unassign`, `POST /api/inventory/add`.

Nuevos (aditivos):
- Almacenes: `GET|POST /api/inventory/warehouses`,
  `GET|PUT|DELETE /api/inventory/warehouses/:id`,
  `GET /api/inventory/warehouses/:id/stock`.
- Transferencias: `GET|POST /api/inventory/transfers`,
  `GET /api/inventory/transfers/:id`,
  `POST /api/inventory/transfers/:id/complete|cancel`.

RBAC: lectura = `READ_ROLES` (igual que el inventario previo, incluye Cobranza
en lectura del core); escritura = Super Admin / Administrador / Técnico.

## Reconciliación store ↔ DB

- El **modo store** sigue siendo el default y la fuente para `npm test`.
  Almacenes sembrados en el repo: Principal, Torre Alfa, Coche Tecnico 1/2.
- El **modo DB** requiere la migración aplicada. Los almacenes se crean por API
  (no hay seed de datos mock en la migración, consistente con
  `billing_schema`). La transferencia naive por `movement('transfer')` se
  mantiene por compatibilidad de la UI congelada; el flujo de primera clase
  vive en `/api/inventory/transfers`.

## Atomicidad

Las mutaciones compuestas (movimiento/transferencia) en `SupabaseInventoryRepository`
hacen read-modify-write secuencial. Para v1 es aceptable (lo valida Hermes en
staging). Una transacción real exigiría una RPC y queda fuera del alcance 5.1.

## Cómo probar

- Hermético: `npm test` (incluye `tests/contract/inventory.contract.test.ts`).
- DB real (Hermes): aplicar la migración, `USE_DB_INVENTORY=true`, luego
  `npm run test:db` (incluye `inventory.db.contract.test.ts`, con limpieza).
  Recordar: el REST de Supabase está bloqueado desde el entorno local; la
  validación DB la corre Hermes.
