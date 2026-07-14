# FASE 5.1 — Inventario ERP: Persistencia + UI aditiva (Resultado)

> Estado: ✅ **Code-complete local** (typecheck/test/build verdes).
> Pendiente: validación de Hermes en staging (aplicar migración + `USE_DB_INVENTORY=true`).
> Diseño: [`INVENTORY_ERP_PERSISTENCE.md`](../inventory/INVENTORY_ERP_PERSISTENCE.md).

## 1. Qué se analizó

- El dominio `inventory` corría 100% en memoria; `routes.ts` mutaba `store.*`
  directo, sin patrón service+repository. Almacén = string; transferencia naive.
- El flag `USE_DB_INVENTORY` y la `DomainKey` `inventory` ya existían sin uso.
- Patrón de referencia: customers/plans/billing (repository + factoría por flag).
- Frontend congelado (`InventoryModule.tsx`) prop-driven, almacenes por nombre.

## 2. Qué se construyó

- **Migración** `20260622000000_inventory_schema.sql`: `warehouses`,
  `inventory_items`, `inventory_movements`, `inventory_transfers`,
  `inventory_assignments`. Aditiva, idempotente, RLS deny-by-default, triggers
  `update_modified_column()`.
- **Backend**: refactor del dominio a `types.ts` / `mappers.ts` /
  `repository.ts` (interface + Store + Supabase) / `service.ts` (factoría por
  `USE_DB_INVENTORY`, fail-fast). `routes.ts` delega al service; contrato v1
  preservado + endpoints aditivos de **almacenes** y **transferencias**.
- **Almacén como entidad de primera clase** y **transferencias con ciclo**
  `pending → completed | cancelled` (el stock se mueve al completar).
- **UI aditiva** (tema slate/indigo, sin rediseñar lo existente):
  `WarehousesModule.tsx` (CRUD + stock por almacén) e
  `InventoryTransfersModule.tsx` (crear/completar/cancelar). Se integran como
  **sub-tabs internas** del tab `inventory` (Artículos | Almacenes |
  Transferencias); "Artículos" sigue siendo el `InventoryModule` intacto.
- **Tests**: `inventory.contract.test.ts` (hermético, 20 casos) y
  `inventory.db.contract.test.ts` (opt-in `RUN_DB_TESTS`, smoke para Hermes).

## 3. Archivos

Nuevos:
- `supabase/migrations/20260622000000_inventory_schema.sql`
- `backend/domains/inventory/{types,mappers,repository,service}.ts`
- `src/components/{WarehousesModule,InventoryTransfersModule}.tsx`
- `tests/contract/inventory.contract.test.ts`
- `tests/contract/inventory.db.contract.test.ts`
- `docs/INVENTORY_ERP_PERSISTENCE.md`, `docs/INVENTORY_ERP_5_1_RESULT.md`

Modificados:
- `backend/domains/inventory/routes.ts` (delegación + endpoints nuevos)
- `src/App.tsx` (imports + sub-tabs del tab inventory; bloque acotado)
- `scripts/run-tests.mjs` (agrega el test DB de inventario)
- `.env.example` (nota de `USE_DB_INVENTORY`), `ROADMAP.md`,
  `docs/SUPABASE_MIGRATIONS_SYNC.md`

Sin cambios: `InventoryModule.tsx`, `src/lib/rbac.ts`, tema, otros dominios.

## 4. Tablas creadas / migradas

`warehouses`, `inventory_items`, `inventory_movements`,
`inventory_transfers`, `inventory_assignments` (todas con RLS habilitada).

## 5. Cómo probar

- `npm run typecheck` · `npm test` · `npm run build` → verdes.
- Local (modo store, default): tab Inventario → "Artículos" idéntico; sub-tabs
  Almacenes/Transferencias operan contra el store; cero regresión visual.
- Staging (Hermes): aplicar la migración, `USE_DB_INVENTORY=true`,
  `npm run test:db`. El REST de Supabase está bloqueado desde local.

## 6. Riesgos remanentes

- Atomicidad: movimientos/transferencias en DB son read-modify-write secuencial
  (sin transacción). Aceptable v1; revisar con RPC si se requiere estricto.
- La transferencia naive por `movement('transfer')` coexiste con la de primera
  clase (compatibilidad de la UI congelada).
- Selects de almacén en el `InventoryModule` congelado siguen hardcodeados
  (cambiarlos a dinámicos toca markup → requiere autorización; fuera de alcance).

## 7. Siguiente fase (gated)

- **5.2**: series/garantías y trazabilidad por número de serie; valuación y
  reportes de inventario; almacenes dinámicos en los selects existentes (con
  autorización de UI). Luego continuar con Finanzas y FTTH (módulos aparte).
