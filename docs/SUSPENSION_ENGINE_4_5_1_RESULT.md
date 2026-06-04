# SUSPENSION ENGINE 4.5.1 — RESULTADO

Fecha: 2026-06-05
Objetivo: desbloquear la validación de Hermes (FAIL 4.5) alineando el motor
con los datos persistentes de Billing/Customers y corrigiendo el contrato del
dashboard. Sin Worker, sin acciones reales, sin tocar routers/MikroTik.

Auditoría: [SUSPENSION_ENGINE_FIX_AUDIT.md](SUSPENSION_ENGINE_FIX_AUDIT.md).

## 1. Causa raíz

El motor 4.5 leía `store.CLIENTS`/`store.INVOICES` (mock), pero en staging
Customers y Billing están en Supabase. Los datos creados en DB no llegaban al
motor → no se podía reproducir el Escenario B. Además el dashboard devolvía
`morosos` en vez de `delinquent`.

## 2. Cambios aplicados

- **Engine async** que lee Customers/Billing **vía sus services** (store o DB según flag) a través de un `SuspensionDataProvider`.
- **Persistencia del motor** detrás de `SuspensionRepository` (memoria o Supabase) con `service.ts` por `USE_DB_SUSPENSION`.
- **Dashboard**: `suspension.delinquent` (+ `morosos` por compat).
- **Herramienta de staging** para crear Escenarios A/B con datos reales.
- Funciones puras intactas (`evaluateInvoice`, `aggregateBillingStatus`, `decideServiceStatus`).

## 3. Archivos

**Creados:** `backend/domains/suspension/{data-provider,repository,service,mappers}.ts`, `docs/SUSPENSION_ENGINE_FIX_AUDIT.md`, `docs/SUSPENSION_ENGINE_4_5_1_RESULT.md`, `tests/contract/suspension.scenarios.contract.test.ts`, `tests/contract/suspension.db.contract.test.ts`.

**Modificados:** `backend/domains/suspension/{engine,routes}.ts`, `backend/domains/dashboard/routes.ts`, `tests/unit/suspension.engine.test.ts`, `tests/contract/suspension.engine.contract.test.ts`.

(`engine-store.ts` se conserva como backing de `StoreSuspensionRepository`.)

## 4. Cómo funciona USE_DB_SUSPENSION

| Flag | Política / estado / eventos / órdenes |
|---|---|
| `false` (default) | `engine-store` en memoria (idéntico a 4.5). |
| `true` | Supabase (`suspension_policies`, `customer_service_state`, `suspension_events`, `suspension_orders`, `reactivation_orders`). Requiere `SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY`. |

**Independiente** de la fuente de **datos**: el provider usa los services de
Customers/Billing, así que con `USE_DB_CUSTOMERS`/`USE_DB_BILLING=true` el motor
ya evalúa datos reales aunque `USE_DB_SUSPENSION` siga en `false`.

## 5. Cómo validar Escenario A (suspensión)

```
POST /api/suspension/test-tools/scenario   { "confirm": true, "scenario": "A" }
→ crea cliente ACTIVO + factura vencida (15 días) → { customerId, invoiceId }
POST /api/suspension/evaluate/<customerId>
→ action=create_suspension, serviceStatus=PENDING_SUSPENSION
GET  /api/suspension/orders?customerId=<customerId>
→ 1 orden orderType=suspension, status=PENDING
GET  /api/clients/<customerId> → status sigue "active" (no se ejecutó)
```

## 6. Cómo validar Escenario B (reactivación)

```
POST /api/suspension/test-tools/scenario   { "confirm": true, "scenario": "B" }
→ crea cliente SUSPENDIDO + factura PAGADA → { customerId }
POST /api/suspension/evaluate/<customerId>
→ action=create_reactivation, serviceStatus=PENDING_REACTIVATION
GET  /api/suspension/orders?customerId=<customerId>
→ 1 orden orderType=reactivation, status=PENDING
GET  /api/clients/<customerId> → status sigue "suspended" (el motor no ejecuta)
```

Reevaluar no duplica órdenes (idempotente). Limpieza: `DELETE /api/suspension/test-tools/customer/<id>`.

## 7. Cómo probar local

- **Mock**: `npm test` (incluye Escenarios A/B vía test-tools en modo hermético).
- **DB**: con `.env` apuntando a Supabase staging + migración 4.5 aplicada:
  `RUN_DB_TESTS=true npm run test:db` (ejecuta `suspension.db.contract`, Escenarios A/B reales).
- Guardas de la herramienta: `NODE_ENV!==production`, `STAGING_TEST_TOOLS_ENABLED!=false`, rol super admin + `confirm:true`.

## 8. Resultado de validación local

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ sin errores |
| `npm test` | ✅ 258 passed / 34 skipped |
| `npm run build` | ✅ OK |
| `RUN_DB_TESTS=true npm run test:db` | ⏭️ requiere credenciales staging (se ejecuta en el entorno de Hermes) |

## 9. Riesgos restantes

- `SupabaseSuspensionRepository` se ejercita solo bajo `RUN_DB_TESTS`; validar en staging.
- `due_soon_days` no está en la tabla `suspension_policies`: en modo DB usa default 3 (solo afecta WARNING/DUE_SOON, no decisiones de corte). Si se requiere persistirlo, añadir `ALTER TABLE ... ADD COLUMN due_soon_days` en una migración futura.
- La reactivación automática de Billing al pagar (mock, en `billing/routes.ts`) sigue activa; al construir el Worker debe centralizarse en el motor.
- La herramienta de staging crea datos `__TEST__`; usar el `DELETE` de limpieza tras validar. **Nunca** disponible en producción.
- Sigue sin ejecutarse nada: las órdenes quedan `PENDING` para el Worker (fase 4.6).

## 10. Instrucciones para Hermes

1. **Pre**: staging con `USE_DB_CUSTOMERS=true`, `USE_DB_BILLING=true`; migración `20260605120000_suspension_engine.sql` aplicada. `USE_DB_SUSPENSION` opcional (`true` para persistir el estado del motor en DB).
2. **Dashboard**: `GET /api/dashboard-stats` → `suspension.delinquent` presente (numérico).
3. **Escenario A**: test-tools `scenario:A` → evaluate → `create_suspension` + orden `PENDING`; `client.status` sigue `active`.
4. **Escenario B**: test-tools `scenario:B` → evaluate → `create_reactivation` + orden `PENDING`; `client.status` sigue `suspended`.
5. **Idempotencia**: reevaluar no duplica órdenes.
6. **No ejecución**: ningún `client.status` cambia por el motor; sin nuevos logs MikroTik.
7. **RBAC**: Soporte 403; Solo lectura/Técnico ven pero no evalúan; Cobranza evalúa; política solo SA/Admin.
8. **Candados**: la herramienta responde 404 si `NODE_ENV=production` o `STAGING_TEST_TOOLS_ENABLED=false`; 403 sin super admin; 400 sin `confirm`.
9. **Limpieza**: `DELETE /api/suspension/test-tools/customer/<id>` para cada cliente `__TEST__`.
10. **(Opcional) DB tests**: `RUN_DB_TESTS=true npm run test:db`.

No se avanza al Worker MikroTik ni se ejecutan acciones reales.
