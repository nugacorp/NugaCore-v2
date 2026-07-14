# NugaCore — Resultado Fase 4.2: Billing Persistence

> Fecha: 2026-06-04 · Estado: **implementado**, detrás de `USE_DB_BILLING` (default `false`).
> Relacionado: [BILLING_ARCHITECTURE.md](../billing/BILLING_ARCHITECTURE.md) · [BILLING_4_1_RESULT.md](./BILLING_4_1_RESULT.md) · [BILLING_ROADMAP.md](../planning/BILLING_ROADMAP.md)

---

## 1. Qué se hizo

Se conectó el **dominio Billing** a persistencia real (Supabase/PostgreSQL), usando el
mismo patrón de Customers y Plans (mappers → repository → service → feature flag),
**sin modificar el frontend** y **manteniendo el contrato de API v1 intacto**.

- `USE_DB_BILLING=false` (default): comportamiento idéntico al anterior (store en memoria).
- `USE_DB_BILLING=true`: el CRUD de facturas y pagos usa Supabase (tablas de Fase 4.1).
- El cambio es reversible con un solo flag.

> No se tocó MikroTik, Suspension, Inventory, Tickets, GIS ni el frontend.
> Customers y Plans siguen intactos.

---

## 2. Archivos creados / modificados

| Archivo | Acción |
|---------|--------|
| `backend/domains/billing/mappers.ts` | CREADO |
| `backend/domains/billing/repository.ts` | CREADO |
| `backend/domains/billing/service.ts` | CREADO |
| `backend/domains/billing/routes.ts` | MODIFICADO (refactor completo) |
| `tests/unit/billing.mappers.test.ts` | CREADO |
| `tests/unit/billing.service.test.ts` | CREADO |
| `tests/contract/billing.contract.test.ts` | CREADO |
| `tests/contract/billing.db.contract.test.ts` | CREADO |
| `scripts/run-tests.mjs` | MODIFICADO (agrega billing.db.contract) |

---

## 3. Arquitectura

```
routes.ts (HTTP + RBAC + asyncHandler)         ← contrato v1 intacto
   │  llama a
service.ts (BillingService)                    ← validaciones + reglas de negocio
   │  usa
repository.ts (BillingRepository)              ← interfaz
   ├── StoreBillingRepository                  (USE_DB_BILLING=false → store)
   └── SupabaseBillingRepository               (USE_DB_BILLING=true  → Supabase)
        │  traduce con
        └── mappers.ts (InvoiceRow → EnrichedInvoice, cents ↔ pesos)
```

### `EnrichedInvoice`
```typescript
interface EnrichedInvoice extends Invoice {
  paidAmount: number;      // suma de pagos aplicados
  pendingAmount: number;   // amount - paidAmount
}
```
Todos los endpoints devuelven `EnrichedInvoice`. El frontend no nota la diferencia
porque ya recibía esta forma enriquecida del antiguo `withAccountState()`.

---

## 4. Feature flag

| Variable | Default | Efecto |
|----------|---------|--------|
| `USE_DB_BILLING` | `false` | `false` → store mock; `true` → Supabase |

---

## 5. Endpoints (contrato v1 intacto)

| Método | Ruta | RBAC | Notas de implementación |
|--------|------|------|------------------------|
| GET | `/api/billing/invoices` | READ_ROLES | Lista + paidAmount/pendingAmount |
| GET | `/api/billing/invoices/:id/account-state` | READ_ROLES | `{ invoice, allocations[] }` |
| GET | `/api/billing/account-summary` | READ_ROLES | Totales financieros |
| GET | `/api/billing/revenue-report` | READ_ROLES | Por método + top pendientes |
| POST | `/api/billing/invoices` | super admin, administrador, cobranza | Crear factura |
| POST | `/api/billing/invoices/:id/pay` | super admin, administrador, cobranza | Registrar pago |
| PUT | `/api/billing/invoices/:id` | super admin, administrador, cobranza | Editar factura |

---

## 6. Tablas de Supabase usadas (modo DB)

| Tabla | Operación |
|-------|-----------|
| `invoices` | SELECT, INSERT, UPDATE |
| `invoice_items` | SELECT, INSERT, DELETE (en update) |
| `payments` | INSERT |
| `payment_applications` | SELECT, INSERT |
| `clients` | Solo lectura implícita via FK (validación de clientId en mock mode) |

---

## 7. Mapeo DB → API v1

| DB (snake_case/cents) | API v1 (camelCase/pesos) |
|-----------------------|--------------------------|
| `issue_date` | `dateStr` |
| `due_date` | `dueDateStr` |
| `applied_cents / 100` | `paidAmount` |
| `balance_cents / 100` | `pendingAmount` (aproximado) |
| `payments + payment_applications` JOIN | `payments[]` embebido |
| `invoice_items` JOIN | `items[]` |
| status computado en tiempo real | `status` |

**Status en tiempo real:** `balance_cents ≤ 0` → `paid`; `due_date < now` → `overdue`; resto → `unpaid`.
Mismo algoritmo que `syncInvoiceStatus()` del mock.

---

## 8. Validaciones del service

| Acción | Reglas |
|--------|--------|
| `validateCreateInvoice` | `clientId` requerido, `amount ≥ 0`, items default si no se pasan |
| `validateUpdateInvoice` | Validación parcial; `status` debe ser enum válido |
| `validatePayment` | `pendingAmount > 0`; `amount ≤ pendingAmount`; sin `amount` → paga el balance completo |

---

## 9. Comportamiento de reactivación automática al pagar

| Modo | Comportamiento |
|------|---------------|
| `USE_DB_BILLING=false` (mock) | Igual que antes: revisa `store.CLIENTS` y `store.SUSPENSION_POLICY`. Si el cliente estaba suspendido y `allowAutoReactivateOnPayment=true` → lo reactiva. |
| `USE_DB_BILLING=true` (DB) | **Omitido** — se implementará en Fase 4.5 junto con el dominio Suspension. |

---

## 10. Cómo probar (modo mock, default)

```bash
npm run typecheck && npm test && npm run build
npm run dev:tsx
```

- `GET /api/billing/invoices` → 5 facturas del mock, con `paidAmount`/`pendingAmount`.
- `POST /api/billing/invoices/:id/pay` → pago parcial o completo.
- El frontend (`BillingModule.tsx`) sigue funcionando igual.

---

## 11. Cómo probar (modo DB, requiere staging)

```env
USE_DB_BILLING=true
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
```

```bash
npm run dev:tsx
# Logs: "Billing domain: persistencia = Supabase (USE_DB_BILLING=true)"
```

Smoke test:
1. `GET /api/billing/invoices` → array (puede estar vacío si no hay facturas en DB)
2. `POST /api/billing/invoices` con `{ clientId: "c-1", amount: 299 }` → 201
3. `POST /api/billing/invoices/:id/pay` con `{ amount: 150, method: "SPEI" }` → 200, `paidAmount=150`
4. Reiniciar servidor → `GET /api/billing/invoices/:id/account-state` → datos persisten

---

## 12. Rollback

```env
USE_DB_BILLING=false
```

Reiniciar el servidor → vuelve al store en memoria. Sin cambios de esquema en DB.

---

## 13. Resultado de verificación local (2026-06-04)

| Verificación | Resultado |
|-------------|-----------|
| `npm run typecheck` | ✅ sin errores |
| `npm test` (hermético) | ✅ **131 passed** · 32 skipped |
| `npm run build` | ✅ exitoso |
| `RUN_DB_TESTS=true npm run test:db` | ✅ **21/21 passed** (billing.db 9 + billing.schema 8 + plans 2 + customers 2) |

---

## 14. Desglose de tests nuevos

### Unit tests
- `tests/unit/billing.mappers.test.ts` — 12 tests: rowToItem, rowToInvoicePayment, rowsToEnrichedInvoice, rowsToAllocations, buildInvoiceInsertRow, buildItemInsertRow.
- `tests/unit/billing.service.test.ts` — 22 tests: validateCreateInvoice, validateUpdateInvoice, validatePayment, delegaciones CRUD.

### Contract tests (hermético)
- `tests/contract/billing.contract.test.ts` — 14 tests: GET lectura, POST crear, POST pagar (parcial/completo/doble/exceso), PUT editar, 404s, 403 RBAC.

### DB tests (opt-in)
- `tests/contract/billing.db.contract.test.ts` — 9 tests: create→find→recordPayment(parcial)→recordPayment(completo)→getAccountState→listInvoices→updateInvoice→null para inexistente + cleanup.

---

## 15. Riesgos

| Riesgo | Severidad | Nota |
|--------|:---------:|------|
| Status en DB puede desincronizarse si se modifica `status` directamente vía `PUT` | 🟡 | En Fase 4.5 se implementará un job de sincronización. Por ahora, el status se computa en tiempo real en cada lectura. |
| `generateInvoiceId` con máximo de sufijos: colisión en concurrencia | 🟡 | Aceptable para piloto. En Fase 4.2+ se puede usar `gen_random_uuid()` o secuencia DB. |
| Reactivación automática desactivada en modo DB | 🟡 | Documentado; se implementa en Fase 4.5. |
| `POST /api/billing/invoices` en modo DB no busca `clientName` desde `clients` | 🟡 | Toma el `clientName` del body o usa el `clientId` como fallback. La UI mock siempre pasa el nombre. |

---

## 16. Instrucciones para Hermes (staging)

1. Poner `USE_DB_BILLING=true` y reiniciar.
2. Verificar log: `Billing domain: persistencia = Supabase (USE_DB_BILLING=true)`.
3. Smoke test:
   - `GET /api/billing/invoices` → responde (puede ser vacío).
   - `POST /api/billing/invoices` con `{ clientId: "c-1", amount: 299 }` → 201.
   - `POST /api/billing/invoices/:id/pay` → 200, `paidAmount` correcto.
   - Reiniciar → factura persiste en `GET`.
4. `RUN_DB_TESTS=true npm run test:db` → esperar 21/21.
5. Volver a `USE_DB_BILLING=false` si todo está OK.

**No avanzar a Fase 4.3 sin aprobación.**
