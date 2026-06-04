# NugaCore — Resultado Fase 4.1: Billing Schema SQL

> Fecha: 2026-06-04 · Estado: **migraciones creadas, NO aplicadas en staging aún.**
> Relacionado: [BILLING_ARCHITECTURE.md](BILLING_ARCHITECTURE.md) · [BILLING_ROADMAP.md](BILLING_ROADMAP.md)

---

## 1. Archivos creados en esta fase

| Archivo | Propósito |
|---------|-----------|
| `supabase/migrations/20260604000000_billing_schema.sql` | Schema: nuevas tablas + columnas en tablas existentes |
| `supabase/migrations/20260604000001_billing_data_migration.sql` | Migración de datos: seed mock + migración legacy payments |
| `tests/contract/billing.schema.db.test.ts` | Tests opt-in contra Supabase real |
| `scripts/validate-billing-schema.mjs` | Script de validación del esquema |
| `scripts/run-tests.mjs` (modificado) | Agrega `billing.schema.db.test.ts` al modo `db` |

**No se modificó:** ningún archivo de TypeScript de producción (`routes.ts`, `service.ts`, `repository.ts`, `mappers.ts`, frontend). El flag `USE_DB_BILLING` sigue en `false`.

---

## 2. Tablas nuevas creadas

| Tabla | Descripción |
|-------|-------------|
| `service_subscriptions` | Contratos cliente↔plan (billing_day, due_days, started_at) |
| `payments` | Transacciones de caja recibidas (entidad independiente) |
| `payment_applications` | Conciliación M:N pago↔factura |
| `credit_notes` | Notas de crédito a favor del cliente |
| `credit_applications` | Uso de créditos en facturas específicas |
| `adjustments` | Ajustes manuales (cargos + o descuentos -) en facturas |
| `payment_receipts` | Comprobantes de pago emitidos al cliente |

---

## 3. Columnas nuevas en tablas existentes

### `public.clients`
- `credit_balance_cents INTEGER NOT NULL DEFAULT 0` — saldo a favor del cliente

### `public.invoices`
| Columna | Tipo | Notas |
|---------|------|-------|
| `subscription_id` | TEXT FK | referencia a `service_subscriptions` |
| `billing_period_start` | DATE | inicio del período facturado |
| `billing_period_end` | DATE | fin del período facturado |
| `subtotal_cents` | INTEGER | suma de ítems antes de descuento |
| `discount_cents` | INTEGER | descuento total |
| `tax_cents` | INTEGER | IVA u otros impuestos |
| `total_cents` | INTEGER | monto total en centavos |
| `applied_cents` | INTEGER | pagos conciliados acumulados |
| `credit_applied_cents` | INTEGER | créditos aplicados |
| `balance_cents` | INTEGER **GENERATED** | `total_cents - applied_cents - credit_applied_cents` |
| `canceled_at` | TIMESTAMPTZ | fecha de cancelación |
| `cancel_reason` | TEXT | motivo de cancelación |
| `idempotency_key` | TEXT UNIQUE | previene generación duplicada |
| `created_by` | TEXT | actorId del operador |
| `cfdi_xml_url` | TEXT | URL al XML del CFDI (Fase 4.9) |

### `public.invoice_items`
- `unit_price_cents INTEGER` — precio unitario en centavos
- `discount_cents INTEGER` — descuento por línea
- `tax_rate NUMERIC(5,4)` — tasa de IVA (default `0.16`)
- `sort_order INTEGER` — orden de presentación

---

## 4. Decisiones de diseño clave

### Dinero en centavos
Todos los montos `*_cents` son `INTEGER` (centavos). Los valores existentes `amount NUMERIC` y `price NUMERIC` se conservan para retrocompatibilidad con el código mock. Los mappers (Fase 4.2) harán la conversión.

### `balance_cents` como columna GENERATED
```sql
balance_cents INTEGER GENERATED ALWAYS AS
  (total_cents - applied_cents - credit_applied_cents) STORED
```
Siempre consistente; nunca puede desincronizarse. Requiere PostgreSQL ≥ 12 (Supabase usa PG 15).

### `payments` ≠ `invoice_payments`
- `invoice_payments`: tabla legacy de pagos embebidos (per-invoice), conservada para el mock.
- `payments`: entidad nueva, independiente de facturas, con `client_id` directo.
- `payment_applications`: conciliación M:N entre `payments` e `invoices`.

En Fase 4.2, el billing service usará `payments` + `payment_applications`. La tabla `invoice_payments` quedará deprecada.

### service_subscriptions antes que subscription_id FK
La tabla `service_subscriptions` se crea al inicio de la migración para que la FK `invoices.subscription_id → service_subscriptions.id` sea válida.

---

## 5. Índices creados

| Índice | Tabla | Columnas | Tipo |
|--------|-------|---------|------|
| `idx_subs_client` | service_subscriptions | client_id | btree |
| `idx_subs_plan` | service_subscriptions | plan_id | btree |
| `idx_subs_status` | service_subscriptions | status | btree |
| `idx_inv_due_open` | invoices | due_date | parcial WHERE status IN ('unpaid','overdue') |
| `idx_inv_period` | invoices | billing_period_start, billing_period_end | btree |
| `idx_inv_balance_open` | invoices | balance_cents | parcial WHERE balance_cents > 0 |
| `idx_inv_sub` | invoices | subscription_id | btree |
| `uq_invoices_idempotency` | invoices | idempotency_key | UNIQUE parcial |
| `idx_payments_client` | payments | client_id | btree |
| `idx_payments_date` | payments | payment_date | btree |
| `idx_payments_date_mth` | payments | payment_date, method | btree |
| `uq_payments_idempotency` | payments | idempotency_key | UNIQUE parcial |
| `idx_pa_payment` | payment_applications | payment_id | btree |
| `idx_pa_invoice` | payment_applications | invoice_id | btree |
| `idx_cn_client` | credit_notes | client_id | btree |
| `idx_adj_invoice` | adjustments | invoice_id | btree |

---

## 6. Constraints

| Constraint | Tabla | Columnas | Tipo |
|-----------|-------|---------|------|
| `CHECK (amount_cents > 0)` | payments | amount_cents | inline CHECK |
| `CHECK (applied_cents > 0)` | payment_applications | applied_cents | inline CHECK |
| `CHECK (amount_cents > 0)` | credit_notes | amount_cents | inline CHECK |
| `CHECK (applied_cents > 0)` | credit_applications | applied_cents | inline CHECK |
| `CHECK (credit_balance_cents >= 0)` | clients | credit_balance_cents | inline CHECK |
| `CHECK (billing_day BETWEEN 1 AND 28)` | service_subscriptions | billing_day | inline CHECK |
| `UNIQUE (payment_id, invoice_id)` | payment_applications | — | tabla |
| `UNIQUE (credit_note_id, invoice_id)` | credit_applications | — | tabla |
| `UNIQUE receipt_number` | payment_receipts | receipt_number | tabla |

---

## 7. Cómo aplicar en staging

```bash
# Desde el directorio del proyecto, con la CLI de Supabase:
supabase db push

# O manualmente en el Supabase Dashboard (SQL Editor):
# Pegar y ejecutar 20260604000000_billing_schema.sql
# Luego ejecutar 20260604000001_billing_data_migration.sql
```

> **Prerequisito:** las migraciones anteriores (`20260531*`) ya deben estar aplicadas.
> Las migraciones son idempotentes: si se corren dos veces no duplican datos.

---

## 8. Cómo validar

```bash
# Validación rápida del esquema (columnas + tablas):
RUN_DB_TESTS=true node scripts/validate-billing-schema.mjs

# Tests de integración completos (incluye billing.schema.db.test.ts):
RUN_DB_TESTS=true npm run test:db
```

La validación del esquema verifica:
- Las 7 tablas nuevas existen y son accesibles.
- Las columnas nuevas en `clients`, `invoices` e `invoice_items` existen.
- `balance_cents` es seleccionable (confirma que la columna GENERATED se creó).
- Las facturas seed (si los clientes existen) tienen `balance_cents` correcto.

---

## 9. Rollback

**Sin redeploy (solo SQL):**
```sql
-- Eliminar tablas nuevas (CASCADE elimina FKs dependientes)
DROP TABLE IF EXISTS public.payment_receipts;
DROP TABLE IF EXISTS public.credit_applications;
DROP TABLE IF EXISTS public.credit_notes;
DROP TABLE IF EXISTS public.payment_applications;
DROP TABLE IF EXISTS public.payments;
DROP TABLE IF EXISTS public.adjustments;
DROP TABLE IF EXISTS public.service_subscriptions CASCADE;

-- Revertir columnas nuevas en invoices
ALTER TABLE public.invoices
  DROP COLUMN IF EXISTS subscription_id,
  DROP COLUMN IF EXISTS billing_period_start,
  DROP COLUMN IF EXISTS billing_period_end,
  DROP COLUMN IF EXISTS balance_cents,
  DROP COLUMN IF EXISTS subtotal_cents,
  DROP COLUMN IF EXISTS discount_cents,
  DROP COLUMN IF EXISTS tax_cents,
  DROP COLUMN IF EXISTS total_cents,
  DROP COLUMN IF EXISTS applied_cents,
  DROP COLUMN IF EXISTS credit_applied_cents,
  DROP COLUMN IF EXISTS canceled_at,
  DROP COLUMN IF EXISTS cancel_reason,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS cfdi_xml_url;

-- Revertir columnas nuevas en invoice_items
ALTER TABLE public.invoice_items
  DROP COLUMN IF EXISTS unit_price_cents,
  DROP COLUMN IF EXISTS discount_cents,
  DROP COLUMN IF EXISTS tax_rate,
  DROP COLUMN IF EXISTS sort_order;

-- Revertir columna nueva en clients
ALTER TABLE public.clients
  DROP COLUMN IF EXISTS credit_balance_cents;
```

> El código TypeScript **no necesita rollback** porque no se modificó en Fase 4.1.
> El backend sigue usando el mock (`USE_DB_BILLING=false`).

---

## 10. Verificación local

| Verificación | Resultado |
|-------------|-----------|
| `npm run typecheck` | ✅ sin errores |
| `npm test` (hermético, 77 pruebas) | ✅ 77 passed · 23 skipped |
| `npm run build` | ✅ build exitoso (warning chunk-size preexistente) |
| `RUN_DB_TESTS=true npm run test:db` | ✅ **12/12 passed** contra Supabase staging (2026-06-04) |

## 10.1 Resultado de aplicación en staging (2026-06-04)

**Método:** `psql` v18 — conexión directa `db.elshnzkceutvjzxvzqad.supabase.co:5432`.
El CLI `supabase` v2.67.1 falló por `health_timeout` no reconocida en config.toml (campo de v2.105+).

| Paso | Resultado |
|------|-----------|
| Migración 1 (`billing_schema.sql`) | ✅ Aplicada — 7 tablas + 26 índices + RLS + trigger |
| Migración 2 PART 1 (UPDATE `*_cents`) | ✅ 0 filas actualizadas (sin facturas previas en DB) |
| Migración 2 PART 2 (migrar `invoice_payments`) | ✅ 0 filas (tabla vacía) |
| Migración 2 PART 3 (seed facturas mock) | ⚠️ DO block fallido en `fac-102→c-2` (FK: `c-2` no existe en staging). Las facturas `fac-101`…`fac-105` **no** se sembraron. Staging solo tiene `c-1`, `c-staging-1`, `c-staging-2`. El DO block hizo rollback completo. |
| Migración 2 PART 4 (`service_subscriptions`) | ✅ 1 fila insertada: `sub-c-1` → `c-1/plan-basic/billing_day=1` |
| `RUN_DB_TESTS=true npm run test:db` | ✅ **12/12 passed** (billing 8 + plans 2 + customers 2) |

**Fallo esperado:** el seed de facturas asume los 5 clientes mock. Staging tiene solo `c-1` porque `USE_DB_CUSTOMERS=true` solo se usó para ese cliente. El DO block prueba `c-1` como proxy pero falla al insertar `fac-102` (referencia `c-2`). En Fase 4.2, el seed de facturas no será necesario — la UI los creará vía API.

---

## 11. Riesgos

| Riesgo | Severidad | Estado |
|--------|:---------:|--------|
| `balance_cents` GENERATED requiere PG 12+ | 🟢 | Supabase usa PG 17 en staging → sin riesgo |
| Migración `invoice_payments` → `payments` con IDs genéricos | 🟢 | Idempotente; tabla vacía en staging |
| Seed de facturas falla si clientes mock no están en DB | 🟡 | Ocurrió en staging (esperado); sin impacto en schema ni tests |
| CLI `supabase` v2.67.1 falla con `health_timeout` en config.toml | 🟡 | Resuelto usando `psql` directo; actualizar CLI a v2.105+ cuando sea posible |
| Columna `discount_cents` en ambas `invoices` e `invoice_items` | 🟢 | Tablas distintas; sin conflicto |
| UNIQUE parcial en `idempotency_key` (solo cuando no es NULL) | 🟢 | Diseño correcto para campos opcionales |

---

## 12. Instrucciones para Hermes (validación en staging)

1. Aplicar las dos migraciones en staging (Dashboard SQL Editor o `supabase db push`).
2. Correr `RUN_DB_TESTS=true node scripts/validate-billing-schema.mjs` contra el staging.
3. Correr `RUN_DB_TESTS=true npm run test:db` → deben pasar billing.schema.db.test.ts + customers + plans.
4. Verificar en el Supabase Dashboard que `public.invoices` tiene la columna `balance_cents`.
5. Verificar que `public.service_subscriptions` contiene las suscripciones de los clientes mock (si USE_DB_CUSTOMERS=true está activo).
6. Registrar el resultado (OK / hallazgos) aquí en esta sección.

---

## 13. Siguiente paso recomendado (Fase 4.2)

Con el esquema validado en staging, el siguiente paso es implementar:
- `backend/domains/billing/mappers.ts` — conversión centavos↔pesos + snake_case↔camelCase
- `backend/domains/billing/repository.ts` — `StoreBillingRepository` + `SupabaseBillingRepository`
- `backend/domains/billing/service.ts` — validaciones + factoría `getBillingService()`
- Refactor de `backend/domains/billing/routes.ts` — usar el service con `asyncHandler`

**No iniciar Fase 4.2 sin que las migraciones estén aplicadas y validadas en staging.**
