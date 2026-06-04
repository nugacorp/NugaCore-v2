# SUSPENSION ENGINE FIX — AUDITORÍA DE CAUSA RAÍZ (Fase 4.5.1)

Fecha: 2026-06-05
Contexto: Hermes marcó FAIL la Fase 4.5. Esta auditoría explica por qué y
cómo se corrige sin romper el mock ni Customers/Billing.

Commit evaluado: `3685349`.

## 1. Por qué staging no podía validar la reactivación (Escenario B)

- En staging: `USE_DB_CUSTOMERS=true`, `USE_DB_BILLING=true` → Customers y Billing viven en **Supabase**.
- El motor 4.5 leía **`store.CLIENTS` y `store.INVOICES`** (el mock en memoria) directamente en `engine.ts`.
- Por tanto, los clientes/facturas creados por API o SQL en **Supabase** nunca entraban al dataset que el motor evaluaba.
- Resultado: imposible construir el escenario "cliente suspendido + factura pagada → ReactivationOrder", porque el motor no veía esos datos.

## 2. Qué datos LEE hoy el motor (4.5)

| Dato | Fuente 4.5 (incorrecta en DB) |
|---|---|
| Clientes (estado de red) | `store.CLIENTS` (mock) |
| Facturas (vencimiento/saldo) | `store.INVOICES` (mock) |
| Política / estado / órdenes / eventos | `engine-store` (memoria) |

## 3. Qué datos DEBERÍA leer

| Dato | Fuente correcta |
|---|---|
| Clientes | `getCustomersService().list()` → store **o** Supabase según `USE_DB_CUSTOMERS` |
| Facturas | `getBillingService().listInvoices()` → store **o** Supabase según `USE_DB_BILLING` |
| Política / estado / órdenes / eventos | `SuspensionRepository` → memoria **o** Supabase según `USE_DB_SUSPENSION` |

Clave: los services de Customers/Billing **ya** eligen store-o-DB por su propio flag. El motor solo debe leer **a través de ellos** (sin duplicar lógica).

## 4. Segundo bloqueo — contrato del dashboard

- `dashboard-stats.suspension` devolvía `morosos`.
- El contrato esperado era `delinquent`.
- Fix: el bloque expone `delinquent` (clientes en `DELINQUENT`) y mantiene `morosos` (DELINQUENT+OVERDUE) por compatibilidad.

## 5. Cómo se corrige (sin romper el mock)

1. **`SuspensionDataProvider`** (`data-provider.ts`): abstracción de solo lectura sobre Customers/Billing.
   - `StoreSuspensionDataProvider` (mock directo) y `ServiceSuspensionDataProvider` (vía services → correcto en DB). Selección automática: si Customers o Billing están en DB, usa el de services.
2. **`SuspensionRepository`** (`repository.ts`) + **`service.ts`**: persistencia del estado del motor con `StoreSuspensionRepository` (engine-store) y `SupabaseSuspensionRepository` (tablas 4.5), elegido por `USE_DB_SUSPENSION`.
3. **`engine.ts`** se vuelve **async** y usa `getSuspensionService()` (repo + provider). Las funciones puras (`evaluateInvoice`, `aggregateBillingStatus`, `decideServiceStatus`) se conservan idénticas y testeables.
4. **Herramienta de staging** (`/api/suspension/test-tools/scenario`) crea escenarios A/B usando los services reales → Hermes puede reproducirlos también con DB. Triple candado (no-prod + flag + super admin/confirm).
5. **Dashboard**: añade `delinquent`.

Compatibilidad: con todos los flags en `false` el comportamiento es idéntico al 4.5 (los 252 tests previos siguen verdes).
